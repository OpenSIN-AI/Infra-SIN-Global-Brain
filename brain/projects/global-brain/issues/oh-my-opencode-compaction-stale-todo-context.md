# BUG-REPORT: OH-MY-OPENCODE System Directive / Compaction Context zeigt stale Daten

**Datum:** 2026-04-15
**Status:** 🔴 OFFEN
**Priorität:** HOCH
**Betroffene Komponente:** `oh-my-opencode-sin` compaction system, todo-continuation-enforcer, compaction-context-injector

---

## 1. Symptom (Was passiert)

Die "OH-MY-OPENCODE - TODO CONTINUATION" System-Direktive zeigt **veraltete/stale Daten** aus einer früheren Session:

```
[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]
Incomplete tasks ...
```

- Die angezeigte TODO-Liste enthält Tasks, die bereits in der vorherigen Session erledigt wurden
- ODER die TODO-Liste zeigt einen Zustand, der nicht dem aktuellen Session-Zustand entspricht
- Die Direktive erscheint am Ende jeder Session, aber die Daten darin stimmen nicht mit der aktuellen Arbeit überein

---

## 2. Was war die ursprüngliche Absicht?

Das OH-MY-OPENCODE Compaction-System sollte:

1. **Am Ende jeder Session** eine kompakte Kontext-Zusammenfassung generieren
2. **TODO-Zustand erfassen** - welche Todos sind incomplete, welche completed
3. **Diese Information in die nächste Session injizieren** via `COMPACTION_CONTEXT_PROMPT`
4. **Guard-Mechanismus** (`compaction-guard`) sorgt dafür, dass die Kompaktion nur unter richtigen Bedingungen ausgelöst wird

Das "TODO CONTINUATION" Feature sollte dem nächsten Agenten zeigen:

- Welche Tasks noch offen sind
- Den aktuellen Fortschritt
- Den Kontext der vorherigen Session

---

## 3. Architektur-Analyse

### 3.1 Beteiligte Komponenten

| Komponente                  | Datei                                                                   | Zweck                                          |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `session-todo-status`       | `dist/hooks/session-todo-status.d.ts`                                   | Prüft ob Session offene Todos hat              |
| `todo`                      | `dist/hooks/claude-code-hooks/todo.d.ts`                                | Todo-Datei laden/speichern pro Session         |
| `compaction-context-prompt` | `dist/hooks/compaction-context-injector/compaction-context-prompt.d.ts` | Generiert den COMPACTION_CONTEXT_PROMPT String |
| `compaction-guard`          | `dist/hooks/todo-continuation-enforcer/compaction-guard.d.ts`           | Guard für Kompaktions-Timing                   |
| `pre-compact-handler`       | `dist/hooks/claude-code-hooks/handlers/pre-compact-handler.d.ts`        | Pre-Compaction Handler                         |
| `hasIncompleteTodos`        | `session-todo-status.d.ts`                                              | Prüft ob Todos incomplete sind                 |

### 3.2 Data Flow

```
Session Start
    ↓
[hasIncompleteTodos] prüft Session-ID basierend
    ↓
[todo.d.ts] loadTodoFile(sessionId) lädt TodoFile
    ↓
[compaction-context-prompt] generiert COMPACTION_CONTEXT_PROMPT
    ↓
System-Direktive wird injiziert
    ↓
Session Ende → pre-compact-handler
    ↓
saveTodoFile(sessionId, todoFile) speichert Zustand
```

---

## 4. Mögliche Ursachen (Root Cause Hypothesis)

### Hypothese 1: Session-ID Mismatch

- Die `loadTodoFile(sessionId)` verwendet möglicherweise eine falsche oder veraltete Session-ID
- Die Session-ID könnte sich zwischen den Sessions ändern
- **Debugging:** Session-ID vergleichen zwischen den Runs

### Hypothese 2: Todofile wird nicht korrekt gespeichert

- `saveTodoFile()` schreibt möglicherweise nicht den aktuellen Zustand
- File-I/O Fehler werden verschluckt (`try/catch {}`)
- **Debugging:** Todofile nach Session-Ende prüfen unter `/tmp` oder `~/.config/opencode/`

### Hypothese 3: Compaction Guard Timing-Problem

- `armCompactionGuard()` / `acknowledgeCompactionGuard()` funktionieren nicht richtig
- Guard wird nicht korrekt "geschärft" oder "acknowledged"
- **Debugging:** Guard-State nach Session prüfen

### Hypothese 4: COMPACTION_CONTEXT_PROMPT使用的是缓存数据

- Der `COMPACTION_CONTEXT_PROMPT` String wird zur Build-Zeit generiert, nicht zur Runtime
- Falls die Kompilierung eine alte Version eingefroren hat, würden stale Daten verwendet
- **Debugging:** String-Inhalt in dist prüfen

### Hypothese 5: Pre-Compaction Handler触发时机不对

- Der `pre-compact-handler` wird zum falschen Zeitpunkt ausgeführt
- Die Todo-Daten werden gespeichert NACHdem die Kompaktion bereits erfolgt ist
- **Debugging:** Log-Ausgabe von pre-compact prüfen

---

## 5. Debugging-Schritte (Sofort)

### 5.1 Todofile finden und prüfen

```bash
# Todofiles suchen
find /tmp -name "*.json" 2>/dev/null | xargs grep -l "todo" 2>/dev/null | head -5
find ~/.config/opencode -name "*todo*" 2>/dev/null | head -10

# Session-spezifische Todofiles
find /tmp -name "*sin-executor*" 2>/dev/null | head -5
find /tmp -name "*session*" 2>/dev/null | grep -i todo | head -5
```

### 5.2 Session-ID herausfinden

```bash
# Offene Sessions auflisten
opencode session list

# Letzten Commit/State der Session prüfen
cat ~/.opencode/sessions/*/metadata.json 2>/dev/null | head -50
```

### 5.3 Compaction Hook Log prüfen

```bash
# oh-my-opencode Logfile finden
cat /tmp/oh-my-opencode.log 2>/dev/null | tail -50

# Compaction-relevante Einträge
grep -i "compaction\|todo\|guard" /tmp/oh-my-opencode.log 2>/dev/null | tail -30
```

---

## 6. Fix-Vorschläge

### Fix 1: Session-ID Tracking verbessern

- Session-ID muss explizit durch den gesamten Kompaktions-Flow durchgereicht werden
- Logging hinzufügen: "Using session ID: X for TODO load"

### Fix 2: Todofile-Validierung

- Prüfen ob die geladene Todofile zur aktuellen Session gehört (Timestamp/ID-Match)
- Bei Mismatch: frischen Zustand vom Agenten holen statt cached Version

### Fix 3: Guard-State Debugging

- `armCompactionGuard()` und `acknowledgeCompactionGuard()` mit console.log versehen
- Guard-State nach jeder Session speichern und beim Start laden

### Fix 4: Pre-Save Verification

- Bevor `saveTodoFile()` aufgerufen wird: Verifikation dass Daten korrekt sind
- Nach dem Speichern: Direkt nochmal laden und vergleichen

### Fix 5: Runtime Prompt Generation

- `COMPACTION_CONTEXT_PROMPT` sollte zur Runtime generiert werden, nicht zur Build-Zeit
- Aktuellen TODO-Zustand direkt in den Prompt einbetten

---

## 7. Betroffene Dateien (lokal)

| Pfad                                                                                                                                    | Relevant für                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `/Users/jeremy/.config/opencode/local-plugins/oh-my-opencode-sin/dist/index.js`                                                         | Kompiliertes Bundle - schwer zu debuggen |
| `/Users/jeremy/.config/opencode/local-plugins/oh-my-opencode-sin/dist/hooks/session-todo-status.d.ts`                                   | TODO-Status Check                        |
| `/Users/jeremy/.config/openplice/oh-my-opencode-sin/dist/hooks/claude-code-hooks/todo.d.ts`                                             | Todo-Datei Load/Save                     |
| `/Users/jeremy/.config/opencode/local-plugins/oh-my-opencode-sin/dist/hooks/compaction-context-injector/compaction-context-prompt.d.ts` | Prompt-Generierung                       |
| `/Users/jeremy/.config/opencode/local-plugins/oh-my-opencode-sin/dist/hooks/todo-continuation-enforcer/compaction-guard.d.ts`           | Guard-Mechanismus                        |

---

## 8. Nächste Schritte

1. [ ] Debugging-Logs aktivieren in oh-my-opencode-sin
2. [ ] Todofiles im System finden und analysieren
3. [ ] Session-ID Tracking prüfen
4. [ ] Guard-State nach Sessions prüfen
5. [ ] Issue im oh-my-opencode GitHub erstellen falls hauseigener Bug
6. [ ] Workaround implementieren falls Bug nicht schnell fixbar

---

## 9. Workaround (falls Bug nicht zeitnah fixbar)

Falls der Bug nicht schnell behoben werden kann:

1. **Manuelle TODO-Injection**: Am Ende jeder Session manuell den TODO-Stand in die globale Brain-Datenbank schreiben
2. **PCPM nutzen**: Statt TODO CONTINUATION die `.pcpm/active-context.json` nutzen für Session-Übergabe
3. **Vor jeder Aufgabe**: Explizit den Agenten bitten, den aktuellen TODO-Stand selbst zu erfassen und zu berichten

---

**Agent:** Antigravity
**Session:** aktuelle Session
**Repo:** Delqhi/global-brain
**Gespeichert:** 2026-04-15
