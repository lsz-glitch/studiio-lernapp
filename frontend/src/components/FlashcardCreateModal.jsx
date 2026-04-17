import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getApiBase } from '../config'
import { isBackendInfoRootResponse, isLikelyHtmlResponse, MSG_API_WRONG_ENDPOINT } from '../utils/apiResponse'
import { getUserAiConfig } from '../utils/aiProvider'

const FORMAT_LABELS = {
  definition: 'Definitions-Abfrage',
  open: 'Offenes Antwortfeld (KI bewertet)',
  multiple_choice: 'Multiple Choice',
  single_choice: 'Single Choice',
}

export default function FlashcardCreateModal({ user, subject, material, onClose, onSuccess }) {
  const [focusInput, setFocusInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('form') // 'form' | 'generating' | 'done'

  const preferenceText = `${focusInput}`.toLowerCase()
  const wantsSingle = /\bsingle\s*choice\b|\bsingle_choice\b/.test(preferenceText)
  const wantsMultiple = /\bmultiple\s*choice\b|\bmultiple_choice\b|\bmcq\b/.test(preferenceText)
  const wantsOpen = /\boffen(es|e|er)?\b|\bopen\b|\bfreitext\b/.test(preferenceText)
  const wantsDefinition = /\bdefinition\b/.test(preferenceText)
  const requestedFormats = [wantsSingle, wantsMultiple, wantsOpen, wantsDefinition].filter(Boolean).length
  const hasStrictFormatRequest = requestedFormats === 1
  const requestedFormat = hasStrictFormatRequest
    ? (wantsSingle
        ? 'single_choice'
        : wantsMultiple
          ? 'multiple_choice'
          : wantsOpen
            ? 'open'
            : 'definition')
    : null
  const hasVerbatimRequest =
    /\b1:1\b|\beins\s*zu\s*eins\b|\bidentisch\b|\bwortw(ö|oe)rtlich\b/.test(preferenceText)

  async function getAiConfig() {
    return getUserAiConfig(user.id)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setStep('generating')
    try {
      const { apiKey, provider } = await getAiConfig()
      const resText = await fetch(`${getApiBase()}/api/pdf-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialId: material.id, storagePath: material.storage_path }),
      })
      const rawPdf = await resText.text()
      const textData = (() => {
        try {
          return JSON.parse(rawPdf || '{}')
        } catch (_) {
          return {}
        }
      })()
      if (isLikelyHtmlResponse(rawPdf)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (isBackendInfoRootResponse(textData)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (resText.status === 404 || (textData && textData.error === 'Route nicht gefunden')) {
        throw new Error(
          'API-Route nicht gefunden. Bitte starte den API-Server neu (im Projektordner: npm run api) und lade die Seite neu.'
        )
      }
      if (textData.error || !textData.text) {
        throw new Error(textData.error || 'PDF-Text konnte nicht geladen werden.')
      }
      const pdfText = textData.text

      const resGen = await fetch(`${getApiBase()}/api/generate-flashcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          provider,
          userId: user.id,
          subjectName: subject.name,
          materialFilename: material.filename,
          pdfText: pdfText.slice(0, 80000),
          focusAttention: focusInput.trim() || undefined,
          focusTheme: undefined,
          forceFormat: requestedFormat || undefined,
          verbatimMode: hasVerbatimRequest || undefined,
        }),
      })
      const rawGen = await resGen.text()
      const genData = (() => {
        try {
          return JSON.parse(rawGen || '{}')
        } catch (_) {
          return {}
        }
      })()
      if (isLikelyHtmlResponse(rawGen)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (isBackendInfoRootResponse(genData)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (resGen.status === 404 || (genData && genData.error === 'Route nicht gefunden')) {
        throw new Error(
          'API-Route nicht gefunden. Bitte starte den API-Server neu (im Projektordner: npm run api) und lade die Seite neu.'
        )
      }
      if (!resGen.ok) throw new Error(genData.error || genData.details || 'Generierung fehlgeschlagen.')
      const cards = genData.cards || []
      if (cards.length === 0) {
        throw new Error(
          'Es wurden 0 Karten zurückgegeben. Bitte API-Server neu starten (npm run api) und erneut versuchen. ' +
          'Falls du 1:1 verlangst, Prompt etwas konkreter machen (z. B. Seitenbereich/Anzahl).',
        )
      }

      const rows = cards.map((c, i) => ({
        user_id: user.id,
        subject_id: subject.id,
        material_id: material.id,
        format: c.format,
        question: c.question,
        answer: c.answer,
        options: c.options || null,
        general_explanation: c.general_explanation || null,
        position: i,
      }))
      const { error: insertErr } = await supabase.from('flashcards').insert(rows)
      if (insertErr) throw new Error(insertErr.message || 'Speichern fehlgeschlagen.')

      setStep('done')
      setTimeout(() => {
        onSuccess?.(cards.length)
        onClose()
      }, 1200)
    } catch (err) {
      setError(err.message || 'Ein Fehler ist aufgetreten.')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-studiio-ink mb-1">Vokabeln erstellen</h3>
        <p className="text-sm text-studiio-muted mb-4">
          Aus: <strong>{material.filename}</strong> (Fach: {subject.name})
        </p>

        {step === 'done' && (
          <p className="text-studiio-accent font-medium py-4">Vokabeln wurden erstellt und gespeichert.</p>
        )}

        {(step === 'form' || (step === 'generating' && error)) && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">
                Worauf soll geachtet werden?
              </label>
              <textarea
                value={focusInput}
                onChange={(e) => setFocusInput(e.target.value)}
                placeholder="z. B. Definitionen, Formeln, zentrale Begriffe, 1:1 übernehmen, nur Single Choice …"
                className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink placeholder:text-studiio-muted/70 focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
                rows={3}
                disabled={loading}
              />
            </div>
            <p className="text-xs text-studiio-muted">
              {hasStrictFormatRequest
                ? 'Dein gewünschtes Format wird strikt übernommen.'
                : 'Ohne Formatvorgabe werden Karten in mehreren Formaten erzeugt.'}
              {hasVerbatimRequest ? ' Dein 1:1-Wunsch wird ebenfalls berücksichtigt.' : ''}
            </p>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-studiio-lavender/60 px-4 py-2 text-sm text-studiio-ink hover:bg-studiio-lavender/30">
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover disabled:opacity-60"
              >
                {loading ? 'Wird erstellt …' : 'Vokabeln generieren'}
              </button>
            </div>
          </form>
        )}

        {step === 'generating' && !error && (
          <p className="text-studiio-muted py-4">KI erstellt die Karteikarten …</p>
        )}
      </div>
    </div>
  )
}

export { FORMAT_LABELS }
