const STORAGE_UNTIL = 'studiio_mini_focus_until'
const STORAGE_PAUSED_MS = 'studiio_mini_focus_paused_ms'

export const MINI_FOCUS_DURATION_MS = 10 * 60 * 1000

export const MINI_FOCUS_CHANGED_EVENT = 'studiio-mini-focus-changed'

function notifyMiniFocusChanged() {
  try {
    window.dispatchEvent(new Event(MINI_FOCUS_CHANGED_EVENT))
  } catch (_) {}
}

/** Startet (oder setzt neu) einen 10-Minuten-Fokus-Countdown — nur aktiv, solange man bei der Aufgabe bleibt. */
export function armMiniFocusSession() {
  try {
    sessionStorage.removeItem(STORAGE_PAUSED_MS)
    sessionStorage.setItem(STORAGE_UNTIL, String(Date.now() + MINI_FOCUS_DURATION_MS))
  } catch (_) {}
  notifyMiniFocusChanged()
}

/** Pausiert den Countdown, wenn noch Zeit lief (z. B. Aufgabe verlassen). */
export function pauseMiniFocusSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_UNTIL)
    const until = raw ? parseInt(raw, 10) : 0
    if (!Number.isFinite(until) || until <= Date.now()) return
    const remaining = until - Date.now()
    sessionStorage.removeItem(STORAGE_UNTIL)
    sessionStorage.setItem(STORAGE_PAUSED_MS, String(remaining))
  } catch (_) {}
  notifyMiniFocusChanged()
}

/** Nimmt eine pausierte Session wieder auf (z. B. Tutor/Vokabeln erneut geöffnet). */
export function resumeMiniFocusSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_PAUSED_MS)
    const pausedMs = raw ? parseInt(raw, 10) : 0
    if (!Number.isFinite(pausedMs) || pausedMs <= 0) return
    sessionStorage.removeItem(STORAGE_PAUSED_MS)
    sessionStorage.setItem(STORAGE_UNTIL, String(Date.now() + pausedMs))
  } catch (_) {}
  notifyMiniFocusChanged()
}

export function clearMiniFocusSession() {
  try {
    sessionStorage.removeItem(STORAGE_UNTIL)
    sessionStorage.removeItem(STORAGE_PAUSED_MS)
  } catch (_) {}
  notifyMiniFocusChanged()
}

/** Für MiniFocusHint: laufender Countdown, pausiert (zurückkehren), oder aus. */
export function getMiniFocusSnapshot() {
  try {
    const rawUntil = sessionStorage.getItem(STORAGE_UNTIL)
    const until = rawUntil ? parseInt(rawUntil, 10) : 0
    if (Number.isFinite(until) && until > Date.now()) {
      return { kind: 'running', until }
    }
    const rawPaused = sessionStorage.getItem(STORAGE_PAUSED_MS)
    const pausedMs = rawPaused ? parseInt(rawPaused, 10) : 0
    if (Number.isFinite(pausedMs) && pausedMs > 0) {
      return { kind: 'paused', remainingMs: pausedMs }
    }
  } catch (_) {}
  return { kind: 'none' }
}
