import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import SubjectMaterials from './SubjectMaterials'
import LectureTutor from './LectureTutor'
import FlashcardCreateModal from './FlashcardCreateModal'
import FlashcardPracticePage from './FlashcardPracticePage'
import { getLearningTime, formatLearningTime } from '../utils/learningTime'

class SubjectDetailErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Fehler in SubjectDetail:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">
            Es ist ein Fehler im Fach-Detailbereich aufgetreten.
          </p>
          <p className="text-xs text-red-700">
            {this.state.error?.message || 'Bitte lade die Seite neu oder gehe zurück zur Übersicht.'}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

function formatCountdown(examDate) {
  if (!examDate) return 'Kein Termin eingetragen'
  const today = new Date()
  const target = new Date(examDate)

  const oneDayMs = 1000 * 60 * 60 * 24
  const diffDays = Math.round((target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / oneDayMs)

  if (Number.isNaN(diffDays)) return 'Ungültiges Datum'
  if (diffDays === 0) return 'Heute ist Klausurtag 💪'
  if (diffDays > 0) return `Noch ${diffDays} Tag${diffDays === 1 ? '' : 'e'}`
  const pastDays = Math.abs(diffDays)
  return `Klausur war vor ${pastDays} Tag${pastDays === 1 ? '' : 'en'}`
}

function SubjectDetailInner({ user, subject, onBack, openToPractice, onOpenToPracticeHandled, openToTutorMaterialId, onOpenToTutorHandled }) {
  const [activeLecture, setActiveLecture] = useState(null)
  const [flashcardMaterial, setFlashcardMaterial] = useState(null)
  const [flashcardRefresh, setFlashcardRefresh] = useState(0)
  const [showFlashcardPractice, setShowFlashcardPractice] = useState(false)
  const [practiceMaterialFilter, setPracticeMaterialFilter] = useState(null)
  const [learningTimeSeconds, setLearningTimeSeconds] = useState(0)
  const [learningTimeRefresh, setLearningTimeRefresh] = useState(0)
  const [tutorRefresh, setTutorRefresh] = useState(0)
  const [progressSummaryPct, setProgressSummaryPct] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [lastSavedNote, setLastSavedNote] = useState('')
  const [noteLoading, setNoteLoading] = useState(true)
  const [noteHydrated, setNoteHydrated] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteStatus, setNoteStatus] = useState('')
  const [noteError, setNoteError] = useState('')

  useEffect(() => {
    if (!user?.id || !subject?.id) return
    getLearningTime(user.id, subject.id).then(setLearningTimeSeconds)
    // Nach Rückkehr aus Tutor/Vokabeln: nochmal laden, sobald die gespeicherte Zeit ankommen konnte
    if (learningTimeRefresh > 0) {
      const t = setTimeout(() => {
        getLearningTime(user.id, subject.id).then(setLearningTimeSeconds)
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [user?.id, subject?.id, learningTimeRefresh])

  useEffect(() => {
    if (!user?.id || !subject?.id) return
    let mounted = true
    ;(async () => {
      try {
        const { data: materialsData, error: matErr } = await supabase
          .from('materials')
          .select('id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .is('deleted_at', null)
        if (matErr) throw matErr

        const materialIds = new Set((materialsData || []).map((m) => m.id))
        const materialsTotal = materialIds.size

        const { data: cardsData, error: cardsErr } = await supabase
          .from('flashcards')
          .select('id, material_id, interval_days')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('is_draft', false)
        if (cardsErr) throw cardsErr
        const cards = cardsData || []
        const cardsTotal = cards.length
        const cardsLearned = cards.filter((c) => Number(c.interval_days || 0) > 0).length

        const { data: tutorRows, error: tutorErr } = await supabase
          .from('tutor_progress')
          .select('material_id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('is_completed', true)
        if (tutorErr) throw tutorErr
        const tutorDoneIds = new Set((tutorRows || []).map((r) => r.material_id).filter((id) => id && materialIds.has(id)))
        const materialsWithCards = new Set(cards.map((c) => c.material_id).filter((id) => id && materialIds.has(id)))
        const materialsDone = Array.from(materialsWithCards).filter((id) => tutorDoneIds.has(id)).length

        const matPct = materialsTotal > 0 ? Math.round((materialsDone / materialsTotal) * 100) : null
        const cardPct = cardsTotal > 0 ? Math.round((cardsLearned / cardsTotal) * 100) : null
        const avgPct = matPct != null && cardPct != null
          ? Math.round((matPct + cardPct) / 2)
          : (matPct ?? cardPct ?? null)
        if (mounted) setProgressSummaryPct(avgPct)
      } catch (_) {
        if (mounted) setProgressSummaryPct(null)
      }
    })()
    return () => { mounted = false }
  }, [user?.id, subject?.id, flashcardRefresh, tutorRefresh])

  useEffect(() => {
    if (!user?.id || !subject?.id) return
    let mounted = true
    setNoteLoading(true)
    setNoteHydrated(false)
    setNoteError('')
    setNoteStatus('')
    supabase
      .from('subject_notes')
      .select('content')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          console.error('Fehler beim Laden der Notiz:', error)
          setNoteError('Notiz konnte nicht geladen werden. Bitte SQL für subject_notes ausführen.')
          setNoteText('')
          setLastSavedNote('')
        } else {
          const loaded = data?.content || ''
          setNoteText(loaded)
          setLastSavedNote(loaded)
        }
        setNoteLoading(false)
        setNoteHydrated(true)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id])

  async function persistNote(nextText) {
    if (!user?.id || !subject?.id) return
    if (noteSaving) return
    if (nextText === lastSavedNote) return
    setNoteSaving(true)
    setNoteError('')
    setNoteStatus('Speichert …')
    const { error } = await supabase
      .from('subject_notes')
      .upsert(
        {
          user_id: user.id,
          subject_id: subject.id,
          content: nextText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,subject_id' }
      )
    setNoteSaving(false)
    if (error) {
      console.error('Fehler beim Speichern der Notiz:', error)
      setNoteError('Notiz konnte nicht gespeichert werden. Bitte SQL für subject_notes ausführen.')
      return
    }
    setLastSavedNote(nextText)
    setNoteStatus('Automatisch gespeichert.')
  }

  useEffect(() => {
    if (!noteHydrated || noteLoading) return
    if (noteText === lastSavedNote) return
    const timer = setTimeout(() => {
      persistNote(noteText)
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteText, lastSavedNote, noteHydrated, noteLoading, user?.id, subject?.id])

  // Direkt vom Dashboard „Vokabeln üben“ geöffnet?
  React.useEffect(() => {
    if (openToPractice && subject?.id) {
      setPracticeMaterialFilter(null)
      setShowFlashcardPractice(true)
      onOpenToPracticeHandled?.()
    }
  }, [openToPractice, subject?.id])

  // Direkt vom Lernplan „Datei mit Tutor durcharbeiten“ geöffnet?
  React.useEffect(() => {
    if (!openToTutorMaterialId || !subject?.id || !user?.id) return
    let mounted = true
    supabase
      .from('materials')
      .select('id, filename, category, storage_path')
      .eq('id', openToTutorMaterialId)
      .eq('subject_id', subject.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return
        onOpenToTutorHandled?.()
        if (!error && data) setActiveLecture(data)
      })
    return () => { mounted = false }
  }, [openToTutorMaterialId, subject?.id, user?.id])

  if (activeLecture) {
    return (
      <LectureTutor
        user={user}
        subject={subject}
        material={activeLecture}
        onBack={() => { setActiveLecture(null); setLearningTimeRefresh((r) => r + 1); setTutorRefresh((r) => r + 1) }}
      />
    )
  }

  if (showFlashcardPractice) {
    return (
      <FlashcardPracticePage
        user={user}
        subject={subject}
        materialFilter={practiceMaterialFilter}
        onBack={() => { setShowFlashcardPractice(false); setFlashcardRefresh((r) => r + 1); setLearningTimeRefresh((r) => r + 1) }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline"
      >
        <span className="inline-block rotate-180 text-base">➜</span>
        Zurück zur Übersicht
      </button>

      <section className="rounded-2xl border border-studiio-lavender/60 bg-white/90 px-4 py-3 shadow-sm">
        <h2 className="text-3xl font-semibold tracking-tight text-studiio-ink">{subject.name}</h2>
        <p className="mt-0.5 text-sm text-studiio-muted">
          {subject.group_label || 'Ohne Semester/Kategorie'}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-studiio-lavender/40 bg-[#eef5ff] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-studiio-muted">Countdown</p>
            <p className="text-sm font-semibold text-studiio-ink">{formatCountdown(subject.exam_date)}</p>
          </div>
          <div className="rounded-xl border border-studiio-lavender/40 bg-[#fff3e7] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-studiio-muted">Klausur</p>
            <p className="text-sm font-semibold text-studiio-ink">
              {subject.exam_date ? new Date(subject.exam_date).toLocaleDateString('de-DE') : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-studiio-lavender/40 bg-[#ebfaf5] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-studiio-muted">Gelernt</p>
            <p className="text-sm font-semibold text-studiio-ink">{formatLearningTime(learningTimeSeconds)}</p>
          </div>
          <div className="rounded-xl border border-studiio-lavender/40 bg-[#f2eefb] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-studiio-muted">Fortschritt</p>
            <p className="text-sm font-semibold text-studiio-ink">{progressSummaryPct != null ? `${progressSummaryPct}%` : '—'}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <SubjectMaterials
            user={user}
            subject={subject}
            refreshTrigger={flashcardRefresh + tutorRefresh}
            onOpenLecture={(material) => setActiveLecture(material)}
            onOpenFlashcardCreate={(material) => setFlashcardMaterial(material)}
            onStartPractice={(materialFilter = null) => {
              setPracticeMaterialFilter(materialFilter)
              setShowFlashcardPractice(true)
            }}
          />
        </div>

        <aside className="h-fit rounded-2xl border border-studiio-lavender/50 bg-white/90 px-4 py-4 space-y-3 xl:sticky xl:top-4">
          <h3 className="text-base font-semibold text-studiio-ink">Notizen</h3>
          {noteError && (
            <p className="text-xs text-red-600">{noteError}</p>
          )}
          {noteLoading ? (
            <p className="text-sm text-studiio-muted">Notiz wird geladen …</p>
          ) : (
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Kurze Stichpunkte, offene Fragen, Merksätze …"
              rows={12}
              className="w-full rounded-xl border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink placeholder:text-studiio-muted/70 focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
            />
          )}
        </aside>
      </div>

      {flashcardMaterial && (
        <FlashcardCreateModal
          user={user}
          subject={subject}
          material={flashcardMaterial}
          onClose={() => setFlashcardMaterial(null)}
          onSuccess={() => {
            setFlashcardRefresh((n) => n + 1)
            setFlashcardMaterial(null)
          }}
        />
      )}
    </div>
  )
}

export default function SubjectDetail(props) {
  return (
    <SubjectDetailErrorBoundary>
      <SubjectDetailInner {...props} />
    </SubjectDetailErrorBoundary>
  )
}

