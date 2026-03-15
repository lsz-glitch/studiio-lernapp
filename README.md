# Studiio — Lern-App mit KI

Studiio ist eine Web-App für Studierende: Fächer und Unterlagen organisieren, mit einem KI-Tutor durcharbeiten, Vokabeln/Karteikarten automatisch erstellen und Fortschritt tracken.

---

## Tech-Stack

| Bereich        | Technologie                          |
|----------------|--------------------------------------|
| Frontend       | React 18, Vite 6, Tailwind CSS       |
| Auth & Daten   | Supabase (Auth, DB, Storage)        |
| KI             | Anthropic Claude API (BYOK)          |
| Backend (API)  | Node.js (Express) in `backend/`      |

**BYOK** = Bring Your Own Key: Der Nutzer trägt seinen eigenen Claude-API-Key in den Einstellungen ein; die App speichert ihn nur im Supabase-Profil (verschlüsselt).

---

## Architektur

- **Frontend** (`frontend/`): React-App; spricht direkt mit Supabase (Auth, DB, Storage); für KI und PDF-Text ruft sie das Backend unter `/api/*` auf.
- **Backend** (`backend/`): Express-Server; einzige Stelle, die Anthropic aufruft und den Supabase Service-Role-Key für PDF-Download nutzt.
- **Datenbank** (`database/`): Supabase-Schema als SQL-Dateien; werden manuell im Supabase SQL-Editor ausgeführt.

---

## Workflow (Überblick)

1. **Anmeldung**  
   Login/Registrierung über Supabase Auth. Nach dem Login: Dashboard mit Fächern.

2. **Fächer & Unterlagen**  
   Fächer anlegen (mit optionalem Klausurtermin). Pro Fach: PDFs hochladen (Vorlesung, Übung, Tutorium, …), max. 20 MB pro Nutzer (konfigurierbar in `frontend/src/config.js`).

3. **KI-Tutor**  
   Vorlesungs-PDFs „Slide für Slide“ durchgehen: Links die Folie, rechts der Chat mit Claude. Erklärung → Verständnisfragen → optional überspringen („Kann ich bereits“ / „Nicht relevant“). Übungen/Tutorien: erst selbst lösen, dann KI-Feedback.

4. **Vokabeln / Karteikarten**  
   Nach dem Durcharbeiten oder manuell: Karteikarten aus dem Inhalt generieren (Claude). Formate: Definition, offenes Antwortfeld (KI bewertet), Multiple/Single Choice. Spaced Repetition (Anki-ähnlich).

5. **Fortschritt & Lernplan**  
   Pro Fach: Fortschritt (Unterlagen durchgearbeitet, Vokabeln gelernt), Lernzeit, Streak. Lernplan mit Tasks (Tutor durcharbeiten, Vokabeln üben, …), automatisch abgehakt bei Erledigung in der App.

6. **Backend (API)**  
   Das Frontend spricht für KI und PDF-Text mit einem eigenen Backend (`backend/`): Claude-Proxy (BYOK), PDF-Text-Extraktion aus Supabase Storage, Karteikarten-Generierung, Antwortbewertung, MC-Optionen-Vorschläge. In der Entwicklung leitet Vite `/api/*` an den Backend-Server weiter.

---

## Projektstruktur

```
studiio.Lernapp/
├── frontend/                 # React-App (Vite, Tailwind)
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx, App.jsx
│   │   ├── supabaseClient.js
│   │   ├── config.js
│   │   ├── components/
│   │   └── utils/
│   ├── public/
│   └── postcss.config.js
├── backend/                  # Backend-Server (Claude-Proxy & API)
│   ├── index.mjs
│   ├── .env.example
│   └── README.md
├── database/                 # Supabase-Schema (SQL-Dateien)
│   ├── README.md             # Reihenfolge & Beschreibung
│   └── supabase-*.sql
├── tests/
├── docs/
├── package.json
├── vite.config.js            # root: frontend, Proxy /api → localhost:8788
├── tailwind.config.js        # content: frontend/index.html, frontend/src/**
├── vitest.config.js
├── .env.example
└── README.md
```

---

## Setup & Start

### 1. Abhängigkeiten

```bash
npm install
```

### 2. Umgebungsvariablen

**Frontend** (Projektroot, **neben** `vite.config.js`): `.env.local` oder `.env` anlegen, siehe `.env.example`. Die Datei gehört ins Projektroot — `vite.config.js` ist so eingestellt (`envDir`), dass Vite sie von dort lädt (nicht nur aus `frontend/`).

- `VITE_SUPABASE_URL` — Supabase Projekt-URL  
- `VITE_SUPABASE_ANON_KEY` — Anon/Public Key  
- Optional in Production: `VITE_API_BASE` — URL des Backends (z. B. `https://dein-api.vercel.app`)

**Backend** (`backend/`): `backend/.env` anlegen, siehe `backend/.env.example`:

- `PORT` (optional, Standard: 8788)  
- `SUPABASE_URL` — dieselbe Projekt-URL wie im Frontend  
- `SUPABASE_SERVICE_ROLE_KEY` — Service-Role-Key (nur für PDF-Download aus Storage; niemals im Frontend verwenden)

### 3. Supabase

- Projekt in [Supabase](https://supabase.com) anlegen.
- Tabellen und RLS mit den mitgelieferten SQL-Dateien anlegen (Reihenfolge beachten, siehe Abschnitt „Supabase SQL-Skripte“).
- Storage-Bucket `materials` anlegen (für PDF-Uploads).

### 4. Zwei Prozesse starten

**Terminal 1 — Backend:**

```bash
npm run api
```

Server läuft auf **http://localhost:8788** (Health-Check: http://localhost:8788/health).

**Terminal 2 — Frontend:**

```bash
npm run dev
```

App unter **http://localhost:5173**. Anfragen an `/api/*` werden von Vite an den Backend-Server weitergeleitet.

### 5. Nutzung

- Registrieren/Anmelden.
- In den Einstellungen einen **Claude API Key** eintragen (BYOK), sonst funktionieren Tutor und Karteikarten-Generierung nicht.
- Fächer anlegen, PDFs hochladen, mit dem Tutor durcharbeiten oder Karteikarten erstellen.

---

## Supabase SQL-Skripte

Die Skripte liegen in **`database/`** und müssen **manuell** im Supabase SQL-Editor ausgeführt werden (kein Migrations-Tool). Reihenfolge und Kurzbeschreibung: siehe **`database/README.md`**.

---

## Backend-Endpoints

| Methode | Pfad                      | Beschreibung                          |
|--------|----------------------------|----------------------------------------|
| GET    | `/health`, `/api/health`   | Health-Check                           |
| POST   | `/api/claude`              | Proxy zu Anthropic (Body: `apiKey`, `payload`) |
| POST   | `/api/pdf-text`            | PDF aus Storage laden, Text extrahieren (`storagePath`) |
| POST   | `/api/generate-flashcards` | Karteikarten aus Text (Claude)        |
| POST   | `/api/evaluate-answer`     | Offene Antwort bewerten (Claude)      |
| POST   | `/api/suggest-mcq-options` | MC-Optionen vorschlagen (Claude)      |

Details und ENV: siehe `backend/README.md`.

---

## Konfiguration (Frontend)

In `frontend/src/config.js`:

- **MAX_STORAGE_PER_USER_MB** — Speicherlimit pro Nutzer (Standard: 20)
- **DEFAULT_EXAM_TIMER_MINUTES** — Standard-Timer für Prüfungssimulation (Standard: 90)
- **API_BASE** / **getApiBase()** — Backend-URL; in Production optional über `VITE_API_BASE` setzen.

---

## Lizenz & Hinweise

- Kein API-Key von Claude im Code oder in öffentlichen Repos. BYOK: Key nur im Nutzerprofil (Supabase).
- Für Deployment: Frontend (z. B. Vercel) und Backend getrennt deployen; Backend-URL als `VITE_API_BASE` setzen und CORS ggf. anpassen.

Bei Fragen oder Fehlern: zuerst prüfen, ob Backend und Frontend laufen und beide Env-Dateien (Frontend + `backend/.env`) gesetzt sind.
