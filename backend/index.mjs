/**
 * Studiio Backend — Claude-Proxy & API
 * Läuft getrennt vom Vite-Frontend (npm run api).
 * Lade Umgebungsvariablen aus backend/.env
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '.env') })

console.log('[Studiio Backend] Gestartet:', __filename)

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')

const app = express()
const port = process.env.PORT || 8788

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    '[Studiio Backend] SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlen. /api/pdf-text wird nicht funktionieren.',
  )
}

const supabaseServerClient =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
}))
app.use(express.json())

app.use((req, res, next) => {
  console.log('[Studiio Backend]', req.method, req.url)
  next()
})

app.get('/health', (req, res) => {
  res.json({ ok: true, msg: 'Studiio Backend', routes: ['/health', '/api/health', 'POST /api/claude', 'POST /api/pdf-text'] })
})
app.get('/api/health', (req, res) => {
  res.json({ ok: true, routes: ['POST /api/claude', 'POST /api/pdf-text', 'POST /api/generate-flashcards'] })
})
app.get('/', (req, res) => {
  res.json({
    service: 'Studiio Backend',
    health: 'GET /health oder GET /api/health',
    claude: 'POST /api/claude',
    pdfText: 'POST /api/pdf-text',
  })
})

const OPENAI_COMPATIBLE_PROVIDERS = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o-mini' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: 'llama-3.1-70b-versatile' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: 'openai/gpt-4o-mini' },
  mistral: { url: 'https://api.mistral.ai/v1/chat/completions', defaultModel: 'mistral-small-latest' },
  xai: { url: 'https://api.x.ai/v1/chat/completions', defaultModel: 'grok-2-latest' },
}

const MAX_CONTEXT_FILES = 40
const MAX_CONTEXT_CHARS_TOTAL = 180000
const MAX_CONTEXT_CHARS_PER_FILE = 18000
const materialTextCache = new Map()
const materialPageContextCache = new Map()
const MATERIAL_CONTEXT_VERSION = 1
const MAX_PAGE_CHARS = 7000
const shareRateLimit = new Map()

function normalizeProvider(raw) {
  const p = String(raw || '').trim().toLowerCase()
  if (!p) return 'anthropic'
  return p
}

function normalizeAnthropicMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((m) => {
    const rawContent = m?.content
    if (typeof rawContent === 'string') return { role: m.role || 'user', content: rawContent }
    if (Array.isArray(rawContent)) {
      const text = rawContent
        .map((c) => (typeof c?.text === 'string' ? c.text : ''))
        .join('\n')
      return { role: m.role || 'user', content: text }
    }
    return { role: m.role || 'user', content: '' }
  })
}

function asAnthropicLikeFromOpenAi(data = {}) {
  return {
    id: data.id,
    model: data.model,
    content: [
      {
        type: 'text',
        text: data?.choices?.[0]?.message?.content || '',
      },
    ],
  }
}

async function callAiProvider({ provider, apiKey, payload }) {
  const selected = normalizeProvider(provider)

  if (selected === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    })
    const text = await resp.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch (_) { data = { error: text || 'Leere Antwort' } }
    return { status: resp.status, data }
  }

  const cfg = OPENAI_COMPATIBLE_PROVIDERS[selected]
  if (!cfg) {
    return {
      status: 400,
      data: {
        error: `Unbekannter KI-Anbieter: ${selected}`,
        supportedProviders: ['anthropic', ...Object.keys(OPENAI_COMPATIBLE_PROVIDERS)],
      },
    }
  }

  const compatPayload = {
    model: payload?.model || cfg.defaultModel,
    messages: [
      ...(payload?.system ? [{ role: 'system', content: payload.system }] : []),
      ...normalizeAnthropicMessages(payload?.messages),
    ],
    max_tokens: payload?.max_tokens,
    temperature: payload?.temperature,
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (selected === 'openrouter') {
    headers['HTTP-Referer'] = 'https://studiio.app'
    headers['X-Title'] = 'Studiio'
  }

  const resp = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(compatPayload),
  })
  const text = await resp.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch (_) { data = { error: text || 'Leere Antwort' } }

  if (resp.status >= 200 && resp.status < 300) {
    return { status: resp.status, data: asAnthropicLikeFromOpenAi(data) }
  }
  return { status: resp.status, data }
}

async function callAiText({ provider, apiKey, model, maxTokens, system, userContent }) {
  const payload = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userContent }],
  }
  const out = await callAiProvider({ provider, apiKey, payload })
  return {
    ...out,
    text: out?.data?.content?.[0]?.text || '',
  }
}

function generateShareCode(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

function checkShareRateLimit({ userId, action, limit, windowMs }) {
  if (!userId) return { ok: false, retryAfterSec: 60 }
  const key = `${userId}:${action}`
  const now = Date.now()
  const entry = shareRateLimit.get(key) || { count: 0, resetAt: now + windowMs }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + windowMs
  }
  if (entry.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    shareRateLimit.set(key, entry)
    return { ok: false, retryAfterSec }
  }
  entry.count += 1
  shareRateLimit.set(key, entry)
  return { ok: true, retryAfterSec: 0 }
}

async function copyMaterialToUser({ sourceMaterial, targetUserId, targetSubjectId }) {
  const oldPath = sourceMaterial.storage_path
  if (!oldPath) throw new Error('Material ohne storage_path kann nicht kopiert werden.')

  const { data: fileBlob, error: downloadErr } = await supabaseServerClient.storage
    .from('materials')
    .download(oldPath)
  if (downloadErr) throw new Error(`Material-Download fehlgeschlagen: ${downloadErr.message}`)

  const safeFilename = String(sourceMaterial.filename || 'datei.pdf').replace(/\s+/g, '_')
  const newPath = `${targetUserId}/${targetSubjectId}/${Date.now()}_${safeFilename}`

  const { error: uploadErr } = await supabaseServerClient.storage
    .from('materials')
    .upload(newPath, fileBlob, { upsert: false, cacheControl: '3600' })
  if (uploadErr) throw new Error(`Material-Upload fehlgeschlagen: ${uploadErr.message}`)

  const { data: inserted, error: insertErr } = await supabaseServerClient
    .from('materials')
    .insert({
      user_id: targetUserId,
      subject_id: targetSubjectId,
      filename: sourceMaterial.filename,
      category: sourceMaterial.category || null,
      size_bytes: sourceMaterial.size_bytes || 0,
      storage_path: newPath,
    })
    .select('id')
    .single()
  if (insertErr) throw new Error(`Material-Metadaten speichern fehlgeschlagen: ${insertErr.message}`)

  return inserted.id
}

async function extractPdfTextFromStoragePath(storagePath) {
  const { data, error } = await supabaseServerClient.storage
    .from('materials')
    .download(storagePath)

  if (error) {
    throw new Error(`Fehler beim Download der PDF aus Supabase: ${error.message}`)
  }

  const parser = new PDFParse({ data: Buffer.from(await data.arrayBuffer()) })
  try {
    const result = await parser.getText()
    return {
      text: typeof result?.text === 'string' ? result.text : '',
      numPages: result?.pages?.length ?? 0,
    }
  } finally {
    await parser.destroy?.()
  }
}

async function persistExtractedTextIfColumnsExist(materialId, text, numPages) {
  try {
    const { error } = await supabaseServerClient
      .from('materials')
      .update({
        extracted_text: text,
        extracted_num_pages: numPages,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', materialId)
    if (error) return false
    return true
  } catch (_) {
    return false
  }
}

function splitPdfTextIntoPages(fullText, numPages = 0) {
  const raw = String(fullText || '')
  const byFormFeed = raw.split('\f').map((p) => p.trim())
  if (byFormFeed.length > 1) {
    return byFormFeed
  }
  // Fallback: keine klaren Seitenumbrüche vorhanden
  const chunks = []
  const safePages = Math.max(1, Number(numPages) || 1)
  const chunkSize = Math.max(1200, Math.floor(raw.length / safePages))
  for (let i = 0; i < raw.length; i += chunkSize) {
    chunks.push(raw.slice(i, i + chunkSize).trim())
  }
  return chunks.length > 0 ? chunks : [raw]
}

function makeMaterialFingerprint({ materialId, storagePath }) {
  return `v${MATERIAL_CONTEXT_VERSION}:${materialId || ''}:${storagePath || ''}`
}

async function loadPersistedPageContexts(materialId, fingerprint) {
  try {
    const { data, error } = await supabaseServerClient
      .from('material_page_contexts')
      .select('page_number, text_excerpt, combined_summary, source_type, fingerprint')
      .eq('material_id', materialId)
      .eq('context_version', MATERIAL_CONTEXT_VERSION)
      .eq('fingerprint', fingerprint)
      .order('page_number', { ascending: true })
    if (error || !Array.isArray(data)) return []
    return data
  } catch (_) {
    return []
  }
}

async function upsertPageContextRow(row) {
  try {
    await supabaseServerClient
      .from('material_page_contexts')
      .upsert(row, { onConflict: 'material_id,page_number,context_version' })
  } catch (_) {
    // Tabelle evtl. noch nicht angelegt -> stilles Fallback auf In-Memory
  }
}

app.post('/api/claude', async (req, res) => {
  try {
    const { apiKey, provider = 'anthropic', payload } = req.body || {}

    if (!apiKey || !payload) {
      return res.status(400).json({ error: 'apiKey und payload sind erforderlich.' })
    }
    const out = await callAiProvider({ provider, apiKey, payload })
    if (out.status < 200 || out.status >= 300) {
      console.error('[Studiio Backend] AI Proxy Fehler:', provider, out.status, out.data)
      return res.status(out.status).json(out.data)
    }
    return res.status(200).json(out.data)
  } catch (err) {
    const code = err.cause?.code || err.code
    const causeMsg = err.cause?.message || err.message
    const details = code ? `${causeMsg} (${code})` : causeMsg
    console.error('[Studiio Backend] Unerwarteter Fehler:', err)
    const isNetwork = code && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH'].includes(code)
    const isFetchFailed = causeMsg === 'fetch failed' || causeMsg?.includes('fetch failed')
    const hint = isNetwork
      ? ' Prüfe Internetverbindung und ob Firewall/Proxy den KI-Endpunkt blockiert.'
      : isFetchFailed
        ? ' Mögliche Ursachen: keine Internetverbindung, Firewall/Proxy blockiert den KI-Endpunkt, oder SSL-Zertifikatsproblem.'
        : ''
    return res.status(500).json({
      error: 'Interner Proxy-Fehler',
      details: details + hint,
    })
  }
})

app.post('/api/pdf-text', async (req, res) => {
  try {
    if (!supabaseServerClient) {
      return res
        .status(500)
        .json({ error: 'Supabase Server-Client ist nicht konfiguriert (fehlende ENV Variablen).' })
    }

    const { storagePath, materialId } = req.body || {}

    if (!storagePath && !materialId) {
      return res.status(400).json({ error: 'storagePath oder materialId ist erforderlich.' })
    }

    let resolvedStoragePath = storagePath
    if (!resolvedStoragePath && materialId) {
      const { data: row, error: rowErr } = await supabaseServerClient
        .from('materials')
        .select('storage_path, extracted_text, extracted_num_pages')
        .eq('id', materialId)
        .maybeSingle()
      if (rowErr) {
        return res.status(500).json({ error: 'Material konnte nicht geladen werden.', details: rowErr.message })
      }
      if (!row?.storage_path) {
        return res.status(404).json({ error: 'Material/Storage-Pfad nicht gefunden.' })
      }
      if (typeof row.extracted_text === 'string' && row.extracted_text.length > 0) {
        return res.status(200).json({
          text: row.extracted_text,
          numPages: row.extracted_num_pages || 0,
          cached: true,
          source: 'materials.extracted_text',
        })
      }
      resolvedStoragePath = row.storage_path
    }

    if (materialId && materialTextCache.has(materialId)) {
      const hit = materialTextCache.get(materialId)
      return res.status(200).json({ text: hit.text, numPages: hit.numPages, cached: true, source: 'memory-cache' })
    }

    console.log('[pdf-text] Download aus Supabase Storage:', { bucket: 'materials', path: resolvedStoragePath })
    const { text: fullText, numPages } = await extractPdfTextFromStoragePath(resolvedStoragePath)

    if (materialId) {
      materialTextCache.set(materialId, { text: fullText, numPages })
      await persistExtractedTextIfColumnsExist(materialId, fullText, numPages)
    }

    return res.status(200).json({ text: fullText, numPages })
  } catch (err) {
    console.error('[pdf-text] Unerwarteter Fehler:', err)
    return res.status(500).json({ error: 'Interner Fehler bei der PDF-Text-Extraktion', details: err.message })
  }
})

app.post('/api/subject-context-text', async (req, res) => {
  try {
    if (!supabaseServerClient) {
      return res
        .status(500)
        .json({ error: 'Supabase Server-Client ist nicht konfiguriert (fehlende ENV Variablen).' })
    }

    const { userId, subjectId } = req.body || {}
    if (!userId || !subjectId) {
      return res.status(400).json({ error: 'userId und subjectId sind erforderlich.' })
    }

    const { data: materials, error: listErr } = await supabaseServerClient
      .from('materials')
      .select('filename, category, storage_path, created_at')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: true })
      .limit(MAX_CONTEXT_FILES)

    if (listErr) {
      return res.status(500).json({ error: 'Materialien konnten nicht geladen werden.', details: listErr.message })
    }
    if (!materials || materials.length === 0) {
      return res.status(200).json({ text: '', filesUsed: 0 })
    }

    let allText = ''
    let filesUsed = 0

    for (const m of materials) {
      if (!m?.storage_path) continue
      const { data, error } = await supabaseServerClient.storage
        .from('materials')
        .download(m.storage_path)
      if (error || !data) continue

      const parser = new PDFParse({ data: Buffer.from(await data.arrayBuffer()) })
      let extracted = ''
      try {
        const result = await parser.getText()
        extracted = typeof result?.text === 'string' ? result.text : ''
      } finally {
        await parser.destroy?.()
      }
      if (!extracted.trim()) continue

      const clipped = extracted.slice(0, MAX_CONTEXT_CHARS_PER_FILE)
      const section =
        `\n\n===== Datei: ${m.filename || 'Unbekannt'} | Kategorie: ${m.category || 'Ohne Kategorie'} =====\n` +
        clipped

      if ((allText + section).length > MAX_CONTEXT_CHARS_TOTAL) break
      allText += section
      filesUsed += 1
    }

    return res.status(200).json({ text: allText.trim(), filesUsed })
  } catch (err) {
    console.error('[subject-context-text] Unerwarteter Fehler:', err)
    return res.status(500).json({ error: 'Interner Fehler beim Laden des Fach-Kontexts', details: err.message })
  }
})

app.post('/api/index-material-text', async (req, res) => {
  try {
    if (!supabaseServerClient) {
      return res
        .status(500)
        .json({ error: 'Supabase Server-Client ist nicht konfiguriert (fehlende ENV Variablen).' })
    }
    const { materialId, storagePath } = req.body || {}
    if (!materialId || !storagePath) {
      return res.status(400).json({ error: 'materialId und storagePath sind erforderlich.' })
    }

    const { text, numPages } = await extractPdfTextFromStoragePath(storagePath)
    materialTextCache.set(materialId, { text, numPages })
    const persisted = await persistExtractedTextIfColumnsExist(materialId, text, numPages)

    return res.status(200).json({
      ok: true,
      numPages,
      textLength: text.length,
      persistedToDb: persisted,
    })
  } catch (err) {
    console.error('[index-material-text] Fehler:', err)
    return res.status(500).json({ error: 'Indexierung fehlgeschlagen.', details: err.message })
  }
})

app.post('/api/build-material-context', async (req, res) => {
  try {
    if (!supabaseServerClient) {
      return res
        .status(500)
        .json({ error: 'Supabase Server-Client ist nicht konfiguriert (fehlende ENV Variablen).' })
    }
    const { materialId, storagePath, provider = 'anthropic', apiKey } = req.body || {}
    if (!materialId || !storagePath) {
      return res.status(400).json({ error: 'materialId und storagePath sind erforderlich.' })
    }

    const fingerprint = makeMaterialFingerprint({ materialId, storagePath })
    const inMem = materialPageContextCache.get(materialId)
    if (inMem && inMem.fingerprint === fingerprint && Array.isArray(inMem.pages) && inMem.pages.length > 0) {
      return res.status(200).json({ cached: true, pages: inMem.pages, source: 'memory-cache' })
    }

    const persisted = await loadPersistedPageContexts(materialId, fingerprint)
    if (persisted.length > 0) {
      const pages = persisted.map((r) => ({
        pageNumber: r.page_number,
        textExcerpt: r.text_excerpt || '',
        combinedSummary: r.combined_summary || r.text_excerpt || '',
        sourceType: r.source_type || 'text_only',
      }))
      materialPageContextCache.set(materialId, { fingerprint, pages })
      return res.status(200).json({ cached: true, pages, source: 'supabase-cache' })
    }

    const { text: fullText, numPages } = await extractPdfTextFromStoragePath(storagePath)
    const rawPages = splitPdfTextIntoPages(fullText, numPages)
    const limitedPages = rawPages.map((t) => String(t || '').slice(0, MAX_PAGE_CHARS))
    const lectureOverview = fullText.slice(0, 16000)

    const pages = []
    for (let i = 0; i < limitedPages.length; i += 1) {
      const pageText = limitedPages[i]
      const pageNumber = i + 1
      if (!pageText.trim()) continue

      let combinedSummary = pageText
      let sourceType = 'text_only'

      if (apiKey) {
        const system =
          'Du erstellst einen präzisen Seitenkontext für Lernende. ' +
          'Wenn Text visuell wirkt (z.B. Schaubild-Labels), beschreibe die Struktur in Worten. ' +
          'Keine Erfindungen. Nur Inhalte aus gegebenem Text/Kontext.'
        const userContent =
          `Gesamtkontext der Vorlesung (gekürzt):\n${lectureOverview}\n\n` +
          `Seite ${pageNumber} (Textauszug):\n${pageText}\n\n` +
          'Erzeuge eine knappe, aber inhaltlich dichte Zusammenfassung dieser Seite (max 8 Sätze).'

        const out = await callAiText({
          provider,
          apiKey,
          model: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : undefined,
          maxTokens: 650,
          system,
          userContent,
        })
        if (out.status >= 200 && out.status < 300 && out.text?.trim()) {
          combinedSummary = out.text.trim()
          sourceType = 'text_plus_ai_summary'
        }
      }

      const row = {
        material_id: materialId,
        page_number: pageNumber,
        context_version: MATERIAL_CONTEXT_VERSION,
        fingerprint,
        source_type: sourceType,
        text_excerpt: pageText,
        combined_summary: combinedSummary,
        updated_at: new Date().toISOString(),
      }
      await upsertPageContextRow(row)

      pages.push({
        pageNumber,
        textExcerpt: pageText,
        combinedSummary,
        sourceType,
      })
    }

    materialPageContextCache.set(materialId, { fingerprint, pages })
    return res.status(200).json({ cached: false, pages, source: 'fresh-build' })
  } catch (err) {
    console.error('[build-material-context] Fehler:', err)
    return res.status(500).json({ error: 'Kontextaufbau fehlgeschlagen.', details: err.message })
  }
})

app.post('/api/generate-flashcards', async (req, res) => {
  try {
    const {
      apiKey,
      provider = 'anthropic',
      subjectName,
      materialFilename,
      pdfText,
      focusAttention,
      focusTheme,
      forceFormat,
      verbatimMode: verbatimModeInput,
    } = req.body || {}
    if (!apiKey || !pdfText) {
      return res.status(400).json({ error: 'apiKey und pdfText sind erforderlich.' })
    }
    const attention = focusAttention || ''
    const focus = focusTheme || ''
    const userPreferenceText = `${attention}\n${focus}`.toLowerCase()

    function detectForcedFormat(text) {
      const t = String(text || '').toLowerCase()
      const wantsSingle = /\bsingle\s*choice\b|\bsingle_choice\b|\bsc\b/.test(t)
      const wantsMultiple = /\bmultiple\s*choice\b|\bmultiple_choice\b|\bmcq\b|\bmc\b/.test(t)
      const wantsOpen = /\boffen(es|e|er)?\b|\bopen\b|\bfreitext\b/.test(t)
      const wantsDefinition = /\bdefinition\b|\bdefinitions\b/.test(t)
      const matches = [wantsSingle, wantsMultiple, wantsOpen, wantsDefinition].filter(Boolean).length
      if (matches !== 1) return null
      if (wantsSingle) return 'single_choice'
      if (wantsMultiple) return 'multiple_choice'
      if (wantsOpen) return 'open'
      if (wantsDefinition) return 'definition'
      return null
    }

    function detectVerbatimMode(text) {
      const t = String(text || '').toLowerCase()
      return (
        /\b1:1\b/.test(t) ||
        /\beins\s*zu\s*eins\b/.test(t) ||
        /\bidentisch\b/.test(t) ||
        /\bwortw(ö|oe)rtlich\b/.test(t) ||
        /\b(übernimm|uebernimm)\b/.test(t)
      )
    }

    const forcedFormatFromPrompt = detectForcedFormat(userPreferenceText)
    const forcedFormat = ['definition', 'open', 'multiple_choice', 'single_choice'].includes(forceFormat)
      ? forceFormat
      : forcedFormatFromPrompt
    const verbatimMode = typeof verbatimModeInput === 'boolean'
      ? verbatimModeInput
      : detectVerbatimMode(userPreferenceText)

    const formatRule = forcedFormat
      ? `- WICHTIG: Nutze ausschließlich das Format "${forcedFormat}" für alle Karten.`
      : '- Mische die Formate (nicht nur eine Sorte).'
    const verbatimRule = verbatimMode
      ? '- WICHTIG: Übernimm Fragen, Antwortoptionen und vorhandene Erklärungen 1:1 aus dem gegebenen Text. Keine Umformulierung, keine Ergänzung an vorhandenen Erklärungen. Wenn zu einer Frage keine Erklärung im Text vorhanden ist, erstelle selbst eine kurze, inhaltlich hilfreiche Erklärung.'
      : '- question und answer sind klar und auf Deutsch.'

    const system = `Du erstellst Vokabeln/Karteikarten als JSON-Array für die Lern-App Studiio.
Regeln:
- Antworte NUR mit einem gültigen JSON-Array, sonst nichts.
- Jedes Element hat: "format", "question", "answer", "general_explanation" und bei multiple_choice/single_choice zusätzlich "options" (Array von Strings).
- format ist genau einer von: definition, open, multiple_choice, single_choice.
- Alle Inhalte aus dem gegebenen Text müssen abgedeckt werden (keine Lücken).
${formatRule}
${verbatimRule}
- Pro Thema/Konzept 1–2 Karten.
- options bei MC/SC: 3–4 Optionen, answer muss exakt eine Option sein.
- general_explanation muss inhaltlich hilfreich sein (2–4 Sätze): kurz erklären, warum die Antwort fachlich stimmt und einen kleinen Lernhinweis geben.`

    const userContent = `Fach: ${subjectName || 'Unbekannt'}
Datei: ${materialFilename || 'Unbekannt'}

${attention ? `Worauf soll geachtet werden: ${attention}\n` : ''}${focus ? `Fokus: ${focus}\n` : ''}

Erstelle Karteikarten, die den gesamten folgenden Inhalt abdecken. Antworte nur mit dem JSON-Array, keine Erklärung.

--- Inhalt ---
${String(pdfText).slice(0, 80000)}

--- Ende. Gib nur das JSON-Array zurück. ---`

    const out = await callAiText({
      provider,
      apiKey,
      model: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : undefined,
      maxTokens: 8000,
      system,
      userContent,
    })
    if (out.status < 200 || out.status >= 300) {
      console.error('[Studiio Backend] generate-flashcards AI:', out.status, out.data)
      return res.status(out.status).json(out.data)
    }
    const text = out.text
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    let cards = []
    if (jsonMatch) {
      try {
        cards = JSON.parse(jsonMatch[0])
      } catch (_) {}
    }
    if (!Array.isArray(cards)) {
      return res.status(500).json({ error: 'KI konnte keine gültigen Karten erzeugen.', raw: text.slice(0, 500) })
    }
    const allowed = ['definition', 'open', 'multiple_choice', 'single_choice']
    const normalizeFormat = (raw) => {
      const v = String(raw || '').trim().toLowerCase()
      if (v === 'single_choice' || v === 'single choice' || v === 'singlechoice' || v === 'sc') return 'single_choice'
      if (v === 'multiple_choice' || v === 'multiple choice' || v === 'multiplechoice' || v === 'mcq' || v === 'mc') return 'multiple_choice'
      if (v === 'definition' || v === 'def') return 'definition'
      if (v === 'open' || v === 'open_text' || v === 'open text' || v === 'text') return 'open'
      return v
    }

    function extractExplanationFromRawCard(rawCard) {
      if (!rawCard || typeof rawCard !== 'object') return ''
      const directKeys = [
        'general_explanation',
        'explanation',
        'rationale',
        'reason',
        'begruendung',
        'begründung',
        'erklaerung',
        'erklärung',
      ]
      for (const k of directKeys) {
        const value = String(rawCard[k] || '').trim()
        if (value) return value
      }
      return ''
    }

    function normalizeCompact(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
    }

    function extractVerbatimExplanationFromSource({ question, answer, options, sourceText }) {
      const src = String(sourceText || '')
      if (!src.trim()) return ''

      const normalizedQuestion = normalizeCompact(question)
      if (!normalizedQuestion) return ''

      // 1) Frage im Originaltext lokalisieren (robust über gekürzte Signatur)
      const qSig = normalizedQuestion.slice(0, 60)
      const srcNorm = normalizeCompact(src)
      const sigIdxNorm = srcNorm.indexOf(qSig)
      if (sigIdxNorm < 0) return ''

      // Mapping Norm-Index -> Originalindex (grob, aber ausreichend für diesen Zweck)
      const tokens = String(src || '').split(/\s+/)
      let rebuild = ''
      let approxOriginalIdx = 0
      for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i]
        const next = rebuild ? `${rebuild} ${t.toLowerCase()}` : t.toLowerCase()
        if (next.length >= sigIdxNorm) {
          approxOriginalIdx = Math.max(0, src.indexOf(t))
          break
        }
        rebuild = next
      }
      const tail = src.slice(approxOriginalIdx)

      // 2) Richtige-Antwort-Label finden
      const optionList = Array.isArray(options) ? options.map((o) => String(o || '').trim()) : []
      const answerText = String(answer || '').trim()
      const answerLetter = (() => {
        const idx = optionList.findIndex((o) => o === answerText)
        if (idx < 0 || idx > 25) return ''
        return String.fromCharCode(65 + idx) // A, B, C...
      })()

      const escapedAnswerText = answerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const answerPattern = answerLetter
        ? new RegExp(`Richtige\\s*Antwort\\s*:\\s*(?:${answerLetter}|${escapedAnswerText})\\s*\\n?([\\s\\S]*)`, 'i')
        : new RegExp(`Richtige\\s*Antwort\\s*:\\s*(?:${escapedAnswerText}|[A-Z])\\s*\\n?([\\s\\S]*)`, 'i')

      const match = tail.match(answerPattern)
      if (!match) return ''

      // 3) Erklärung bis zur nächsten Frage nehmen
      const afterAnswer = String(match[1] || '').trim()
      if (!afterAnswer) return ''
      const nextQuestionIdx = afterAnswer.search(/\n\s*Frage\s+\d+\s*:/i)
      const rawExplanation = (nextQuestionIdx >= 0 ? afterAnswer.slice(0, nextQuestionIdx) : afterAnswer).trim()
      if (!rawExplanation) return ''

      // Sehr kurze/rauschige Treffer verwerfen
      if (rawExplanation.length < 20) return ''
      return rawExplanation
    }

    function extractVerbatimExplanationByQuestionBlock({ question, answer, options, sourceText }) {
      const src = String(sourceText || '')
      if (!src.trim()) return ''
      const qNorm = normalizeCompact(question)
      if (!qNorm) return ''

      const parts = src.split(/\n(?=\s*Frage\s+\d+\s*:)/i).filter(Boolean)
      const answerText = String(answer || '').trim()
      const optionList = Array.isArray(options) ? options.map((o) => String(o || '').trim()) : []
      const answerLetter = (() => {
        const idx = optionList.findIndex((o) => o === answerText)
        if (idx < 0 || idx > 25) return ''
        return String.fromCharCode(65 + idx)
      })()

      for (const part of parts) {
        const partNorm = normalizeCompact(part)
        if (!partNorm) continue
        // Frage-Match: erster relevanter Teil der Frage muss im Block vorkommen.
        const qSig = qNorm.slice(0, 80)
        if (!partNorm.includes(qSig)) continue

        const escapedAnswerText = answerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const answerPattern = answerLetter
          ? new RegExp(`Richtige\\s*Antwort\\s*:\\s*(?:${answerLetter}|${escapedAnswerText})\\s*\\n?([\\s\\S]*)`, 'i')
          : new RegExp(`Richtige\\s*Antwort\\s*:\\s*(?:${escapedAnswerText}|[A-Z])\\s*\\n?([\\s\\S]*)`, 'i')
        const match = part.match(answerPattern)
        if (!match) continue
        const explanation = String(match[1] || '').trim()
        if (explanation.length >= 20) return explanation
      }
      return ''
    }

    function buildFallbackExplanation({ format, question, answer, options }) {
      const q = String(question || '').trim()
      const a = String(answer || '').trim()
      if (format === 'multiple_choice' || format === 'single_choice') {
        return (
          `Korrekt ist "${a}". ` +
          `Entscheidend ist bei "${q}" der fachliche Ursache-Wirkung-Zusammenhang. ` +
          'Lernhinweis: Achte darauf, welche Größe sich ändert und welche im Vergleich konstant bleibt.'
        )
      }
      if (format === 'definition') {
        return (
          `Diese Karte prüft den Kernbegriff aus "${q}". ` +
          `Wichtig ist, dass du die Bedeutung von "${a}" nicht nur auswendig kennst, ` +
          'sondern auch in eigenen Worten erklären kannst.'
        )
      }
      if (format === 'open') {
        return (
          `Bei dieser offenen Frage ist "${a}" die zentrale inhaltliche Aussage. ` +
          'Für eine gute Antwort solltest du den Begriff korrekt benennen und kurz begründen, warum er hier passt.'
        )
      }
      return `Die korrekte Antwort ist "${a}", weil sie den inhaltlichen Kern der Frage trifft.`
    }

    cards = cards
      .filter((c) => c && c.question && c.answer)
      .map((c) => {
        let format = normalizeFormat(c.format)
        if (forcedFormat) format = forcedFormat
        if (!allowed.includes(format)) return null
        let answer = String(c.answer).trim()
        let explanationFromAnswerBlock = ''
        // Falls die KI Antwort + Erklärung in ein Feld schreibt, splitten wir robust:
        // erste Zeile = Antwort, Rest = allgemeine Erklärung.
        if (answer.includes('\n')) {
          const lines = answer.split(/\r?\n/).map((s) => s.trim())
          const first = lines[0] || ''
          const rest = lines.slice(1).join(' ').trim()
          if (first && rest && rest.length >= 20) {
            answer = first
            explanationFromAnswerBlock = rest
          }
        }
        let options = null
        if (format === 'multiple_choice' || format === 'single_choice') {
          const rawOptions = Array.isArray(c.options) ? c.options.map((o) => String(o).trim()).filter(Boolean) : []
          const withAnswer = rawOptions.includes(answer) ? rawOptions : [answer, ...rawOptions]
          const unique = Array.from(new Set(withAnswer)).slice(0, 4)
          options = unique.length >= 2 ? unique : fallbackMcqOptions(answer)
        }
        const parsedExplanation = extractExplanationFromRawCard(c) || explanationFromAnswerBlock
        const sourceExplanation = verbatimMode
          ? extractVerbatimExplanationFromSource({
              question: c.question,
              answer,
              options,
              sourceText: pdfText,
            })
          : ''
        const sourceExplanationByBlock = verbatimMode && !sourceExplanation
          ? extractVerbatimExplanationByQuestionBlock({
              question: c.question,
              answer,
              options,
              sourceText: pdfText,
            })
          : ''
        const finalExplanation = parsedExplanation || sourceExplanation || sourceExplanationByBlock
        return {
          format,
          question: String(c.question).trim(),
          answer,
          options,
          // In 1:1-Modus: vorhandene Erklärung strikt übernehmen;
          // nur wenn wirklich keine da ist, eine hilfreiche Erklärung ergänzen.
          general_explanation: finalExplanation || buildFallbackExplanation({
            format,
            question: c.question,
            answer,
            options,
          }),
        }
      })
      .filter(Boolean)
      .map((c, i) => ({ ...c, position: i }))

    // Robuster Fallback: falls KI-Output formal unbrauchbar war, trotzdem Karten erzeugen.
    if (cards.length === 0) {
      // Bei explizitem 1:1-Wunsch lieber transparent fehlschlagen statt künstliche Karten zu erfinden.
      if (verbatimMode) {
        return res.status(422).json({
          error: 'Es konnten keine 1:1-Karten aus dem Blatt extrahiert werden.',
          details: 'Bitte Prompt etwas präzisieren (z. B. Kapitel/Seitenbereich oder gewünschte Anzahl).',
        })
      }
      const chunks = String(pdfText)
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter((s) => s.length > 30)
        .slice(0, 6)
      cards = chunks.map((chunk, i) => ({
        format: i % 2 === 0 ? 'definition' : 'open',
        question: `Was ist die Kernaussage von Abschnitt ${i + 1}?`,
        answer: chunk.slice(0, 260),
        options: null,
        general_explanation: 'Die Kernaussage dieses Abschnitts sollte in eigenen Worten erklärt werden. Achte auf Fachbegriffe und den Zusammenhang zum Thema.',
        position: i,
      }))
      if (cards.length === 0) {
        cards = [{
          format: 'definition',
          question: `Nenne einen zentralen Punkt aus ${materialFilename || 'dieser Datei'}.`,
          answer: 'Kernaussage aus dem Inhalt zusammenfassen.',
          options: null,
          general_explanation: 'Ziel ist, den wichtigsten inhaltlichen Punkt präzise und verständlich zusammenzufassen.',
          position: 0,
        }]
      }
    }

    return res.status(200).json({ cards })
  } catch (err) {
    console.error('[Studiio Backend] generate-flashcards:', err)
    return res.status(500).json({ error: 'Fehler bei der Vokabel-Generierung', details: err.message })
  }
})

app.post('/api/evaluate-answer', async (req, res) => {
  try {
    const { apiKey, provider = 'anthropic', question, correctAnswer, userAnswer } = req.body || {}
    if (!apiKey || !question || correctAnswer == null || !userAnswer) {
      return res.status(400).json({ error: 'apiKey, question, correctAnswer und userAnswer sind erforderlich.' })
    }
    const system =
      'Du bewertest Lern-Antworten. Antworte NUR mit einem JSON-Objekt in dieser Form: ' +
      '{"correct": true oder false, "quality": "again|hard|good|easy", "feedback": "Ein kurzer Satz auf Deutsch."} Kein anderer Text.'
    const userContent =
      `Frage: ${question}\nRichtige Antwort: ${correctAnswer}\nAntwort des/der Lernenden: ${userAnswer}\n\n` +
      'Bewerte inhaltlich (auch bei anderer Formulierung). ' +
      'quality-Regeln: again = falsch oder wesentliche Lücke, hard = knapp richtig mit Unsicherheit/Lücken, ' +
      'good = klar richtig, easy = vollständig + präzise + sicher. ' +
      'Gib NUR JSON mit correct, quality, feedback zurück.'
    const out = await callAiText({
      provider,
      apiKey,
      model: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : undefined,
      maxTokens: 200,
      system,
      userContent,
    })
    if (out.status < 200 || out.status >= 300) {
      return res.status(out.status).json(out.data)
    }
    const text = (out.text || '').trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    let result = { correct: false, quality: 'again', feedback: 'Bewertung konnte nicht gelesen werden.' }
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        const qualityRaw = String(parsed.quality || '').toLowerCase()
        const quality = ['again', 'hard', 'good', 'easy'].includes(qualityRaw)
          ? qualityRaw
          : (!!parsed.correct ? 'good' : 'again')
        result = {
          correct: !!parsed.correct,
          quality,
          feedback: typeof parsed.feedback === 'string' ? parsed.feedback : result.feedback,
        }
      } catch (_) {}
    }
    return res.status(200).json(result)
  } catch (err) {
    console.error('[Studiio Backend] evaluate-answer:', err)
    return res.status(500).json({ error: 'Fehler bei der Bewertung', details: err.message })
  }
})

function fallbackMcqOptions(correctAnswer) {
  const a = String(correctAnswer || '').trim()
  return [a || 'Richtige Antwort', 'Weitere Option 1', 'Weitere Option 2', 'Weitere Option 3'].filter(Boolean)
}

app.post('/api/suggest-mcq-options', async (req, res) => {
  let correctAnswer = ''
  try {
    const body = req.body || {}
    const { apiKey, provider = 'anthropic', question, existingOptions } = body
    correctAnswer = body.correctAnswer != null ? String(body.correctAnswer) : ''
    if (!apiKey || !question || body.correctAnswer == null) {
      return res.status(400).json({ error: 'apiKey, question und correctAnswer sind erforderlich.', options: fallbackMcqOptions(correctAnswer) })
    }
    const existing = Array.isArray(existingOptions) ? existingOptions.filter((s) => typeof s === 'string' && s.trim()) : []
    const system = 'Du erzeugst Antwortmöglichkeiten für eine Multiple-Choice-Frage. Antworte NUR mit einem JSON-Objekt: {"options": ["Option1", "Option2", "Option3", "Option4"]}. Die richtige Antwort muss genau einmal vorkommen. Die anderen Optionen sollen plausibel falsch sein. Reihenfolge zufällig mischen. Alle Optionen auf Deutsch, kurz und klar.'
    let userContent = `Frage: ${question}\nRichtige Antwort: ${correctAnswer}\n\n`
    if (existing.length > 0) {
      userContent += `Bereits vorhandene Optionen (berücksichtigen):\n${existing.map((o) => `- ${o}`).join('\n')}\n\n`
    }
    userContent += `Erzeuge 4 Antwortmöglichkeiten als JSON-Array "options". Die richtige Antwort "${correctAnswer}" muss enthalten sein. Nur das JSON ausgeben.`
    const out = await callAiText({
      provider,
      apiKey,
      model: provider === 'anthropic' ? 'claude-sonnet-4-20250514' : undefined,
      maxTokens: 300,
      system,
      userContent,
    })
    if (out.status < 200 || out.status >= 300) {
      const errMsg = out?.data?.error?.message || out?.data?.error || out?.data?.message || 'Unbekannter Fehler'
      console.error('[Studiio Backend] suggest-mcq-options AI error:', out.status, errMsg)
      return res.status(200).json({ options: fallbackMcqOptions(correctAnswer) })
    }
    const text = (out.text || '').trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    let options = []
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        const arr = parsed?.options
        if (Array.isArray(arr)) options = arr.filter((s) => typeof s === 'string').map((s) => String(s).trim()).filter(Boolean)
      } catch (_) {}
    }
    if (options.length < 2) {
      options = fallbackMcqOptions(correctAnswer)
    }
    return res.status(200).json({ options })
  } catch (err) {
    console.error('[Studiio Backend] suggest-mcq-options:', err.message || err)
    return res.status(200).json({ options: fallbackMcqOptions(correctAnswer) })
  }
})

app.post('/api/subject-share/create', async (req, res) => {
  try {
    const {
      ownerUserId,
      subjectId,
      codeLabel,
      includeSubject = true,
      includeNotes = true,
      includeMaterials = true,
      includeFlashcards = true,
    } = req.body || {}

    if (!ownerUserId || !subjectId) {
      return res.status(400).json({ error: 'ownerUserId und subjectId sind erforderlich.' })
    }
    const rl = checkShareRateLimit({
      userId: ownerUserId,
      action: 'share-create',
      limit: 10,
      windowMs: 60 * 1000,
    })
    if (!rl.ok) {
      return res.status(429).json({ error: 'Zu viele Code-Erstellungen. Bitte kurz warten.', retryAfterSec: rl.retryAfterSec })
    }
    if (!includeSubject && !includeNotes && !includeMaterials && !includeFlashcards) {
      return res.status(400).json({ error: 'Mindestens ein Bereich muss ausgewählt sein.' })
    }

    const { data: subject, error: subjectErr } = await supabaseServerClient
      .from('subjects')
      .select('id')
      .eq('id', subjectId)
      .eq('user_id', ownerUserId)
      .maybeSingle()
    if (subjectErr || !subject) {
      return res.status(404).json({ error: 'Fach wurde nicht gefunden oder gehört nicht zum Nutzer.' })
    }

    let shareCode = generateShareCode(10)
    for (let i = 0; i < 4; i++) {
      const { data: existing } = await supabaseServerClient
        .from('subject_share_exports')
        .select('id')
        .eq('share_code', shareCode)
        .maybeSingle()
      if (!existing) break
      shareCode = generateShareCode(10)
    }

    const { data, error } = await supabaseServerClient
      .from('subject_share_exports')
      .insert({
        owner_user_id: ownerUserId,
        source_subject_id: subjectId,
        share_code: shareCode,
        code_label: String(codeLabel || '').trim() || null,
        include_subject: !!includeSubject,
        include_notes: !!includeNotes,
        include_materials: !!includeMaterials,
        include_flashcards: !!includeFlashcards,
        is_active: true,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id, share_code, code_label, include_subject, include_notes, include_materials, include_flashcards, created_at, expires_at')
      .single()
    if (error) return res.status(500).json({ error: 'Share-Code konnte nicht erstellt werden.', details: error.message })

    return res.status(200).json({ export: data })
  } catch (err) {
    console.error('[subject-share/create] Fehler:', err)
    return res.status(500).json({ error: 'Share-Code konnte nicht erstellt werden.', details: err.message })
  }
})

app.post('/api/subject-share/preview', async (req, res) => {
  try {
    const { code } = req.body || {}
    const normalizedCode = String(code || '').trim().toUpperCase()
    if (!normalizedCode) {
      return res.status(400).json({ error: 'code ist erforderlich.' })
    }
    const { data: exportRow, error: exportErr } = await supabaseServerClient
      .from('subject_share_exports')
      .select('*')
      .eq('share_code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle()
    if (exportErr || !exportRow) {
      return res.status(404).json({ error: 'Code nicht gefunden oder nicht mehr aktiv.' })
    }
    if (exportRow.expires_at && new Date(exportRow.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Dieser Code ist abgelaufen.' })
    }
    const { data: sourceSubject } = await supabaseServerClient
      .from('subjects')
      .select('id, name')
      .eq('id', exportRow.source_subject_id)
      .eq('user_id', exportRow.owner_user_id)
      .maybeSingle()
    if (!sourceSubject) {
      return res.status(404).json({ error: 'Quellfach nicht gefunden.' })
    }

    let materialCount = 0
    let flashcardCount = 0
    let hasNotes = false
    if (exportRow.include_materials) {
      const { count } = await supabaseServerClient
        .from('materials')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', exportRow.owner_user_id)
        .eq('subject_id', sourceSubject.id)
        .is('deleted_at', null)
      materialCount = count || 0
    }
    if (exportRow.include_flashcards) {
      const { count } = await supabaseServerClient
        .from('flashcards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', exportRow.owner_user_id)
        .eq('subject_id', sourceSubject.id)
      flashcardCount = count || 0
    }
    if (exportRow.include_notes) {
      const { data: noteRow } = await supabaseServerClient
        .from('subject_notes')
        .select('subject_id')
        .eq('user_id', exportRow.owner_user_id)
        .eq('subject_id', sourceSubject.id)
        .maybeSingle()
      hasNotes = !!noteRow
    }

    return res.status(200).json({
      preview: {
        code: exportRow.share_code,
        codeLabel: exportRow.code_label || null,
        subjectName: sourceSubject.name,
        expiresAt: exportRow.expires_at || null,
        includeSubject: !!exportRow.include_subject,
        includeNotes: !!exportRow.include_notes,
        includeMaterials: !!exportRow.include_materials,
        includeFlashcards: !!exportRow.include_flashcards,
        materialCount,
        flashcardCount,
        hasNotes,
      },
    })
  } catch (err) {
    console.error('[subject-share/preview] Fehler:', err)
    return res.status(500).json({ error: 'Code-Vorschau fehlgeschlagen.', details: err.message })
  }
})

app.post('/api/subject-share/import', async (req, res) => {
  try {
    const { importerUserId, code, mergeTargetSubjectId } = req.body || {}
    const normalizedCode = String(code || '').trim().toUpperCase()
    if (!importerUserId || !normalizedCode) {
      return res.status(400).json({ error: 'importerUserId und code sind erforderlich.' })
    }
    const rl = checkShareRateLimit({
      userId: importerUserId,
      action: 'share-import',
      limit: 20,
      windowMs: 60 * 1000,
    })
    if (!rl.ok) {
      return res.status(429).json({ error: 'Zu viele Import-Versuche. Bitte kurz warten.', retryAfterSec: rl.retryAfterSec })
    }

    const { data: exportRow, error: exportErr } = await supabaseServerClient
      .from('subject_share_exports')
      .select('*')
      .eq('share_code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle()
    if (exportErr || !exportRow) {
      return res.status(404).json({ error: 'Code nicht gefunden oder nicht mehr aktiv.' })
    }
    if (exportRow.expires_at && new Date(exportRow.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Dieser Code ist abgelaufen.' })
    }
    if (exportRow.owner_user_id === importerUserId) {
      return res.status(400).json({ error: 'Du kannst deinen eigenen Code nicht importieren.' })
    }
    const { data: existingImport } = await supabaseServerClient
      .from('subject_share_imports')
      .select('id')
      .eq('export_id', exportRow.id)
      .eq('importer_user_id', importerUserId)
      .maybeSingle()
    if (existingImport) {
      return res.status(409).json({ error: 'Diesen Code hast du bereits importiert.' })
    }

    const { data: sourceSubject, error: sourceErr } = await supabaseServerClient
      .from('subjects')
      .select('id, name, group_label, exam_date')
      .eq('id', exportRow.source_subject_id)
      .eq('user_id', exportRow.owner_user_id)
      .maybeSingle()
    if (sourceErr || !sourceSubject) {
      return res.status(404).json({ error: 'Quellfach nicht gefunden.' })
    }

    let isMergeImport = false
    let targetSubject = null
    if (mergeTargetSubjectId) {
      const { data: mergeTarget, error: mergeTargetErr } = await supabaseServerClient
        .from('subjects')
        .select('id, name, group_label, exam_date')
        .eq('id', mergeTargetSubjectId)
        .eq('user_id', importerUserId)
        .maybeSingle()
      if (mergeTargetErr || !mergeTarget) {
        return res.status(404).json({ error: 'Ziel-Fach zum Zusammenlegen wurde nicht gefunden.' })
      }
      targetSubject = mergeTarget
      isMergeImport = true
    } else {
      const subjectName = (sourceSubject.name || 'Geteiltes Fach').trim()
      const importedName = subjectName.length > 70 ? `${subjectName.slice(0, 70)} …` : `${subjectName} (geteilt)`
      const { data: newSubject, error: newSubjectErr } = await supabaseServerClient
        .from('subjects')
        .insert({
          user_id: importerUserId,
          name: importedName,
          group_label: exportRow.include_subject ? sourceSubject.group_label : null,
          exam_date: exportRow.include_subject ? sourceSubject.exam_date : null,
        })
        .select('id, name, group_label, exam_date')
        .single()
      if (newSubjectErr) {
        return res.status(500).json({ error: 'Ziel-Fach konnte nicht erstellt werden.', details: newSubjectErr.message })
      }
      targetSubject = newSubject
    }

    const materialIdMap = new Map()
    let copiedMaterials = 0
    let failedMaterials = 0
    const failedMaterialNames = []
    if (exportRow.include_materials) {
      const { data: sourceMaterials, error: listErr } = await supabaseServerClient
        .from('materials')
        .select('id, filename, category, size_bytes, storage_path')
        .eq('user_id', exportRow.owner_user_id)
        .eq('subject_id', sourceSubject.id)
        .is('deleted_at', null)
      if (listErr) {
        return res.status(500).json({ error: 'Materialien konnten nicht geladen werden.', details: listErr.message })
      }
      for (const m of sourceMaterials || []) {
        try {
          const newMaterialId = await copyMaterialToUser({
            sourceMaterial: m,
            targetUserId: importerUserId,
            targetSubjectId: targetSubject.id,
          })
          materialIdMap.set(m.id, newMaterialId)
          copiedMaterials += 1
        } catch (copyErr) {
          console.error('[subject-share/import] Material-Kopie fehlgeschlagen:', copyErr)
          failedMaterials += 1
          if (m?.filename) failedMaterialNames.push(String(m.filename))
        }
      }
    }

    if (exportRow.include_notes) {
      try {
        const { data: sourceNote } = await supabaseServerClient
          .from('subject_notes')
          .select('content')
          .eq('user_id', exportRow.owner_user_id)
          .eq('subject_id', sourceSubject.id)
          .maybeSingle()
        const incoming = String(sourceNote?.content || '').trim()
        if (incoming) {
          let nextContent = incoming
          if (isMergeImport) {
            const { data: existingNote } = await supabaseServerClient
              .from('subject_notes')
              .select('content')
              .eq('user_id', importerUserId)
              .eq('subject_id', targetSubject.id)
              .maybeSingle()
            const current = String(existingNote?.content || '').trim()
            if (current && current !== incoming) {
              nextContent = `${current}\n\n---\n\n${incoming}`
            } else if (current === incoming) {
              nextContent = current
            }
          }
          await supabaseServerClient
            .from('subject_notes')
            .upsert(
              {
                user_id: importerUserId,
                subject_id: targetSubject.id,
                content: nextContent,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id,subject_id' },
            )
        }
      } catch (noteErr) {
        console.error('[subject-share/import] Notizen kopieren fehlgeschlagen:', noteErr)
      }
    }

    let copiedFlashcards = 0
    if (exportRow.include_flashcards) {
      let startPosition = 0
      if (isMergeImport) {
        const { data: lastCard } = await supabaseServerClient
          .from('flashcards')
          .select('position')
          .eq('user_id', importerUserId)
          .eq('subject_id', targetSubject.id)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()
        startPosition = Number(lastCard?.position || 0) + 1
      }
      const { data: sourceCards, error: cardsErr } = await supabaseServerClient
        .from('flashcards')
        .select('format, question, answer, options, position, material_id, general_explanation')
        .eq('user_id', exportRow.owner_user_id)
        .eq('subject_id', sourceSubject.id)
        .order('position', { ascending: true })
      if (cardsErr) {
        return res.status(500).json({ error: 'Vokabeln konnten nicht geladen werden.', details: cardsErr.message })
      }
      const rows = (sourceCards || []).map((c) => ({
        user_id: importerUserId,
        subject_id: targetSubject.id,
        material_id:
          exportRow.include_materials && c.material_id
            ? (materialIdMap.get(c.material_id) || null)
            : null,
        format: c.format,
        question: c.question,
        answer: c.answer,
        options: c.options || null,
        position: startPosition + Number(c.position || 0),
        general_explanation: c.general_explanation || null,
      }))

      if (rows.length > 0) {
        const { error: insertCardsErr } = await supabaseServerClient
          .from('flashcards')
          .insert(rows)
        if (insertCardsErr) {
          return res.status(500).json({ error: 'Vokabeln konnten nicht kopiert werden.', details: insertCardsErr.message })
        }
      }
      copiedFlashcards = rows.length
    }

    await supabaseServerClient
      .from('subject_share_exports')
      .update({
        import_count: Number(exportRow.import_count || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', exportRow.id)

    await supabaseServerClient
      .from('subject_share_imports')
      .insert({
        export_id: exportRow.id,
        importer_user_id: importerUserId,
        new_subject_id: targetSubject.id,
      })

    return res.status(200).json({
      subject: targetSubject,
      mergedIntoExisting: isMergeImport,
      copied: {
        materials: copiedMaterials,
        failedMaterials,
        failedMaterialNames: failedMaterialNames.slice(0, 5),
        flashcards: copiedFlashcards,
        notes: !!exportRow.include_notes,
        subjectMeta: !!exportRow.include_subject && !isMergeImport,
      },
    })
  } catch (err) {
    console.error('[subject-share/import] Fehler:', err)
    return res.status(500).json({ error: 'Import fehlgeschlagen.', details: err.message })
  }
})

app.use((req, res) => {
  res.status(404).json({
    error: 'Route nicht gefunden',
    method: req.method,
    path: req.path,
    hint: 'GET /health oder GET /api/health',
  })
})

const server = app.listen(port, () => {
  console.log('')
  console.log(`Studiio Backend läuft auf http://localhost:${port}`)
  console.log(`Health-Check: http://localhost:${port}/health`)
  console.log('Dieses Fenster offen lassen – sonst stoppt der Server.')
  console.log('')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} ist schon belegt. Stoppe den anderen Prozess oder setze z.B. PORT=8789 npm run api`)
  } else {
    console.error('Server-Fehler:', err)
  }
  process.exit(1)
})
