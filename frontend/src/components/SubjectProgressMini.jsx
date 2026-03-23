import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

function withAlpha(hex, alphaHex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) return hex
  return `${hex}${alphaHex}`
}

export default function SubjectProgressMini({ user, subject, onProgress, accentColor = '#4fb4ad' }) {
  const [materialsTotal, setMaterialsTotal] = useState(0)
  const [materialsDone, setMaterialsDone] = useState(0)
  const [cardsTotal, setCardsTotal] = useState(0)
  const [cardsLearned, setCardsLearned] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user?.id || !subject?.id) return
    let mounted = true

    async function load() {
      try {
        const { count: matCount } = await supabase
          .from('materials')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
        if (!mounted) return
        setMaterialsTotal(matCount ?? 0)

        const { data: flashcardsData } = await supabase
          .from('flashcards')
          .select('id, material_id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
        if (!mounted) return
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
        if (!mounted) return
        const learnedIds = new Set((reviews || []).map((r) => r.flashcard_id))
        setCardsLearned(learnedIds.size)
      } catch {
        // Mini-Anzeige: bei Fehlern einfach 0 % anzeigen
      } finally {
        if (mounted) setLoaded(true)
      }
    }

    load()
    return () => { mounted = false }
  }, [user?.id, subject?.id])

  const matPct = materialsTotal ? Math.round((materialsDone / materialsTotal) * 100) : null
  const cardPct = cardsTotal ? Math.round((cardsLearned / cardsTotal) * 100) : null

  // Schnitt aus beiden Fortschritten für Farbanzeige (0 = rot, 100 = grün)
  React.useEffect(() => {
    if (!loaded || !subject?.id || !onProgress) return
    if (matPct == null && cardPct == null) {
      onProgress(subject.id, null)
      return
    }
    const avg = matPct != null && cardPct != null
      ? (matPct + cardPct) / 2
      : (matPct ?? cardPct ?? 0)
    onProgress(subject.id, Math.round(avg))
  }, [loaded, subject?.id, matPct, cardPct, onProgress])

  if (!materialsTotal && !cardsTotal) {
    return (
      <p className="text-xs text-studiio-muted">Noch kein Fortschritt erfasst</p>
    )
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-studiio-ink">Unterlagen</span>
          <span className="text-studiio-muted">{matPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#eef0ec]">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              backgroundColor: accentColor,
              width: `${Math.max(0, Math.min(100, matPct ?? 0))}%`,
            }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-studiio-ink">Vokabeln</span>
          <span className="text-studiio-muted">{cardPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#eef0ec]">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              backgroundColor: withAlpha(accentColor, '99'),
              width: `${Math.max(0, Math.min(100, cardPct ?? 0))}%`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

