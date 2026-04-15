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
  const EXISTING_KEY_HINT =
    'Ein KI API Key ist bereits im Profil hinterlegt. Du kannst ihn hier überschreiben oder löschen.'
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
  const [shareCodes, setShareCodes] = useState([])
  const [shareCodesLoading, setShareCodesLoading] = useState(true)
  const [copyStatus, setCopyStatus] = useState('')

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
        setMessage(EXISTING_KEY_HINT)
      }

      setLoading(false)
    }

    loadProfile()
    return () => {
      isMounted = false
    }
  }, [user.id])

  useEffect(() => {
    let mounted = true
    async function loadShareCodes() {
      setShareCodesLoading(true)
      const { data, error: err } = await supabase
        .from('subject_share_exports')
        .select('id, code, code_label, created_at, expires_at, is_active, subject:subjects(name)')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })

      if (!mounted) return
      if (err) {
        console.error('Fehler beim Laden der Share-Codes:', err)
        setShareCodes([])
        setShareCodesLoading(false)
        return
      }
      setShareCodes(data || [])
      setShareCodesLoading(false)
    }
    loadShareCodes()
    return () => {
      mounted = false
    }
  }, [user.id])

  function formatDate(value) {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  async function handleCopyCode(code) {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopyStatus(code)
      window.setTimeout(() => setCopyStatus(''), 1200)
    } catch (_) {
      setError('Code konnte nicht kopiert werden. Bitte manuell markieren.')
    }
  }

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
      {message && message !== EXISTING_KEY_HINT && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {message}
        </p>
      )}

      <form onSubmit={handleSave} className="space-y-4 max-w-3xl">
        <div className="rounded-xl border border-studiio-lavender/40 bg-white p-4">
          <h3 className="text-sm font-semibold text-studiio-ink mb-3">KI Einstellungen</h3>
          {message === EXISTING_KEY_HINT && (
            <p className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {message}
            </p>
          )}
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
          <div className="mt-3 flex flex-wrap gap-3">
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
        </div>

        <div className="rounded-xl border border-studiio-lavender/40 bg-white p-4">
          <h3 className="text-sm font-semibold text-studiio-ink mb-3">Geteilte Codes</h3>
          {shareCodesLoading ? (
            <p className="text-sm text-studiio-muted">Codes werden geladen …</p>
          ) : shareCodes.length === 0 ? (
            <p className="text-sm text-studiio-muted">Du hast noch keine Codes erstellt.</p>
          ) : (
            <ul className="space-y-2">
              {shareCodes.slice(0, 12).map((item) => {
                const expired = item.expires_at ? new Date(item.expires_at).getTime() < Date.now() : false
                const subjectName = item?.subject?.name || 'Fach'
                return (
                  <li key={item.id} className="rounded-lg border border-studiio-lavender/50 bg-studiio-sky/10 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-studiio-ink truncate">
                        {item.code_label?.trim() || subjectName}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(item.code)}
                        className="rounded border border-studiio-lavender/70 bg-white px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-lavender/20"
                      >
                        {copyStatus === item.code ? 'Kopiert' : 'Kopieren'}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-studiio-muted">
                      {item.code} · Ablauf: {formatDate(item.expires_at)} · {expired ? 'Abgelaufen' : item.is_active ? 'Aktiv' : 'Deaktiviert'}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-studiio-lavender/30 bg-white/70 p-3">
          <h3 className="text-sm font-semibold text-studiio-ink mb-2">Profil</h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="display-name" className="block text-sm font-medium text-studiio-ink mb-1">
                Name
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="z. B. Lena"
                className="studiio-input w-full"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={nameSaving}
              className="rounded-lg border border-studiio-lavender/70 px-4 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-sky/20 disabled:opacity-60"
            >
              {nameSaving ? 'Speichert …' : 'Name speichern'}
            </button>
          </div>
          <p className="mt-2 text-xs text-studiio-muted">
            Das musst du normalerweise nur selten anpassen.
          </p>
        </div>
      </form>
    </section>
  )
}

