/**
 * Studiio — zentrale Konstanten (laut .cursorrules)
 * Hier kannst du Werte einfach anpassen.
 *
 * Optional: FALLBACK_* wenn du ohne VITE_* buildest (z. B. Vercel ohne Env).
 * Sonst reichen VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in Root-.env
 */

export const FALLBACK_SUPABASE_URL = ''
export const FALLBACK_SUPABASE_ANON_KEY = ''

export const MAX_STORAGE_PER_USER_MB = 20
export const DEFAULT_EXAM_TIMER_MINUTES = 90
export const DEFAULT_MONTHLY_AI_BUDGET_USD = 10

/**
 * Basis-URL des Backend-Servers (Claude-Proxy & API). In Production VITE_API_BASE setzen
 * (z. B. https://dein-backend.example.com — ohne /api am Ende, ohne Slash am Ende).
 */
function normalizeApiBase(raw) {
  const s = String(raw || '').trim()
  if (!s) return 'http://localhost:8788'
  return s.replace(/\/+$/, '')
}

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE)

/**
 * URL-Präfix für API-Aufrufe: in Dev leer (Vite-Proxy leitet /api weiter), sonst API_BASE.
 * Komponenten sollten getApiBase() verwenden, damit Dev und Production korrekt funktionieren.
 */
export function getApiBase() {
  return import.meta.env.DEV ? '' : API_BASE
}
