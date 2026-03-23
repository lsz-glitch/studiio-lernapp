import { supabase } from '../supabaseClient'

export const DEFAULT_AI_PROVIDER = 'anthropic'

export function parseStoredAiConfig(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (!raw) return null

  // Backward compatibility: old installs stored only the Claude key as plain text.
  if (!raw.startsWith('{')) {
    return { provider: DEFAULT_AI_PROVIDER, apiKey: raw }
  }

  try {
    const parsed = JSON.parse(raw)
    const provider = typeof parsed?.provider === 'string' ? parsed.provider : DEFAULT_AI_PROVIDER
    const apiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : ''
    if (!apiKey) return null
    return { provider, apiKey }
  } catch (_) {
    return { provider: DEFAULT_AI_PROVIDER, apiKey: raw }
  }
}

export function serializeAiConfig({ provider, apiKey }) {
  return JSON.stringify({
    provider: provider || DEFAULT_AI_PROVIDER,
    apiKey: (apiKey || '').trim(),
  })
}

export async function getUserAiConfig(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('claude_api_key_encrypted')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error('Profil konnte nicht geladen werden.')

  const cfg = parseStoredAiConfig(data?.claude_api_key_encrypted)
  if (!cfg?.apiKey) {
    throw new Error('Kein KI API Key hinterlegt. Bitte in den Einstellungen eintragen.')
  }
  return cfg
}
