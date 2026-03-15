import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function SubjectProgress({ user, subject, refreshTrigger }) {
  const [materialsTotal, setMaterialsTotal] = useState(0)
  const [materialsDone, setMaterialsDone] = useState(0)
  const [cardsTotal, setCardsTotal] = useState(0)
  const [cardsLearned, setCardsLearned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.id || !subject?.id) return
    let mounted = true
    setLoading(true)
    setError('')

    async function load() {
      try {
        const { count: matCount, error: matErr } = await supabase
          .from('materials')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
        if (matErr) throw matErr
        setMaterialsTotal(matCount ?? 0)

        const { data: flashcardsData, error: fcErr } = await supabase
          .from('flashcards')
          .select('id, material_id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
        if (fcErr) throw fcErr
        const cards = flashcardsData || []
        setCardsTotal(cards.length)
        const materialIdsWithCards = new Set(cards.map((c) => c.material_id).filter(Boolean))
        setMaterialsDone(materialIdsWithCards.size)

        if (cards.length === 0) {
          setCardsLearned(0)
          return
        }
        const cardIds = cards.map((c) => c.id)
        const { data: reviews } = await supabase
          .from('flashcard_reviews')
          .select('flashcard_id')
          .eq('user_id', user.id)
          .eq('correct', true)
          .in('flashcard_id', cardIds)
        const learnedIds = new Set((reviews || []).map((r) => r.flashcard_id))
        setCardsLearned(learnedIds.size)
      } catch (e) {
        if (mounted) setError(e.message || 'Fortschritt konnte nicht geladen werden.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshTrigger])

  if (loading) {
    return (
      <div className="rounded-xl border-2 border-studiio-lavender/50 bg-white/90 px-4 py-3">
        <p className="text-sm text-studiio-muted">Fortschritt wird geladen …</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  const materialsLabel = materialsTotal === 1 ? 'Unterlage' : 'Unterlagen'
  const cardsLabel = cardsTotal === 1 ? 'Vokabel' : 'Vokabeln'

  return (
    <div className="rounded-xl border-2 border-studiio-accent/30 bg-studiio-sky/20 px-5 py-4">
      <h3 className="text-sm font-semibold text-studiio-ink mb-3">Fortschritt</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-studiio-muted mb-1">Unterlagen durchgearbeitet</p>
          <p className="text-xl font-bold text-studiio-ink">
            {materialsDone} von {materialsTotal} {materialsLabel}
          </p>
          {materialsTotal > 0 && (
            <div className="mt-1.5 h-2 w-full rounded-full bg-studiio-lavender/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-studiio-accent transition-all duration-300"
                style={{ width: `${materialsTotal ? Math.round((materialsDone / materialsTotal) * 100) : 0}%` }}
              />
            </div>
          )}
        </div>
        <div>
          <p className="text-xs text-studiio-muted mb-1">Vokabeln gelernt</p>
          <p className="text-xl font-bold text-studiio-ink">
            {cardsLearned} von {cardsTotal} {cardsLabel}
          </p>
          {cardsTotal > 0 && (
            <div className="mt-1.5 h-2 w-full rounded-full bg-studiio-lavender/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-studiio-mint transition-all duration-300"
                style={{ width: `${cardsTotal ? Math.round((cardsLearned / cardsTotal) * 100) : 0}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
