/**
 * Erkennt typische Anthropic-Fehler bei leerem Guthaben / Billing
 * und liefert eine verständliche deutsche Meldung.
 */

export const MSG_ANTHROPIC_LOW_CREDIT_DE =
  'Dein Anthropic-Guthaben reicht gerade nicht (oder Billing ist ausstehend). Bitte unter console.anthropic.com im Bereich „Plans & Billing“ aufladen – danach funktionieren KI-Tutor und Vokabeln wieder.'

export const MSG_ANTHROPIC_RATE_LIMIT_DE =
  'Anthropic meldet: **Limit für Eingabe-Token pro Minute** (Rate Limit deiner Organisation). ' +
  'Das betrifft nicht die **Länge der Antwort**, sondern alles, was in derselben Minute **hineingeschickt** wurde: z. B. großer PDF-Text, Fachkontext, Seitenkontext für viele Folien, Tutor-Anfragen, Vokabeln – oft **mehrere Aufrufe hintereinander**. ' +
  'Bitte **etwa eine Minute warten** und erneut versuchen, oder weniger KI-Aktionen gleichzeitig starten. Infos: https://docs.claude.com/en/api/rate-limits'

function appendParts(parts, value) {
  if (value == null) return
  if (typeof value === 'string' && value.trim()) parts.push(value)
}

/**
 * Sammelt alle relevanten Fehlertexte aus Proxy-/Anthropic-JSON und Roh-Body.
 */
export function extractClaudeProxyErrorText(parsed, rawText) {
  const parts = []
  appendParts(parts, rawText)
  if (!parsed || typeof parsed !== 'object') return parts.join('\n')

  const err = parsed.error
  if (err && typeof err === 'object') {
    appendParts(parts, err.message)
  } else {
    appendParts(parts, typeof err === 'string' ? err : null)
  }
  appendParts(parts, parsed.message)
  appendParts(parts, parsed.details)
  return parts.join('\n')
}

export function isLikelyAnthropicLowCreditOrBilling(fullText) {
  const t = String(fullText || '').toLowerCase()
  if (!t.trim()) return false
  if (t.includes('your credit balance is too low')) return true
  if (t.includes('credit balance') && (t.includes('too low') || t.includes('is too low'))) return true
  if (t.includes('plans & billing') || t.includes('plans and billing')) return true
  if (t.includes('purchase credits')) return true
  if (t.includes('insufficient_quota')) return true
  if (t.includes('insufficient credits')) return true
  if (t.includes('billing') && (t.includes('anthropic') || t.includes('credit') || t.includes('payment'))) return true
  return false
}

export function isLikelyAnthropicRateLimitError(fullText) {
  const t = String(fullText || '').toLowerCase()
  if (!t.trim()) return false
  if (t.includes('rate limit')) return true
  if (t.includes('tokens per minute')) return true
  if (t.includes('too many requests')) return true
  if (t.includes('429') && (t.includes('token') || t.includes('rate'))) return true
  return false
}

export function userFacingMessageForAiHttpError({ responseText, parsed }) {
  const blob = extractClaudeProxyErrorText(parsed, responseText)
  if (isLikelyAnthropicLowCreditOrBilling(blob)) return MSG_ANTHROPIC_LOW_CREDIT_DE
  if (isLikelyAnthropicRateLimitError(blob)) return MSG_ANTHROPIC_RATE_LIMIT_DE
  return null
}

/**
 * Technische Fehlermeldung aus /api/claude-ähnlichen JSON-Antworten (Fallback).
 */
export function technicalMessageFromClaudeProxyJson(parsed, rawText) {
  if (!parsed || typeof parsed !== 'object') {
    return typeof rawText === 'string' && rawText.trim() ? rawText.slice(0, 500) : 'KI-Anfrage fehlgeschlagen.'
  }
  const errObj = typeof parsed.error === 'object' ? parsed.error : null
  let message = 'KI-Anfrage fehlgeschlagen.'
  if (errObj?.message) message = errObj.message
  else if (typeof parsed.error === 'string') message = parsed.error
  else if (parsed.message) message = parsed.message
  if (parsed.details) message += ` — ${parsed.details}`
  return message
}

/**
 * Eine Zeile für Nutzer:innen bei HTTP-Fehler vom KI-Proxy.
 */
export function resolveClaudeProxyFailureMessage({ responseText, parsed }) {
  const friendly = userFacingMessageForAiHttpError({ responseText, parsed })
  if (friendly) return friendly
  return technicalMessageFromClaudeProxyJson(parsed, responseText)
}

/**
 * Hinweis für den Seitenkontext (/api/build-material-context), wenn die KI fehlschlägt
 * (z. B. leeres Anthropic-Guthaben), der PDF-Text aber weiter genutzt wird.
 */
export function pageContextAiBannerFromFailureBody(body) {
  if (!body || typeof body !== 'object') return null
  const billing = userFacingMessageForAiHttpError({ responseText: '', parsed: body })
  if (billing) return billing
  const technical = resolveClaudeProxyFailureMessage({ responseText: '', parsed: body })
  return `Der KI-Seitenkontext (kurze Folien-Zusammenfassungen) war nicht verfügbar: ${technical}`
}
