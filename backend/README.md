# Studiio Backend

Der Backend-Server für Studiio: KI-Proxy (BYOK) und API für PDF-Text-Extraktion, Karteikarten-Generierung und Antwortbewertung. Dieser Server nutzt den Supabase Service-Role-Key für den PDF-Download aus Storage.

## Start

```bash
# Im Projektroot
npm run api
```

Der Server läuft standardmäßig auf **http://localhost:8788**. Das Vite-Frontend leitet `/api/*` in der Entwicklung dorthin weiter.

## Umgebungsvariablen

Lege im Ordner `backend/` eine Datei `.env` an (nicht versioniert). Siehe `backend/.env.example` für die benötigten Variablen:

- **PORT** (optional) – Port, Standard: 8788
- **SUPABASE_URL** – Supabase Projekt-URL (für PDF-Download aus Storage)
- **SUPABASE_SERVICE_ROLE_KEY** – Service-Role-Key (nur serverseitig, nie im Frontend)

Ohne Supabase-Variablen funktioniert der Claude-Proxy weiterhin; nur der Endpoint `/api/pdf-text` (PDF-Text für Tutor/Karteikarten) schlägt dann fehl.

## Endpoints

| Methode | Pfad | Beschreibung |
|--------|------|--------------|
| GET | `/health`, `/api/health` | Health-Check |
| POST | `/api/claude` | KI-Proxy (Body: `apiKey`, optional `provider`, `payload`) |
| POST | `/api/pdf-text` | PDF aus Supabase Storage laden und Text extrahieren (Body: `storagePath`) |
| POST | `/api/generate-flashcards` | Karteikarten aus Text generieren (Claude) |
| POST | `/api/evaluate-answer` | Offene Antwort bewerten (Claude) |
| POST | `/api/suggest-mcq-options` | MC-Optionen vorschlagen (Claude) |

Der API-Key wird vom Frontend (aus dem Nutzerprofil) mitgeschickt (BYOK). Unterstützte Provider im Proxy: `anthropic`, `openai`, `groq`, `openrouter`, `mistral`, `xai`.
