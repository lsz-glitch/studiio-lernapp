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
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .is('deleted_at', null)
        if (matErr) throw matErr
        setMaterialsTotal(matCount ?? 0)

        const { data: activeMaterials, error: activeMatErr } = await supabase
          .from('materials')
          .select('id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .is('deleted_at', null)
        if (activeMatErr) throw activeMatErr
        const activeMaterialIds = new Set((activeMaterials || []).map((m) => m.id))

        const { data: flashcardsData, error: fcErr } = await supabase
          .from('flashcards')
          .select('id, material_id, interval_days')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('is_draft', false)
        if (fcErr) throw fcErr
        const cards = flashcardsData || []
        setCardsTotal(cards.length)
        const materialIdsWithCards = new Set(
          cards
            .map((c) => c.material_id)
            .filter((id) => Boolean(id) && activeMaterialIds.has(id)),
        )

        const { data: tutorDoneRows, error: tutorErr } = await supabase
          .from('tutor_progress')
          .select('material_id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('is_completed', true)
        if (tutorErr) throw tutorErr
        const materialIdsWithTutorDone = new Set(
          (tutorDoneRows || [])
            .map((r) => r.material_id)
            .filter((id) => Boolean(id) && activeMaterialIds.has(id)),
        )

        const doneBoth = Array.from(materialIdsWithCards).filter((id) => materialIdsWithTutorDone.has(id))
        setMaterialsDone(doneBoth.length)

        // Schnellere Heuristik: gelernt, sobald Intervall > 0 ist.
        // Spart große Review-Abfragen beim Öffnen eines Fachs.
        const learnedCount = cards.filter((c) => Number(c.interval_days || 0) > 0).length
        setCardsLearned(learnedCount)
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
    <div className="rounded-2xl border border-studiio-lavender/70 bg-white px-5 py-4 shadow-sm">
      <h3 className="text-sm font-semibold text-studiio-ink mb-3">Fortschritt</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-studiio-lavender/60 bg-[#f8f6fc] px-3 py-3">
          <p className="text-xs font-medium text-studiio-muted mb-1">Unterlagen durchgearbeitet</p>
          <div className="mb-2 flex items-end justify-between gap-2">
            <p className="text-xl font-bold text-studiio-ink">
              {materialsDone} von {materialsTotal}
            </p>
            <p className="text-xs font-medium text-studiio-muted">{materialsLabel}</p>
          </div>
          {materialsTotal > 0 ? (
            <div className="h-3 w-full rounded-full bg-[#e7deef] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7c6b9e] to-[#9a88ba] transition-all duration-300"
                style={{ width: `${materialsTotal ? Math.round((materialsDone / materialsTotal) * 100) : 0}%` }}
              />
            </div>
          ) : (
            <p className="text-xs text-studiio-muted">Noch keine Unterlagen vorhanden.</p>
          )}
        </div>

        <div className="rounded-xl border border-studiio-lavender/60 bg-[#f3fbf8] px-3 py-3">
          <p className="text-xs font-medium text-studiio-muted mb-1">Vokabeln gelernt</p>
          <div className="mb-2 flex items-end justify-between gap-2">
            <p className="text-xl font-bold text-studiio-ink">
              {cardsLearned} von {cardsTotal}
            </p>
            <p className="text-xs font-medium text-studiio-muted">{cardsLabel}</p>
          </div>
          {cardsTotal > 0 ? (
            <div className="h-3 w-full rounded-full bg-[#d8efe7] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#4fb4ad] to-[#6fc8be] transition-all duration-300"
                style={{ width: `${cardsTotal ? Math.round((cardsLearned / cardsTotal) * 100) : 0}%` }}
              />
            </div>
          ) : (
            <p className="text-xs text-studiio-muted">Noch keine Vokabeln vorhanden.</p>
          )}
        </div>
      </div>
    </div>
  )
}
