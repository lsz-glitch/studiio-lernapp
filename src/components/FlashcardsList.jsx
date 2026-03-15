import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { FORMAT_LABELS } from './FlashcardCreateModal'

export default function FlashcardsList({ user, subject, refreshTrigger }) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)

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
    <ul className="space-y-2">
      {cards.map((card) => (
        <li
          key={card.id}
          className="rounded-xl border border-studiio-lavender/50 bg-white/90 overflow-hidden"
        >
          <button
            type="button"
            className="w-full text-left px-4 py-3 flex items-center justify-between gap-2"
            onClick={() => setExpandedId(expandedId === card.id ? null : card.id)}
          >
            <span className="text-sm font-medium text-studiio-ink line-clamp-1 flex-1 min-w-0">
              {card.question}
            </span>
            <span className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-studiio-sky/50 text-studiio-ink">
              {FORMAT_LABELS[card.format] || card.format}
            </span>
          </button>
          {expandedId === card.id && (
            <div className="px-4 pb-4 pt-0 border-t border-studiio-lavender/30">
              <p className="text-xs text-studiio-muted mb-1">Antwort:</p>
              <p className="text-sm text-studiio-ink">{card.answer}</p>
              {Array.isArray(card.options) && card.options.length > 0 && (
                <>
                  <p className="text-xs text-studiio-muted mt-2 mb-1">Optionen:</p>
                  <ul className="text-sm text-studiio-ink list-disc list-inside">
                    {card.options.map((opt, i) => (
                      <li key={i}>{opt}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
