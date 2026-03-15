import { useState } from 'react'
import { supabase } from '../supabaseClient'
import PasswordInput from './PasswordInput'

/**
 * Login-Formular: E-Mail + Passwort, Anmeldung mit Supabase Auth.
 * Inkl. Passwort ein-/ausblenden und "Passwort vergessen".
 */
export default function LoginForm({ onSuccess, onSwitchToRegister }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMessage, setResetMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) {
      setError(err.message || 'Anmeldung fehlgeschlagen.')
      return
    }
    onSuccess?.()
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setResetMessage('')
    if (!resetEmail.trim()) {
      setError('Bitte E-Mail-Adresse eingeben.')
      return
    }
    setResetLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/`,
    })
    setResetLoading(false)
    if (err) {
      setError(err.message || 'E-Mail konnte nicht gesendet werden.')
      return
    }
    setResetMessage('Falls ein Konto existiert, wurde ein Link zum Zurücksetzen an diese E-Mail gesendet. Prüfe auch den Spam-Ordner.')
  }

  if (showForgotPassword) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setShowForgotPassword(false)
            setError('')
            setResetMessage('')
            setResetEmail('')
          }}
          className="text-sm text-studiio-muted hover:text-studiio-ink flex items-center gap-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Zurück zum Anmelden
        </button>
        <h3 className="text-lg font-semibold text-studiio-ink">Passwort vergessen</h3>
        <p className="text-sm text-studiio-muted">
          Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link zum Zurücksetzen des Passworts.
        </p>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {resetMessage && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {resetMessage}
          </p>
        )}
        <form onSubmit={handleForgotPassword} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium text-studiio-ink mb-1">
              E-Mail
            </label>
            <input
              id="reset-email"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="deine@email.de"
              className="studiio-input w-full"
            />
          </div>
          <button type="submit" disabled={resetLoading} className="studiio-btn-primary w-full">
            {resetLoading ? 'Wird gesendet …' : 'Link zum Zurücksetzen senden'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div>
        <label htmlFor="login-email" className="block text-sm font-medium text-studiio-ink mb-1">
          E-Mail
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="studiio-input w-full"
        />
      </div>
      <div>
        <label htmlFor="login-password" className="block text-sm font-medium text-studiio-ink mb-1">
          Passwort
        </label>
        <PasswordInput
          id="login-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>
      <p className="text-sm text-center">
        <button
          type="button"
          onClick={() => setShowForgotPassword(true)}
          className="text-studiio-accent font-medium hover:underline"
        >
          Passwort vergessen?
        </button>
      </p>
      <button type="submit" disabled={loading} className="studiio-btn-primary w-full">
        {loading ? 'Wird angemeldet …' : 'Anmelden'}
      </button>
      <p className="text-sm text-studiio-muted text-center">
        Noch kein Konto?{' '}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-studiio-accent font-medium hover:underline"
        >
          Registrieren
        </button>
      </p>
    </form>
  )
}
