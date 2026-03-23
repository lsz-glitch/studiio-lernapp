import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import SubjectMaterials from './SubjectMaterials'
import LectureTutor from './LectureTutor'
import FlashcardCreateModal from './FlashcardCreateModal'
import FlashcardsSection from './FlashcardsSection'
import FlashcardPracticePage from './FlashcardPracticePage'
import SubjectProgress from './SubjectProgress'
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [learningTimeSeconds, setLearningTimeSeconds] = useState(0)
  const [learningTimeRefresh, setLearningTimeRefresh] = useState(0)
  const [tutorRefresh, setTutorRefresh] = useState(0)

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

  // Direkt vom Dashboard „Vokabeln üben“ geöffnet?
  React.useEffect(() => {
    if (openToPractice && subject?.id) {
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

      <section className="space-y-1">
        <h2 className="text-2xl font-semibold text-studiio-ink">{subject.name}</h2>
        <p className="text-sm text-studiio-muted">
          {subject.group_label || 'Ohne Semester/Kategorie'}
        </p>
        <p className="text-sm text-studiio-ink">
          Countdown:&nbsp;
          <span className="font-medium">
            {formatCountdown(subject.exam_date)}
          </span>
        </p>
        {subject.exam_date && (
          <p className="text-xs text-studiio-muted">
            Klausurtermin:&nbsp;
            {new Date(subject.exam_date).toLocaleDateString('de-DE')}
          </p>
        )}
        <p className="text-sm text-studiio-ink">
          Bisher <span className="font-medium">{formatLearningTime(learningTimeSeconds)}</span> gelernt
        </p>
      </section>

      <SubjectProgress
        user={user}
        subject={subject}
        refreshTrigger={flashcardRefresh}
      />

      <SubjectMaterials
        user={user}
        subject={subject}
        refreshTrigger={flashcardRefresh + tutorRefresh}
        onOpenLecture={(material) => setActiveLecture(material)}
        onOpenFlashcardCreate={(material) => setFlashcardMaterial(material)}
      />

      <section className="border-t border-studiio-lavender/40 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-lg font-semibold text-studiio-ink">Vokabeln / Karteikarten</h3>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-lg border-2 border-dashed border-studiio-lavender/60 px-4 py-2 text-sm font-medium text-studiio-ink hover:border-studiio-accent hover:bg-studiio-sky/20"
          >
            Karte hinzufügen
          </button>
        </div>
        <FlashcardsSection
          user={user}
          subject={subject}
          refreshTrigger={flashcardRefresh}
          onStartPractice={() => setShowFlashcardPractice(true)}
          showAddModal={showAddModal}
          onCloseAddModal={() => setShowAddModal(false)}
        />
      </section>

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

