import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import SettingsClaudeKey from './components/SettingsClaudeKey'
import DashboardSubjects from './components/DashboardSubjects'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [activeView, setActiveView] = useState('overview') // 'overview' | 'settings'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
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
              onClick={() => setActiveView('overview')}
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
          <DashboardSubjects user={user} />
        )}
        {activeView === 'settings' && <SettingsClaudeKey user={user} />}
      </main>
    </div>
  )
}

export default App
