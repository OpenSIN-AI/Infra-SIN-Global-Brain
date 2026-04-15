# Chrome Password Manager Integration

## Überblick

OpenSIN-Agenten können **automatisch** auf Chrome-gespeicherte Passwörter zugreifen. Der User hat bereits ein System gebaut, das:
- Passwörter aus Chrome's SQLite-Datenbank extrahiert
- Diese mit dem macOS Keychain entschlüsselt (Chrome Safe Storage)
- Cookies aus Chrome für Session-Wiederverwendung extrahiert

## Wichtigste Regeln

1. **IMMERS Chrome gespeicherte Passwörter VOR Nutzung verwenden**
2. **NIEMALS Menschen für Passwörter belästigen**
3. **Credentials IMMER automatisch in sin-passwordmanager speichern**

## Architektur

### Hauptkomponenten

```
A2A-SIN-Google-Apps/src/chrome/
├── password-manager.ts    # Extrahiert Passwörter aus Chrome
├── cookie-extractor.ts    # Extrahiert Cookies aus Chrome
```

### Verschlüsselung

Chrome macOS verwendet:
- **Keychain**: "Chrome Safe Storage" Passwort
- **Algorithmus**: AES-256-CBC mit v10/v11 Prefix
- **Key-Derivation**: scrypt('saltysalt')

## API Referenz

### password-manager.ts

```typescript
import { 
  listChromeProfiles,
  extractCredentialsFromProfile,
  searchCredentials,
  getCredentialForService,
  checkPasswordManagerAccess
} from './chrome/password-manager';

// Alle Chrome-Profile auflisten
const profiles = listChromeProfiles();
// → [{ name: 'Default', path: '/Users/...', email: 'user@gmail.com' }, ...]

// Credentials aus Default-Profil für google.com
const creds = extractCredentialsFromProfile('Default', { origin: 'google.com' });

// Passwort für spezifischen Service
const googleCred = getCredentialForService('google.com');
// → { origin, username, password, ... }

// Verfügbarkeit prüfen
const status = checkPasswordManagerAccess();
// → { available: true, profiles: 3 }
```

### cookie-extractor.ts

```typescript
import {
  extractCookiesFromProfile,
  getSessionCookiesForDomain,
  getAuthCookies,
  exportCookiesNetscape,
  exportCookiesJSON
} from './chrome/cookie-extractor';

// Cookies für Domain
const cookies = getSessionCookiesForDomain('google.com', 'Default');

// Auth-Cookies (sid, session, auth, token, etc.)
const authCookies = getAuthCookies('Default');

// Export für curl/httpie
const netscapeFormat = exportCookiesNetscape(cookies);
// # Netscape HTTP Cookie File
// .google.com	TRUE	/	TRUE	0	SID	xxx

// Export als JSON
const jsonFormat = exportCookiesJSON(cookies);
```

## Benutzung

### 1. Automatische Credential-Suche vor Login

```typescript
async function autoLogin(service: string) {
  // Erst Chrome-Credentials versuchen
  const chromeCred = getCredentialForService(service);
  
  if (chromeCred?.password) {
    // Chrome-Passwort gefunden → direkt nutzen
    await login(service, chromeCred.username, chromeCred.password);
    return;
  }
  
  // Fallback: sin-passwordmanager
  const storedCred = await sinPasswordmanager.get(service);
  if (storedCred) {
    await login(service, storedCred.username, storedCred.password);
    return;
  }
  
  // Final: sin-google-apps für OAuth
  await sinGoogleApps.oauthLogin(service);
}
```

### 2. Session-Wiederverwendung

```typescript
async function reuseSession(service: string) {
  // Chrome-Cookies für Session holen
  const cookies = getSessionCookiesForDomain(service);
  
  if (cookies.length > 0) {
    // Chrome-Session existiert → wiederverwenden
    await restoreSession(service, cookies);
    return true;
  }
  return false;
}
```

## Sicherheit

- Passwörter werden **NIEMALS** als Klartext geloggt
- Temp-Dateien werden nach Lesen gelöscht
- Nur entschlüsselte Passwörter im Memory behalten

## Troubleshooting

### Problem: "No Chrome profiles found"

**Lösung**: Chrome muss mind. einmal gestartet worden sein, um Profile zu erstellen.

### Problem: "Keychain access denied"

**Lösung**: macOS Keychain Passwort "Chrome Safe Storage" muss für den aktuellen User existieren. Chrome muss einmal mit dem User gestartet worden sein.

### Problem: Password decryption fails

**Lösung**: Falsches Chrome-Profil oder Keychain-Passwort wurde geändert. Chrome-Profile können mehrere Keychain-Einträge haben - der richtige muss verwendet werden.

## Dateien im Repo

- `/Users/jeremy/dev/A2A-SIN-Google-Apps/src/chrome/password-manager.ts` - Vollständige Implementierung
- `/Users/jeremy/dev/A2A-SIN-Google-Apps/src/chrome/cookie-extractor.ts` - Vollständige Implementierung

## Neue Agenten-Anweisung (für Global Brain)

```
FÜR ALLE AGENTEN (PFLICHT!):
1. Bevor du ein Passwort eingibst oder einen Login machst:
   → Prüfe IMMER zuerst Chrome Password Manager (A2A-SIN-Google-Apps)
   → Suche nach gespeicherten Credentials für die Domain
2. Wenn Chrome-Credential gefunden:
   → Speichere es AUTOMATISCH in sin-passwordmanager
   → Nutze es sofort ohne den User zu belästigen
3. Wenn KEIN Chrome-Credential:
   → Versuche sin-passwordmanager
   → Versuche sin-google-apps OAuth
   → NIEMALS den User nach Passwort fragen!
4. Credentials MÜSSEN IMMER zuerst in sin-passwordmanager gespeichert werden,
   bevor sie irgendwo genutzt werden.
```