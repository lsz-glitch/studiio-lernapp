import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import SettingsClaudeKey from './components/SettingsClaudeKey'
import DashboardSubjects from './components/DashboardSubjects'
import SubjectDetail from './components/SubjectDetail'
import StatisticsPage from './components/StatisticsPage'
import './App.css'

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

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [activeView, setActiveView] = useState('overview') // 'overview' | 'subjects' | 'statistics' | 'settings'
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [openToPractice, setOpenToPractice] = useState(false)
  const [openToTutorMaterialId, setOpenToTutorMaterialId] = useState(null)
  const [todayPlannedTasks, setTodayPlannedTasks] = useState(0)

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

  const isOverviewRoot = activeView === 'overview' && !selectedSubject
  const navActiveView = selectedSubject ? 'subjects' : activeView
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
          {selectedSubject ? (
            <SubjectDetail
              user={user}
              subject={selectedSubject}
              onBack={() => setSelectedSubject(null)}
              openToPractice={openToPractice}
              onOpenToPracticeHandled={() => setOpenToPractice(false)}
              openToTutorMaterialId={openToTutorMaterialId}
              onOpenToTutorHandled={() => setOpenToTutorMaterialId(null)}
            />
          ) : activeView === 'overview' ? (
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
          ) : null}
          {activeView === 'subjects' && !selectedSubject && (
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
          )}
          {activeView === 'statistics' && !selectedSubject && (
            <StatisticsPage user={user} />
          )}
          {activeView === 'settings' && <SettingsClaudeKey user={user} />}
        </main>
      </div>
    </div>
  )
}

export default App
