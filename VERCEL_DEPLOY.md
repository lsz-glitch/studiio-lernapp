# Deploy auf Vercel

Supabase-Zugang steht in **`src/config.js`** (`FALLBACK_SUPABASE_*`).  
Damit reicht **kein** Eintrag unter Vercel → Environment Variables.

Optional kannst du trotzdem `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` setzen — die überschreiben die Fallbacks beim Build.

**Hinweis:** Öffentliches GitHub-Repo? Dann sieht jeder den Key (für anon/publishable bei Supabase üblich, trotzdem bewusst sein).
