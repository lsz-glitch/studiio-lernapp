/**
 * Hilfen für API-Antworten: erkennt z. B. die Backend-Startseite (GET /) statt echter API-Daten.
 */

export const MSG_API_WRONG_ENDPOINT =
  'Die API-Antwort passt nicht: Es kam die Backend-Startseite statt einer Schnittstelle. ' +
  'Bitte prüfe VITE_API_BASE (volle Backend-URL ohne /api am Ende), CORS und ob der Server mit npm run api läuft.'

/**
 * JSON vom Backend-Root (GET /) — keine gültige Claude-/PDF-Antwort.
 */
export function isBackendInfoRootResponse(data) {
  if (!data || typeof data !== 'object') return false
  return (
    data.service === 'Studiio Backend' &&
    typeof data.health === 'string' &&
    typeof data.claude === 'string' &&
    !('content' in data) &&
    !('text' in data)
  )
}

export function isLikelyHtmlResponse(text) {
  const t = String(text || '').trimStart()
  return t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.startsWith('<')
}
