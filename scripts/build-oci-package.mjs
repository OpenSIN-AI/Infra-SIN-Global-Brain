/**
 * Builds the one-shot OCI deploy package: brain-oci.tar.gz
 *
 * Contents (everything needed to run the brain-core daemon standalone):
 *   install.sh                  (entry point — same as brain-core/deploy/install-oci.sh)
 *   brain-core.service          (systemd unit)
 *   brain-core/                 (daemon + transports + engines + seed)
 *   brain-client/               (thin client for agents on the same host)
 *   src/                        (legacy engines still imported by handlers — embeddings etc.)
 *   scripts/brain-smoke.mjs     (so ops can `npm run brain:smoke` on the VM)
 *   scripts/brain-client-smoke.mjs
 *   scripts/brain-seed-smoke.mjs
 *   AGENTS.md                   (initial ultra canon source)
 *   package.json + package-lock.json (reproducible `npm ci`)
 *
 * On the VM, one command installs everything:
 *   tar xzf brain-oci.tar.gz -C /tmp/brain-oci && sudo bash /tmp/brain-oci/install.sh
 *
 * The archive ships with NO node_modules so the VM builds fresh against its
 * native toolchain — crucial for optional native modules like hnswlib-node.
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(repoRoot, "brain-oci.tar.gz");
const stage = path.join(os.tmpdir(), `brain-oci-build-${Date.now()}`);

// Files / directories that MUST be in the archive.
const includes = [
  "brain-core",
  "brain-client",
  "src",
  "AGENTS.md",
  "README.md",
  "ROADMAP.md",
  "package.json",
  "package-lock.json",
  "scripts/brain-smoke.mjs",
  "scripts/brain-client-smoke.mjs",
  "scripts/brain-seed-smoke.mjs",
  "scripts/brain-meta-smoke.mjs"
];

console.log(`[pack] staging -> ${stage}`);
mkdirSync(stage, { recursive: true });

for (const rel of includes) {
  const src = path.join(repoRoot, rel);
  const dst = path.join(stage, rel);
  if (!existsSync(src)) {
    console.warn(`[pack] skipping missing: ${rel}`);
    continue;
  }
  const s = statSync(src);
  if (s.isDirectory()) {
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(src, dst, {
      recursive: true,
      filter: (src2) => {
        if (/node_modules/.test(src2)) return false;
        if (/\.DS_Store$/.test(src2)) return false;
        return true;
      }
    });
  } else {
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  console.log(`[pack]   + ${rel}`);
}

// Flatten the installer + unit to the archive root for the one-liner UX.
cpSync(path.join(repoRoot, "brain-core/deploy/install-oci.sh"), path.join(stage, "install.sh"));
cpSync(path.join(repoRoot, "brain-core/deploy/brain-core.service"), path.join(stage, "brain-core.service"));

// Short README inside the archive.
writeFileSync(
  path.join(stage, "INSTALL.md"),
  [
    "# ONE-BRAIN — OCI install package",
    "",
    "Extract and run:",
    "",
    "    tar xzf brain-oci.tar.gz -C /tmp/brain-oci",
    "    sudo bash /tmp/brain-oci/install.sh",
    "",
    "Env overrides (all optional):",
    "    BRAIN_WORKSPACE=/srv/global-brain",
    "    BRAIN_DATA_DIR=/var/lib/brain",
    "    BRAIN_HTTP_PORT=7070",
    "    BRAIN_NATS_URL=nats://127.0.0.1:4222",
    "    INSTALL_NATS=1          # set 0 to keep your own nats-server",
    "    INSTALL_HNSW=1          # set 0 to skip native HNSW try",
    "    SEED_AGENTS_MD=1        # set 0 to skip initial PRIORITY-canon seed",
    "",
    "The installer writes a systemd unit (brain-core.service), a service user",
    "`brain`, installs production deps with `npm ci`, optionally fetches",
    "nats-server v2.10.22, starts the daemon and (by default) seeds the",
    "PRIORITY -10..-4 canon from AGENTS.md.",
    ""
  ].join("\n")
);

// Reproducibility hint.
writeFileSync(
  path.join(stage, "VERSION"),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      node: process.version,
      source: "global-brain repo",
      contents: includes.concat(["install.sh", "brain-core.service", "INSTALL.md"])
    },
    null,
    2
  )
);

console.log(`[pack] tar czf ${outFile}`);
execSync(`tar czf "${outFile}" -C "${stage}" .`, { stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });

const sizeMb = (statSync(outFile).size / (1024 * 1024)).toFixed(1);
console.log(`[pack] OK — ${outFile} (${sizeMb} MB)`);
console.log("\nOn the VM 92.5.60.87 (one command):");
console.log(`  scp brain-oci.tar.gz ubuntu@92.5.60.87:/tmp/`);
console.log(`  ssh ubuntu@92.5.60.87 'mkdir -p /tmp/brain-oci && tar xzf /tmp/brain-oci.tar.gz -C /tmp/brain-oci && sudo bash /tmp/brain-oci/install.sh'`);
