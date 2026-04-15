# Box.com Storage — VERIFIZIERTE KONFIGURATION

**Status:** FUNKTIONIERT ✅ (2026-04-15 verifiziert)

## API Credentials

| Parameter | Wert |
|:---|:---|
| Developer Token | `f9PURW50E47k9dwoVKkBD64QLJLnC4Nx` |
| Account ID | `50440114812` |
| Account Name | Jeremy Schulze |
| Space Total | 10 GB |
| Space Used | ~1.5 MB |

## Ordner IDs (NUMERISCH, NICHT Share-Links!)

| Ordner | Numerische ID | Share-URL |
|:---|:---|:---|
| Public | `376915767916` | https://app.box.com/s/mvurec77pppyqhxb09z1dwcf8bz4o7eu |
| Cache | `376701205578` | https://app.box.com/s/9s5htoefw1ux9ajaqj656v9a02h7z7x1 |

> [!WARNING]
> **API nutzt NUR numerische IDs!** Share-Links (z.B. `9s5htoefw1ux9ajaqj656v9a02h7z7x1`) sind für Menschen, NICHT für API-Calls!

## API Test (verifiziert funktioniert)

```bash
# Account Info
curl -s -X GET "https://api.box.com/2.0/users/me" \
  -H "Authorization: Bearer f9PURW50E47k9dwoVKkBD64QLJLnC4Nx"
# Erwartet: {"type":"user","id":50440114812,"name":"Jeremy Schulze",...}

# Folder Liste
curl -s -X GET "https://api.box.com/2.0/folders/0/items" \
  -H "Authorization: Bearer f9PURW50E47k9dwoVKkBD64QLJLnC4Nx"

# Test Upload
curl -s -X POST "https://upload.box.com/api/2.0/files/content" \
  -H "Authorization: Bearer f9PURW50E47k9dwoVKkBD64QLJLnC4Nx" \
  -F attributes='{"name":"test.txt","parent":{"id":"376701205578"}}' \
  -F file=@/dev/null
```

## .env Configuration (für A2A-SIN-Box-Storage Service)

```env
BOX_STORAGE_URL=http://room-09-box-storage:3000
BOX_STORAGE_API_KEY=<user_must_set>
BOX_DEVELOPER_TOKEN=f9PURW50E47k9dwoVKkBD64QLJLnC4Nx
BOX_PUBLIC_FOLDER_ID=376915767916
BOX_CACHE_FOLDER_ID=376701205578
```

## Was noch fehlt

| Aufgabe | Status |
|:---|:---|
| CORS in Developer Console aktivieren | ⏳ MANUELL |
| A2A-SIN-Box-Storage deployen | ⏳ MANUELL |
| JWT für Produktion (statt 60min Token) | ⏳ OFFEN |

## Dokumentation

- `box-storage.md` in `OpenSIN-AI/Infra-SIN-Dev-Setup` (verbessert 2026-04-15)
- `upgraded-opencode-stack/box-storage.md` (dieselbe Datei)

## Repos

- https://github.com/OpenSIN-AI/Infra-SIN-Dev-Setup
- https://github.com/Delqhi/upgraded-opencode-stack