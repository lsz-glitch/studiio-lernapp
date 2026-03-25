import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabaseClient'
import FlashcardPractice from './FlashcardPractice'
import FlashcardEditModal from './FlashcardEditModal'
import { addLearningTime } from '../utils/learningTime'
import { completeVocabTasksForSubjectToday } from '../utils/learningPlan'

export default function FlashcardPracticePage({ user, subject, materialFilter = null, onBack }) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingCard, setEditingCard] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeCard, setActiveCard] = useState(null)
  const [quickQuestion, setQuickQuestion] = useState('')
  const [quickAnswer, setQuickAnswer] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickInfo, setQuickInfo] = useState('')
  const [quickError, setQuickError] = useState('')
  const [showQuickHelp, setShowQuickHelp] = useState(false)
  const sessionStartRef = useRef(Date.now())
  const savedSecondsRef = useRef(0)

  // Lernzeit alle 60 Sekunden zwischenspeichern (wird nie zurückgesetzt)
  useEffect(() => {
    if (!user?.id || !subject?.id) return
    const interval = setInterval(async () => {
      savedSecondsRef.current += 60
      await addLearningTime(user.id, subject.id, 60)
    }, 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.id, subject?.id])

  async function handleBack() {
    const totalSec = (Date.now() - sessionStartRef.current) / 1000
    const remainder = Math.max(0, Math.round(totalSec) - savedSecondsRef.current)
    if (remainder >= 1 && user?.id && subject?.id) await addLearningTime(user.id, subject.id, remainder)
    if (user?.id && subject?.id) await completeVocabTasksForSubjectToday(user.id, subject.id)
    onBack()
  }

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    setLoading(true)
    const nowIso = new Date().toISOString()
    let query = supabase
      .from('flashcards')
      .select('id, format, question, answer, options, position, next_review_at, interval_days, general_explanation, material_id')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .eq('is_draft', false)
      // Spaced Repetition: nur fällige Karten laden (überfällig oder noch nie terminiert).
      .or(`next_review_at.is.null,next_review_at.lte.${nowIso}`)
      .order('position', { ascending: true })
    if (materialFilter?.id) query = query.eq('material_id', materialFilter.id)

    query.then(({ data, error: e }) => {
        if (!mounted) return
        if (e) {
          setError(e.message)
          setCards([])
        } else {
          setError('')
          setCards(data || [])
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshKey, materialFilter?.id])

  async function handleCreateQuickDraft() {
    const q = quickQuestion.trim()
    if (!q) {
      setQuickError('Bitte zuerst die Frage notieren.')
      return
    }
    setQuickSaving(true)
    setQuickError('')
    setQuickInfo('')
    const materialIdFromContext = activeCard?.material_id || materialFilter?.id || null
    const { error: insertErr } = await supabase
      .from('flashcards')
      .insert({
        user_id: user.id,
        subject_id: subject.id,
        material_id: materialIdFromContext,
        format: 'definition',
        question: q,
        answer: quickAnswer.trim() || 'Antwort folgt',
        options: null,
        is_draft: true,
        position: 0,
      })
    setQuickSaving(false)
    if (insertErr) {
      setQuickError(insertErr.message || 'Entwurf konnte nicht gespeichert werden.')
      return
    }
    setQuickQuestion('')
    setQuickAnswer('')
    setQuickInfo('Entwurf gespeichert. Du kannst ihn später im Entwurf-Bereich bearbeiten.')
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-studiio-cream overflow-auto">
      <div className="flex-shrink-0 px-4 py-3 border-b border-studiio-lavender/40 bg-white/95">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline font-medium"
        >
          <span className="inline-block rotate-180 text-base">➜</span>
          Zurück zum Fach
        </button>
        <h2 className="text-lg font-semibold text-studiio-ink mt-2">Vokabelmodus — {subject.name}</h2>
        {materialFilter?.filename && (
          <p className="text-xs text-studiio-muted mt-1">Filter: {materialFilter.filename}</p>
        )}
        <p className="text-xs text-studiio-muted mt-1">Du machst das großartig – jede Karte bringt dich sicherer Richtung Prüfung.</p>
      </div>
      <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {loading && (
              <p className="text-sm text-studiio-muted">Vokabeln werden geladen …</p>
            )}
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            {!loading && !error && cards.length === 0 && (
              <div className="rounded-xl border border-studiio-lavender/60 bg-white p-6 text-center">
                <p className="text-studiio-muted">Heute sind keine fälligen Vokabeln mehr offen.</p>
                <button type="button" onClick={handleBack} className="mt-3 text-sm text-studiio-accent hover:underline">
                  Zurück zum Fach
                </button>
              </div>
            )}
            {!loading && !error && cards.length > 0 && (
              <FlashcardPractice
                user={user}
                cards={cards}
                onBack={handleBack}
                onEditCard={(card) => setEditingCard(card)}
                onCardChange={setActiveCard}
              />
            )}
          </div>

          <aside className="h-fit rounded-xl border border-studiio-lavender/60 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-studiio-ink">Schnellkarte notieren</h3>
              <button
                type="button"
                onClick={() => setShowQuickHelp((v) => !v)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-studiio-lavender/70 text-[11px] font-bold text-studiio-muted hover:bg-studiio-sky/20"
                aria-label="Erklärung zum Schnellkartenmodus anzeigen"
                title="Was ist der Schnellkartenmodus?"
              >
                ?
              </button>
            </div>
            {showQuickHelp && (
              <p className="text-xs text-studiio-muted rounded-lg border border-studiio-lavender/40 bg-studiio-sky/20 px-2.5 py-2">
                Wird als Entwurf gespeichert (Format: Definition) und erscheint noch nicht im Wiederholungsmodus.
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-studiio-ink mb-1">Frage</label>
              <textarea
                value={quickQuestion}
                onChange={(e) => setQuickQuestion(e.target.value)}
                rows={3}
                placeholder="z. B. Was ist der Unterschied zwischen nominalem und realem BIP?"
                className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-studiio-ink mb-1">Antwort (optional)</label>
              <textarea
                value={quickAnswer}
                onChange={(e) => setQuickAnswer(e.target.value)}
                rows={2}
                placeholder="Kannst du später ergänzen."
                className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
              />
            </div>
            <p className="text-[11px] text-studiio-muted">
              Zuordnung: {activeCard?.material_id || materialFilter?.id ? 'Aktuelle Datei' : 'Manueller Ordner'}
            </p>
            {quickError && <p className="text-xs text-red-600">{quickError}</p>}
            {quickInfo && <p className="text-xs text-emerald-700">{quickInfo}</p>}
            <button
              type="button"
              onClick={handleCreateQuickDraft}
              disabled={quickSaving}
              className="w-full rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover disabled:opacity-60"
            >
              {quickSaving ? 'Speichert …' : 'Als Entwurf speichern'}
            </button>
          </aside>
        </div>
      </div>

      {editingCard && (
        <FlashcardEditModal
          user={user}
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSuccess={() => {
            setRefreshKey((k) => k + 1)
            setEditingCard(null)
          }}
          onDelete={() => {
            setRefreshKey((k) => k + 1)
            setEditingCard(null)
          }}
        />
      )}
    </div>
  )
}
