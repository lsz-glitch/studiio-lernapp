import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import https from 'https'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'

// Beim Start prüfen: diese Datei läuft
const __filename = new URL(import.meta.url).pathname
console.log('[claudeProxy] Gestartet:', __filename)

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')

dotenv.config({ path: new URL('./.env', import.meta.url).pathname })

const app = express()
const port = process.env.PORT || 8788

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    '[claudeProxy] SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlen. /api/pdf-text wird nicht funktionieren.',
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

// Jede Anfrage in der Konsole anzeigen (damit du siehst, ob der Server sie erreicht)
app.use((req, res, next) => {
  console.log('[claudeProxy]', req.method, req.url)
  next()
})

// Health sofort als erste Routen (vor allem anderen)
app.get('/health', (req, res) => {
  res.json({ ok: true, msg: 'Studiio Proxy', routes: ['/health', '/api/health', 'POST /api/claude', 'POST /api/pdf-text'] })
})
app.get('/api/health', (req, res) => {
  res.json({ ok: true, routes: ['POST /api/claude', 'POST /api/pdf-text'] })
})
app.get('/', (req, res) => {
  res.json({
    service: 'Studiio Claude Proxy',
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
      console.error('[claudeProxy] Fehler von Anthropic:', rawBody.status, data)
      return res.status(rawBody.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    const code = err.cause?.code || err.code
    const causeMsg = err.cause?.message || err.message
    const details = code ? `${causeMsg} (${code})` : causeMsg
    console.error('[claudeProxy] Unerwarteter Fehler:', err)
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

    console.log('[pdf-text] Download aus Supabase Storage:', {
      bucket: 'materials',
      path: storagePath,
    })

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

    return res.status(200).json({
      text: fullText,
      numPages,
    })
  } catch (err) {
    console.error('[pdf-text] Unerwarteter Fehler:', err)
    return res.status(500).json({ error: 'Interner Fehler bei der PDF-Text-Extraktion', details: err.message })
  }
})

// 404 am Ende: zeigt an, welche URL angefragt wurde (zum Debuggen)
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
  console.log(`Claude Proxy Server läuft auf http://localhost:${port}`)
  console.log(`Zum Testen: Diese Adresse im BROWSER (Chrome/Safari/Firefox) öffnen, nicht im Terminal eingeben:`)
  console.log(`  → http://localhost:${port}/health`)
  console.log('')
  console.log('Dieses Fenster offen lassen – sonst stoppt der Server.')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} ist schon belegt. Stoppe den anderen Prozess oder setze z.B. PORT=8789 npm run api`)
  } else {
    console.error('Server-Fehler:', err)
  }
  process.exit(1)
})

