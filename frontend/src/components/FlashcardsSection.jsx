import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { FORMAT_LABELS } from './FlashcardCreateModal'
import FlashcardAddManualModal from './FlashcardAddManualModal'
import FlashcardEditModal from './FlashcardEditModal'

export default function FlashcardsSection({ user, subject, refreshTrigger, onStartPractice, showAddModal = false, onCloseAddModal }) {
  const [cards, setCards] = useState([])
  const [toPracticeCount, setToPracticeCount] = useState(null) // null = noch nicht geladen
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addModalRefresh, setAddModalRefresh] = useState(0)
  const [showManageList, setShowManageList] = useState(false)
  const [editingCard, setEditingCard] = useState(null)

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    setLoading(true)
    supabase
      .from('flashcards')
      .select('id, format, question, answer, options, position, next_review_at')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .order('position', { ascending: true })
      .then(({ data, error: e }) => {
        if (!mounted) return
        if (e) {
          setError(e.message)
          setCards([])
          setToPracticeCount(null)
        } else {
          setError('')
          setCards(data || [])
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshTrigger, addModalRefresh])

  // Leichte Berechnung: zu üben = überfällig oder ohne next_review_at.
  // Vermeidet große flashcard_reviews-Abfragen beim Öffnen eines Fachs.
  useEffect(() => {
    if (cards.length === 0) {
      setToPracticeCount(cards.length)
      return
    }
    const nowIso = new Date().toISOString()
    const needPractice = cards.filter(
      (c) => !c.next_review_at || c.next_review_at <= nowIso,
    ).length
    setToPracticeCount(needPractice)
  }, [cards])

  if (loading) return <p className="text-sm text-studiio-muted">Vokabeln werden geladen …</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  if (cards.length === 0) {
    return (
      <>
        {showAddModal && (
          <FlashcardAddManualModal
            user={user}
            subject={subject}
            currentCardCount={0}
            onClose={onCloseAddModal}
            onSuccess={() => { setAddModalRefresh((n) => n + 1); onCloseAddModal?.() }}
          />
        )}
      </>
    )
  }

  const toPractice = toPracticeCount ?? cards.length

  async function handleDeleteCard(card) {
    if (!window.confirm('Diese Vokabel-Karte wirklich löschen?')) return
    const { error: e } = await supabase.from('flashcards').delete().eq('id', card.id)
    if (e) {
      console.error(e)
      return
    }
    setCards((prev) => prev.filter((c) => c.id !== card.id))
    setAddModalRefresh((n) => n + 1)
  }

  function handleEditSuccess(updated) {
    setCards((prev) => prev.map((c) => (c.id === editingCard.id ? { ...c, ...updated } : c)))
    setEditingCard(null)
    setAddModalRefresh((n) => n + 1)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-studiio-ink">
          <strong>{cards.length}</strong> {cards.length === 1 ? 'Vokabel' : 'Vokabeln'} in diesem Fach.
          <span className="ml-2 text-studiio-muted">
            — <strong>{toPractice}</strong> noch zu üben
          </span>
        </p>
        <button
          type="button"
          onClick={onStartPractice}
          className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
        >
          Vokabeln üben
        </button>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="rounded-lg border-2 border-studiio-lavender/60 px-4 py-2 text-sm font-medium text-studiio-ink hover:border-studiio-accent hover:bg-studiio-sky/20"
        >
          Karte hinzufügen
        </button>
        <button
          type="button"
          onClick={() => setShowManageList((v) => !v)}
          className="rounded-lg border border-studiio-lavender/60 px-4 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/30"
        >
          {showManageList ? 'Verwalten ausblenden' : 'Vokabeln verwalten'}
        </button>
      </div>

      {showManageList && (
        <div className="rounded-xl border border-studiio-lavender/50 bg-white/90 overflow-hidden">
          <p className="text-xs text-studiio-muted px-3 py-2 border-b border-studiio-lavender/30">
            Karten bearbeiten, Format wechseln oder löschen.
          </p>
          <ul className="divide-y divide-studiio-lavender/30 max-h-60 overflow-auto">
            {cards.map((card) => (
              <li key={card.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-studiio-ink line-clamp-1">{card.question}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-studiio-sky/50 text-studiio-ink ml-1">
                    {FORMAT_LABELS[card.format] || card.format}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingCard(card)}
                    className="rounded border border-studiio-lavender/60 px-2 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/30"
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCard(card)}
                    className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showAddModal && (
        <FlashcardAddManualModal
          user={user}
          subject={subject}
          currentCardCount={cards.length}
          onClose={onCloseAddModal}
          onSuccess={() => { setAddModalRefresh((n) => n + 1); onCloseAddModal?.() }}
        />
      )}
      {editingCard && (
        <FlashcardEditModal
          user={user}
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  )
}
