import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

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

function LectureTutorInner({ user, subject, material, onBack }) {
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfError, setPdfError] = useState(null)
  const [topicIndex, setTopicIndex] = useState(1)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [zoom, setZoom] = useState(1.1)

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
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [material.storage_path])

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

  async function sendToClaude({ userMessage, mode }) {
    setLoading(true)
    try {
      const apiKey = await fetchClaudeApiKey()

      const payload = {
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system:
          'Du bist ein deutschsprachiger Lern-Tutor. Du arbeitest eine Vorlesung Slide für Slide durch und ersetzt so gut wie möglich den Besuch der Vorlesung.\n\n' +
          '- Fasse Inhalte verständlich in eigenen Worten zusammen.\n' +
          '- Nutze Beispiele, Analogien und Umformulierungen.\n' +
          '- Nach jeder Erklärung stellst du GENAU EINE offene Verständnisfrage.\n' +
          '- Wenn der/die Studierende auf diese Frage antwortet, bewertest du die Antwort: Was ist richtig, was fehlt, welche Missverständnisse gibt es?\n' +
          '- Schlage ggf. eine kurze Korrektur-/Idealantwort vor und gehe erst danach zum nächsten Thema weiter.',
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
                    ? 'Starte bitte mit dem nächsten sinnvollen Thema basierend auf der Vorlesungs-PDF. Erkläre dieses Thema so, als würdest du mir die Vorlesung halten: verständlich, mit Beispielen, Umformulierungen und ggf. einer kurzen Mini-Zusammenfassung. Stelle mir danach GENAU EINE offene Verständnisfrage zu diesem Thema, auf die ich im Chat antworten kann.'
                    : 'Dies ist meine Antwort auf deine letzte Verständnisfrage zum aktuellen Thema. Bitte bewerte meine Antwort: Was ist richtig, was fehlt, sind Missverständnisse drin? Ergänze eine kurze Idealantwort. Wenn meine Antwort im Kern passt, kannst du zum Abschluss noch eine kurze vertiefende Frage oder ein Beispiel vorschlagen.\n\n' +
                      `Meine Antwort:\n${userMessage || '(keine zusätzliche Nachricht)'}`),
              },
            ],
          },
        ],
      }

      const response = await fetch('http://localhost:8787/api/claude', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey, payload }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error('Fehler von der Claude API:', errText)
        throw new Error('Die KI-Antwort ist fehlgeschlagen. Bitte später erneut versuchen.')
      }

      const data = await response.json()
      const text = data?.content?.[0]?.text || 'Keine Antwort vom Tutor erhalten.'

      setMessages((prev) => [
        ...prev,
        ...(mode === 'answer' && userMessage
          ? [{ role: 'user', content: userMessage }]
          : []),
        { role: 'assistant', content: text },
      ])
    } catch (err) {
      console.error(err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            err.message ||
            'Es ist ein Fehler bei der Anfrage an die KI aufgetreten. Bitte prüfe deinen Claude API Key in den Einstellungen.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleAskForSlide() {
    sendToClaude({ userMessage: '', mode: 'explain' })
  }

  function handleSubmitChat(e) {
    e.preventDefault()
    if (!input.trim()) return
    const text = input.trim()
    setInput('')
    sendToClaude({ userMessage: text, mode: 'answer' })
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
  }

  // Beim ersten Öffnen automatisch mit dem ersten Thema starten
  useEffect(() => {
    if (!started && pdfUrl) {
      setStarted(true)
      sendToClaude({ userMessage: '', mode: 'explain' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, started])

  return (
    <div className="space-y-4 min-h-[calc(100vh-140px)] -mx-4 md:-mx-8 lg:-mx-12 px-0">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline"
      >
        <span className="inline-block rotate-180 text-base">➜</span>
        Zurück zum Fach
      </button>

      <div className="grid gap-4 md:grid-cols-2 h-full">
        <section className="rounded-2xl border border-studiio-lavender/60 bg-white/80 px-3 py-3 flex flex-col gap-2 h-full">
          <header className="flex items-center justify-between gap-2 pb-1 border-b border-studiio-lavender/40">
            <div>
              <h2 className="text-sm font-semibold text-studiio-ink">
                Vorlesung: {material.filename}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-studiio-muted">
              <span>Zoom</span>
              <div className="inline-flex rounded-full border border-studiio-lavender/60 overflow-hidden bg-studiio-sky/30">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.7, z - 0.1))}
                  className="px-2 py-0.5 hover:bg-studiio-sky/60"
                >
                  -
                </button>
                <span className="px-2 py-0.5 border-l border-r border-studiio-lavender/60 min-w-[3rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
                  className="px-2 py-0.5 hover:bg-studiio-sky/60"
                >
                  +
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 min-h-[360px] flex items-center justify-center bg-studiio-sky/30 rounded-xl overflow-auto">
            {pdfError ? (
              <div className="px-4 py-3 text-xs text-red-700">
                <p className="font-semibold mb-1">PDF konnte nicht geladen werden.</p>
                <p className="mb-1">{pdfError}</p>
                <p>
                  Prüfe im Supabase Dashboard unter <strong>Storage → Bucket „materials“ → Policies</strong>,
                  ob angemeldete Nutzer Leserechte für ihre eigenen Dateien haben.
                </p>
              </div>
            ) : pdfUrl ? (
              <div
                className="inline-block"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                }}
              >
                <iframe
                  src={pdfUrl}
                  title={material.filename}
                  className="w-[850px] h-[1100px] border-0 bg-white"
                />
              </div>
            ) : (
              <p className="text-sm text-studiio-muted">PDF wird geladen …</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleAskForSlide}
              disabled={loading}
              className="studiio-btn-primary text-xs"
            >
              {loading ? 'Tutor antwortet …' : 'Nächstes Thema erklären lassen'}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSkip('known')}
                className="rounded-full border border-studiio-lavender/80 px-3 py-1 text-[11px] text-studiio-muted hover:bg-studiio-mint/60 hover:text-studiio-ink"
              >
                Kann ich bereits
              </button>
              <button
                type="button"
                onClick={() => handleSkip('irrelevant')}
                className="rounded-full border border-studiio-lavender/80 px-3 py-1 text-[11px] text-studiio-muted hover:bg-studiio-peach/60 hover:text-studiio-ink"
              >
                Nicht relevant
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-studiio-lavender/60 bg-white/80 flex flex-col h-full">
          <header className="px-3 py-2 border-b border-studiio-lavender/40">
            <h2 className="text-base font-semibold text-studiio-ink">KI-Tutor</h2>
            <p className="text-xs text-studiio-muted">
              Stelle Rückfragen, bitte um Beispiele oder Zusammenfassungen zu den aktuellen Folien.
            </p>
          </header>
          <div className="flex-1 px-3 py-2 space-y-2 overflow-y-auto text-[13px] leading-relaxed">
            {messages
              .filter((m) => m.role !== 'system')
              .map((m, index) => (
                <div
                  key={index}
                  className={
                    m.role === 'user'
                      ? 'text-right'
                      : 'text-left'
                  }
                >
                  <div
                    className={
                      m.role === 'user'
                        ? 'inline-block max-w-[80%] rounded-2xl bg-studiio-accent text-white px-3 py-1.5 text-[13px]'
                        : 'inline-block max-w-[80%] rounded-2xl bg-studiio-sky/40 text-studiio-ink px-3 py-1.5 text-[13px]'
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            {loading && (
              <p className="text-[11px] text-studiio-muted">Tutor schreibt …</p>
            )}
          </div>
          <form onSubmit={handleSubmitChat} className="border-t border-studiio-lavender/40 px-3 py-2 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Deine Frage oder Bitte an den Tutor …"
              className="studiio-input flex-1 text-xs"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="studiio-btn-primary text-xs px-3"
            >
              Senden
            </button>
          </form>
        </section>
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

