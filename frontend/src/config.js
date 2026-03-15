/**
 * Studiio — zentrale Konstanten (laut .cursorrules)
 * Hier kannst du Werte einfach anpassen.
 */

export const MAX_STORAGE_PER_USER_MB = 20
export const DEFAULT_EXAM_TIMER_MINUTES = 90

/** Basis-URL des Backend-Servers (Claude-Proxy & API). In Production ggf. VITE_API_BASE setzen. */
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8788'

/**
 * URL-Präfix für API-Aufrufe: in Dev leer (Vite-Proxy leitet /api weiter), sonst API_BASE.
 * Komponenten sollten getApiBase() verwenden, damit Dev und Production korrekt funktionieren.
 */
export function getApiBase() {
  return import.meta.env.DEV ? '' : API_BASE
}
