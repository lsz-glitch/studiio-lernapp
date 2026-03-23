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
    } = req.body || {}
    if (!apiKey || !pdfText) {
      return res.status(400).json({ error: 'apiKey und pdfText sind erforderlich.' })
    }
    const attention = focusAttention || ''
    const focus = focusTheme || ''

    const system = `Du erstellst Vokabeln/Karteikarten als JSON-Array für die Lern-App Studiio.
Regeln:
- Antworte NUR mit einem gültigen JSON-Array, sonst nichts.
- Jedes Element hat: "format", "question", "answer", und bei multiple_choice/single_choice zusätzlich "options" (Array von Strings).
- format ist genau einer von: definition, open, multiple_choice, single_choice.
- Alle Inhalte aus dem gegebenen Text müssen abgedeckt werden (keine Lücken).
- Mische die Formate (nicht nur eine Sorte). Pro Thema/Konzept 1–2 Karten.
- question und answer sind klar und auf Deutsch. options bei MC/SC: 3–4 Optionen, answer muss exakt eine Option sein.`

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
    cards = cards
      .filter((c) => c && allowed.includes(c.format) && c.question && c.answer)
      .map((c, i) => ({
        format: c.format,
        question: String(c.question).trim(),
        answer: String(c.answer).trim(),
        options: Array.isArray(c.options) ? c.options.map((o) => String(o).trim()) : (c.format === 'multiple_choice' || c.format === 'single_choice' ? [c.answer] : null),
        position: i,
      }))

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
    const system = 'Du bewertest Lern-Antworten. Antworte NUR mit einem JSON-Objekt in dieser Form: {"correct": true oder false, "feedback": "Ein kurzer Satz auf Deutsch."} Kein anderer Text.'
    const userContent = `Frage: ${question}\nRichtige Antwort: ${correctAnswer}\nAntwort des/der Lernenden: ${userAnswer}\n\nIst die Antwort inhaltlich richtig (auch wenn anders formuliert)? JSON mit "correct" und "feedback".`
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
    let result = { correct: false, feedback: 'Bewertung konnte nicht gelesen werden.' }
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        result = {
          correct: !!parsed.correct,
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
