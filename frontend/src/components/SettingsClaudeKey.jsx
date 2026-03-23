import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import PasswordInput from './PasswordInput'
import {
  DEFAULT_AI_PROVIDER,
  parseStoredAiConfig,
  serializeAiConfig,
} from '../utils/aiProvider'

/**
 * Einstellungsbereich für KI-Provider + API Key (BYOK).
 * Speicherung bleibt kompatibel in profiles.claude_api_key_encrypted:
 * - Altbestand: reiner String (Claude-Key)
 * - Neu: JSON-String { provider, apiKey }
 */
export default function SettingsClaudeKey({ user }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [provider, setProvider] = useState(DEFAULT_AI_PROVIDER)

  const providerOptions = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openai', label: 'OpenAI (GPT)' },
    { value: 'groq', label: 'Groq' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'xai', label: 'xAI (Grok)' },
  ]

  function getInitialDisplayName() {
    const metaName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.user_metadata?.display_name
    if (metaName && String(metaName).trim()) return String(metaName).trim()
    const email = user?.email || ''
    const localPart = email.split('@')[0] || ''
    return localPart.replace(/[._-]+/g, ' ').trim()
  }

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

      const cfg = parseStoredAiConfig(data?.claude_api_key_encrypted)
      setDisplayName(getInitialDisplayName())
      if (cfg?.provider) setProvider(cfg.provider)
      if (cfg?.apiKey) {
        // Sicherheits-Hinweis: Wir zeigen den echten Key nicht im Klartext an.
        setKeyValue('') // Eingabefeld bleibt leer
        setMessage('Ein KI API Key ist bereits im Profil hinterlegt. Du kannst ihn hier überschreiben oder löschen.')
      }

      setLoading(false)
    }

    loadProfile()
    return () => {
      isMounted = false
    }
  }, [user.id])

  async function handleSaveName(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    const nextName = displayName.trim()
    if (!nextName) {
      setError('Bitte gib einen Namen ein.')
      return
    }

    setNameSaving(true)
    const { error: err } = await supabase.auth.updateUser({
      data: { full_name: nextName },
    })
    setNameSaving(false)

    if (err) {
      console.error('Fehler beim Speichern des Namens:', err)
      setError(`Name konnte nicht gespeichert werden: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setMessage('Name wurde gespeichert.')
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!keyValue.trim()) {
      setError('Bitte einen KI API Key eingeben.')
      return
    }

    setSaving(true)
    const storedValue = serializeAiConfig({
      provider,
      apiKey: keyValue.trim(),
    })
    const { error: err } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          claude_api_key_encrypted: storedValue,
        },
        { onConflict: 'id' },
      )

    setSaving(false)

    if (err) {
      console.error('Fehler beim Speichern des KI Keys:', err)
      setError(`Speichern fehlgeschlagen: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setKeyValue('')
    setMessage('KI API Key wurde sicher im Profil gespeichert.')
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

    setMessage('KI API Key wurde aus deinem Profil entfernt.')
  }

  if (loading) {
    return <p className="text-sm text-studiio-muted">Einstellungen werden geladen …</p>
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-studiio-ink mb-1">Einstellungen</h2>
        <p className="text-sm text-studiio-muted">
          Hier kannst du deinen eigenen KI API Key (mit Anbieter) hinterlegen. Der Key wird nur in deinem Supabase-Profil
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
        <div className="rounded-xl border border-studiio-lavender/40 bg-white p-4">
          <h3 className="text-sm font-semibold text-studiio-ink mb-3">Profil</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="display-name" className="block text-sm font-medium text-studiio-ink mb-1">
                Dein Name
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="z. B. Lena"
                className="studiio-input w-full"
              />
              <p className="mt-1 text-xs text-studiio-muted">
                Dieser Name wird z. B. in deiner Begrüßung im Dashboard angezeigt.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleSaveName}
                disabled={nameSaving}
                className="rounded-lg border border-studiio-lavender/70 px-4 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-sky/20 disabled:opacity-60"
              >
                {nameSaving ? 'Wird gespeichert …' : 'Name speichern'}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="ai-provider" className="block text-sm font-medium text-studiio-ink mb-1">
            KI Anbieter
          </label>
          <select
            id="ai-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent mb-3"
          >
            {providerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 mb-1">
            <label htmlFor="claude-key" className="block text-sm font-medium text-studiio-ink">
              KI API Key
            </label>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-studiio-lavender/70 text-xs font-semibold text-studiio-muted hover:bg-studiio-lavender/40"
              aria-label="Hinweis zum KI API Key"
            >
              ?
            </button>
          </div>
          {showHelp && (
            <div className="mb-2 rounded-lg border border-studiio-lavender/60 bg-studiio-sky/40 px-3 py-2 text-xs text-studiio-muted">
              <p className="font-medium text-studiio-ink mb-1">Woher bekomme ich den API Key?</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Wähle oben deinen KI-Anbieter.</li>
                <li>Erstelle im gewählten Anbieter-Konto einen API Key.</li>
                <li>Kopiere den Key hier hinein und speichere.</li>
              </ol>
              <p className="mt-2">
                Viele Anbieter zeigen den Key nur einmal komplett an. Speichere ihn daher sicher (z.&nbsp;B. Passwort-Manager), bevor du das Fenster schließt.
              </p>
              <p className="mt-2">
                Der Key wird nur in deinem Supabase-Profil gespeichert und nicht in GitHub oder dem öffentlichen Code geteilt. Die Kosten für Anfragen trägst du selbst über dein gewähltes Anbieter-Konto.
              </p>
            </div>
          )}
          <PasswordInput
            id="claude-key"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            required={false}
            autoComplete="off"
            placeholder="z.B. sk-ant-..., sk-..., gsk_... (wird nicht im Klartext angezeigt)"
          />
          <p className="mt-1 text-xs text-studiio-muted">
            Hinweis: Aus Sicherheitsgründen wird ein bereits gespeicherter Key hier nicht im Klartext angezeigt.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="studiio-btn-primary">
            {saving ? 'Wird gespeichert …' : 'KI API Key speichern'}
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

