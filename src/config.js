/**
 * Studiio — zentrale Konstanten (laut .cursorrules)
 *
 * Supabase: Wenn du KEINE Vercel-Umgebungsvariablen nutzen willst, reichen die
 * beiden FALLBACK_* Werte unten (wie in Supabase → Settings → API).
 * Optional überschreiben .env.local / VITE_SUPABASE_* beim Build.
 */

export const MAX_STORAGE_PER_USER_MB = 20
export const DEFAULT_EXAM_TIMER_MINUTES = 90
export const API_BASE = 'http://localhost:8788'

/** Ohne .env auf dem Server: diese Werte werden für Supabase verwendet (öffentlicher Key). */
export const FALLBACK_SUPABASE_URL = 'https://omptsapvlyschmzkximh.supabase.co'
export const FALLBACK_SUPABASE_ANON_KEY =
  'sb_publishable_BEs9t77Rano-7SsNznwd2A_JYzWVYyt'
