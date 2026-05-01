# OPENCODE-STACK AUDIT + REPO-AKTUALISIERUNGSPLAN

**Datum:** 2026-04-15
**Status:** 🔴 PLAN ERSTELLT
**Ausloeser:** User: "das meise ist veraltet... nicht mehr korrekt.. muss aktualisiert und auf neuesten stand der dinge gebracht werden!"

---

## 1. UEBERBLICK — REPO-LANDSCAPE

| Repo                                    | Org         | Zweck                                                                       | Status                     | Letztes Update |
| --------------------------------------- | ----------- | --------------------------------------------------------------------------- | -------------------------- | -------------- |
| **upgraded-opencode-stack**             | Delqhi/     | **SSOT** — Haupt-OpenCode-Config (Provider, Modelle, MCPs, Skills, Plugins) | ✅ AKTUELL                 | 2026-04-15     |
| **global-brain**                        | Delqhi/     | DPMA v4 — Persistent Code Plan Memory                                       | ✅ AKTUELL                 | 2026-04-15     |
| **dev-setup** (Infra-SIN-Dev-Setup)     | OpenSIN-AI/ | Dev Environment Setup                                                       | ✅ AKTUELL (Session heute) | 2026-04-15     |
| **OpenSIN-overview**                    | OpenSIN-AI/ | Single Source of Truth — Org-Uebersicht                                     | ⚠️ TEILWEISE               | Unbekannt      |
| **OpenSIN-documentation**               | OpenSIN-AI/ | Offizielle Doku (docs.opensin.ai)                                           | ⚠️ PRUEFEN                 | Unbekannt      |
| **OpenSIN-onboarding**                  | OpenSIN-AI/ | Autonomes First-Run Setup                                                   | ⚠️ PRUEFEN                 | Unbekannt      |
| **OpenSIN-backend**                     | OpenSIN-AI/ | Backend + A2A Fleet Control Plane                                           | ⚠️ PRUEFEN                 | Unbekannt      |
| **OpenSIN** (Core)                      | OpenSIN-AI/ | 310+ Packages, Haupt-Monorepo                                               | ⚠️ PRUEFEN                 | Unbekannt      |
| **OpenSIN-Code**                        | OpenSIN-AI/ | Autonomes OpenSIN CLI                                                       | ⚠️ PRUEFEN                 | Unbekannt      |
| **OpenSIN-WebApp**                      | OpenSIN-AI/ | chat.opensin.ai (Next.js 16)                                                | ⚠️ PRUEFEN                 | Unbekannt      |
| **Template-A2A-SIN-Agent**              | OpenSIN-AI/ | Blueprint fuer neue A2A-Agenten                                             | ⚠️ PRUEFEN                 | Unbekannt      |
| **OpenSIN-Marketing-Release-Strategie** | OpenSIN-AI/ | Marketing + Release Playbooks                                               | ⚠️ PRUEFEN                 | Unbekannt      |
| **website-opensin.ai**                  | OpenSIN-AI/ | Open-Source Marketing Website                                               | ⚠️ PRUEFEN                 | Unbekannt      |
| **website-my.opensin.ai**               | OpenSIN-AI/ | Commercial Marketplace (my.opensin.ai)                                      | ⚠️ PRUEFEN                 | Unbekannt      |

---

## 2. FRAGE: upgraded-opencode-stack (Delqhi/) — KANN DAS WEG?

### NEIN! upgraded-opencode-stack ist das SSOT!

**upgraded-opencode-stack** ist **NICHT veraltet** — es ist die **AKTUELLE REFERENZ** fuer das gesamte OpenSIN-Ökosystem:

- **Letztes Update:** 2026-04-15 (HEUTE!)
- **58 Dateien** im Haupt-Branch
- **44 Skills**, **4 Plugins**, **27 MCPs**, **12 Commands**, **5 Provider**
- **SSOT** — alles andere MUSS sich daran orientieren

### Was upgraded-opencode-stack ENTHAELT (und alles andere davon ableiten MUSS):

| Komponente   | Count | Referenz                                                       |
| ------------ | ----- | -------------------------------------------------------------- |
| Skills       | 44    | `skills/` Verzeichnis                                          |
| Plugins      | 4     | `plugin` Array in `opencode.json`                              |
| MCP Servers  | 27    | `mcp` Block in `opencode.json`                                 |
| Agents       | 21+   | `agent` Block in `opencode.json`                               |
| Commands     | 12    | `command` Block in `opencode.json`                             |
| Provider     | 5     | `provider` Block (google, openai, openrouter, qwen, modal)     |
| Team-Configs | 7     | `oh-my-sin.json`, `oh-my-openagent.json`, `my-sin-team-*.json` |

### WAS upgraded-opencode-stack NICHT IST:

- Es ist **KEIN** veraltetes Legacy-Repo
- Es ist **KEIN** Duplikat von etwas anderem
- Es ist das **AKTIVE** Konfigurations-Repository das via `sin-sync` auf alle Maschinen verteilt wird

### Empfohlene Aktion fuer upgraded-opencode-stack:

✅ **BEHALTEN** — Es ist das Herzstueck des OpenSIN-Ökosystems.
⚠️ **VERKNUEPFEN** — Alle anderen Repos MUESSEN explizit darauf verweisen als "Single Source of Truth".

---

## 3. VERALTETE INHALTE — WAS MUSS AKTUALISIERT WERDEN

### 3.1 OpenSIN-documentation (docs.opensin.ai)

**Problem:** Die Doku muss exakt mit upgraded-opencode-stack uebereinstimmen.

**Was pruefen:**

- Stimmen die installierten Skills/Plugins/MCPs mit upgraded-opencode-stack ueberein?
- Referenziert die Doku den korrekten SSOT (`Delqhi/upgraded-opencode-stack`)?
- Sind die Modell-Konfigurationen aktuell (gpt-5.4, antigravity-\*, qwen/coder-model)?
- Referenzieren die Setup-Anweisungen `sin-sync` und `oh-my-sin.json` korrekt?
- Ist der Box.com Storage Mandate aktualisiert (nicht mehr GitLab LogCenter)?

**Issue-Titel:** `docs: sync documentation with upgraded-opencode-stack v2.2.1 SSOT`

---

### 3.2 OpenSIN-overview

**Problem:** Muss die aktuelle Team-Struktur (17 Teams, oh-my-sin.json) korrekt abbilden.

**Was pruefen:**

- Stimmen die Team-Counts mit `oh-my-sin.json` ueberein?
- Ist die Agenten-Registry aktuell?
- Verweist es auf den korrekten SSOT?
- Sind die CI/CD-Infos aktuell (n8n + A2A-SIN-GitHub-Action, KEINE GitHub Actions)?

**Issue-Titel:** `docs: update org overview to reflect current 17-team structure + SSOT`

---

### 3.3 OpenSIN-onboarding

**Problem:** Muss den aktuellen Setup-Flow abbilden.

**Was pruefen:**

- Referenziert es `sin-sync` und `oh-my-sin.json` korrekt?
- Stimmt die Passwordmanager-Integration?
- Sind die API-Key-Registrierungen aktuell?
- Verweist es auf upgraded-opencode-stack als Config-Quelle?

**Issue-Titel:** `fix: update onboarding flow to use upgraded-opencode-stack SSOT + sin-sync`

---

### 3.4 OpenSIN-backend

**Problem:** Backend + A2A Fleet Control Plane muss konsistent sein.

**Was pruefen:**

- Stimmen die MCP-Endpoints mit `opencode.json` ueberein?
- Sind die CLI-Binaries (`sin-google-apps`, `sin-server`, etc.) aktuell?
- Verweist es auf korrekte OCI VM Configs?

**Issue-Titel:** `fix: sync backend MCP endpoints and CLI tools with upgraded-opencode-stack`

---

### 3.5 OpenSIN (Core Monorepo)

**Problem:** 310+ Packages — muss konsistent sein.

**Was pruefen:**

- Sind die Package-Namen korrekt? (`@opensin/sdk`, `@opensin/cli`, `@opensin/agent-sdk`, `@opensin/cli-tools`)
- Stimmen die Abhaengigkeiten mit SSOT ueberein?
- Verweisen die READMEs auf korrekte Docs?

**Issue-Titel:** `chore: sync core monorepo package structure with current SSOT`

---

### 3.6 OpenSIN-Code

**Problem:** CLI mit Browser/Computer-Use muss aktuell sein.

**Was pruefen:**

- Stimmen die Features (OpenSIN Bridge, sin-computer-use, sinInChrome) mit aktuellen Specs?
- Sind die MCP-Tools aktuell?
- CI/CD-Infos korrekt (n8n + sin-github-action)?

**Issue-Titel:** `fix: update OpenSIN-Code docs to reflect current Bridge + MCP surface`

---

### 3.7 OpenSIN-WebApp

**Problem:** chat.opensin.ai — Next.js 16 App.

**Was pruefen:**

- Referenziert sie korrekte A2A-Endpoints?
- Stimmen die Auth-Flows mit upgraded-opencode-stack ueberein?
- CI/CD-Infos korrekt?

**Issue-Titel:** `fix: sync WebApp config with current A2A endpoints + SSOT`

---

### 3.8 Template-A2A-SIN-Agent

**Problem:** Blueprint fuer neue Agenten.

**Was pruefen:**

- Stimmt das Template mit dem aktuellen `create-a2a-sin-agent` Skill ueberein?
- Sind die `agent.json`, `A2A-CARD.md`, `.well-known/` Strukturen aktuell?
- Marketplace-Metadata korrekt?

**Issue-Titel:** `fix: update template to match current create-a2a-sin-agent skill v2`

---

### 3.9 OpenSIN-Marketing-Release-Strategie

**Problem:** Marketing-Doku.

**Was pruefen:**

- Stimmen die Repo-Links?
- Sind die Zahlen aktuell (372 Packages, 620 Teams, 79 Blog Posts)?
- Verweist es auf korrekte Dashboards?

**Issue-Titel:** `docs: update marketing strategy with current metrics + SSOT links`

---

### 3.10 website-opensin.ai

**Problem:** Open-Source Website.

**Was pruefen:**

- Stimmen die Install-Anleitungen?
- Referenziert sie korrekte SSOT?
- CI/CD-Infos korrekt (Vercel/Cloudflare)?

**Issue-Titel:** `fix: update opensin.ai website content to reflect current SSOT`

---

### 3.11 website-my.opensin.ai

**Problem:** Commercial Marketplace.

**Was pruefen:**

- Stimmen die Marketplace-Team-Infos?
- Sind die Pricing-Infos aktuell?
- Referenziert sie korrekte A2A-Endpoints?

**Issue-Titel:** `fix: update my.opensin.ai marketplace content with current team structure`

---

## 4. MASSNAHMEN-PLAN

### Phase 1: Audit (Sofort)

- [x] Repo-Uebersicht erstellt
- [x] upgraded-opencode-stack als SSOT validiert
- [ ] Jedes Repo klonen und README + Key-Files pruefen
- [ ] Diskrepanzen gegen SSOT dokumentieren

### Phase 2: Issues erstellen (Dieser Schritt)

- [ ] Issue in OpenSIN-documentation
- [ ] Issue in OpenSIN-overview
- [ ] Issue in OpenSIN-onboarding
- [ ] Issue in OpenSIN-backend
- [ ] Issue in OpenSIN (Core)
- [ ] Issue in OpenSIN-Code
- [ ] Issue in OpenSIN-WebApp
- [ ] Issue in Template-A2A-SIN-Agent
- [ ] Issue in OpenSIN-Marketing-Release-Strategie
- [ ] Issue in website-opensin.ai
- [ ] Issue in website-my.opensin.ai

### Phase 3: Umsetzung (Durch Team Coder Flotte)

- [ ] SIN-Zeus dispatcht Issues an Team Coder
- [ ] PARALLEL: Jedes Repo wird aktualisiert
- [ ] Jedes Update verweist explizit auf `Delqhi/upgraded-opencode-stack` als SSOT
- [ ] Nach Update: `sin-sync` ausfuehren

### Phase 4: Verifikation

- [ ] Alle READMEs verweisen auf SSOT
- [ ] Alle CI/CD-Infos korrekt (n8n + A2A-SIN-GitHub-Action)
- [ ] Keine veralteten GitHub Actions Referenzen
- [ ] Box.com Storage Mandate ueberall aktualisiert

---

## 5. SSOT-DEFINITION

**Single Source of Truth = `Delqhi/upgraded-opencode-stack`**

Alle anderen Repos MUESSEN in ihrem README explizit darauf verweisen:

```markdown
## Single Source of Truth

Dieses Repo ist Teil des OpenSIN-Ökosystems.
Die kanonische OpenCode-Konfiguration liegt unter:
**https://github.com/Delqhi/upgraded-opencode-stack**

Nach Aenderungen an `opencode.json` MUSS `sin-sync` ausgefuehrt werden.
```

---

**Erstellt von:** Antigravity Agent
**Datum:** 2026-04-15
**Gespeichert in:** `Delqhi/global-brain`
