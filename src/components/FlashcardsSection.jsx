import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function FlashcardsSection({ user, subject, refreshTrigger, onStartPractice }) {
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
  }, [user?.id, subject?.id, refreshTrigger])

  if (loading) return <p className="text-sm text-studiio-muted">Vokabeln werden geladen …</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  if (cards.length === 0) {
    return (
      <p className="text-sm text-studiio-muted">
        Noch keine Vokabeln für dieses Fach. Erstelle welche über „Vokabeln erstellen“ bei einer Datei.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-studiio-ink">
        <strong>{cards.length}</strong> {cards.length === 1 ? 'Vokabel' : 'Vokabeln'} in diesem Fach.
      </p>
      <button
        type="button"
        onClick={onStartPractice}
        className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
      >
        Vokabeln üben
      </button>
    </div>
  )
}
