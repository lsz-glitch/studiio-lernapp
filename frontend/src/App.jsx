import React, { Suspense, lazy, useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { WELCOME_START_DELAY_MS, WELCOME_REMIND_SNOOZE_MS } from './config'
import {
  armMiniFocusSession,
  pauseMiniFocusSession,
  clearMiniFocusSession,
} from './utils/miniFocusSession'
import { clearPomodoroFocusStorage, dispatchPomodoroPauseForLeave } from './utils/pomodoroFocusBridge'
import { confirmFocusLeaveIfNeeded } from './utils/focusLeaveConfirm'
import { completeTask } from './utils/learningPlan'
import { openLearningPlanExternalUrlSafely } from './utils/safeExternalUrl'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import PomodoroTimer from './components/PomodoroTimer'
import './App.css'

const SettingsClaudeKey = lazy(() => import('./components/SettingsClaudeKey'))
const DashboardSubjects = lazy(() => import('./components/DashboardSubjects'))
const SubjectDetail = lazy(() => import('./components/SubjectDetail'))
const StatisticsPage = lazy(() => import('./components/StatisticsPage'))
const SubjectPlanMode = lazy(() => import('./components/SubjectPlanMode'))

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

function getWelcomeTaskLabel(task, subjects) {
  const sub = task?.subject_id ? subjects.find((s) => s.id === task.subject_id) : null
  const t = task?.title?.trim()
  if (t) return t
  return `${getTaskTypeLabel(task?.type || 'manual')}${sub ? `: ${sub.name}` : ''}`
}

function formatMmSsFromMs(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** Aufgabe ist am angegebenen Kalendertag (lokal) geplant — z. B. nur „heute“ für den Start-Dialog. */
function taskScheduledOnLocalDay(task, dayKey) {
  if (!task?.scheduled_at) return false
  const d = new Date(task.scheduled_at)
  if (Number.isNaN(d.getTime())) return false
  return toLocalDateKey(d) === dayKey
}

function isMissingExternalUrlColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('external_url') && msg.includes('column'))
}

/** Wenn die Spalte noch nicht angelegt wurde: database/supabase-learning-plan-carryover-prompted.sql */
function isMissingCarryoverPromptedColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return (
    code === '42703' ||
    (msg.includes('carryover_prompted') && (msg.includes('column') || msg.includes('does not exist')))
  )
}

const WELCOME_SNOOZE_KEY = 'studiio_welcome_flow_snooze_until'

function getWelcomeSnoozeUntil() {
  try {
    const v = localStorage.getItem(WELCOME_SNOOZE_KEY)
    const t = v ? parseInt(v, 10) : 0
    return Number.isFinite(t) && t > Date.now() ? t : 0
  } catch (_) {
    return 0
  }
}

function isWelcomeMutedToday() {
  try {
    return localStorage.getItem(`studiio_welcome_flow_mute_${toLocalDateKey()}`) === '1'
  } catch (_) {
    return false
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [activeView, setActiveView] = useState('overview') // 'overview' | 'subjects' | 'statistics' | 'settings'
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [showStandaloneSubjectPlan, setShowStandaloneSubjectPlan] = useState(false)
  const [openToPractice, setOpenToPractice] = useState(false)
  const [openToTutorMaterialId, setOpenToTutorMaterialId] = useState(null)
  const [todayPlannedTasks, setTodayPlannedTasks] = useState(0)
  /** Nach Carryover-Check (oder Skip) true — damit der Start-Dialog nicht davor aufpoppt. */
  const [planPickReady, setPlanPickReady] = useState(false)
  const [welcomeStartOpen, setWelcomeStartOpen] = useState(false)
  const [welcomeStartTasks, setWelcomeStartTasks] = useState([])
  const [welcomeStartSubjects, setWelcomeStartSubjects] = useState([])
  /** Zuerst offenen Tutor fortsetzen? Sonst direkt Aufgabenwahl. */
  const [welcomeFlowStep, setWelcomeFlowStep] = useState('pick')
  const [welcomeResumeHint, setWelcomeResumeHint] = useState(null)
  /** Nach Tab-Fokus: Snooze abgelaufen? → Start-Hinweis erneut prüfen. */
  const [welcomeFocusNonce, setWelcomeFocusNonce] = useState(0)
  const [welcomePendingNav, setWelcomePendingNav] = useState(null)
  const welcomeNavigateTimeoutRef = useRef(null)
  const [, setWelcomeTick] = useState(0)
  /** Nach Wiederherstellung von Tab/Fach aus localStorage — Start-Dialog erst danach. */
  const [sessionRestoreDone, setSessionRestoreDone] = useState(false)
  const [carryoverModal, setCarryoverModal] = useState({
    open: false,
    tasks: [],
    selectedIds: [],
    loading: false,
  })
  /** Nach Start aus dem Willkommens-Flow: manuelle/Klausur-Aufgaben — „Zeit für …“ + Erledigt / weiter. */
  const [welcomeTaskFollowup, setWelcomeTaskFollowup] = useState(null)
  const [welcomeFollowupSaving, setWelcomeFollowupSaving] = useState(false)
  const [welcomeFollowupError, setWelcomeFollowupError] = useState('')

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
    if (!user || authLoading) {
      setSessionRestoreDone(false)
      return
    }
    let cancelled = false

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
      } finally {
        if (!cancelled) setSessionRestoreDone(true)
      }
    }

    restore()
    return () => {
      cancelled = true
    }
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
    if (!user?.id || authLoading || !supabase) {
      setPlanPickReady(false)
      return
    }
    let mounted = true
    const todayKey = toLocalDateKey()
    const oncePerDayKey = `studiio_task_carryover_prompted_${todayKey}`

    async function loadCarryoverTasks() {
      try {
        if (typeof window !== 'undefined' && window.localStorage.getItem(oncePerDayKey) === '1') {
          return
        }

        const yesterdayDate = new Date()
        yesterdayDate.setDate(yesterdayDate.getDate() - 1)
        const yesterday = toLocalDateKey(yesterdayDate)

        /** Nur Aufgaben von gestern (auf „heute“ beziehbar), kein alter Backlog aus vielen Tagen. */
        function buildCarryoverQuery(filterPromptedNull) {
          const { startIso, endIso } = getDateRangeForKey(yesterday)
          let q = supabase
            .from('learning_plan_tasks')
            .select(
              filterPromptedNull
                ? 'id, title, type, scheduled_at, carryover_prompted_at'
                : 'id, title, type, scheduled_at',
            )
            .eq('user_id', user.id)
            .is('completed_at', null)
            .gte('scheduled_at', startIso)
            .lt('scheduled_at', endIso)
          if (filterPromptedNull) q = q.is('carryover_prompted_at', null)
          return q.order('scheduled_at', { ascending: true })
        }

        let { data, error } = await buildCarryoverQuery(true)
        if (error && isMissingCarryoverPromptedColumn(error)) {
          const r2 = await buildCarryoverQuery(false)
          data = r2.data
          error = r2.error
        }
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
          tasks,
          selectedIds: tasks.map((t) => t.id),
          loading: false,
        })
      } catch (e) {
        console.error('Übernahme-Dialog Fehler:', e)
      } finally {
        if (mounted) setPlanPickReady(true)
      }
    }

    loadCarryoverTasks()
    return () => {
      mounted = false
    }
  }, [user?.id, authLoading])

  // Start-Hinweis: erst nach Übernahme-Dialog (carryoverModal.open false, planPickReady true). Snooze 10 Min. möglich.
  // `welcomeStartOpen` gehört nicht in die Dependencies: beim Schließen (z. B. „Zum Lernplan“) würde der Effect
  // sonst sofort erneut laufen und den Dialog wieder öffnen.
  useEffect(() => {
    if (!user?.id || authLoading || !supabase || !planPickReady || !sessionRestoreDone) return
    if (carryoverModal.open) return
    if (activeView !== 'overview' || selectedSubject) return
    if (getWelcomeSnoozeUntil()) return
    if (isWelcomeMutedToday()) return
    if (welcomeStartOpen || welcomePendingNav) return

    let mounted = true
    const todayKey = toLocalDateKey()

    async function loadWelcomeFlow() {
      try {
        const [{ data: subjectRows, error: subErr }, taskRes, { data: progList, error: progErr }] =
          await Promise.all([
            supabase.from('subjects').select('id, name, group_label, exam_date').eq('user_id', user.id),
            supabase
              .from('learning_plan_tasks')
              .select('id, title, type, subject_id, material_id, scheduled_at, external_url')
              .eq('user_id', user.id)
              .is('completed_at', null)
              .order('scheduled_at', { ascending: true }),
            supabase
              .from('tutor_progress')
              .select('material_id, subject_id, updated_at, started, is_completed')
              .eq('user_id', user.id)
              .eq('is_completed', false)
              .eq('started', true)
              .order('updated_at', { ascending: false })
              .limit(1),
          ])
        if (!mounted) return
        let taskRows = taskRes.data
        let taskErr = taskRes.error
        if (taskErr && isMissingExternalUrlColumn(taskErr)) {
          const r2 = await supabase
            .from('learning_plan_tasks')
            .select('id, title, type, subject_id, material_id, scheduled_at')
            .eq('user_id', user.id)
            .is('completed_at', null)
            .order('scheduled_at', { ascending: true })
          if (!mounted) return
          taskRows = (r2.data || []).map((t) => ({ ...t, external_url: null }))
          taskErr = r2.error
        }
        if (subErr || taskErr) {
          if (subErr) console.error('Start-Dialog: Fächer laden fehlgeschlagen:', subErr)
          if (taskErr) console.error('Start-Dialog: Aufgaben laden fehlgeschlagen:', taskErr)
          return
        }
        if (progErr) console.error('Start-Dialog: Tutor-Fortschritt laden fehlgeschlagen:', progErr)

        const subjects = subjectRows || []
        /* Start-Dialog: nur Aufgaben, die heute fällig sind (nicht der ganze Überfälligkeits-Backlog). */
        const open = (taskRows || []).filter((t) => taskScheduledOnLocalDay(t, todayKey))

        let resumeHint = null
        const prog = Array.isArray(progList) ? progList[0] : null
        if (prog?.material_id) {
          const { data: mat, error: matErr } = await supabase
            .from('materials')
            .select('id, filename, subject_id')
            .eq('id', prog.material_id)
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .maybeSingle()
          if (!mounted) return
          if (!matErr && mat?.id) {
            const sid = prog.subject_id || mat.subject_id
            const sub = subjects.find((s) => s.id === sid)
            if (sub) {
              resumeHint = {
                subject: sub,
                materialId: mat.id,
                materialFilename: mat.filename || 'Datei',
                updatedAt: prog.updated_at,
              }
            }
          }
        }

        if (!resumeHint && !open.length) return

        setWelcomeStartSubjects(subjects)
        /* Im Dialog mehr Aufgaben zeigen; „beliebig“ wählen geht zusätzlich über den Lernplan-Link. */
        setWelcomeStartTasks(open.slice(0, 50))
        if (resumeHint) {
          setWelcomeResumeHint(resumeHint)
          setWelcomeFlowStep('resume')
        } else {
          setWelcomeResumeHint(null)
          setWelcomeFlowStep('pick')
        }
        setWelcomeStartOpen(true)
      } catch (e) {
        console.error('Start-Dialog Fehler:', e)
      }
    }

    loadWelcomeFlow()
    return () => {
      mounted = false
    }
  }, [
    user?.id,
    authLoading,
    planPickReady,
    sessionRestoreDone,
    carryoverModal.open,
    activeView,
    selectedSubject,
    welcomeFocusNonce,
    welcomePendingNav,
  ])

  useEffect(() => {
    const onFocus = () => setWelcomeFocusNonce((x) => x + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    if (!user?.id) {
      clearMiniFocusSession()
      clearPomodoroFocusStorage()
      setWelcomeTaskFollowup(null)
      setWelcomeFollowupError('')
      setWelcomeFollowupSaving(false)
      setWelcomeStartOpen(false)
      setWelcomeStartTasks([])
      setWelcomeStartSubjects([])
      setWelcomeFlowStep('pick')
      setWelcomeResumeHint(null)
      if (welcomeNavigateTimeoutRef.current) {
        clearTimeout(welcomeNavigateTimeoutRef.current)
        welcomeNavigateTimeoutRef.current = null
      }
      setWelcomePendingNav(null)
    }
  }, [user?.id])

  useEffect(() => {
    if (!selectedSubject) {
      pauseMiniFocusSession()
    }
  }, [selectedSubject])

  useEffect(() => {
    if (selectedSubject && showStandaloneSubjectPlan) {
      pauseMiniFocusSession()
    }
  }, [selectedSubject, showStandaloneSubjectPlan])

  useEffect(() => {
    if (activeView !== 'overview' || selectedSubject) {
      setWelcomeStartOpen(false)
      setWelcomeFlowStep('pick')
      setWelcomeResumeHint(null)
      if (welcomeNavigateTimeoutRef.current) {
        clearTimeout(welcomeNavigateTimeoutRef.current)
        welcomeNavigateTimeoutRef.current = null
      }
      setWelcomePendingNav(null)
    }
  }, [activeView, selectedSubject])

  useEffect(() => {
    if (!welcomePendingNav) return
    const id = window.setInterval(() => setWelcomeTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [welcomePendingNav])

  function closeWelcomeModal() {
    setWelcomeStartOpen(false)
    setWelcomeFlowStep('pick')
    setWelcomeResumeHint(null)
  }

  /** Schließt den Start-Dialog, scrollt zum Lernplan und öffnet dort das Formular für eine neue Aufgabe. */
  function openLearningPlanFromWelcome() {
    closeWelcomeModal()
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        document.getElementById('studiio-learning-plan-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        /* Nach dem Scroll das Eingabeformular öffnen (LearningPlan hört auf dieses Event). */
        window.setTimeout(() => {
          try {
            window.dispatchEvent(new Event('studiio-open-learning-plan-add'))
          } catch (_) {}
        }, 450)
      }, 80)
    })
  }

  function snoozeWelcomeModal() {
    try {
      localStorage.setItem(WELCOME_SNOOZE_KEY, String(Date.now() + WELCOME_REMIND_SNOOZE_MS))
    } catch (_) {}
    closeWelcomeModal()
  }

  function muteWelcomeForToday() {
    try {
      localStorage.setItem(`studiio_welcome_flow_mute_${toLocalDateKey()}`, '1')
    } catch (_) {}
    closeWelcomeModal()
  }

  function handleResumeContinue() {
    const h = welcomeResumeHint
    if (!h?.subject?.id || !h?.materialId) return
    armMiniFocusSession()
    closeWelcomeModal()
    setShowStandaloneSubjectPlan(false)
    setSelectedSubject(h.subject)
    setOpenToPractice(false)
    setOpenToTutorMaterialId(h.materialId)
  }

  function clearWelcomePendingNavigate() {
    if (welcomeNavigateTimeoutRef.current) {
      clearTimeout(welcomeNavigateTimeoutRef.current)
      welcomeNavigateTimeoutRef.current = null
    }
    setWelcomePendingNav(null)
  }

  function executeWelcomeNavigation(task, subjects) {
    if (welcomeNavigateTimeoutRef.current) {
      clearTimeout(welcomeNavigateTimeoutRef.current)
      welcomeNavigateTimeoutRef.current = null
    }
    setWelcomePendingNav(null)

    openLearningPlanExternalUrlSafely(task?.external_url)

    const sub = task.subject_id ? subjects.find((s) => s.id === task.subject_id) : null
    if (sub) armMiniFocusSession()

    const labelLine = getWelcomeTaskLabel(task, subjects)
    const queueFollowupModal = () => {
      if (needsWelcomeTaskFollowupModal(task)) {
        setWelcomeFollowupError('')
        setWelcomeTaskFollowup({ task, labelLine })
      }
    }

    if (task.type === 'vocab' && sub) {
      setShowStandaloneSubjectPlan(false)
      setSelectedSubject(sub)
      setOpenToPractice(true)
      setOpenToTutorMaterialId(null)
      return
    }
    if (task.type === 'tutor' && sub) {
      setShowStandaloneSubjectPlan(false)
      setSelectedSubject(sub)
      setOpenToPractice(false)
      setOpenToTutorMaterialId(task.material_id || null)
      return
    }
    if (task.type === 'exam' && sub) {
      setShowStandaloneSubjectPlan(false)
      setSelectedSubject(sub)
      setOpenToPractice(false)
      setOpenToTutorMaterialId(null)
      queueFollowupModal()
      return
    }
    if (sub) {
      setShowStandaloneSubjectPlan(false)
      setSelectedSubject(sub)
      setOpenToPractice(false)
      setOpenToTutorMaterialId(null)
      queueFollowupModal()
      return
    }
    window.setTimeout(() => {
      document.getElementById('studiio-learning-plan-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      queueFollowupModal()
    }, 150)
  }

  function dismissWelcomeTaskFollowup() {
    setWelcomeTaskFollowup(null)
    setWelcomeFollowupError('')
    setWelcomeFollowupSaving(false)
  }

  async function handleWelcomeTaskFollowupComplete() {
    if (!user?.id || !welcomeTaskFollowup?.task?.id) return
    setWelcomeFollowupSaving(true)
    setWelcomeFollowupError('')
    const { error } = await completeTask(user.id, welcomeTaskFollowup.task.id)
    setWelcomeFollowupSaving(false)
    if (error) {
      console.error('Start-Follow-up: Aufgabe konnte nicht abgehakt werden:', error)
      setWelcomeFollowupError('Speichern hat nicht geklappt. Bitte später im Lernplan erneut versuchen.')
      return
    }
    dismissWelcomeTaskFollowup()
  }

  function scheduleWelcomeNavigation(task) {
    const subjects = [...welcomeStartSubjects]
    clearWelcomePendingNavigate()
    closeWelcomeModal()
    const endsAt = Date.now() + WELCOME_START_DELAY_MS
    const labelLine = getWelcomeTaskLabel(task, subjects)
    setWelcomePendingNav({ task, subjects, endsAt, labelLine })
    welcomeNavigateTimeoutRef.current = window.setTimeout(() => {
      welcomeNavigateTimeoutRef.current = null
      executeWelcomeNavigation(task, subjects)
    }, WELCOME_START_DELAY_MS)
  }

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
    let rememberDayInStorage = true
    try {
      if (moveSelected) {
        // Ausgewählte Aufgaben auf heute verschieben (Datum heute, Uhrzeit beibehalten)
        for (const task of selectedTasks) {
          const current = new Date(task.scheduled_at)
          const today = new Date()
          today.setHours(current.getHours(), current.getMinutes(), 0, 0)
          const { error: moveErr } = await supabase
            .from('learning_plan_tasks')
            .update({ scheduled_at: today.toISOString() })
            .eq('id', task.id)
            .eq('user_id', user.id)
          if (moveErr) {
            console.error('Übernahme-Dialog: Verschieben fehlgeschlagen:', moveErr)
            rememberDayInStorage = false
            break
          }
        }
      }

      if (rememberDayInStorage && markAsPrompted) {
        // Für alle angezeigten Aufgaben merken, dass bereits gefragt wurde (nur einmal pro Aufgabe).
        const allShownIds = carryoverModal.tasks.map((t) => t.id)
        if (allShownIds.length) {
          const { error: promptErr } = await supabase
            .from('learning_plan_tasks')
            .update({ carryover_prompted_at: nowIso })
            .in('id', allShownIds)
            .eq('user_id', user.id)
          if (promptErr) {
            if (isMissingCarryoverPromptedColumn(promptErr)) {
              console.warn(
                'Übernahme-Dialog: Spalte carryover_prompted_at fehlt — bitte database/supabase-learning-plan-carryover-prompted.sql in Supabase ausführen.',
              )
            } else {
              console.error('Übernahme-Dialog: Merken „schon gefragt“ fehlgeschlagen:', promptErr)
              rememberDayInStorage = false
            }
          }
        }
      }
    } catch (e) {
      rememberDayInStorage = false
      console.error('Übernahme-Dialog: Speichern fehlgeschlagen', e)
    } finally {
      if (rememberDayInStorage && typeof window !== 'undefined') {
        window.localStorage.setItem(oncePerDayKey, '1')
      }
      setCarryoverModal({ open: false, tasks: [], selectedIds: [], loading: false })
    }
  }

  const isOverviewRoot = activeView === 'overview' && !selectedSubject
  const navActiveView = selectedSubject ? 'subjects' : activeView
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
    if (selectedSubject && showStandaloneSubjectPlan) {
      return (
        <div className="min-h-0 w-full">
          <SubjectPlanMode
            user={user}
            subject={selectedSubject}
            onBack={() => {
              setShowStandaloneSubjectPlan(false)
            }}
            onActiveSubjectChange={(nextSubject) => {
              if (!nextSubject?.id) return
              setSelectedSubject(nextSubject)
            }}
            showHeader
            showCatalog
            interactive
            allowSubjectSelection
          />
        </div>
      )
    }

    if (selectedSubject) {
      return (
        <SubjectDetail
          user={user}
          subject={selectedSubject}
          onBack={() => {
            if (!confirmFocusLeaveIfNeeded()) return
            dispatchPomodoroPauseForLeave()
            pauseMiniFocusSession()
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(null)
          }}
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
          onOpenSubject={(subject) => {
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(subject)
          }}
          onStartPractice={(subject) => {
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(subject)
            setOpenToPractice(true)
          }}
          onOpenTutor={(subject, materialId) => {
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(subject)
            setOpenToTutorMaterialId(materialId)
          }}
          onOpenSubjectPlan={(subject) => {
            setSelectedSubject(subject)
            setShowStandaloneSubjectPlan(true)
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
          onOpenSubject={(subject) => {
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(subject)
          }}
          onStartPractice={(subject) => {
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(subject)
            setOpenToPractice(true)
          }}
          onOpenTutor={(subject, materialId) => {
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(subject)
            setOpenToTutorMaterialId(materialId)
          }}
          onOpenSubjectPlan={(subject) => {
            setSelectedSubject(subject)
            setShowStandaloneSubjectPlan(true)
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
            setShowStandaloneSubjectPlan(false)
            setSelectedSubject(null)
          }}
          onGoToSubjects={() => {
            setActiveView('subjects')
            setShowStandaloneSubjectPlan(false)
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
                  if (!confirmFocusLeaveIfNeeded()) return
                  setActiveView('overview')
                  setShowStandaloneSubjectPlan(false)
                  setSelectedSubject(null)
                }}
                className={navActiveView === 'overview' ? 'rounded-full bg-[#cdeee8] px-3 py-1 font-medium text-[#245b55]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#e9f4fb]'}
              >
                Lernplan
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirmFocusLeaveIfNeeded()) return
                  dispatchPomodoroPauseForLeave()
                  setActiveView('subjects')
                  setShowStandaloneSubjectPlan(false)
                  setSelectedSubject(null)
                }}
                className={navActiveView === 'subjects' ? 'rounded-full bg-[#f4e5cb] px-3 py-1 font-medium text-[#6b4c15]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#f9f2e5]'}
              >
                Fächer
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirmFocusLeaveIfNeeded()) return
                  dispatchPomodoroPauseForLeave()
                  setActiveView('statistics')
                  setShowStandaloneSubjectPlan(false)
                  setSelectedSubject(null)
                }}
                className={navActiveView === 'statistics' ? 'rounded-full bg-[#d8ecff] px-3 py-1 font-medium text-[#23507a]' : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-[#e8f2fb]'}
              >
                Statistiken
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirmFocusLeaveIfNeeded()) return
                  dispatchPomodoroPauseForLeave()
                  setActiveView('settings')
                  setShowStandaloneSubjectPlan(false)
                  setSelectedSubject(null)
                }}
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
      <PomodoroTimer
        elevated={Boolean(
          (welcomePendingNav && activeView === 'overview' && !selectedSubject) || selectedSubject,
        )}
      />
      {welcomeStartOpen && activeView === 'overview' && !selectedSubject && user && (
        <div className="fixed inset-0 z-[68] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-studiio-lavender/40 bg-gradient-to-br from-white via-[#f8fbff] to-[#f3fff8] p-5 shadow-xl">
            {welcomeFlowStep === 'resume' && welcomeResumeHint ? (
              <>
                <h3 className="text-lg font-semibold text-studiio-ink">Schön, dass du wieder da bist</h3>
                <p className="mt-2 text-sm text-studiio-muted leading-relaxed">
                  Du warst zuletzt beim <strong className="text-studiio-ink">Tutor</strong> für{' '}
                  <strong className="text-studiio-ink">{welcomeResumeHint.materialFilename}</strong> im Fach{' '}
                  <strong className="text-studiio-ink">{welcomeResumeHint.subject.name}</strong> — und hast noch nicht abgeschlossen.{' '}
                  <strong className="text-studiio-ink">Möchtest du dort weitermachen?</strong>
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={handleResumeContinue}
                    className="rounded-lg bg-studiio-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-studiio-accentHover"
                  >
                    Ja, weitermachen
                  </button>
                  {welcomeStartTasks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setWelcomeFlowStep('pick')
                        setWelcomeResumeHint(null)
                      }}
                      className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/20"
                    >
                      Etwas anderes wählen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openLearningPlanFromWelcome}
                    className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/20"
                  >
                    Zum Lernplan — Aufgabe wählen oder neu anlegen
                  </button>
                  <button
                    type="button"
                    onClick={snoozeWelcomeModal}
                    className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/20"
                  >
                    In 10 Min. erinnern — erst planen
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-studiio-ink">Schön, dass du da bist, {getDisplayName(user)}!</h3>
                <p className="mt-2 text-sm text-studiio-muted leading-relaxed">
                  <strong className="text-studiio-ink">Womit möchtest du in zwei Minuten anfangen?</strong> In der Liste sind nur Aufgaben, die <strong className="text-studiio-ink">für heute</strong> vorgesehen sind. Kurz orientieren — dann starten wir automatisch. Oft reichen schon{' '}
                  <strong className="text-studiio-ink">wenige Minuten Fokus</strong>, um gut reinzukommen; du entscheidest, wie lange du dranbleibst.{' '}
                  <span className="text-studiio-ink/90">
                    Passt nichts hier? Im Lernplan siehst du alle geplanten Aufgaben und kannst dir eine neue anlegen.
                  </span>
                </p>
                {welcomeStartTasks.length === 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-studiio-muted">
                      Keine offenen Aufgaben für heute in dieser Kurzliste — im Lernplan findest du den vollen Plan und kannst sofort etwas Neues eintragen.
                    </p>
                    <button
                      type="button"
                      onClick={openLearningPlanFromWelcome}
                      className="w-full rounded-lg bg-studiio-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-studiio-accentHover sm:w-auto"
                    >
                      Zum Lernplan
                    </button>
                  </div>
                ) : (
                  <ul className="mt-4 max-h-[min(50vh,22rem)] space-y-2 overflow-auto">
                    {welcomeStartTasks.map((task) => {
                      const sub = task.subject_id ? welcomeStartSubjects.find((s) => s.id === task.subject_id) : null
                      const line = getWelcomeTaskLabel(task, welcomeStartSubjects)
                      const timeStr = task.scheduled_at
                        ? new Date(task.scheduled_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                        : ''
                      return (
                        <li key={task.id}>
                          <button
                            type="button"
                            onClick={() => scheduleWelcomeNavigation(task)}
                            className="flex w-full items-start gap-2 rounded-xl border border-studiio-lavender/50 bg-white/90 px-3 py-2.5 text-left text-sm shadow-sm transition hover:border-studiio-accent/50 hover:bg-studiio-sky/10"
                          >
                            <span
                              className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getTaskTypeBadgeClass(task.type)}`}
                            >
                              {getTaskTypeLabel(task.type)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block break-words font-medium text-studiio-ink">{line}</span>
                              {(sub || timeStr) && (
                                <span className="mt-0.5 block text-xs text-studiio-muted">
                                  {[sub?.name, timeStr].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-lg leading-none text-studiio-accent" aria-hidden>
                              ➜
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {welcomeStartTasks.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={openLearningPlanFromWelcome}
                      className="w-full rounded-lg border border-dashed border-studiio-accent/40 bg-studiio-sky/10 px-3 py-2.5 text-left text-sm font-medium text-studiio-ink hover:bg-studiio-sky/25 sm:text-center"
                    >
                      Andere Aufgabe oder neu anlegen — zum vollen Lernplan
                    </button>
                  </div>
                )}
                <div className="mt-4 flex flex-col gap-2 border-t border-studiio-lavender/30 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={snoozeWelcomeModal}
                    className="rounded-lg border border-studiio-lavender/70 px-3 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/20"
                  >
                    In 10 Min. erinnern — erst planen
                  </button>
                  <button
                    type="button"
                    onClick={muteWelcomeForToday}
                    className="rounded-lg border border-studiio-lavender/70 px-3 py-2 text-sm font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/20"
                  >
                    Heute nicht mehr erinnern
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {welcomeTaskFollowup && user && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/35 px-4">
          <div
            className="w-full max-w-md rounded-2xl border border-studiio-lavender/50 bg-gradient-to-br from-white via-[#f8fbff] to-[#fff8ef] p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-followup-title"
          >
            <h3 id="welcome-followup-title" className="text-lg font-semibold text-studiio-ink">
              Zeit für …
            </h3>
            <p className="mt-2 text-sm font-medium leading-snug text-studiio-ink">
              {welcomeTaskFollowup.labelLine}
            </p>
            <p className="mt-2 text-sm text-studiio-muted leading-relaxed">
              Du kannst die App ganz normal nutzen. Wenn du fertig bist, markiere die Aufgabe hier als erledigt — oder
              schließ dieses Fenster und hake später im Lernplan ab.
            </p>
            {welcomeFollowupError && (
              <p className="mt-2 text-xs text-red-600" role="alert">
                {welcomeFollowupError}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={dismissWelcomeTaskFollowup}
                className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/20"
              >
                Weiter ohne abhaken
              </button>
              <button
                type="button"
                onClick={handleWelcomeTaskFollowupComplete}
                disabled={welcomeFollowupSaving}
                className="rounded-lg bg-studiio-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-studiio-accentHover disabled:opacity-60"
              >
                {welcomeFollowupSaving ? 'Speichert …' : 'Erledigt'}
              </button>
            </div>
          </div>
        </div>
      )}
      {welcomePendingNav && activeView === 'overview' && !selectedSubject && user && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[69] border-t border-teal-200/80 bg-gradient-to-r from-teal-50/98 via-white/98 to-[#f3fff8]/98 px-4 py-3 shadow-[0_-8px_24px_rgba(57,67,105,0.12)]"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-studiio-ink">
              <span className="font-semibold">Gleich geht&apos;s los:</span>{' '}
              <span className="break-words">{welcomePendingNav.labelLine}</span>
              <span className="mt-0.5 block text-xs text-studiio-muted">
                Automatischer Start in{' '}
                <span className="font-mono font-semibold text-studiio-ink">
                  {formatMmSsFromMs(Math.max(0, welcomePendingNav.endsAt - Date.now()))}
                </span>{' '}
                — kurz sammeln, dann ohne weiteres Klicken weiter.
              </span>
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => executeWelcomeNavigation(welcomePendingNav.task, welcomePendingNav.subjects)}
                className="rounded-lg bg-studiio-accent px-3 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
              >
                Jetzt starten
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(WELCOME_SNOOZE_KEY, String(Date.now() + WELCOME_REMIND_SNOOZE_MS))
                  } catch (_) {}
                  clearWelcomePendingNavigate()
                }}
                className="rounded-lg border border-studiio-lavender/70 px-3 py-2 text-sm font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/20"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
      {carryoverModal.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-studiio-lavender/40 bg-gradient-to-br from-white via-[#f8fbff] to-[#f3fff8] p-4 shadow-xl">
            <h3 className="text-lg font-semibold text-studiio-ink">
              {getGreetingByHour()}, {getDisplayName(user)}! 🌷
            </h3>
            <p className="mt-1 text-sm text-studiio-muted">
              Schön, dass du heute lernst. Hier sind nur deine <strong className="text-studiio-ink">offenen Aufgaben von gestern</strong> — welche möchtest du auf <strong className="text-studiio-ink">heute</strong> legen?
            </p>
            <p className="mt-1 text-xs text-studiio-muted">
              Wenn du heute nichts verschieben möchtest, nutze „Heute nichts verschieben“. Danach kannst du wählen, womit du anfangen möchtest.
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
