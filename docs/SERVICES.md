# Studiio – Services & Architektur

Kurze Übersicht der Anwendungs-Services und wie sie getestet werden.

## Frontend (React + Vite)

- **Ort:** `frontend/src/`
- **Start:** `npm run dev` (Port 5173)
- **Build:** `npm run build`
- Nutzeroberfläche, Auth, Dashboard, Tutor, Vokabeln, Lernplan. Spricht mit Backend über `/api/*` (Proxy im Dev) und direkt mit Supabase (Auth, DB, Storage).

## Backend (Express – Claude-Proxy & PDF)

- **Ort:** `backend/index.mjs`
- **Start:** `npm run api` (Port 8788)
- **Routen:**
  - `GET /health`, `GET /api/health` – Health-Check
  - `POST /api/claude` – Proxy zu Anthropic Claude (BYOK: API-Key aus dem Request-Body)
  - `POST /api/pdf-text` – PDF aus Supabase Storage laden und Text extrahieren
  - `POST /api/generate-flashcards` – Karteikarten aus Text generieren (Claude)
  - `POST /api/evaluate-answer` – Offene Antwort bewerten (Claude)
  - `POST /api/suggest-mcq-options` – MC-Optionen vorschlagen (Claude)
- **Umgebungsvariablen:** `backend/.env` – `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `PORT`

## Supabase

- **Auth:** Login/Registrierung, Session, Passwort-Reset
- **Datenbank:** `profiles`, `subjects`, `materials`, `flashcards`, `flashcard_reviews`, `user_streaks`, `user_learning_time`, `learning_plan_tasks`
- **Storage:** Bucket `materials` für PDF-Uploads
- Konfiguration im Frontend über `frontend/src/supabaseClient.js` (URL + anon key), Backend nutzt Service-Role-Key für Storage/DB.
- **Schema:** SQL-Dateien in `database/`, manuell im Supabase SQL-Editor ausführen (siehe `database/README.md`).

## Tests

- **Runner:** Vitest
- **Unit-Tests:** z. B. `frontend/src/utils/learningTime.js` (z. B. `formatLearningTime`) – in `tests/unit/`
- **API-Tests:** `tests/api/api-http.test.js` – rufen laufenden Server (Port 8788) per HTTP auf. Ohne laufenden Server werden die Tests übersprungen. Für volle API-Checks: zuerst `npm run api` starten, dann `npm run test:run`.

### Befehle

```bash
npm run test        # Vitest im Watch-Modus
npm run test:run    # Einmaliger Lauf
npm run test:coverage   # Mit Coverage-Bericht
```

### Was getestet wird

- **Unit:** Reine Hilfsfunktionen (z. B. Zeitformatierung) ohne Supabase/Netzwerk.
- **API:** `GET /health`, `GET /api/health`, `POST /api/claude` (Validierung), `POST /api/pdf-text` (Validierung), 404 für unbekannte Routen. Keine echten Claude- oder Supabase-Calls in den Tests.

## Dokumentation

- **Projektregeln & Features:** `.cursorrules`
- **Backend-Details:** `backend/README.md` (falls vorhanden)
- **Git/GitHub:** `GITHUB_SETUP.md`
