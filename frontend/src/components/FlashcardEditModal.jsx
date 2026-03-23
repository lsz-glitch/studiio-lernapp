import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { FORMAT_LABELS } from './FlashcardCreateModal'
import { getApiBase } from '../config'
import { getUserAiConfig } from '../utils/aiProvider'
const FORMATS = ['definition', 'open', 'multiple_choice', 'single_choice']

export default function FlashcardEditModal({ user, card, onClose, onSuccess }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [format, setFormat] = useState('definition')
  const [optionsText, setOptionsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [suggestLoading, setSuggestLoading] = useState(false)

  useEffect(() => {
    if (!card) return
    setQuestion(card.question || '')
    setAnswer(card.answer || '')
    setFormat(card.format || 'definition')
    const opts = Array.isArray(card.options) ? card.options : []
    setOptionsText(opts.join('\n'))
  }, [card])

  const isChoice = format === 'multiple_choice' || format === 'single_choice'
  const options = optionsText
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  async function fetchSuggestOptions() {
    if (!user?.id || !question.trim() || !answer.trim()) return
    setSuggestLoading(true)
    setError('')
    try {
      const { apiKey, provider } = await getUserAiConfig(user.id)
      if (!apiKey) {
        setError('Kein API-Key. Bitte in den Einstellungen eintragen.')
        return
      }
      const existingOpts = optionsText.split(/\n/).map((s) => s.trim()).filter(Boolean)
      const res = await fetch(`${getApiBase()}/api/suggest-mcq-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          provider,
          question: question.trim(),
          correctAnswer: answer.trim(),
          existingOptions: existingOpts.length > 0 ? existingOpts : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = [data.error, data.details].filter(Boolean).join(' — ') || 'Vorschlag fehlgeschlagen.'
        throw new Error(msg)
      }
      const list = Array.isArray(data?.options) ? data.options : []
      const text = list.length > 0 ? list.join('\n') : [answer.trim(), 'Option 2', 'Option 3', 'Option 4'].filter(Boolean).join('\n')
      setOptionsText(text)
    } catch (err) {
      const msg = err.message || 'KI-Vorschlag fehlgeschlagen.'
      setError(msg.includes('fetch') || msg.includes('Failed') ? `${msg} API-Server starten: npm run api` : msg)
    } finally {
      setSuggestLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!question.trim()) {
      setError('Bitte eine Frage eingeben.')
      return
    }
    if (!answer.trim()) {
      setError('Bitte eine Antwort eingeben.')
      return
    }
    if (isChoice && options.length < 2) {
      setError('Bei Multiple/Single Choice mindestens 2 Antwortmöglichkeiten eingeben (eine pro Zeile).')
      return
    }
    if (isChoice && !options.includes(answer.trim())) {
      setError('Die richtige Antwort muss in den Antwortmöglichkeiten vorkommen.')
      return
    }

    setLoading(true)
    try {
      const update = {
        format,
        question: question.trim(),
        answer: answer.trim(),
        options: isChoice ? options : null,
      }
      const { error: updateErr } = await supabase
        .from('flashcards')
        .update(update)
        .eq('id', card.id)
      if (updateErr) throw new Error(updateErr.message || 'Speichern fehlgeschlagen.')
      onSuccess?.(update)
      onClose()
    } catch (err) {
      setError(err.message || 'Ein Fehler ist aufgetreten.')
    } finally {
      setLoading(false)
    }
  }

  if (!card) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-studiio-ink mb-1">Vokabel bearbeiten</h3>
        <p className="text-sm text-studiio-muted mb-4">Frage und Antwort anpassen oder Format wechseln.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-studiio-ink mb-1">Frage</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="z.B. Was ist …?"
              className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink placeholder:text-studiio-muted/70 focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
              rows={2}
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-studiio-ink mb-1">Antwort</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Die richtige Antwort"
              className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink placeholder:text-studiio-muted/70 focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
              rows={2}
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-studiio-ink mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
              disabled={loading}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f] || f}
                </option>
              ))}
            </select>
          </div>
          {isChoice && (
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">
                Antwortmöglichkeiten (eine pro Zeile; eine Zeile = richtige Antwort)
              </label>
              {user && (
                <button
                  type="button"
                  onClick={fetchSuggestOptions}
                  disabled={suggestLoading || loading || !question.trim() || !answer.trim()}
                  className="mb-2 rounded-lg border border-studiio-accent bg-studiio-sky/30 px-3 py-1.5 text-xs font-medium text-studiio-accent hover:bg-studiio-sky/50 disabled:opacity-50"
                >
                  {suggestLoading ? 'KI erstellt Vorschlag …' : 'KI-Vorschlag für Antwortmöglichkeiten'}
                </button>
              )}
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="Option 1&#10;Option 2&#10;Option 3"
                className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink placeholder:text-studiio-muted/70 focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
                rows={4}
                disabled={loading}
              />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-studiio-lavender/60 px-4 py-2 text-sm text-studiio-ink hover:bg-studiio-lavender/30"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover disabled:opacity-60"
            >
              {loading ? 'Wird gespeichert …' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
