import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import FlashcardPractice from './FlashcardPractice'

export default function FlashcardPracticePage({ user, subject, onBack }) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    setLoading(true)
    supabase
      .from('flashcards')
      .select('id, format, question, answer, options, position')
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
          setCards(data || [])
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-studiio-cream overflow-auto">
      <div className="flex-shrink-0 px-4 py-3 border-b border-studiio-lavender/40 bg-white/95">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline font-medium"
        >
          <span className="inline-block rotate-180 text-base">➜</span>
          Zurück zum Fach
        </button>
        <h2 className="text-lg font-semibold text-studiio-ink mt-2">Vokabelmodus — {subject.name}</h2>
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
            <button type="button" onClick={onBack} className="mt-3 text-sm text-studiio-accent hover:underline">
              Zurück zum Fach
            </button>
          </div>
        )}
        {!loading && !error && cards.length > 0 && (
          <FlashcardPractice user={user} cards={cards} onBack={onBack} />
        )}
      </div>
    </div>
  )
}
