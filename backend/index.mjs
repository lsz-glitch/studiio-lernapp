/**
 * Studiio Backend — Claude-Proxy & API
 * Läuft getrennt vom Vite-Frontend (npm run api).
 * Lade Umgebungsvariablen aus backend/.env
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import https from 'https'
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

app.post('/api/claude', async (req, res) => {
  try {
    const { apiKey, payload } = req.body || {}

    if (!apiKey || !payload) {
      return res.status(400).json({ error: 'apiKey und payload sind erforderlich.' })
    }

    const body = JSON.stringify(payload)
    const rawBody = await new Promise((resolve, reject) => {
      const req = https.request(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body, 'utf8'),
          },
        },
        (resp) => {
          const chunks = []
          resp.on('data', (chunk) => chunks.push(chunk))
          resp.on('end', () => resolve({ status: resp.statusCode, data: Buffer.concat(chunks).toString('utf8') }))
          resp.on('error', reject)
        },
      )
      req.on('error', reject)
      req.write(body, 'utf8')
      req.end()
    })

    let data
    try {
      data = rawBody.data ? JSON.parse(rawBody.data) : {}
    } catch (_) {
      data = { error: rawBody.data || 'Leere Antwort von Anthropic' }
    }

    if (rawBody.status < 200 || rawBody.status >= 300) {
      console.error('[Studiio Backend] Anthropic Fehler:', rawBody.status, data)
      return res.status(rawBody.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    const code = err.cause?.code || err.code
    const causeMsg = err.cause?.message || err.message
    const details = code ? `${causeMsg} (${code})` : causeMsg
    console.error('[Studiio Backend] Unerwarteter Fehler:', err)
    const isNetwork = code && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH'].includes(code)
    const isFetchFailed = causeMsg === 'fetch failed' || causeMsg?.includes('fetch failed')
    const hint = isNetwork
      ? ' Prüfe deine Internetverbindung und ob eine Firewall/Proxy Anfragen zu api.anthropic.com blockiert.'
      : isFetchFailed
        ? ' Mögliche Ursachen: keine Internetverbindung, Firewall/Proxy blockiert api.anthropic.com, oder SSL-Zertifikatsproblem.'
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

    const { storagePath } = req.body || {}

    if (!storagePath) {
      return res.status(400).json({ error: 'storagePath ist erforderlich.' })
    }

    console.log('[pdf-text] Download aus Supabase Storage:', { bucket: 'materials', path: storagePath })

    const { data, error } = await supabaseServerClient.storage
      .from('materials')
      .download(storagePath)

    if (error) {
      console.error('[pdf-text] Fehler beim Download der PDF:', error)
      return res.status(500).json({ error: 'Fehler beim Download der PDF aus Supabase', details: error.message })
    }

    const arrayBuffer = await data.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    console.log('[pdf-text] Starte PDF-Parsing …')
    const parser = new PDFParse({ data: buffer })
    let fullText = ''
    let numPages = 0
    try {
      const result = await parser.getText()
      fullText = typeof result?.text === 'string' ? result.text : ''
      numPages = result?.pages?.length ?? 0
    } finally {
      await parser.destroy?.()
    }

    return res.status(200).json({ text: fullText, numPages })
  } catch (err) {
    console.error('[pdf-text] Unerwarteter Fehler:', err)
    return res.status(500).json({ error: 'Interner Fehler bei der PDF-Text-Extraktion', details: err.message })
  }
})

app.post('/api/generate-flashcards', async (req, res) => {
  try {
    const { apiKey, subjectName, materialFilename, pdfText, focusAttention, focusTheme } = req.body || {}
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

    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: userContent }],
    }

    const body = JSON.stringify(payload)
    const rawBody = await new Promise((resolve, reject) => {
      const req = https.request(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body, 'utf8'),
          },
        },
        (resp) => {
          const chunks = []
          resp.on('data', (chunk) => chunks.push(chunk))
          resp.on('end', () => resolve({ status: resp.statusCode, data: Buffer.concat(chunks).toString('utf8') }))
          resp.on('error', reject)
        },
      )
      req.on('error', reject)
      req.write(body, 'utf8')
      req.end()
    })

    let data
    try {
      data = rawBody.data ? JSON.parse(rawBody.data) : {}
    } catch (_) {
      data = {}
    }
    if (rawBody.status < 200 || rawBody.status >= 300) {
      console.error('[Studiio Backend] generate-flashcards Anthropic:', rawBody.status, data)
      return res.status(rawBody.status).json(data)
    }

    const text = data?.content?.[0]?.text || ''
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
    const { apiKey, question, correctAnswer, userAnswer } = req.body || {}
    if (!apiKey || !question || correctAnswer == null || !userAnswer) {
      return res.status(400).json({ error: 'apiKey, question, correctAnswer und userAnswer sind erforderlich.' })
    }
    const system = 'Du bewertest Lern-Antworten. Antworte NUR mit einem JSON-Objekt in dieser Form: {"correct": true oder false, "feedback": "Ein kurzer Satz auf Deutsch."} Kein anderer Text.'
    const userContent = `Frage: ${question}\nRichtige Antwort: ${correctAnswer}\nAntwort des/der Lernenden: ${userAnswer}\n\nIst die Antwort inhaltlich richtig (auch wenn anders formuliert)? JSON mit "correct" und "feedback".`
    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: userContent }],
    }
    const body = JSON.stringify(payload)
    const rawBody = await new Promise((resolve, reject) => {
      const req = https.request(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body, 'utf8'),
          },
        },
        (resp) => {
          const chunks = []
          resp.on('data', (chunk) => chunks.push(chunk))
          resp.on('end', () => resolve({ status: resp.statusCode, data: Buffer.concat(chunks).toString('utf8') }))
          resp.on('error', reject)
        },
      )
      req.on('error', reject)
      req.write(body, 'utf8')
      req.end()
    })
    let data
    try {
      data = rawBody.data ? JSON.parse(rawBody.data) : {}
    } catch (_) {
      data = {}
    }
    if (rawBody.status < 200 || rawBody.status >= 300) {
      return res.status(rawBody.status).json(data)
    }
    const text = (data?.content?.[0]?.text || '').trim()
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
    const { apiKey, question, existingOptions } = body
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
    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: userContent }],
    }
    const bodyStr = JSON.stringify(payload)
    const rawBody = await new Promise((resolve, reject) => {
      const clientReq = https.request(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
          },
        },
        (resp) => {
          const chunks = []
          resp.on('data', (chunk) => chunks.push(chunk))
          resp.on('end', () => resolve({ status: resp.statusCode, data: Buffer.concat(chunks).toString('utf8') }))
          resp.on('error', reject)
        },
      )
      clientReq.on('error', (e) => {
        console.error('[Studiio Backend] suggest-mcq-options request error:', e.message)
        reject(e)
      })
      clientReq.write(bodyStr, 'utf8')
      clientReq.end()
    })
    let data = {}
    try {
      data = rawBody.data ? JSON.parse(rawBody.data) : {}
    } catch (_) {}
    if (rawBody.status < 200 || rawBody.status >= 300) {
      const errMsg = data?.error?.message || data?.error || (typeof data?.message === 'string' ? data.message : null)
      console.error('[Studiio Backend] suggest-mcq-options Claude error:', rawBody.status, errMsg || rawBody.data)
      return res.status(200).json({ options: fallbackMcqOptions(correctAnswer) })
    }
    const firstBlock = data?.content?.[0]
    const text = (typeof firstBlock?.text === 'string' ? firstBlock.text : '') || String(rawBody.data || '').trim()
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
