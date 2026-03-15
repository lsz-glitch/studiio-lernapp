import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabaseClient'
import FlashcardPractice from './FlashcardPractice'
import FlashcardEditModal from './FlashcardEditModal'
import { addLearningTime } from '../utils/learningTime'

export default function FlashcardPracticePage({ user, subject, onBack }) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingCard, setEditingCard] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
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
    onBack()
  }

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    setLoading(true)
    supabase
      .from('flashcards')
      .select('id, format, question, answer, options, position, next_review_at, interval_days')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .order('position', { ascending: true })
      .then(({ data, error: e }) => {
        if (!mounted) return
        if (e) {
          setError(e.message)
          setCards([])
        } else {
          setError('')
          const list = data || []
          const now = new Date().toISOString()
          list.sort((a, b) => {
            const aDue = !a.next_review_at || a.next_review_at <= now
            const bDue = !b.next_review_at || b.next_review_at <= now
            if (aDue && !bDue) return -1
            if (!aDue && bDue) return 1
            if (!a.next_review_at && b.next_review_at) return -1
            if (a.next_review_at && !b.next_review_at) return 1
            return (a.next_review_at || '').localeCompare(b.next_review_at || '')
          })
          setCards(list)
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshKey])

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
        <p className="text-xs text-studiio-muted mt-1">Fällige und falsch beantwortete Karten erscheinen öfter (Spaced Repetition).</p>
      </div>
      <div className="flex-1 p-4 md:p-6 max-w-2xl mx-auto w-full">
        {loading && (
          <p className="text-sm text-studiio-muted">Vokabeln werden geladen …</p>
        )}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {!loading && !error && cards.length === 0 && (
          <div className="rounded-xl border border-studiio-lavender/60 bg-white p-6 text-center">
            <p className="text-studiio-muted">Noch keine Vokabeln für dieses Fach.</p>
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
          />
        )}
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
        />
      )}
    </div>
  )
}
