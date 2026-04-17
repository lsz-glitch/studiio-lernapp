import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import PasswordInput from './PasswordInput'
import { DEFAULT_MONTHLY_AI_BUDGET_USD } from '../config'
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
  const [budgetSaving, setBudgetSaving] = useState(false)
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
  const [shareCodeFilter, setShareCodeFilter] = useState('active') // active | expiring | expired | all
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageStats, setUsageStats] = useState({
    todayCostUsd: 0,
    monthCostUsd: 0,
    monthInputTokens: 0,
    monthOutputTokens: 0,
    providers: [],
  })
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState(String(DEFAULT_MONTHLY_AI_BUDGET_USD))
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(Number(DEFAULT_MONTHLY_AI_BUDGET_USD))

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
        .select('claude_api_key_encrypted, ai_monthly_budget_usd')
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
      const storedBudget = Number(data?.ai_monthly_budget_usd)
      if (Number.isFinite(storedBudget) && storedBudget > 0) {
        setMonthlyBudgetUsd(storedBudget)
        setMonthlyBudgetInput(String(storedBudget))
      } else {
        setMonthlyBudgetUsd(Number(DEFAULT_MONTHLY_AI_BUDGET_USD))
        setMonthlyBudgetInput(String(DEFAULT_MONTHLY_AI_BUDGET_USD))
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
    async function loadUsageStats() {
      setUsageLoading(true)
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data, error: err } = await supabase
        .from('ai_usage_logs')
        .select('provider, estimated_cost_usd, input_tokens, output_tokens, created_at')
        .eq('user_id', user.id)
        .gte('created_at', monthStart.toISOString())

      if (!mounted) return
      if (err) {
        console.error('Fehler beim Laden des geschätzten Verbrauchs:', err)
        setUsageLoading(false)
        return
      }

      let todayCostUsd = 0
      let monthCostUsd = 0
      let monthInputTokens = 0
      let monthOutputTokens = 0
      const providerAgg = new Map()

      for (const row of data || []) {
        const cost = Number(row.estimated_cost_usd || 0)
        const inTokens = Number(row.input_tokens || 0)
        const outTokens = Number(row.output_tokens || 0)
        const createdAt = new Date(row.created_at)
        monthCostUsd += cost
        monthInputTokens += inTokens
        monthOutputTokens += outTokens
        if (!Number.isNaN(createdAt.getTime()) && createdAt >= todayStart) {
          todayCostUsd += cost
        }
        const p = String(row.provider || 'unbekannt')
        providerAgg.set(p, (providerAgg.get(p) || 0) + cost)
      }

      const providers = Array.from(providerAgg.entries())
        .map(([provider, costUsd]) => ({ provider, costUsd }))
        .sort((a, b) => b.costUsd - a.costUsd)

      setUsageStats({
        todayCostUsd,
        monthCostUsd,
        monthInputTokens,
        monthOutputTokens,
        providers,
      })
      setUsageLoading(false)
    }
    loadUsageStats()
    return () => {
      mounted = false
    }
  }, [user.id])

  function formatUsd(value) {
    return `$${Number(value || 0).toFixed(4)}`
  }
  const monthUsageUsd = Number(usageStats.monthCostUsd || 0)
  const budgetProgressPct = monthlyBudgetUsd > 0
    ? Math.min(100, Math.round((monthUsageUsd / monthlyBudgetUsd) * 100))
    : 0
  const budgetStatus =
    budgetProgressPct >= 100
      ? 'Budget erreicht'
      : budgetProgressPct >= 80
        ? 'Budget fast erreicht'
        : 'Im Budget'
  const budgetToneClass =
    budgetProgressPct >= 100
      ? 'text-red-700'
      : budgetProgressPct >= 80
        ? 'text-amber-700'
        : 'text-emerald-700'
  const budgetBarClass =
    budgetProgressPct >= 100
      ? 'bg-red-500'
      : budgetProgressPct >= 80
        ? 'bg-amber-500'
        : 'bg-emerald-500'

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

  async function handleSaveBudget(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    const parsed = Number(String(monthlyBudgetInput || '').replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Bitte gib ein gültiges Budget in USD ein (größer als 0).')
      return
    }
    setBudgetSaving(true)
    const { error: err } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          ai_monthly_budget_usd: Number(parsed.toFixed(2)),
        },
        { onConflict: 'id' },
      )
    setBudgetSaving(false)
    if (err) {
      console.error('Fehler beim Speichern des Monatsbudgets:', err)
      setError(`Budget konnte nicht gespeichert werden: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }
    setMonthlyBudgetUsd(Number(parsed.toFixed(2)))
    setMonthlyBudgetInput(String(Number(parsed.toFixed(2))))
    setMessage('Monatsbudget wurde gespeichert.')
  }

  function handleIncreaseBudget(amount) {
    const current = Number(String(monthlyBudgetInput || '').replace(',', '.'))
    const safeCurrent = Number.isFinite(current) && current > 0 ? current : Number(monthlyBudgetUsd || DEFAULT_MONTHLY_AI_BUDGET_USD || 0)
    const next = Number((safeCurrent + Number(amount || 0)).toFixed(2))
    setMonthlyBudgetInput(String(next))
  }

  if (loading) {
    return <p className="text-sm text-studiio-muted">Einstellungen werden geladen …</p>
  }

  const nowMs = Date.now()
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000
  const filteredShareCodes = shareCodes.filter((item) => {
    const expiresMs = item.expires_at ? new Date(item.expires_at).getTime() : null
    const expired = expiresMs ? expiresMs < nowMs : false
    const active = !expired && Boolean(item.is_active)
    const expiringSoon = active && expiresMs ? expiresMs - nowMs <= threeDaysMs : false
    if (shareCodeFilter === 'active') return active
    if (shareCodeFilter === 'expiring') return expiringSoon
    if (shareCodeFilter === 'expired') return expired || !item.is_active
    return true
  })

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

      <form onSubmit={handleSave} className="max-w-3xl space-y-3 sm:space-y-4">
        <div className="rounded-xl border border-studiio-lavender/40 bg-white p-3 sm:p-4">
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
            className="mb-2 w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent sm:mb-3"
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
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
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

        <div className="rounded-xl border border-studiio-lavender/40 bg-white p-3 sm:p-4">
          <h3 className="text-sm font-semibold text-studiio-ink mb-3">Geteilte Codes</h3>
          <div className="mb-3 inline-flex rounded-full border border-studiio-lavender/60 bg-studiio-lavender/15 p-1">
            {[
              { id: 'active', label: 'Aktiv' },
              { id: 'expiring', label: 'Läuft bald ab' },
              { id: 'expired', label: 'Abgelaufen' },
              { id: 'all', label: 'Alle' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setShareCodeFilter(opt.id)}
                className={shareCodeFilter === opt.id
                  ? 'rounded-full bg-white px-3 py-1 text-xs font-semibold text-studiio-ink'
                  : 'rounded-full px-3 py-1 text-xs text-studiio-muted hover:bg-white/60'}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {shareCodesLoading ? (
            <p className="text-sm text-studiio-muted">Codes werden geladen …</p>
          ) : filteredShareCodes.length === 0 ? (
            <p className="text-sm text-studiio-muted">Für diesen Filter gibt es gerade keine Codes.</p>
          ) : (
            <ul className="space-y-2">
              {filteredShareCodes.slice(0, 12).map((item) => {
                const expired = item.expires_at ? new Date(item.expires_at).getTime() < Date.now() : false
                const subjectName = item?.subject?.name || 'Fach'
                const statusText = expired ? 'Abgelaufen' : item.is_active ? 'Aktiv' : 'Deaktiviert'
                return (
                  <li key={item.id} className="rounded-lg border border-studiio-lavender/50 bg-studiio-sky/10 px-2.5 py-2 sm:px-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-medium text-studiio-ink break-words">
                        {item.code_label?.trim() || subjectName}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(item.code)}
                        className="w-full rounded border border-studiio-lavender/70 bg-white px-2 py-1.5 text-xs text-studiio-ink hover:bg-studiio-lavender/20 sm:w-auto"
                      >
                        {copyStatus === item.code ? 'Kopiert' : 'Kopieren'}
                      </button>
                    </div>
                    <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-studiio-muted sm:grid-cols-2">
                      <p className="break-all rounded bg-white/70 px-2 py-1">
                        Code: <span className="font-medium text-studiio-ink">{item.code}</span>
                      </p>
                      <p className="rounded bg-white/60 px-2 py-1">Ablauf: {formatDate(item.expires_at)}</p>
                      <p className="rounded bg-white/60 px-2 py-1">Status: {statusText}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-studiio-lavender/30 bg-white/70 p-3">
          <h3 className="text-sm font-semibold text-studiio-ink mb-2">Geschätzter Verbrauch</h3>
          <p className="text-xs text-studiio-muted mb-2">
            Das sind geschätzte Kosten auf Basis von Token-Verbrauch in Studiio (nicht die exakte Anbieter-Rechnung).
          </p>
          <form onSubmit={handleSaveBudget} className="mb-3 rounded-lg border border-studiio-lavender/50 bg-white px-3 py-2">
            <label htmlFor="monthly-budget-usd" className="block text-xs font-medium text-studiio-ink mb-1">
              Dein Monatsbudget / Guthaben (USD)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="monthly-budget-usd"
                type="number"
                min="0.01"
                step="0.01"
                value={monthlyBudgetInput}
                onChange={(e) => setMonthlyBudgetInput(e.target.value)}
                className="studiio-input w-full sm:max-w-[180px]"
                placeholder="z. B. 20"
              />
              <button
                type="submit"
                disabled={budgetSaving}
                className="rounded-lg border border-studiio-lavender/70 px-3 py-2 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/20 disabled:opacity-60"
              >
                {budgetSaving ? 'Speichert …' : 'Budget speichern'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[5, 10, 20].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => handleIncreaseBudget(amount)}
                  className="rounded border border-studiio-lavender/70 bg-studiio-lavender/10 px-2.5 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/20"
                >
                  +{amount} USD
                </button>
              ))}
            </div>
          </form>
          {usageLoading ? (
            <p className="text-sm text-studiio-muted">Verbrauch wird geladen …</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-studiio-lavender/50 bg-white px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-studiio-muted">Heute (geschätzt)</p>
                  <p className="text-base font-semibold text-studiio-ink">{formatUsd(usageStats.todayCostUsd)}</p>
                </div>
                <div className="rounded-lg border border-studiio-lavender/50 bg-white px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-studiio-muted">Diesen Monat (geschätzt)</p>
                  <p className="text-base font-semibold text-studiio-ink">{formatUsd(usageStats.monthCostUsd)}</p>
                </div>
              </div>
              <div className="rounded-lg border border-studiio-lavender/50 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wide text-studiio-muted">Monatsbudget (geschätzt)</p>
                  <span className={`text-xs font-semibold ${budgetToneClass}`}>{budgetStatus}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-studiio-ink">
                  {formatUsd(monthUsageUsd)} von {formatUsd(monthlyBudgetUsd)}
                </p>
                <div className="mt-2 h-2 w-full rounded-full bg-studiio-lavender/30 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${budgetBarClass}`}
                    style={{ width: `${budgetProgressPct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-studiio-muted">{budgetProgressPct}% genutzt</p>
              </div>
              <p className="text-xs text-studiio-muted">
                Tokens diesen Monat: In {usageStats.monthInputTokens.toLocaleString('de-DE')} · Out {usageStats.monthOutputTokens.toLocaleString('de-DE')}
              </p>
              {usageStats.providers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {usageStats.providers.map((p) => (
                    <span key={p.provider} className="rounded bg-studiio-lavender/20 px-2 py-1 text-xs text-studiio-ink">
                      {p.provider}: {formatUsd(p.costUsd)}
                    </span>
                  ))}
                </div>
              )}
            </div>
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

