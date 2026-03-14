import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import PasswordInput from './PasswordInput'

/**
 * Einstellungsbereich für den Claude API Key (BYOK).
 * Annahme: Es gibt in Supabase eine Tabelle "profiles" mit:
 *  - id (uuid, primary key, = auth.users.id)
 *  - claude_api_key_encrypted (text oder verschlüsselte Spalte)
 */
export default function SettingsClaudeKey({ user }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true
    async function loadProfile() {
      setLoading(true)
      setError('')
      setMessage('')
      const { data, error: err } = await supabase
        .from('profiles')
        .select('claude_api_key_encrypted')
        .eq('id', user.id)
        .maybeSingle()

      if (!isMounted) return

      if (err) {
        console.error('Fehler beim Laden des Profils:', err)
        setError(
          `Profil konnte nicht geladen werden: ${err.message || 'Bitte später erneut versuchen.'}`,
        )
        setLoading(false)
        return
      }

      if (data && data.claude_api_key_encrypted) {
        // Sicherheits-Hinweis: Wir zeigen den echten Key nicht im Klartext an.
        setKeyValue('') // Eingabefeld bleibt leer
        setMessage('Ein Claude API Key ist bereits im Profil hinterlegt. Du kannst ihn hier überschreiben oder löschen.')
      }

      setLoading(false)
    }

    loadProfile()
    return () => {
      isMounted = false
    }
  }, [user.id])

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!keyValue.trim()) {
      setError('Bitte einen Claude API Key eingeben.')
      return
    }

    setSaving(true)
    const { error: err } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          claude_api_key_encrypted: keyValue.trim(),
        },
        { onConflict: 'id' },
      )

    setSaving(false)

    if (err) {
      console.error('Fehler beim Speichern des Claude Keys:', err)
      setError(`Speichern fehlgeschlagen: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setKeyValue('')
    setMessage('Claude API Key wurde sicher im Profil gespeichert.')
  }

  async function handleDelete() {
    setError('')
    setMessage('')
    setDeleting(true)

    const { error: err } = await supabase
      .from('profiles')
      .update({ claude_api_key_encrypted: null })
      .eq('id', user.id)

    setDeleting(false)

    if (err) {
      console.error('Fehler beim Löschen des Claude Keys:', err)
      setError(`Key konnte nicht gelöscht werden: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setMessage('Claude API Key wurde aus deinem Profil entfernt.')
  }

  if (loading) {
    return <p className="text-sm text-studiio-muted">Einstellungen werden geladen …</p>
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-studiio-ink mb-1">Einstellungen</h2>
        <p className="text-sm text-studiio-muted">
          Hier kannst du deinen eigenen Claude API Key hinterlegen. Der Key wird nur in deinem Supabase-Profil
          gespeichert und nicht im Code oder in GitHub abgelegt.
        </p>
      </div>

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

      <form onSubmit={handleSave} className="space-y-4 max-w-lg">
        <div>
          <label htmlFor="claude-key" className="block text-sm font-medium text-studiio-ink mb-1">
            Claude API Key
          </label>
          <PasswordInput
            id="claude-key"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            required={false}
            autoComplete="off"
            placeholder="sk-ant-... (wird nicht im Klartext angezeigt, wenn bereits gespeichert)"
          />
          <p className="mt-1 text-xs text-studiio-muted">
            Hinweis: Aus Sicherheitsgründen wird ein bereits gespeicherter Key hier nicht im Klartext angezeigt.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="studiio-btn-primary">
            {saving ? 'Wird gespeichert …' : 'Claude API Key speichern'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-studiio-lavender/70 px-4 py-2.5 text-sm font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/30"
          >
            {deleting ? 'Wird gelöscht …' : 'Key löschen'}
          </button>
        </div>
      </form>
    </section>
  )
}

