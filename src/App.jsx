import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import SettingsClaudeKey from './components/SettingsClaudeKey'
import DashboardSubjects from './components/DashboardSubjects'
import SubjectDetail from './components/SubjectDetail'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [activeView, setActiveView] = useState('overview') // 'overview' | 'settings'
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [openToPractice, setOpenToPractice] = useState(false)
  const [openToTutorMaterialId, setOpenToTutorMaterialId] = useState(null)

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

        if (storedView === 'settings') {
          setActiveView('settings')
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

  if (!supabase) {
    return (
      <div className="min-h-screen bg-amber-50 text-gray-900 flex flex-col items-center justify-center px-6 py-12">
        <h1 className="text-2xl font-semibold mb-2">Studiio — Supabase fehlt</h1>
        <p className="text-center max-w-lg text-gray-700">
          In <code className="bg-white px-1 rounded border">src/config.js</code>{' '}
          <strong>FALLBACK_SUPABASE_URL</strong> und{' '}
          <strong>FALLBACK_SUPABASE_ANON_KEY</strong> setzen (Supabase → API).
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
          <p className="text-studiio-muted mt-1">Lernen mit KI</p>
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
    <div className="min-h-screen bg-studiio-cream text-studiio-ink">
      <header className="studiio-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="studiio-logo">Studiio</h1>
          <p className="text-studiio-muted text-sm">Lernen mit KI</p>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setActiveView('overview')
                setSelectedSubject(null)
              }}
              className={
                activeView === 'overview'
                  ? 'rounded-full bg-studiio-mint/70 px-3 py-1 font-medium text-studiio-ink'
                  : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-studiio-mint/40'
              }
            >
              Übersicht
            </button>
            <button
              type="button"
              onClick={() => setActiveView('settings')}
              className={
                activeView === 'settings'
                  ? 'rounded-full bg-studiio-lavender/70 px-3 py-1 font-medium text-studiio-ink'
                  : 'rounded-full px-3 py-1 text-studiio-muted hover:bg-studiio-lavender/40'
              }
            >
              Einstellungen
            </button>
          </nav>
          <span className="text-sm text-studiio-muted" title={user.email}>
            {user.email}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm font-medium text-studiio-accent hover:underline"
          >
            Abmelden
          </button>
        </div>
      </header>
      <main className="studiio-main space-y-6">
        {activeView === 'overview' && (
          selectedSubject ? (
            <SubjectDetail
              user={user}
              subject={selectedSubject}
              onBack={() => setSelectedSubject(null)}
              openToPractice={openToPractice}
              onOpenToPracticeHandled={() => setOpenToPractice(false)}
              openToTutorMaterialId={openToTutorMaterialId}
              onOpenToTutorHandled={() => setOpenToTutorMaterialId(null)}
            />
          ) : (
            <DashboardSubjects
              user={user}
              onOpenSubject={(subject) => setSelectedSubject(subject)}
              onStartPractice={(subject) => {
                setSelectedSubject(subject)
                setOpenToPractice(true)
              }}
              onOpenTutor={(subject, materialId) => {
                setSelectedSubject(subject)
                setOpenToTutorMaterialId(materialId)
              }}
            />
          )
        )}
        {activeView === 'settings' && <SettingsClaudeKey user={user} />}
      </main>
    </div>
  )
}

export default App
