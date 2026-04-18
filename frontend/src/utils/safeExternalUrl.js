/**
 * Nur http(s)-Links für Lernplan-Weiterleitungen (kein javascript:, data:, file:, etc.)
 * @param {unknown} raw
 * @returns {string|null} normalisierte URL oder null
 */
export function sanitizeLearningPlanExternalUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let url
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

/**
 * Öffnet einen geprüften Link in einem eigenen Browserfenster (externe Seite; Studiio bleibt offen).
 * Mit `popup` + Größe öffnen viele Browser ein separates Fenster statt nur einen weiteren Tab.
 * Wird das Popup blockiert, einmal Fallback: neuer Tab mit noopener.
 */
export function openLearningPlanExternalUrlSafely(href) {
  const safe = sanitizeLearningPlanExternalUrl(href)
  if (!safe) return
  const popupFeatures = [
    'popup=yes',
    'width=1024',
    'height=720',
    'scrollbars=yes',
    'resizable=yes',
    'noopener=yes',
    'noreferrer=yes',
  ].join(',')
  const tabFeatures = 'noopener,noreferrer'

  function openAsTab() {
    try {
      window.open(safe, '_blank', tabFeatures)
    } catch (_) {}
  }

  try {
    const win = window.open(safe, '_blank', popupFeatures)
    // Nur bei blockiertem Popup nachladen — nicht `win.closed` prüfen: vermeidet selten ein zweites Fenster.
    if (!win) openAsTab()
  } catch (_) {
    openAsTab()
  }
}
