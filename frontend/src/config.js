/**
 * Studiio — zentrale Konstanten (laut .cursorrules)
 * Hier kannst du Werte einfach anpassen.
 *
 * Optional: FALLBACK_* wenn du ohne VITE_* buildest (z. B. Vercel ohne Env).
 * Sonst reichen VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in Root-.env
 */

export const FALLBACK_SUPABASE_URL = ''
export const FALLBACK_SUPABASE_ANON_KEY = ''

export const MAX_STORAGE_PER_USER_MB = 100
export const DEFAULT_EXAM_TIMER_MINUTES = 90
/** Nach Auswahl im Start-Dialog: so viele ms warten, dann automatisch zur Aufgabe (Orientierungszeit). */
export const WELCOME_START_DELAY_MS = 2 * 60 * 1000
/** „Erinnere mich später“ / erst planen — Dialog so lange ausblenden. */
export const WELCOME_REMIND_SNOOZE_MS = 10 * 60 * 1000

/** Pomodoro-Technik (anpassbar) */
export const POMODORO_FOCUS_MINUTES = 25
export const POMODORO_SHORT_BREAK_MINUTES = 5
export const POMODORO_LONG_BREAK_MINUTES = 15
/** Nach so vielen abgeschlossenen Fokus-Runden kommt eine lange Pause. */
export const POMODORO_CYCLES_BEFORE_LONG_BREAK = 4

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
