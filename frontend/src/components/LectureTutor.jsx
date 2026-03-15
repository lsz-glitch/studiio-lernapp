import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabaseClient'
import ReactMarkdown from 'react-markdown'
import { recordStreakActivity } from '../utils/streak'
import { addLearningTime } from '../utils/learningTime'
import { completeTutorTasksForMaterial } from '../utils/learningPlan'
import { getApiBase } from '../config'

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

class LectureTutorErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Fehler im LectureTutor:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">
            Es ist ein Fehler im KI-Tutor aufgetreten.
          </p>
          <p className="text-xs text-red-700">
            {this.state.error?.message || 'Bitte gehe zurück zum Fach und versuche es erneut.'}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

const MAX_PDF_CHARS = 35000
const PDF_TEXT_RETRIES = 3
const PDF_TEXT_RETRY_DELAY_MS = 1500

const isExerciseCategory = (cat) => cat === 'Übung' || cat === 'Tutorium'

function LectureTutorInner({ user, subject, material, onBack }) {
  const isExerciseMode = isExerciseCategory(material?.category)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfError, setPdfError] = useState(null)
  const [pdfExtractedText, setPdfExtractedText] = useState(null)
  const [pdfTextLoading, setPdfTextLoading] = useState(false)
  const [pdfTextError, setPdfTextError] = useState(null)
  const [pdfTextRetryKey, setPdfTextRetryKey] = useState(0)
  const [pdfNumPages, setPdfNumPages] = useState(0)
  const [topicIndex, setTopicIndex] = useState(1)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [currentTaskText, setCurrentTaskText] = useState(null)
  const [materialIndex, setMaterialIndex] = useState(1)
  const [totalMaterials, setTotalMaterials] = useState(0)
  const [pdfZoom, setPdfZoom] = useState(1)
  const sessionStartRef = useRef(Date.now())
  const savedSecondsRef = useRef(0)
  const pdfBlobRef = useRef(null)

  // Lernzeit alle 60 Sekunden zwischenspeichern (wird nie zurückgesetzt)
  useEffect(() => {
    if (!user?.id || !subject?.id) return
    const interval = setInterval(async () => {
      savedSecondsRef.current += 60
      await addLearningTime(user.id, subject.id, 60)
    }, 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.id, subject?.id])

  // Materialliste laden, um Fortschritt „Datei X von Y“ zu berechnen
  useEffect(() => {
    if (!subject?.id || !material?.id) return
    let mounted = true
    supabase
      .from('materials')
      .select('id')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!mounted || !data) return
        const ids = data.map((r) => r.id)
        setTotalMaterials(ids.length)
        const idx = ids.indexOf(material.id)
        setMaterialIndex(idx >= 0 ? idx + 1 : 1)
      })
    return () => { mounted = false }
  }, [subject?.id, material?.id, user?.id])

  useEffect(() => {
    let objectUrl
    async function loadUrl() {
      console.log('[LectureTutor] download wird aufgerufen:', {
        bucket: 'materials',
        path: material.storage_path,
      })

      const { data, error } = await supabase.storage
        .from('materials')
        .download(material.storage_path)

      if (error) {
        console.error('[LectureTutor] Fehler beim Download der PDF:', error)
        setPdfError(
          'Die PDF konnte nicht geladen werden. Details siehe Konsole (Storage-Fehler beim Download).',
        )
        return
      }

      try {
        console.log('[LectureTutor] download Ergebnis:', {
          type: data?.type,
          size: data?.size,
        })

        if (!(data instanceof Blob)) {
          console.error('[LectureTutor] download hat keinen Blob zurückgegeben:', data)
          setPdfError(
            'Die PDF-Daten sind ungültig (kein Blob). Prüfe den Storage-Bucket-Namen und die Policies.',
          )
          return
        }

        if (data.type && data.type !== 'application/pdf') {
          console.error('[LectureTutor] Unerwarteter MIME-Typ:', data.type)
          setPdfError(
            `Erwartet: application/pdf, erhalten: ${data.type}.`,
          )
          return
        }

        pdfBlobRef.current = data
        objectUrl = URL.createObjectURL(data)
        setPdfUrl(objectUrl)
        setPdfError(null)
      } catch (e) {
        console.error('[LectureTutor] Fehler beim Erzeugen der Blob-URL:', e)
        setPdfError('Die PDF-URL konnte nicht erzeugt werden (Blob-URL Fehler).')
      }
    }

    loadUrl()

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      pdfBlobRef.current = null
    }
  }, [material.storage_path])

  // PDF-URL inkl. Seitennummer (viele Viewer springen mit #page=N zur richtigen Seite)
  const pdfUrlWithPage = pdfUrl
    ? `${pdfUrl}#page=${Math.max(1, Math.min(topicIndex, pdfNumPages || topicIndex))}`
    : null

  // PDF-Text vom Backend extrahieren (mit Retries), damit der Tutor die Vorlesung immer lesen kann
  useEffect(() => {
    if (!material?.storage_path) return

    const endpoint = `${getApiBase()}/api/pdf-text`
    let cancelled = false
    setPdfTextLoading(true)
    setPdfExtractedText(null)
    setPdfTextError(null)

    async function fetchWithRetry(attempt) {
      if (cancelled) return
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: material.storage_path }),
        })
        const text = await res.text()
        if (cancelled) return
        if (!res.ok) {
          const msg = text?.slice(0, 200) || res.statusText
          if (attempt < PDF_TEXT_RETRIES) {
            await new Promise((r) => setTimeout(r, PDF_TEXT_RETRY_DELAY_MS))
            return fetchWithRetry(attempt + 1)
          }
          setPdfTextError(`Server: ${res.status} – ${msg}`)
          return
        }
        const data = JSON.parse(text || '{}')
        if (data.error) {
          if (attempt < PDF_TEXT_RETRIES) {
            await new Promise((r) => setTimeout(r, PDF_TEXT_RETRY_DELAY_MS))
            return fetchWithRetry(attempt + 1)
          }
          setPdfTextError(data.details || data.error || 'Unbekannter Fehler')
          return
        }
        const content = typeof data.text === 'string' ? data.text : ''
        setPdfExtractedText(content)
        setPdfTextError(null)
      } catch (err) {
        if (cancelled) return
        if (attempt < PDF_TEXT_RETRIES) {
          await new Promise((r) => setTimeout(r, PDF_TEXT_RETRY_DELAY_MS))
          return fetchWithRetry(attempt + 1)
        }
        setPdfTextError(err?.message || 'Verbindung zum API-Server fehlgeschlagen. Bitte „npm run api“ prüfen.')
      } finally {
        if (!cancelled) setPdfTextLoading(false)
      }
    }

    fetchWithRetry(0)
    return () => {
      cancelled = true
    }
  }, [material.storage_path, pdfTextRetryKey])

  // Fortschritt aus localStorage laden
  useEffect(() => {
    try {
      const key = `studiio_tutor_progress_${material.id}`
      const raw = localStorage.getItem(key)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (typeof saved.topicIndex === 'number') {
        setTopicIndex(saved.topicIndex)
      }
      if (Array.isArray(saved.messages)) {
        setMessages(saved.messages)
      }
      if (typeof saved.numPages === 'number' && saved.numPages > 0) {
        setPdfNumPages(saved.numPages)
      }
    } catch (e) {
      console.error('Fehler beim Laden des Tutor-Fortschritts:', e)
    }
  }, [material.id])

  // Fortschritt speichern (Thema, Nachrichten, Seitenanzahl)
  useEffect(() => {
    try {
      const key = `studiio_tutor_progress_${material.id}`
      const toSave = {
        topicIndex,
        messages,
        numPages: pdfNumPages,
      }
      localStorage.setItem(key, JSON.stringify(toSave))
    } catch (e) {
      console.error('Fehler beim Speichern des Tutor-Fortschritts:', e)
    }
  }, [material.id, topicIndex, messages, pdfNumPages])

  async function fetchClaudeApiKey() {
    const { data, error } = await supabase
      .from('profiles')
      .select('claude_api_key_encrypted')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      console.error('Fehler beim Laden des Claude API Keys:', error)
      throw new Error('Claude API Key konnte nicht geladen werden.')
    }
    if (!data || !data.claude_api_key_encrypted) {
      throw new Error('Kein Claude API Key hinterlegt. Bitte in den Einstellungen eintragen.')
    }
    return data.claude_api_key_encrypted
  }

  async function callClaude(systemPrompt, userPrompt) {
    const apiKey = await fetchClaudeApiKey()
    const pdfSnippet = pdfExtractedText
      ? (pdfExtractedText.length > MAX_PDF_CHARS ? pdfExtractedText.slice(0, MAX_PDF_CHARS) + '\n[... gekürzt]' : pdfExtractedText)
      : '(PDF-Text nicht verfügbar.)'
    const payload = {
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt + '\n\n--- PDF-Inhalt ---\n' + pdfSnippet }] }],
    }
    const response = await fetch(`${getApiBase()}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, payload }),
    })
    const responseText = await response.text()
    if (!response.ok) {
      let msg = 'KI-Anfrage fehlgeschlagen.'
      try {
        const err = JSON.parse(responseText)
        if (err?.error?.message) msg = err.error.message
        else if (typeof err?.error === 'string') msg = err.error
      } catch (_) {}
      throw new Error(msg)
    }
    const data = JSON.parse(responseText)
    return data?.content?.[0]?.text || ''
  }

  async function fetchExerciseTask(taskNum) {
    setLoading(true)
    try {
      const system =
        'Du bekommst den Inhalt eines Übungsblatts oder Tutoriums (PDF-Text). ' +
        'Deine Aufgabe: Nimm die genannte Aufgabe (Frage/Aufgabentext) aus dem PDF und stelle sie 1:1 so, wie sie im PDF steht. ' +
        'Übernimm den Text wörtlich – keine Umformulierung, keine Zusammenfassung, keine Erklärung, keine Lösung. ' +
        'Antworte NUR mit dem exakten Aufgabentext aus der PDF (die Frage/die Aufgabe so, wie sie der/die Studierende dort liest). ' +
        'Wenn es mehrere Aufgaben gibt, nimm die n-te (n = angegebene Nummer). Kein „Aufgabe 1:“ oder ähnliches davor – nur den Aufgabentext aus der PDF.'
      const user =
        `Fach: ${subject.name}. Datei: ${material.filename}.\n` +
        `Stelle die Aufgabe Nummer ${taskNum} aus dem PDF – übernimm sie wörtlich aus dem PDF-Text.`
      const text = await callClaude(system, user)
      const taskText = (text || 'Keine Aufgabe gefunden.').trim()
      setCurrentTaskText(taskText)
      setMessages((prev) => [...prev, { role: 'assistant', content: `**Aufgabe ${taskNum}**\n\n${taskText}` }])
      recordStreakActivity(user?.id)
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: err?.message || 'Aufgabe konnte nicht geladen werden.' }])
    } finally {
      setLoading(false)
    }
  }

  async function sendExerciseEvaluate(taskText, userAnswer) {
    setLoading(true)
    try {
      const apiKey = await fetchClaudeApiKey()
      const system =
        'Du bist ein deutschsprachiger Tutor für Übungen. Du bekommst eine Aufgabenstellung und die Antwort/Lösung des/der Studierenden. ' +
        'Bewerte die Antwort (richtig / teilweise richtig / falsch). Gib klares, freundliches Feedback. Erkläre bei Bedarf die Musterlösung oder was gefehlt hat. ' +
        'Antworte auf Deutsch, in kurzen Absätzen. Stelle danach keine neue Aufgabe.'
      const userPrompt =
        `Aufgabe:\n${taskText}\n\n` +
        `Antwort des/der Studierenden:\n${userAnswer}\n\n` +
        'Bewerte die Antwort und gib Feedback bzw. Erklärung.'
      const payload = {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }
      const response = await fetch(`${getApiBase()}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, payload }),
      })
      const responseText = await response.text()
      if (!response.ok) throw new Error('Bewertung fehlgeschlagen.')
      const data = JSON.parse(responseText)
      const feedback = data?.content?.[0]?.text || 'Kein Feedback erhalten.'
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userAnswer },
        { role: 'assistant', content: feedback },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userAnswer },
        { role: 'assistant', content: err?.message || 'Bewertung konnte nicht geladen werden.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function sendToClaude({ userMessage, mode }) {
    if (mode === 'explain' && (!pdfExtractedText || pdfExtractedText.length === 0)) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Der PDF-Inhalt wurde noch nicht geladen. Bitte warte kurz oder klicke auf „PDF-Text erneut laden“. Der Tutor braucht den Text, um die Vorlesung zu erklären.',
        },
      ])
      return
    }
    setLoading(true)
    try {
      const apiKey = await fetchClaudeApiKey()

      const payload = {
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system:
          'Du bist ein deutschsprachiger Lern-Tutor. Du arbeitest eine Vorlesung Folie für Folie durch.\n\n' +
          'Folien/Seiten:\n' +
          '- Erkläre grundsätzlich jede Folie (jede Seite) einzeln. Nur wenn zwei Folien thematisch zusammengehören (z.B. eine Tabelle über zwei Seiten, ein zusammenhängender Beweis), erkläre sie gemeinsam – sonst immer eine Folie pro Schritt.\n\n' +
          'Wichtige Regeln:\n' +
          '- Pro Thema/Folie stellst du genau EINE Verständnisfrage. Keine zweite Verständnisfrage zu demselben Thema.\n' +
          '- Der/die Studierende kann jederzeit Rückfragen zum aktuellen Thema stellen. Beantworte Rückfragen klar und kurz; stelle dabei keine weitere Verständnisfrage.\n' +
          '- Wenn der/die Studierende auf die Verständnisfrage antwortet: Bewerte die Antwort (richtig/fehlt/Missverständnisse), gib eine kurze Idealantwort. Danach ist das Thema für dich abgeschlossen – wechsle nicht von selbst zum nächsten Thema.\n' +
          '- Ein neues Thema beginnst du nur, wenn der Nutzer explizit zum nächsten Thema wechselt (z.B. per Button „Nächstes Thema“). Bis dahin bleibst du beim aktuellen Thema und beantwortest nur noch Rückfragen.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `Fach: ${subject.name}\n` +
                  `Kategorie: ${subject.group_label || 'ohne Kategorie'}\n` +
                  `Datei: ${material.filename}\n` +
                  `Thema-Index: ${topicIndex}\n\n` +
                  (mode === 'explain'
                    ? 'Erkläre die nächste Folie (bzw. das nächste thematische Stück) aus der Vorlesungs-PDF: grundsätzlich immer eine Folie/Seite, nur bei klarem thematischen Zusammenhang (z.B. Tabelle über zwei Seiten) zwei Folien gemeinsam. Erkläre verständlich, mit Beispielen und Umformulierungen. Stelle danach genau EINE offene Verständnisfrage zu diesem Thema. Der Nutzer kann darauf antworten oder Rückfragen stellen; wechsle erst zum nächsten Thema, wenn er es per Button wünscht.'
                    : 'Der Nutzer antwortet oder stellt eine Rückfrage zum aktuellen Thema.\n\n' +
                      'Wenn es eine Antwort auf deine Verständnisfrage ist: Bewerte sie (richtig/fehlt/Missverständnisse), gib eine kurze Idealantwort. Stelle danach keine weitere Verständnisfrage zu diesem Thema.\n\n' +
                      'Wenn es eine Rückfrage ist: Beantworte sie zum aktuellen Thema. Keine neue Verständnisfrage.\n\n' +
                      `Nachricht des Nutzers:\n${userMessage || '(keine zusätzliche Nachricht)'}`) +
                  '\n\n--- Inhalt der Vorlesung (extrahierter PDF-Text) ---\n' +
                  (pdfExtractedText
                    ? (pdfExtractedText.length > MAX_PDF_CHARS
                        ? pdfExtractedText.slice(0, MAX_PDF_CHARS) + '\n[... gekürzt]'
                        : pdfExtractedText)
                    : pdfTextLoading
                      ? '(PDF-Text wird geladen …)'
                      : '(PDF-Text konnte nicht geladen werden oder ist leer.)'),
              },
            ],
          },
        ],
      }

      const response = await fetch(`${getApiBase()}/api/claude`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey, payload }),
      })

      const responseText = await response.text()

      if (!response.ok) {
        let message = 'Die KI-Antwort ist fehlgeschlagen. Bitte später erneut versuchen.'
        try {
          const errData = JSON.parse(responseText)
          const errObj = typeof errData.error === 'object' ? errData.error : null
          if (errObj?.message) {
            message = errObj.message
          } else if (typeof errData.error === 'string') {
            message = errData.error
          } else if (errData.message) {
            message = errData.message
          }
          if (errData.details) message += ` — ${errData.details}`
        } catch (_) {
          if (responseText) message = responseText.slice(0, 300)
        }
        console.error('[LectureTutor] Claude-API Fehler:', response.status, responseText)
        throw new Error(message)
      }

      const data = JSON.parse(responseText)
      const text = data?.content?.[0]?.text || 'Keine Antwort vom Tutor erhalten.'

      setMessages((prev) => [
        ...prev,
        ...(mode === 'answer' && userMessage
          ? [{ role: 'user', content: userMessage }]
          : []),
        { role: 'assistant', content: text },
      ])
    } catch (err) {
      console.error('[LectureTutor] sendToClaude Fehler:', err)
      const isNetworkError =
        err.name === 'TypeError' &&
        (err.message === 'Failed to fetch' || err.message?.includes('NetworkError'))
      const displayMessage = isNetworkError
        ? "Der KI-Server ist nicht erreichbar. Bitte starte ihn mit 'npm run api' in einem separaten Terminal."
        : (err.message ||
            'Es ist ein Fehler bei der Anfrage an die KI aufgetreten. Bitte prüfe deinen Claude API Key in den Einstellungen.')
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: displayMessage,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleAskForSlide() {
    setTopicIndex((idx) => idx + 1)
    sendToClaude({ userMessage: '', mode: 'explain' })
  }

  function handleSubmitChat(e) {
    e.preventDefault()
    if (!input.trim()) return
    const text = input.trim()
    setInput('')
    if (isExerciseMode) {
      if (currentTaskText) sendExerciseEvaluate(currentTaskText, text)
      else setMessages((prev) => [...prev, { role: 'user', content: text }])
    } else {
      sendToClaude({ userMessage: text, mode: 'answer' })
    }
  }

  function handleNextExercise() {
    setTopicIndex((idx) => idx + 1)
    setCurrentTaskText(null)
    fetchExerciseTask(topicIndex + 1)
  }

  function handleSkip(type) {
    const label = type === 'known' ? 'Kann ich bereits' : 'Nicht relevant'
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: `${label} – bitte nächste Folie.`,
      },
    ])
    setTopicIndex((idx) => idx + 1)
    sendToClaude({ userMessage: '', mode: 'explain' })
    recordStreakActivity(user?.id)
  }

  // Erst starten, wenn der Tutor den PDF-Inhalt lesen kann (extrahierter Text da)
  useEffect(() => {
    const hasPdfText = pdfExtractedText != null && pdfExtractedText.length > 0
    if (!started && pdfUrl && !pdfError && !pdfTextLoading && hasPdfText && messages.length === 0) {
      setStarted(true)
      if (isExerciseMode) fetchExerciseTask(1)
      else sendToClaude({ userMessage: '', mode: 'explain' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, pdfError, pdfTextLoading, pdfExtractedText, started, messages.length, isExerciseMode])

  const progressPercent =
    totalMaterials > 0 ? Math.min(100, Math.round((materialIndex / totalMaterials) * 100)) : null

  const zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
  const pdfBaseWidth = 380
  const pdfWidth = Math.round(pdfBaseWidth * pdfZoom)
  const pdfHeight = Math.round(pdfWidth * (4 / 3))

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-studiio-cream overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 px-4 md:px-6 py-2">
      {/* Oben: Zurück + Fortschritt (kompakt) */}
      <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 py-3">
        <button
          type="button"
          onClick={async () => {
            const totalSec = (Date.now() - sessionStartRef.current) / 1000
            const remainder = Math.max(0, Math.round(totalSec) - savedSecondsRef.current)
            if (remainder >= 1 && user?.id && subject?.id) await addLearningTime(user.id, subject.id, remainder)
            if (user?.id && material?.id) await completeTutorTasksForMaterial(user.id, material.id)
            onBack()
          }}
          className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline font-medium"
        >
          <span className="inline-block rotate-180 text-base">➜</span>
          Zurück zum Fach
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-studiio-ink truncate">
            {totalMaterials > 0 ? (
              <>Datei {materialIndex} von {totalMaterials}</>
            ) : (
              <>{material.filename}</>
            )}
          </span>
          <div className="flex items-center gap-2 w-24 sm:w-32">
            <div className="flex-1 h-2 rounded-full bg-studiio-lavender/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-studiio-accent transition-all duration-300"
                style={{ width: progressPercent != null ? `${progressPercent}%` : '0%' }}
              />
            </div>
            <span className="text-xs font-semibold text-studiio-ink tabular-nums">
              {progressPercent != null ? `${progressPercent} %` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Hauptbereich: volle Höhe, 2 Spalten */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {/* Links: PDF – ganze Seite sichtbar, ohne Verzerrung, mit Zoom */}
        <section className="flex flex-col min-h-0 rounded-xl border border-studiio-lavender/60 bg-white shadow-sm overflow-hidden">
          <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-studiio-lavender/40 bg-white/90">
            <h2 className="text-sm font-semibold text-studiio-ink truncate">
              {material.filename}
            </h2>
            <span className="text-xs text-studiio-muted">
              {isExerciseMode ? `Aufgabe ${topicIndex}` : `Seite ${Math.min(topicIndex, pdfNumPages || topicIndex)}${pdfNumPages > 0 ? ` von ${pdfNumPages}` : ''}`}
            </span>
          </header>
          <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto bg-studiio-sky/30 p-2">
            {pdfError ? (
              <div className="px-4 py-3 text-sm text-red-700 rounded-lg bg-red-50 border border-red-200">
                <p className="font-semibold mb-1">PDF konnte nicht geladen werden.</p>
                <p className="mb-1">{pdfError}</p>
                <p className="text-xs">
                  Prüfe im Supabase Dashboard unter <strong>Storage → Bucket „materials“ → Policies</strong>.
                </p>
              </div>
            ) : pdfUrl ? (
              <div className="w-full h-full overflow-auto flex flex-col items-center justify-start p-2 gap-2">
                <iframe
                  key={pdfUrlWithPage}
                  src={pdfUrlWithPage}
                  title={material.filename}
                  className="flex-shrink-0 border-0 bg-white rounded-lg shadow-md"
                  style={{
                    width: pdfWidth,
                    height: pdfHeight,
                    minWidth: 240,
                    minHeight: 320,
                  }}
                  sandbox="allow-same-origin"
                />
                <p className="text-xs text-studiio-muted">
                  Zeigt die PDF „Load failed“?{' '}
                  <a
                    href={pdfUrlWithPage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-studiio-accent hover:underline"
                  >
                    PDF in neuem Tab öffnen
                  </a>
                </p>
              </div>
            ) : (
              <p className="text-sm text-studiio-muted">PDF wird geladen …</p>
            )}
          </div>
          {/* Zoom + Buttons */}
          <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-studiio-lavender/40 bg-white/90">
            <div className="flex items-center gap-1 flex-wrap max-w-full">
              <span className="text-xs text-studiio-muted mr-1">Zoom:</span>
              {zoomSteps.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setPdfZoom(z)}
                  className={`rounded px-2 py-1 text-xs font-medium transition ${
                    pdfZoom === z
                      ? 'bg-studiio-accent text-white'
                      : 'bg-studiio-lavender/30 text-studiio-ink hover:bg-studiio-lavender/50'
                  }`}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isExerciseMode ? (
                <button
                  type="button"
                  onClick={handleNextExercise}
                  disabled={loading || pdfTextLoading || !pdfExtractedText}
                  className="studiio-btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!pdfExtractedText && !pdfTextLoading ? 'Zuerst PDF-Text laden' : undefined}
                >
                  {loading ? '…' : pdfTextLoading ? 'Laden …' : 'Nächste Aufgabe'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleAskForSlide}
                    disabled={loading || pdfTextLoading || !pdfExtractedText}
                    className="studiio-btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!pdfExtractedText && !pdfTextLoading ? 'Zuerst PDF-Text laden' : undefined}
                  >
                    {loading ? '…' : pdfTextLoading ? 'Laden …' : 'Nächstes Thema'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip('known')}
                    className="rounded-lg border-2 border-studiio-mint/80 bg-studiio-mint/30 px-3 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-mint/50"
                  >
                    Kann ich bereits
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip('irrelevant')}
                    className="rounded-lg border-2 border-studiio-peach/80 bg-studiio-peach/30 px-3 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-peach/50"
                  >
                    Nicht relevant
                  </button>
                </>
              )}
            </div>
          </div>
          {(pdfTextLoading || pdfTextError) && (
            <div className="flex-shrink-0 px-3 py-2 rounded-b-xl bg-studiio-sky/30 border-t border-studiio-lavender/40 text-xs text-studiio-ink">
              {pdfTextLoading && <p>PDF-Inhalt wird gelesen …</p>}
              {pdfTextError && !pdfTextLoading && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-red-700">{pdfTextError}</span>
                  <button
                    type="button"
                    onClick={() => setPdfTextRetryKey((k) => k + 1)}
                    className="rounded border border-studiio-accent bg-white px-2 py-1 text-studiio-accent hover:bg-studiio-accent hover:text-white"
                  >
                    Erneut laden
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Rechts: Chat – große Schrift, Markdown */}
        <section className="flex flex-col min-h-0 rounded-xl border border-studiio-lavender/60 bg-white shadow-sm overflow-hidden">
          <header className="flex-shrink-0 px-4 py-3 border-b border-studiio-lavender/40">
            <h2 className="text-lg font-semibold text-studiio-ink">KI-Tutor</h2>
            <p className="text-sm text-studiio-muted">
              Rückfragen, Beispiele, Zusammenfassungen zu den Folien.
            </p>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
            {messages
              .filter((m) => m.role !== 'system')
              .map((m, index) => (
                <div
                  key={index}
                  className={m.role === 'user' ? 'text-right' : 'text-left'}
                >
                  {m.role === 'user' ? (
                    <div className="inline-block max-w-[85%] rounded-2xl bg-studiio-accent text-white px-4 py-3 text-base">
                      {m.content}
                    </div>
                  ) : (
                    <div className="inline-block max-w-[85%] rounded-2xl bg-studiio-sky/40 text-studiio-ink px-4 py-3 text-[17px] leading-relaxed prose prose-base max-w-none prose-headings:font-semibold prose-headings:text-studiio-ink prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:font-semibold prose-strong:text-studiio-ink">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
            {loading && (
              <p className="text-sm text-studiio-muted">Tutor schreibt …</p>
            )}
          </div>
          <form
            onSubmit={handleSubmitChat}
            className="flex-shrink-0 border-t border-studiio-lavender/40 px-4 py-3 flex gap-2 items-center bg-white/95"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isExerciseMode ? 'Deine Lösung oder Antwort eingeben …' : 'Deine Frage oder Bitte an den Tutor …'}
              className="studiio-input flex-1 text-base py-2.5"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="studiio-btn-primary text-base px-5 py-2.5"
            >
              Senden
            </button>
          </form>
        </section>
      </div>
      </div>
    </div>
  )
}

export default function LectureTutor(props) {
  return (
    <LectureTutorErrorBoundary>
      <LectureTutorInner {...props} />
    </LectureTutorErrorBoundary>
  )
}

