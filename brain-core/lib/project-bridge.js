/**
 * ProjectBridge — keeps the on-disk `brain/projects/<id>/` and `.pcpm/` tiers
 * consistent with the live Store.
 *
 * The local file tree is no longer the source of truth but must stay readable
 * by every existing tool (git, manual grep, old agents that haven't adopted
 * the client yet). We:
 *
 * 1. Ingest the existing tree on boot: replay every knowledge entry as
 *    `knowledge.add` WAL records (idempotent via entry.id) so the Store
 *    matches what's on disk.
 * 2. Mirror live updates back to disk in small debounced batches so git
 *    history stays meaningful without hammering the filesystem.
 */

import path from "node:path";

import { createRepositoryLayout, createProjectBrainLayout } from "../../src/lib/layout.js";
import { readJsonFile, writeJsonFile, ensureDir } from "../../src/lib/storage.js";
import { promises as fs } from "node:fs";

export class ProjectBridge {
  constructor({ store, workspaceRoot }) {
    this.store = store;
    this.workspaceRoot = workspaceRoot;
    this.pendingMirror = new Map(); // projectId -> timer
  }

  async ingestAll() {
    const projectsRoot = path.join(this.workspaceRoot, "brain", "projects");
    const entries = await fs.readdir(projectsRoot).catch(() => []);
    for (const projectId of entries) {
      await this.ingestProject(projectId);
    }
    // Also ingest global knowledge once.
    const globalFile = path.join(this.workspaceRoot, "brain", "global", "knowledge.json");
    const globalDoc = await readJsonFile(globalFile, { entries: [] });
    for (const entry of globalDoc.entries ?? []) {
      if (entry.status !== "active") continue;
      await this.store.addKnowledge(entry, { actor: "boot-ingest-global" });
    }
  }

  async ingestProject(projectId) {
    const layout = await createRepositoryLayout({
      rootDir: this.workspaceRoot,
      projectId
    });
    const doc = await readJsonFile(layout.projectKnowledgeFile, { entries: [] });
    for (const entry of doc.entries ?? []) {
      if (entry.status !== "active") continue;
      await this.store.addKnowledge(entry, { actor: "boot-ingest-project" });
    }
  }

  /**
   * Debounced mirror. Multiple writes within 500 ms collapse into one flush.
   */
  scheduleMirror(projectId) {
    if (this.pendingMirror.has(projectId)) return;
    const timer = setTimeout(async () => {
      this.pendingMirror.delete(projectId);
      await this.mirrorProject(projectId).catch((err) => {
        console.error("[brain] mirror failed", projectId, err.message);
      });
    }, 500);
    this.pendingMirror.set(projectId, timer);
  }

  async mirrorProject(projectId) {
    const layout = await createRepositoryLayout({
      rootDir: this.workspaceRoot,
      projectId
    });
    const projectEntries = [];
    const globalEntries = [];
    for (const entry of this.store.cache.entries.values()) {
      if (entry.scope === "global") {
        globalEntries.push(entry);
      } else if (entry.source?.projectId === projectId) {
        projectEntries.push(entry);
      }
    }
    await writeJsonFile(layout.projectKnowledgeFile, { entries: projectEntries });
    await writeJsonFile(layout.globalKnowledgeFile, { entries: globalEntries });
  }

  /**
   * Every project gets a tiny `.pcpm/brain-pointer.json` so local agents
   * know which daemon to talk to. Non-destructive: existing .pcpm contents
   * stay untouched.
   */
  async writeBrainPointer(projectRoot, { url, projectId }) {
    const layout = await createProjectBrainLayout(projectRoot);
    const pointerFile = path.join(layout.localRoot, "brain-pointer.json");
    await ensureDir(layout.localRoot);
    await writeJsonFile(pointerFile, {
      url,
      projectId,
      updatedAt: new Date().toISOString()
    });
    return pointerFile;
  }
}
