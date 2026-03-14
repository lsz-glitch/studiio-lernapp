import { useState } from 'react'
import { supabase } from '../supabaseClient'
import PasswordInput from './PasswordInput'

/**
 * Registrierungs-Formular: E-Mail + Passwort, Konto anlegen mit Supabase Auth.
 */
export default function RegisterForm({ onSuccess, onSwitchToLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    const { error: err } = await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (err) {
      setError(err.message || 'Registrierung fehlgeschlagen.')
      return
    }
    setMessage('Konto erstellt. Bitte prüfe deine E-Mail zur Bestätigung (falls aktiviert). Du kannst dich jetzt anmelden.')
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {message && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {message}
        </p>
      )}
      <div>
        <label htmlFor="register-email" className="block text-sm font-medium text-studiio-ink mb-1">
          E-Mail
        </label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="studiio-input w-full"
        />
      </div>
      <div>
        <label htmlFor="register-password" className="block text-sm font-medium text-studiio-ink mb-1">
          Passwort
        </label>
        <PasswordInput
          id="register-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="Mind. 6 Zeichen"
        />
      </div>
      <button type="submit" disabled={loading} className="studiio-btn-primary w-full">
        {loading ? 'Wird erstellt …' : 'Konto erstellen'}
      </button>
      <p className="text-sm text-studiio-muted text-center">
        Bereits ein Konto?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-studiio-accent font-medium hover:underline"
        >
          Anmelden
        </button>
      </p>
    </form>
  )
}
