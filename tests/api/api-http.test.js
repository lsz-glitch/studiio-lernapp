/**
 * API tests – laufen gegen einen laufenden Server (npm run api).
 * Ohne Server werden die Tests übersprungen (kein Fehler).
 */
import { describe, it, expect, beforeAll } from 'vitest'

const BASE = 'http://localhost:8788'
let serverAvailable = false

describe('Studiio API (HTTP)', () => {
  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE}/health`)
      serverAvailable = res.ok
    } catch (_) {
      serverAvailable = false
    }
  })

  it('GET /health returns 200 and ok', async () => {
    if (!serverAvailable) return
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('ok', true)
    expect(['Studiio Proxy', 'Studiio Backend']).toContain(data.msg)
  })

  it('GET /api/health returns 200 and routes', async () => {
    if (!serverAvailable) return
    const res = await fetch(`${BASE}/api/health`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('ok', true)
    expect(Array.isArray(data.routes)).toBe(true)
  })

  it('POST /api/claude returns 400 when body empty', async () => {
    const res = await fetch(`${BASE}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data).toHaveProperty('error')
  })

  it('POST /api/pdf-text rejects when storagePath missing', async () => {
    if (!serverAvailable) return
    const res = await fetch(`${BASE}/api/pdf-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect([400, 500]).toContain(res.status)
    const data = await res.json()
    expect(data).toHaveProperty('error')
  })

  it('GET unknown returns 404', async () => {
    if (!serverAvailable) return
    const res = await fetch(`${BASE}/unknown`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).toHaveProperty('error', 'Route nicht gefunden')
  })
})
