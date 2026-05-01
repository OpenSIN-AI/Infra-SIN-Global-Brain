# Box.com CORS Aktivierung — Schritt-für-Schritt

## Ziel

Box.com API-Zugriff von `http://localhost:3000` und `http://room-09-box-storage:3000` erlauben.

## Manuelle Schritte (MUSS VOM USER GEMACHT WERDEN!)

### 1. Developer Console öffnen

```
https://account.box.com/developers/console
```

- **Account:** zukunftsorientierte.energie@gmail.com

### 2. App auswählen

- Klicke auf **"Meine Plattform-Apps"** in der linken Sidebar
- Klicke auf die App (wahrscheinlich `room-09-box-storage` oder ähnlich)

### 3. Configuration Tab öffnen

- Klicke auf den **"Configuration"** Tab (nicht "General"!)

### 4. CORS Domains finden (GANZ UNTEN!)

- Scrolle **GANZ NACH UNTEN** zum Abschnitt **"CORS Domains"**
- Dort findest du ein Textfeld

### 5. CORS Domains eintragen

Trage folgende Domains ein (kommagetrennt):

```
http://localhost:3000,http://room-09-box-storage:3000
```

> [!IMPORTANT]
>
> - MIT Komma getrennt!
> - KEINE Leerzeichen!
> - Protocol (http/https) MUSS stimmen!

### 6. Speichern

- Klicke **"Save"** oder **"Apply"**

---

## Screenshot-Ablauf

```
┌─────────────────────────────────────────────────────────┐
│  Developer Console                                       │
│  ┌──────────┐                                           │
│  │ Meine    │ ← Hier klicken                            │
│  │ Plattform│                                           │
│  │ -Apps    │                                           │
│  └──────────┘                                           │
│                                                          │
│  [Deine App auswählen]                                   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Configuration Tab ← HIER KLICKEN                 │   │
│  │ General | Configuration | Webhooks | etc.        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ... (viel scrollen) ...                                │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ CORS Domains                                    │   │
│  │ ┌───────────────────────────────────────────┐   │   │
│  │ │ http://localhost:3000,                     │   │   │
│  │ │ http://room-09-box-storage:3000           │   │   │
│  │ └───────────────────────────────────────────┘   │   │
│  │                              [Save] Button       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Verifizierung

Nach dem Speichern kannst du testen mit:

```bash
curl -X OPTIONS "https://api.box.com/2.0/files/376915767916" \
  -H "Authorization: Bearer DEIN_TOKEN" \
  -H "Access-Control-Request-Headers: Authorization" \
  -H "Origin: http://localhost:3000" \
  -v 2>&1 | grep -i "access-control"
```

---

## Falls keine App existiert

Falls du noch keine App hast:

1. **Create Platform App** klicken
2. **User Authentication (OAuth 2.0)** auswählen
3. App-Name: `room-09-box-storage`
4. Nach dem Erstellen → Configuration Tab → CORS Domains

---

## Credentials für Box API (bereits gespeichert)

```
TOKEN= f9PURW50E47k9dwoVKkBD64QLJLnC4Nx
PUBLIC_FOLDER_ID= 376915767916
CACHE_FOLDER_ID= 376701205578
```

---

## Troubleshooting

| Problem                         | Lösung                                     |
| :------------------------------ | :----------------------------------------- |
| CORS-Seite nicht gefunden       | Ganz nach unten scrollen!                  |
| Save-Button funktioniert nicht  | Browser-Konsole prüfen für JS-Errors       |
| Domains werden nicht akzeptiert | Nur HTTP/HTTPS + Port, kein trailing slash |
