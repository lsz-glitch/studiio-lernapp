import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 8787

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
}))
app.use(express.json())

app.post('/api/claude', async (req, res) => {
  try {
    const { apiKey, payload } = req.body || {}

    if (!apiKey || !payload) {
      return res.status(400).json({ error: 'apiKey und payload sind erforderlich.' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('[claudeProxy] Fehler von Anthropic:', data)
      return res.status(response.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    console.error('[claudeProxy] Unerwarteter Fehler:', err)
    return res.status(500).json({ error: 'Interner Proxy-Fehler', details: err.message })
  }
})

app.listen(port, () => {
  console.log(`Claude Proxy Server läuft auf http://localhost:${port}`)
})

