import React, { Suspense, lazy, useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import './App.css'

const SettingsClaudeKey = lazy(() => import('./components/SettingsClaudeKey'))
const DashboardSubjects = lazy(() => import('./components/DashboardSubjects'))
const SubjectDetail = lazy(() => import('./components/SubjectDetail'))
const StatisticsPage = lazy(() => import('./components/StatisticsPage'))

function getDisplayName(user) {
  const metaName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.display_name
  if (metaName && String(metaName).trim()) return String(metaName).trim()

  const email = user?.email || ''
  const localPart = email.split('@')[0] || 'Lernende'
  const clean = localPart.replace(/[._-]+/g, ' ').trim()
  if (!clean) return 'Lernende'
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

function getGreetingByHour() {
  return new Date().getHours() < 12 ? 'Guten Morgen' : 'Guten Tag'
}

function getMotivationByHour() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Schönen Start in den Tag - du packst das.'
  if (hour >= 18) return 'Stark, dass du heute noch lernst.'
  return 'Ich wünsche dir einen produktiven, entspannten Lerntag.'
}

function toLocalDateKey(date = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDateRangeForKey(dateKey) {
  const start = new Date(`${dateKey}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function dayDiffFromToday(dayKey) {
  if (!dayKey) return null
  const target = new Date(`${dayKey}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = today.getTime() - target.getTime()
  return Math.round(diffMs / (24 * 60 * 60 * 1000))
}

function getTaskTypeLabel(type) {
  if (type === 'tutor') return 'Tutor'
  if (type === 'vocab') return 'Vokabeln'
  if (type === 'exam') return 'Klausur'
  return 'Aufgabe'
}

function getTaskTypeBadgeClass(type) {
  if (type === 'tutor') return 'border-teal-200 bg-teal-50 text-teal-700'
  if (type === 'vocab') return 'border-violet-200 bg-violet-50 text-violet-700'
  if (type === 'exam') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-studiio-lavender/60 bg-white text-studiio-muted'
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [activeView, setActiveView] = useState('overview') // 'overview' | 'subjects' | 'statistics' | 'settings'
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [openToPractice, setOpenToPractice] = useState(false)
  const [openToTutorMaterialId, setOpenToTutorMaterialId] = useState(null)
  const [todayPlannedTasks, setTodayPlannedTasks] = useState(0)
  const [carryoverModal, setCarryoverModal] = useState({
    open: false,
    mode: 'yesterday', // yesterday | all_open
    tasks: [],
    selectedIds: [],
    loading: false,
  })

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Letzte Ansicht/Fach nach Login wiederherstellen
  useEffect(() => {
    if (!user || authLoading) return

    const restore = async () => {
      try {
        const storedView = localStorage.getItem('studiio_last_view')
        const storedSubjectId = localStorage.getItem('studiio_last_subject_id')
        const storedSubjectRaw = localStorage.getItem('studiio_last_subject')
        let restoredSubject = null

        if (storedView === 'settings' || storedView === 'subjects' || storedView === 'statistics') {
          setActiveView(storedView)
        } else {
          setActiveView('overview')
        }

        // 1. Versuch: komplettes Fach-Objekt aus localStorage verwenden
        if (storedSubjectRaw) {
          try {
            restoredSubject = JSON.parse(storedSubjectRaw)
            if (restoredSubject && restoredSubject.id) {
              setSelectedSubject(restoredSubject)
              return
            }
          } catch (e) {
            console.error('Fehler beim Parsen von studiio_last_subject:', e)
          }
        }

        // 2. Fallback: Fach aus Supabase nachladen, falls nur die ID gespeichert ist
        if (!restoredSubject && storedSubjectId) {
          const { data, error } = await supabase
            .from('subjects')
            .select('id, name, group_label, exam_date')
            .eq('id', storedSubjectId)
            .maybeSingle()

          if (!error && data) {
            setSelectedSubject(data)
          }
        }
      } catch (e) {
        console.error('Fehler beim Wiederherstellen der letzten Ansicht:', e)
      }
    }

    restore()
  }, [user, authLoading])

  // Ansicht/Fach in localStorage speichern
  useEffect(() => {
    if (!user) return
    try {
      localStorage.setItem('studiio_last_view', activeView)
      if (selectedSubject?.id) {
        localStorage.setItem('studiio_last_subject_id', selectedSubject.id)
        localStorage.setItem('studiio_last_subject', JSON.stringify(selectedSubject))
      } else {
        localStorage.removeItem('studiio_last_subject_id')
        localStorage.removeItem('studiio_last_subject')
      }
    } catch (e) {
      console.error('Fehler beim Speichern der letzten Ansicht:', e)
    }
  }, [user, activeView, selectedSubject])

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut()
  }

  useEffect(() => {
    if (!user?.id || authLoading || !supabase) return
    let mounted = true
    const todayKey = toLocalDateKey()
    const oncePerDayKey = `studiio_task_carryover_prompted_${todayKey}`
    if (typeof window !== 'undefined' && window.localStorage.getItem(oncePerDayKey) === '1') return

    async function loadCarryoverTasks() {
      try {
        const today = toLocalDateKey()
        const yesterdayDate = new Date()
        yesterdayDate.setDate(yesterdayDate.getDate() - 1)
        const yesterday = toLocalDateKey(yesterdayDate)

        // Aktivitätszustand bestimmen: gestern aktiv => nur gestrige offenen Aufgaben.
        // Sonst (mehrere Tage inaktiv) => alle überfälligen offenen Aufgaben.
        const { data: streakData } = await supabase
          .from('user_streaks')
          .select('last_activity_date')
          .eq('user_id', user.id)
          .maybeSingle()
        const lastActivity = streakData?.last_activity_date ? String(streakData.last_activity_date).slice(0, 10) : null
        const daysSinceLastActivity = dayDiffFromToday(lastActivity)
        // "yesterday"-Modus auch dann, wenn gestern ODER heute bereits Aktivität vorlag.
        const mode = daysSinceLastActivity != null && daysSinceLastActivity <= 1 ? 'yesterday' : 'all_open'

        let query = supabase
          .from('learning_plan_tasks')
          .select('id, title, type, scheduled_at, carryover_prompted_at')
          .eq('user_id', user.id)
          .is('completed_at', null)
          .is('carryover_prompted_at', null)

        if (mode === 'yesterday') {
          const { startIso, endIso } = getDateRangeForKey(yesterday)
          query = query.gte('scheduled_at', startIso).lt('scheduled_at', endIso)
        } else {
          const { startIso: todayStartIso } = getDateRangeForKey(today)
          query = query.lt('scheduled_at', todayStartIso)
        }

        const { data, error } = await query.order('scheduled_at', { ascending: true })
        if (!mounted) return
        if (error) {
          console.error('Übernahme-Dialog: Aufgaben laden fehlgeschlagen:', error)
          return
        }
        const tasks = data || []
        if (!tasks.length) {
          if (typeof window !== 'undefined') window.localStorage.setItem(oncePerDayKey, '1')
          return
        }

        setCarryoverModal({
          open: true,
          mode,
          tasks,
          selectedIds: tasks.map((t) => t.id),
          loading: false,
        })
      } catch (e) {
        console.error('Übernahme-Dialog Fehler:', e)
      }
    }

    loadCarryoverTasks()
    return () => { mounted = false }
  }, [user?.id, authLoading])

  function toggleCarryoverTask(taskId) {
    setCarryoverModal((prev) => {
      const selected = new Set(prev.selectedIds)
      if (selected.has(taskId)) selected.delete(taskId)
      else selected.add(taskId)
      return { ...prev, selectedIds: Array.from(selected) }
    })
  }

  function selectAllCarryoverTasks() {
    setCarryoverModal((prev) => ({ ...prev, selectedIds: prev.tasks.map((t) => t.id) }))
  }

  function clearCarryoverSelection() {
    setCarryoverModal((prev) => ({ ...prev, selectedIds: [] }))
  }

  async function handleCarryoverSubmit({ moveSelected, markAsPrompted }) {
    if (!user?.id || !supabase) return
    const todayKey = toLocalDateKey()
    const oncePerDayKey = `studiio_task_carryover_prompted_${todayKey}`
    const nowIso = new Date().toISOString()
    const selectedSet = new Set(carryoverModal.selectedIds)
    const selectedTasks = carryoverModal.tasks.filter((t) => selectedSet.has(t.id))

    setCarryoverModal((prev) => ({ ...prev, loading: true }))
    try {
      if (moveSelected) {
        // Ausgewählte Aufgaben auf heute verschieben (Datum heute, Uhrzeit beibehalten)
        for (const task of selectedTasks) {
          const current = new Date(task.scheduled_at)
          const today = new Date()
          today.setHours(current.getHours(), current.getMinutes(), 0, 0)
          await supabase
            .from('learning_plan_tasks')
            .update({ scheduled_at: today.toISOString() })
            .eq('id', task.id)
            .eq('user_id', user.id)
        }
      }

      if (markAsPrompted) {
        // Für alle angezeigten Aufgaben merken, dass bereits gefragt wurde (nur einmal pro Aufgabe).
        const allShownIds = carryoverModal.tasks.map((t) => t.id)
        if (allShownIds.length) {
          await supabase
            .from('learning_plan_tasks')
            .update({ carryover_prompted_at: nowIso })
            .in('id', allShownIds)
            .eq('user_id', user.id)
        }
      }
    } catch (e) {
      console.error('Übernahme-Dialog: Speichern fehlgeschlagen', e)
    } finally {
      if (typeof window !== 'undefined') window.localStorage.setItem(oncePerDayKey, '1')
      setCarryoverModal({ open: false, mode: 'yesterday', tasks: [], selectedIds: [], loading: false })
    }
  }

  const isOverviewRoot = activeView === 'overview' && !selectedSubject
  const navActiveView = selectedSubject ? 'subjects' : activeView
  const canRemindTomorrow = carryoverModal.mode === 'all_open'
  const carryoverTypeCounts = carryoverModal.tasks.reduce((acc, task) => {
    const type = task?.type || 'manual'
    acc[type] = (acc[type] || 0) + 1
    return acc
  }, {})
  const headerTitle = activeView === 'settings'
    ? 'Einstellungen'
    : activeView === 'statistics'
      ? 'Statistiken'
    : activeView === 'subjects'
      ? 'Meine Fächer'
    : isOverviewRoot
      ? 'studiio'
      : selectedSubject?.name || 'Dashboard'
  const headerSubtitle = activeView === 'settings'
    ? 'Verwalte dein Konto und deine API-Einstellungen.'
    : activeView === 'statistics'
      ? 'Dein Lernfortschritt auf einen Blick.'
    : activeView === 'subjects'
      ? 'Du machst das großartig, ein Fach nach dem anderen.'
    : isOverviewRoot
      ? ''
      : 'Deine Lernübersicht auf einen Blick.'

  function renderMainContent() {
    if (selectedSubject) {
      return (
        <SubjectDetail
          user={user}
          subject={selectedSubject}
          onBack={() => setSelectedSubject(null)}
          openToPractice={openToPractice}
          onOpenToPracticeHandled={() => setOpenToPractice(false)}
          openToTutorMaterialId={openToTutorMaterialId}
          onOpenToTutorHandled={() => setOpenToTutorMaterialId(null)}
        />
      )
    }

    if (activeView === 'overview') {
      return (
        <DashboardSubjects
          user={user}
          onTodayPlannedChange={setTodayPlannedTasks}
          onOpenSubject={(subject) => setSelectedSubject(subject)}
          onStartPractice={(subject) => {
            setSelectedSubject(subject)
            setOpenToPractice(true)
          }}
          onOpenTutor={(subject, materialId) => {
            setSelectedSubject(subject)
            setOpenToTutorMaterialId(materialId)
          }}
          showTopSection
          showLearningPlanSection
          showSubjectsSection={false}
        />
      )
    }

    if (activeView === 'subjects') {
      return (
        <DashboardSubjects
          user={user}
          onTodayPlannedChange={setTodayPlannedTasks}
          onOpenSubject={(subject) => setSelectedSubject(subject)}
          onStartPractice={(subject) => {
            setSelectedSubject(subject)
            setOpenToPractice(true)
          }}
          onOpenTutor={(subject, materialId) => {
            setSelectedSubject(subject)
            setOpenToTutorMaterialId(materialId)
          }}
          showTopSection={false}
          showLearningPlanSection={false}
          showSubjectsSection
        />
      )
    }

    if (activeView === 'statistics') {
      return (
        <StatisticsPage
          user={user}
          onGoToLearningPlan={() => {
            setActiveView('overview')
            setSelectedSubject(null)
          }}
          onGoToSubjects={() => {
            setActiveView('subjects')
            setSelectedSubject(null)
          }}
        />
      )
    }

    if (activeView === 'settings') {
      return <SettingsClaudeKey user={user} />
    }

    return null
  }

  if (!supabase) {
    return (
      <div className="min-h-screen bg-amber-50 text-gray-900 flex flex-col items-center justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold mb-2">Studiio — Supabase fehlt</h1>
        <p className="text-center max-w-lg text-gray-700">
          Root-<code className="bg-white px-1 rounded border">.env</code> mit{' '}
          <strong>VITE_SUPABASE_URL</strong> und{' '}
          <strong>VITE_SUPABASE_ANON_KEY</strong> — oder in{' '}
          <code className="bg-white px-1 rounded border">frontend/src/config.js</code>{' '}
          die <strong>FALLBACK_*</strong>-Werte (Supabase → API).
        </p>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-studiio-cream flex items-center justify-center">
        <p className="text-studiio-muted">Laden …</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-studiio-cream text-studiio-ink flex flex-col items-center justify-center px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="studiio-logo text-3xl md:text-4xl">Studiio</h1>
          <p className="text-studiio-muted mt-1">Dein smarter Lernraum für echte Fortschritte.</p>
        </header>
        <main className="w-full max-w-sm rounded-2xl border border-studiio-lavender/40 bg-white/80 shadow-sm p-6 md:p-8">
          <h2 className="text-xl font-semibold text-studiio-ink mb-4 text-center">
            {authMode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </h2>
          {authMode === 'login' ? (
            <LoginForm
              onSwitchToRegister={() => setAuthMode('register')}
            />
          ) : (
            <RegisterForm
              onSwitchToLogin={() => setAuthMode('login')}
              onSuccess={() => setAuthMode('login')}
            />
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#dff3eb] via-[#ece1fb] to-[#ddf4ea] text-studiio-ink">
      <div className="w-full">
        <header className="border-b border-[#e8ece9] bg-gradient-to-r from-[#ffffff]/95 via-[#f7fbff]/95 to-[#fff9ef]/95 px-4 py-4 md:px-8">
          <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className={isOverviewRoot ? 'text-xl md:text-2xl font-semibold tracking-tight' : 'text-xl md:text-2xl font-semibold tracking-tight'}>
                {headerTitle}
              </h1>
              {headerSubtitle && (
                <p className="text-sm text-studiio-muted">
                  {headerSubtitle}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setActiveView('overview')
                  setSelectedSubject(null)
                }}
                className={navActiveView === 'overview' ? 'rounded-full bg-[#cdeee8] px-3 py-1 font-medium text-[#245b55]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#e9f4fb]'}
              >
                Lernplan
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveView('subjects')
                  setSelectedSubject(null)
                }}
                className={navActiveView === 'subjects' ? 'rounded-full bg-[#f4e5cb] px-3 py-1 font-medium text-[#6b4c15]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#f9f2e5]'}
              >
                Fächer
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveView('statistics')
                  setSelectedSubject(null)
                }}
                className={navActiveView === 'statistics' ? 'rounded-full bg-[#d8ecff] px-3 py-1 font-medium text-[#23507a]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#e8f2fb]'}
              >
                Statistiken
              </button>
              <button
                type="button"
                onClick={() => setActiveView('settings')}
                className={navActiveView === 'settings' ? 'rounded-full bg-[#ece0f8] px-3 py-1 font-medium text-[#5f4b7a]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#efe8fb]'}
              >
                Einstellungen
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full px-3 py-1 text-studiio-muted hover:bg-studiio-sky/20"
                title={user.email}
              >
                Abmelden
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] px-4 py-6 md:px-8 md:py-8">
          <Suspense fallback={<p className="text-sm text-studiio-muted">Ansicht wird geladen …</p>}>
            {renderMainContent()}
          </Suspense>
        </main>
      </div>
      {carryoverModal.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-studiio-lavender/40 bg-gradient-to-br from-white via-[#f8fbff] to-[#f3fff8] p-4 shadow-xl">
            <h3 className="text-lg font-semibold text-studiio-ink">
              {getGreetingByHour()}, {getDisplayName(user)}! 🌷
            </h3>
            <p className="mt-1 text-sm text-studiio-muted">
              {carryoverModal.mode === 'yesterday'
                ? 'Schön, dass du heute lernst. Welche offenen Aufgaben von gestern möchtest du heute mitnehmen?'
                : 'Willkommen zurück! Welche offenen Aufgaben aus den letzten Tagen möchtest du heute übernehmen?'}
            </p>
            <p className="mt-1 text-xs text-studiio-muted">
              {canRemindTomorrow
                ? 'Du kannst auch auf „Morgen erinnern“ tippen, wenn du heute bewusst nichts verschieben möchtest.'
                : 'Wenn du heute nichts verschieben möchtest, nutze „Heute nichts verschieben“. Dann fragen wir diese Aufgaben nicht erneut.'}
            </p>
            <p className="mt-1 text-xs font-medium text-studiio-accent">
              {getMotivationByHour()}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-studiio-muted">
                {carryoverModal.selectedIds.length} von {carryoverModal.tasks.length} ausgewählt
              </p>
              <p className="text-xs text-studiio-muted">
                {getTaskTypeLabel('tutor')}: {carryoverTypeCounts.tutor || 0} · {getTaskTypeLabel('vocab')}: {carryoverTypeCounts.vocab || 0} · {getTaskTypeLabel('exam')}: {carryoverTypeCounts.exam || 0} · {getTaskTypeLabel('manual')}: {carryoverTypeCounts.manual || 0}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllCarryoverTasks}
                  className="rounded border border-studiio-lavender/70 bg-white px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-lavender/20"
                >
                  Alle auswählen
                </button>
                <button
                  type="button"
                  onClick={clearCarryoverSelection}
                  className="rounded border border-studiio-lavender/70 bg-white px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-lavender/20"
                >
                  Keine auswählen
                </button>
              </div>
            </div>
            <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
              {carryoverModal.tasks.map((task) => (
                <li key={task.id} className="rounded-lg border border-studiio-lavender/40 bg-studiio-sky/10 px-3 py-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={carryoverModal.selectedIds.includes(task.id)}
                      onChange={() => toggleCarryoverTask(task.id)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="min-w-0">
                      <span className={`mb-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getTaskTypeBadgeClass(task.type)}`}>
                        {getTaskTypeLabel(task.type)}
                      </span>
                      <span className="block text-sm font-medium text-studiio-ink">{task.title || 'Aufgabe'}</span>
                      <span className="block text-xs text-studiio-muted">
                        {new Date(task.scheduled_at).toLocaleDateString('de-DE')} · {new Date(task.scheduled_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleCarryoverSubmit({ moveSelected: false, markAsPrompted: true })}
                disabled={carryoverModal.loading}
                className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/30"
              >
                Heute nichts verschieben
              </button>
              {canRemindTomorrow && (
                <button
                  type="button"
                  onClick={() => handleCarryoverSubmit({ moveSelected: false, markAsPrompted: false })}
                  disabled={carryoverModal.loading}
                  className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/30"
                >
                  Morgen erinnern
                </button>
              )}
              <button
                type="button"
                onClick={() => handleCarryoverSubmit({ moveSelected: true, markAsPrompted: true })}
                disabled={carryoverModal.loading}
                className="studiio-btn-primary"
              >
                {carryoverModal.loading ? 'Speichert …' : 'Auswahl übernehmen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
