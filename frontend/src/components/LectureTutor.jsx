import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabaseClient'
import ReactMarkdown from 'react-markdown'
import { addLearningTime } from '../utils/learningTime'
import { completeTutorTasksForMaterial } from '../utils/learningPlan'
import CompletionCelebration from './CompletionCelebration'
import {
  getApiBase,
  TUTOR_ATTACH_SUBJECT_CONTEXT,
  TUTOR_ANSWER_CHAT_TRANSCRIPT_MAX_CHARS,
  TUTOR_CLAUDE_MAX_TOKENS_CHAT,
  TUTOR_CLAUDE_MAX_TOKENS_EXPLAIN,
  TUTOR_KI_MAX_PAGE_CONTEXT_CHARS,
  TUTOR_KI_MAX_PAGE_CONTEXT_CHARS_FOLLOWUP,
  TUTOR_KI_MAX_PDF_CHARS,
  TUTOR_KI_MAX_PDF_CHARS_FOLLOWUP,
  TUTOR_KI_MAX_SUBJECT_CONTEXT_CHARS,
  TUTOR_KI_MAX_SUBJECT_CONTEXT_CHARS_FOLLOWUP,
} from '../config'
import { LECTURE_TUTOR_ANSWER_SYSTEM, LECTURE_TUTOR_EXPLAIN_SYSTEM } from '../lectureTutorSystemPrompts'
import { isBackendInfoRootResponse, isLikelyHtmlResponse, MSG_API_WRONG_ENDPOINT } from '../utils/apiResponse'
import { pageContextAiBannerFromFailureBody, resolveClaudeProxyFailureMessage } from '../utils/aiBillingError'
import MiniFocusHint from './MiniFocusHint'
import { resumeMiniFocusSession } from '../utils/miniFocusSession'
import { dispatchPomodoroPauseForLeave, dispatchPomodoroResumeAfterTask } from '../utils/pomodoroFocusBridge'
import { confirmFocusLeaveIfNeeded } from '../utils/focusLeaveConfirm'
import { getUserAiConfig } from '../utils/aiProvider'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

/** Gleichzeitige Downloads desselben Pfads (z. B. Strict Mode) → Supabase oft „Lock was stolen“. */
const materialPdfDownloadInflight = new Map()

/**
 * Ein gemeinsames Promise pro storage_path: parallele Aufrufe warten auf denselben Download.
 * Bei „Lock was stolen“ kurz warten und erneut versuchen.
 */
async function dedupedMaterialPdfDownload(storagePath) {
  const key = String(storagePath || '')
  if (!key) throw new Error('storage_path fehlt')

  let p = materialPdfDownloadInflight.get(key)
  if (!p) {
    p = (async () => {
      const maxAttempts = 3
      let lastError = null
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { data, error } = await supabase.storage.from('materials').download(key)
        if (!error && data instanceof Blob) return data
        lastError = error || new Error('Storage-Download: kein Blob')
        const msg = String(lastError?.message || lastError)
        if (attempt < maxAttempts - 1 && /stolen|lock/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
          continue
        }
        throw lastError
      }
      throw lastError
    })().finally(() => {
      if (materialPdfDownloadInflight.get(key) === p) materialPdfDownloadInflight.delete(key)
    })
    materialPdfDownloadInflight.set(key, p)
  }
  return p
}

/**
 * Technische Infos für PDF-Vorschau / Storage (zum Debuggen, z. B. pdf.js-Name, Meldung, Supabase-code).
 */
function buildPdfPreviewDebugDetails(scope, err, extra = {}) {
  const lines = []
  lines.push(`Bereich: ${scope}`)
  if (extra.pageNumber != null) lines.push(`Folie: ${extra.pageNumber}`)
  try {
    if (typeof pdfjs?.version === 'string') lines.push(`pdf.js: ${pdfjs.version}`)
  } catch (_) {}
  lines.push(`Worker: ${pdfWorker}`)
  if (err == null) {
    lines.push('(kein Error-Objekt)')
    return lines.join('\n')
  }
  if (typeof err === 'string') {
    lines.push(err)
    return lines.join('\n')
  }
  const e = err
  if (e.name) lines.push(`Typ/Name: ${e.name}`)
  if (e.message) lines.push(`Meldung: ${e.message}`)
  if (e.code != null && e.code !== '') lines.push(`code: ${e.code}`)
  if (e.status != null) lines.push(`status: ${e.status}`)
  if (e.statusCode != null) lines.push(`statusCode: ${e.statusCode}`)
  if (e.details != null) {
    lines.push(
      `details: ${typeof e.details === 'string' ? e.details : JSON.stringify(e.details)}`,
    )
  }
  if (e.stack) lines.push(`Stack:\n${String(e.stack).slice(0, 800)}`)
  return lines.join('\n')
}

/**
 * Safari/WebKit liefert bei blockiertem/failed fetch oft nur „Load failed“ — als Chat-Text wirkte das wie KI-Inhalt.
 */
/** Entfernt kurze Browser-/Fetch-Fehlertexte, die früher als KI-Nachricht im Chat hingen. */
function sanitizeTutorChatMessages(messages) {
  if (!Array.isArray(messages)) return messages
  return messages.filter((m) => {
    if (!m || m.role !== 'assistant' || typeof m.content !== 'string') return true
    const t = m.content.trim()
    if (!t) return true
    if (/^load failed\.?$/i.test(t)) return false
    if (/^failed to fetch$/i.test(t)) return false
    return true
  })
}

function formatTutorFetchConnectionError(err) {
  const name = err?.name || 'Error'
  const rawMsg = String(err?.message || err || '').trim()
  const msgLower = rawMsg.toLowerCase()
  /** WebKit meldet manchmal nur „Load failed“ ohne weiteren Kontext. */
  const isLoadFailedMsg = /load failed/i.test(msgLower)
  const isDomAbort =
    typeof DOMException !== 'undefined' &&
    err instanceof DOMException &&
    (name === 'AbortError' || msgLower.includes('aborted') || isLoadFailedMsg)
  const isTypeFetchFail =
    name === 'TypeError' &&
    (msgLower === 'failed to fetch' ||
      msgLower.includes('networkerror') ||
      isLoadFailedMsg ||
      msgLower.includes('fetch') ||
      msgLower.includes('network request failed'))
  if (!(name === 'AbortError' || isDomAbort || isTypeFetchFail || isLoadFailedMsg)) return null
  return (
    '**Verbindungsproblem**\n\n' +
    'Die App konnte den **KI-Backend-Server** nicht zuverlässig erreichen (das ist **nicht** dasselbe wie ein leeres Anthropic-Guthaben).\n\n' +
    'Bitte prüfen:\n' +
    '- Läuft das Backend? Im Projektordner in einem **eigenen Terminal**: `npm run api`\n' +
    '- Stimmt `VITE_API_BASE` in der `.env` / auf Vercel? (volle URL des Backends, **ohne** `/api` am Ende)\n' +
    '- Rufst du die App per **HTTPS** auf, muss die API-URL auch **HTTPS** sein — sonst blockiert der Browser die Anfrage.\n\n' +
    `Technisch: \`${name}\`${rawMsg ? ` — ${rawMsg}` : ''}`
  )
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const MAX_PAGES_PER_EXPLANATION = 2

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

function clipTutorContext(text, maxChars, label) {
  const s = typeof text === 'string' ? text : ''
  if (!s) return ''
  if (s.length <= maxChars) return s
  return `${s.slice(0, maxChars)}\n[... ${label} gekürzt — in den Einstellungen über TUTOR_KI_MAX_* anpassbar]`
}

/** Letzte Wechsel (max. 6 Nachrichten) für Antwortmodus — spart Tokens gegenüber vollem UI-Verlauf. */
function buildTutorAnswerTranscript(chatMessages, maxChars) {
  const list = sanitizeTutorChatMessages(Array.isArray(chatMessages) ? chatMessages : [])
  const tail = list
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim(),
    )
    .slice(-6)
  if (tail.length === 0) return ''
  const joined = tail
    .map((m) => `${m.role === 'user' ? 'Nutzer' : 'Tutor'}: ${m.content.trim()}`)
    .join('\n\n—\n\n')
  return clipTutorContext(joined, maxChars, 'Chat-Verlauf')
}

/**
 * Schätzt den PDF-Textausschnitt zu den sichtbaren Folien (linear über Zeichenlänge),
 * damit nicht jedes Mal das ganze Skript mitgeschickt wird.
 */
function slicePdfForVisiblePages(fullText, pageStart, pageEnd, numPages, maxChars) {
  const t = typeof fullText === 'string' ? fullText : ''
  if (!t.trim()) return '(PDF-Text leer.)'
  const pages = Number(numPages) || 0
  const ps = Math.max(1, Number(pageStart) || 1)
  const pe = Math.max(ps, Number(pageEnd) || ps)
  if (!pages || pages < 2) {
    return clipTutorContext(t, maxChars, 'PDF')
  }
  const len = t.length
  const margin = Math.min(2500, Math.floor(len * 0.08))
  const a = Math.max(0, Math.floor(((ps - 1) / pages) * len) - margin)
  const b = Math.min(len, Math.ceil((pe / pages) * len) + margin)
  let chunk = t.slice(a, b)
  let note = ''
  if (a > 0) note += `[Nur Ausschnitt: Text vor Folie ${ps} weggelassen (Kosten/Tokens).]\n`
  if (b < len) note += `[Nur Ausschnitt: Text nach Folie ${pe} ggf. gekürzt.]\n`
  return clipTutorContext(note + chunk, maxChars, 'PDF-Ausschnitt')
}

const PDF_TEXT_RETRIES = 3
const PDF_TEXT_RETRY_DELAY_MS = 1500
const TUTOR_SAVE_DEBOUNCE_MS = 800

const isExerciseCategory = (cat) => cat === 'Übung' || cat === 'Tutorium'

function ensureExplainQuestion(text, pageStart, pageEnd) {
  const safe = (text || '').trim()
  const hasQuestion = safe.includes('?')
  if (hasQuestion) return safe
  const pageLabel =
    pageStart === pageEnd ? `Folie ${pageStart}` : `Folien ${pageStart}-${pageEnd}`
  return (
    safe +
    `\n\n**Verständnisfrage:** Was ist aus ${pageLabel} für dich die wichtigste Aussage, und wie würdest du sie in eigenen Worten erklären?`
  ).trim()
}

function normalizeTutorTone(raw) {
  return String(raw || '')
    .replace(/\bIhre Antwort\b/g, 'Deine Antwort')
    .replace(/\bSie haben\b/g, 'Du hast')
    .replace(/\bfür Sie\b/g, 'für dich')
    .replace(/\bIhnen\b/g, 'dir')
}

function stripNextMarker(raw) {
  return String(raw || '')
    .replace(/\[\[NEXT:(same|section)\]\]/gi, '')
    .replace(/\[\[NO_VERSTAENDNISFRAGE\]\]/gi, '')
    .trim()
}

function extractThemeTitle(text, fallback = 'Thema') {
  const cleanLines = String(text || '')
    .split('\n')
    .map((line) =>
      line
        .replace(/[*#`>]/g, '')
        .replace(/^\s*[-•]\s*/, '')
        .replace(/^\s*(titel|thema|überschrift)\s*:\s*/i, '')
        .trim(),
    )
    .filter(Boolean)

  const firstLine = cleanLines.find((line) => {
    const lowered = line.toLowerCase()
    return !lowered.includes('verständnisfrage') && !lowered.startsWith('idealantwort')
  })

  if (!firstLine) return fallback
  if (firstLine.length <= 64) return firstLine
  return `${firstLine.slice(0, 64).trimEnd()}...`
}

function splitTutorQuestion(raw) {
  const text = String(raw || '').trim()
  if (!text) return { mainText: '', questionText: '' }

  const boldMatch = text.match(/\*\*Verständnisfrage:\*\*\s*([\s\S]*)$/i)
  if (boldMatch) {
    const mainText = text.slice(0, boldMatch.index).trim()
    const questionText = (boldMatch[1] || '').trim()
    return { mainText, questionText }
  }

  const plainMatch = text.match(/(?:^|\n)Verständnisfrage:\s*([^\n]+)\s*$/i)
  if (plainMatch) {
    const idx = text.toLowerCase().lastIndexOf('verständnisfrage:')
    const mainText = idx >= 0 ? text.slice(0, idx).trim() : text
    const questionText = (plainMatch[1] || '').trim()
    return { mainText, questionText }
  }

  // Fallback: letzte sinnvolle Zeile/Absatz als Frage erkennen.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1]
    if (last.endsWith('?')) {
      return {
        mainText: paragraphs.slice(0, -1).join('\n\n').trim(),
        questionText: last,
      }
    }
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length > 1) {
    const lastLine = lines[lines.length - 1]
    if (lastLine.endsWith('?')) {
      return {
        mainText: lines.slice(0, -1).join('\n').trim(),
        questionText: lastLine,
      }
    }
  }

  return { mainText: text, questionText: '' }
}

function LectureTutorInner({ user, subject, material, onBack }) {
  const isExerciseMode = isExerciseCategory(material?.category)
  /** PDF als Blob für react-pdf (kein blob:-String → weniger „Load failed“ durch zu frühes Revoke). */
  const [pdfFile, setPdfFile] = useState(null)
  /** Eigene Object-URL nur für „Im neuen Tab öffnen“; Vorschau nutzt `pdfFile` direkt. */
  const [pdfTabUrl, setPdfTabUrl] = useState(null)
  const [pdfError, setPdfError] = useState(null)
  const [pdfErrorDetails, setPdfErrorDetails] = useState(null)
  const [pdfExtractedText, setPdfExtractedText] = useState(null)
  const [pdfTextLoading, setPdfTextLoading] = useState(false)
  const [pdfTextError, setPdfTextError] = useState(null)
  const [subjectContextText, setSubjectContextText] = useState('')
  const [subjectContextLoading, setSubjectContextLoading] = useState(false)
  const [pageContexts, setPageContexts] = useState([])
  const [pageContextLoading, setPageContextLoading] = useState(false)
  const [pageContextAiBanner, setPageContextAiBanner] = useState(null)
  const [pdfTextRetryKey, setPdfTextRetryKey] = useState(0)
  const [pdfNumPages, setPdfNumPages] = useState(0)
  const [topicIndex, setTopicIndex] = useState(1)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [initialRequestDone, setInitialRequestDone] = useState(false)
  const [currentTaskText, setCurrentTaskText] = useState(null)
  const [explanationHistory, setExplanationHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isCompleted, setIsCompleted] = useState(false)
  const [progressHydrated, setProgressHydrated] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [chatWindowVersion, setChatWindowVersion] = useState(1)
  const [archivedThemeChats, setArchivedThemeChats] = useState([])
  const [nextThemeMode, setNextThemeMode] = useState('same') // 'same' | 'section'
  const [themeRoundInSection, setThemeRoundInSection] = useState(1)
  const [currentThemeId, setCurrentThemeId] = useState(null)
  const [completedThemeKeys, setCompletedThemeKeys] = useState([])
  const [materialIndex, setMaterialIndex] = useState(1)
  const [totalMaterials, setTotalMaterials] = useState(0)
  const [pdfZoom, setPdfZoom] = useState(1.25)
  const sessionStartRef = useRef(Date.now())
  const savedSecondsRef = useRef(0)
  const pdfBlobRef = useRef(null)
  const latestMessageRef = useRef(null)
  const currentThemeRef = useRef(null)
  const tutorTasksCompletedRef = useRef(false)

  async function markTutorTasksCompleteIfNeeded() {
    if (tutorTasksCompletedRef.current) return
    if (!user?.id || !material?.id) return
    try {
      await completeTutorTasksForMaterial(user.id, material.id)
      tutorTasksCompletedRef.current = true
    } catch (_) {
      // stilles Fallback, UI bleibt benutzbar
    }
  }

  useEffect(() => {
    resumeMiniFocusSession()
    dispatchPomodoroResumeAfterTask()
  }, [])

  // Lernzeit alle 60 Sekunden zwischenspeichern (wird nie zurückgesetzt)
  useEffect(() => {
    if (!user?.id || !subject?.id) return
    const interval = setInterval(async () => {
      savedSecondsRef.current += 60
      await addLearningTime(user.id, subject.id, 60)
    }, 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.id, subject?.id])

  // Beim neuen Verlauf den Anfang der neuesten Nachricht sichtbar machen.
  useEffect(() => {
    if (!latestMessageRef.current) return
    latestMessageRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [messages.length])

  // Bei Themenwechsel den Fokus auf den aktuellen Themen-Block setzen.
  useEffect(() => {
    if (!currentThemeRef.current) return
    currentThemeRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [chatWindowVersion])

  // Seitenkontext je Material aufbauen/laden (mit Backend-Cache gegen doppelte KI-Kosten).
  useEffect(() => {
    if (!material?.id || !material?.storage_path || !user?.id) return
    let cancelled = false
    setPageContextLoading(true)
    setPageContextAiBanner(null)

    ;(async () => {
      try {
        const { apiKey, provider } = await fetchAiConfig()
        const res = await fetch(`${getApiBase()}/api/build-material-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            materialId: material.id,
            storagePath: material.storage_path,
            apiKey,
            provider,
            userId: user.id,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || data?.error || !Array.isArray(data?.pages)) {
          setPageContexts([])
          if (!cancelled && (data?.error || !res.ok)) {
            setPageContextAiBanner(resolveClaudeProxyFailureMessage({ responseText: JSON.stringify(data), parsed: data }))
          }
          return
        }
        setPageContexts(data.pages)
        if (!cancelled) {
          setPageContextAiBanner(
            data?.contextAiFailureBody ? pageContextAiBannerFromFailureBody(data.contextAiFailureBody) : null,
          )
        }
      } catch (_) {
        if (!cancelled) {
          setPageContexts([])
          setPageContextAiBanner(null)
        }
      } finally {
        if (!cancelled) setPageContextLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [material?.id, material?.storage_path, user?.id])

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
    let cancelled = false
    setPdfError(null)
    setPdfErrorDetails(null)
    setPdfFile(null)
    setPdfTabUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })

    async function loadUrl() {
      console.log('[LectureTutor] download wird aufgerufen:', {
        bucket: 'materials',
        path: material.storage_path,
      })

      let data
      try {
        data = await dedupedMaterialPdfDownload(material.storage_path)
      } catch (error) {
        if (cancelled) return
        console.error('[LectureTutor] Fehler beim Download der PDF:', error)
        setPdfErrorDetails(buildPdfPreviewDebugDetails('Supabase Storage (Download)', error))
        setPdfError(
          'Die PDF konnte nicht geladen werden. Details siehe Konsole (Storage-Fehler beim Download).',
        )
        return
      }

      if (cancelled) return

      try {
        console.log('[LectureTutor] download Ergebnis:', {
          type: data?.type,
          size: data?.size,
        })

        const mime = String(data.type || '').toLowerCase()
        const allowedMime =
          !mime ||
          mime === 'application/pdf' ||
          mime === 'application/octet-stream' ||
          mime === 'binary/octet-stream'
        if (mime && !allowedMime) {
          console.error('[LectureTutor] Unerwarteter MIME-Typ:', data.type)
          setPdfErrorDetails(
            `${buildPdfPreviewDebugDetails('MIME-Typ', null)}\nContent-Type: ${data.type || '(leer)'}`,
          )
          setPdfError(`Erwartet eine PDF-Datei, erhalten: ${data.type}.`)
          return
        }

        if (cancelled) return

        pdfBlobRef.current = data
        const tabUrl = URL.createObjectURL(data)
        if (cancelled) {
          URL.revokeObjectURL(tabUrl)
          return
        }
        setPdfFile(data)
        setPdfTabUrl(tabUrl)
        setPdfError(null)
        setPdfErrorDetails(null)
      } catch (e) {
        if (!cancelled) {
          console.error('[LectureTutor] Fehler beim Laden der PDF:', e)
          setPdfErrorDetails(buildPdfPreviewDebugDetails('PDF vorbereiten (try/catch)', e))
          setPdfError('Die PDF konnte nicht vorbereitet werden. Bitte später erneut versuchen.')
        }
      }
    }

    loadUrl()

    return () => {
      cancelled = true
      pdfBlobRef.current = null
      setPdfFile(null)
      setPdfTabUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [material.storage_path])

  const currentStartPage = Math.max(1, Math.min(topicIndex, pdfNumPages || topicIndex))
  const currentEndPage = Math.min(
    currentStartPage + MAX_PAGES_PER_EXPLANATION - 1,
    pdfNumPages || currentStartPage + MAX_PAGES_PER_EXPLANATION - 1,
  )
  const currentThemeKey = `${currentStartPage}-${currentEndPage}:${themeRoundInSection}`
  const isCurrentThemeAnswered = completedThemeKeys.includes(currentThemeKey)
  const pagesToDisplay = isExerciseMode
    ? [currentStartPage]
    : Array.from(
        { length: Math.max(1, currentEndPage - currentStartPage + 1) },
        (_, i) => currentStartPage + i,
      )
  const visiblePageContext = pagesToDisplay
    .map((p) => pageContexts.find((x) => x.pageNumber === p))
    .filter(Boolean)
    .map((p) => `Seite ${p.pageNumber}:\n${p.combinedSummary || p.textExcerpt || ''}`)
    .join('\n\n')
  const hasPdfText = pdfExtractedText != null && pdfExtractedText.length > 0
  const hasPageContext = String(visiblePageContext || '').trim().length > 0
  const canExplainWithContext = hasPdfText || hasPageContext

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
          body: JSON.stringify({ materialId: material.id, storagePath: material.storage_path }),
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
        if (isLikelyHtmlResponse(text)) {
          if (attempt < PDF_TEXT_RETRIES) {
            await new Promise((r) => setTimeout(r, PDF_TEXT_RETRY_DELAY_MS))
            return fetchWithRetry(attempt + 1)
          }
          setPdfTextError(
            'Die API hat HTML statt JSON geliefert (falsche URL oder kein Backend). ' + MSG_API_WRONG_ENDPOINT,
          )
          return
        }
        let data
        try {
          data = JSON.parse(text || '{}')
        } catch (parseErr) {
          if (attempt < PDF_TEXT_RETRIES) {
            await new Promise((r) => setTimeout(r, PDF_TEXT_RETRY_DELAY_MS))
            return fetchWithRetry(attempt + 1)
          }
          setPdfTextError('Ungültige API-Antwort (kein JSON). Bitte Backend und VITE_API_BASE prüfen.')
          return
        }
        if (isBackendInfoRootResponse(data)) {
          if (attempt < PDF_TEXT_RETRIES) {
            await new Promise((r) => setTimeout(r, PDF_TEXT_RETRY_DELAY_MS))
            return fetchWithRetry(attempt + 1)
          }
          setPdfTextError(MSG_API_WRONG_ENDPOINT)
          return
        }
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
        if (typeof data.numPages === 'number' && data.numPages > 0) {
          setPdfNumPages(data.numPages)
        }
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

  // Fachweiter Kontext (andere Unterlagen) — nur wenn aktiviert; sonst keine API-Last und keine Tokens.
  useEffect(() => {
    if (!user?.id || !subject?.id) return
    if (!TUTOR_ATTACH_SUBJECT_CONTEXT) {
      setSubjectContextText('')
      setSubjectContextLoading(false)
      return
    }
    let cancelled = false
    setSubjectContextLoading(true)
    const endpoint = `${getApiBase()}/api/subject-context-text`

    ;(async () => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, subjectId: subject.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || data?.error) {
          setSubjectContextText('')
          return
        }
        const txt = typeof data.text === 'string' ? data.text : ''
        setSubjectContextText(txt.slice(0, TUTOR_KI_MAX_SUBJECT_CONTEXT_CHARS))
      } catch (_) {
        if (!cancelled) setSubjectContextText('')
      } finally {
        if (!cancelled) setSubjectContextLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user?.id, subject?.id])

  // Fortschritt laden (lokal + Supabase). Supabase hat Priorität.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const key = `studiio_tutor_progress_${material.id}`
        const raw = localStorage.getItem(key)
        if (raw) {
          const saved = JSON.parse(raw)
          if (typeof saved.topicIndex === 'number') setTopicIndex(saved.topicIndex)
          if (Array.isArray(saved.messages)) setMessages(sanitizeTutorChatMessages(saved.messages))
          if (typeof saved.numPages === 'number' && saved.numPages > 0) setPdfNumPages(saved.numPages)
          if (typeof saved.currentTaskText === 'string' && saved.currentTaskText.trim()) setCurrentTaskText(saved.currentTaskText)
          if (typeof saved.started === 'boolean') setStarted(saved.started)
          if (typeof saved.initialRequestDone === 'boolean') setInitialRequestDone(saved.initialRequestDone)
          else if (Array.isArray(saved.messages) && saved.messages.length > 0) setInitialRequestDone(true)
          if (Array.isArray(saved.explanationHistory)) setExplanationHistory(saved.explanationHistory)
          if (typeof saved.historyIndex === 'number') setHistoryIndex(saved.historyIndex)
          if (typeof saved.isCompleted === 'boolean') setIsCompleted(saved.isCompleted)
          if (typeof saved.themeRoundInSection === 'number' && saved.themeRoundInSection > 0) {
            setThemeRoundInSection(saved.themeRoundInSection)
          }
          if (Array.isArray(saved.completedThemeKeys)) {
            setCompletedThemeKeys(saved.completedThemeKeys)
          }
        }
      } catch (e) {
        console.error('Fehler beim Laden des lokalen Tutor-Fortschritts:', e)
      }

      try {
        const { data, error } = await supabase
          .from('tutor_progress')
          .select('topic_index, num_pages, messages, current_task_text, started, initial_request_done, explanation_history, history_index, is_completed, theme_round_in_section, completed_theme_keys')
          .eq('user_id', user.id)
          .eq('material_id', material.id)
          .maybeSingle()
        if (mounted && !error && data) {
          if (typeof data.topic_index === 'number') setTopicIndex(data.topic_index)
          if (typeof data.num_pages === 'number' && data.num_pages > 0) setPdfNumPages(data.num_pages)
          if (Array.isArray(data.messages)) setMessages(sanitizeTutorChatMessages(data.messages))
          if (typeof data.current_task_text === 'string' && data.current_task_text.trim()) setCurrentTaskText(data.current_task_text)
          if (typeof data.started === 'boolean') setStarted(data.started)
          if (typeof data.initial_request_done === 'boolean') setInitialRequestDone(data.initial_request_done)
          if (Array.isArray(data.explanation_history)) setExplanationHistory(data.explanation_history)
          if (typeof data.history_index === 'number') setHistoryIndex(data.history_index)
          if (typeof data.is_completed === 'boolean') setIsCompleted(data.is_completed)
          if (typeof data.theme_round_in_section === 'number' && data.theme_round_in_section > 0) {
            setThemeRoundInSection(data.theme_round_in_section)
          }
          if (Array.isArray(data.completed_theme_keys)) {
            setCompletedThemeKeys(data.completed_theme_keys)
          }
        }
      } catch (_) {
        // stilles Fallback auf localStorage
      } finally {
        if (mounted) setProgressHydrated(true)
      }
    })()

    return () => { mounted = false }
  }, [material.id, user.id])

  // Fortschritt speichern (Thema, Nachrichten, Seitenanzahl)
  useEffect(() => {
    try {
      const key = `studiio_tutor_progress_${material.id}`
      const toSave = {
        topicIndex,
        messages,
        numPages: pdfNumPages,
        currentTaskText,
        started,
        initialRequestDone,
        explanationHistory,
        historyIndex,
        isCompleted,
        themeRoundInSection,
        completedThemeKeys,
      }
      localStorage.setItem(key, JSON.stringify(toSave))
    } catch (e) {
      console.error('Fehler beim Speichern des Tutor-Fortschritts:', e)
    }
  }, [
    material.id,
    topicIndex,
    messages,
    pdfNumPages,
    currentTaskText,
    started,
    initialRequestDone,
    explanationHistory,
    historyIndex,
    isCompleted,
    themeRoundInSection,
    completedThemeKeys,
  ])

  useEffect(() => {
    if (!progressHydrated || !user?.id || !material?.id || !subject?.id) return
    const t = setTimeout(async () => {
      try {
        await supabase
          .from('tutor_progress')
          .upsert(
            {
              user_id: user.id,
              material_id: material.id,
              subject_id: subject.id,
              topic_index: topicIndex,
              num_pages: pdfNumPages || null,
              messages,
              current_task_text: currentTaskText || null,
              started,
              initial_request_done: initialRequestDone,
              explanation_history: explanationHistory,
              history_index: historyIndex,
              is_completed: isCompleted,
              theme_round_in_section: themeRoundInSection,
              completed_theme_keys: completedThemeKeys,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,material_id' },
          )
      } catch (_) {}
    }, TUTOR_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [
    progressHydrated,
    user?.id,
    material?.id,
    subject?.id,
    topicIndex,
    pdfNumPages,
    messages,
    currentTaskText,
    started,
    initialRequestDone,
    explanationHistory,
    historyIndex,
    isCompleted,
    themeRoundInSection,
    completedThemeKeys,
  ])

  async function fetchAiConfig() {
    try {
      return await getUserAiConfig(user.id)
    } catch (error) {
      console.error('Fehler beim Laden des KI API Keys:', error)
      throw new Error('Kein KI API Key hinterlegt. Bitte in den Einstellungen eintragen.')
    }
  }

  async function callClaude(systemPrompt, userPrompt) {
    const { apiKey, provider } = await fetchAiConfig()
    const pdfSnippet = pdfExtractedText
      ? slicePdfForVisiblePages(
          pdfExtractedText,
          currentStartPage,
          currentEndPage,
          pdfNumPages,
          TUTOR_KI_MAX_PDF_CHARS,
        )
      : '(PDF-Text nicht verfügbar.)'
    const subjectContext =
      TUTOR_ATTACH_SUBJECT_CONTEXT && subjectContextText
        ? clipTutorContext(subjectContextText, TUTOR_KI_MAX_SUBJECT_CONTEXT_CHARS, 'Fachkontext')
        : '(Kein zusätzlicher Fachkontext geladen.)'
    const subjectBlock =
      TUTOR_ATTACH_SUBJECT_CONTEXT && subjectContext && subjectContext !== '(Kein zusätzlicher Fachkontext geladen.)'
        ? '\n\n--- Fachkontext (alle Unterlagen, gekürzt) ---\n' + subjectContext
        : ''
    const payload = {
      model: CLAUDE_MODEL,
      max_tokens: TUTOR_CLAUDE_MAX_TOKENS_CHAT,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: userPrompt + '\n\n--- Aktuelle Datei (PDF-Inhalt) ---\n' + pdfSnippet + subjectBlock,
        }],
      }],
    }
    const response = await fetch(`${getApiBase()}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, provider, payload, userId: user.id }),
    })
    const responseText = await response.text()
    if (!response.ok) {
      let parsed
      try {
        parsed = JSON.parse(responseText)
      } catch (_) {
        parsed = null
      }
      throw new Error(resolveClaudeProxyFailureMessage({ responseText, parsed }))
    }
    let data
    try {
      data = JSON.parse(responseText)
    } catch (_) {
      throw new Error(MSG_API_WRONG_ENDPOINT)
    }
    if (isBackendInfoRootResponse(data)) {
      throw new Error(MSG_API_WRONG_ENDPOINT)
    }
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
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: err?.message || 'Aufgabe konnte nicht geladen werden.' }])
    } finally {
      setLoading(false)
    }
  }

  async function sendExerciseEvaluate(taskText, userAnswer) {
    setLoading(true)
    try {
      const { apiKey, provider } = await fetchAiConfig()
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
        max_tokens: TUTOR_CLAUDE_MAX_TOKENS_CHAT,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }
      const response = await fetch(`${getApiBase()}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, provider, payload, userId: user.id }),
      })
      const responseText = await response.text()
      if (!response.ok) throw new Error('Bewertung fehlgeschlagen.')
      let data
      try {
        data = JSON.parse(responseText)
      } catch (_) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (isBackendInfoRootResponse(data)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
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

  async function sendToClaude({ userMessage, mode, explainOverride, chatSnapshot } = {}) {
    if (mode === 'explain' && !canExplainWithContext) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Der Tutor hat noch keinen lesbaren Folienkontext. Bitte warte kurz oder nutze „Erneut laden“. ' +
            'Sobald PDF-Text oder Seitenkontext da ist, startet die Erklärung automatisch.',
        },
      ])
      return
    }
    setLoading(true)
    try {
      const { apiKey, provider } = await fetchAiConfig()

      const pStart = explainOverride?.startPage ?? currentStartPage
      const pEnd = explainOverride?.endPage ?? currentEndPage
      const pRound = explainOverride?.themeRoundInSection ?? themeRoundInSection
      const pageNumsForCtx = Array.from(
        { length: Math.max(1, pEnd - pStart + 1) },
        (_, i) => pStart + i,
      )
      const ctxForPrompt = pageNumsForCtx
        .map((pg) => pageContexts.find((x) => x.pageNumber === pg))
        .filter(Boolean)
        .map((row) => `Seite ${row.pageNumber}:\n${row.combinedSummary || row.textExcerpt || ''}`)
        .join('\n\n')

      const pdfMaxChars = mode === 'explain' ? TUTOR_KI_MAX_PDF_CHARS : TUTOR_KI_MAX_PDF_CHARS_FOLLOWUP
      const pdfBlock = pdfExtractedText
        ? slicePdfForVisiblePages(pdfExtractedText, pStart, pEnd, pdfNumPages, pdfMaxChars)
        : pdfTextLoading
          ? '(PDF-Text wird geladen …)'
          : '(PDF-Text konnte nicht geladen werden oder ist leer.)'

      const pageCtxMax =
        mode === 'explain' ? TUTOR_KI_MAX_PAGE_CONTEXT_CHARS : TUTOR_KI_MAX_PAGE_CONTEXT_CHARS_FOLLOWUP
      const pageBlock = ctxForPrompt
        ? clipTutorContext(ctxForPrompt, pageCtxMax, 'Seitenkontext')
        : pageContextLoading
          ? '(Seitenkontext wird aufgebaut …)'
          : '(Kein zusätzlicher Seitenkontext verfügbar.)'

      const subjectMaxChars =
        mode === 'explain' ? TUTOR_KI_MAX_SUBJECT_CONTEXT_CHARS : TUTOR_KI_MAX_SUBJECT_CONTEXT_CHARS_FOLLOWUP
      const subjectSection = TUTOR_ATTACH_SUBJECT_CONTEXT
        ? '\n\n--- Fachkontext (alle Unterlagen, gekürzt) ---\n' +
          (subjectContextText
            ? clipTutorContext(subjectContextText, subjectMaxChars, 'Fachkontext')
            : subjectContextLoading
              ? '(Fachkontext wird geladen …)'
              : '(Kein zusätzlicher Fachkontext geladen.)')
        : ''

      const metaHeader =
        `Fach: ${subject.name}\n` +
        `Kategorie: ${subject.group_label || 'ohne Kategorie'}\n` +
        `Datei: ${material.filename}\n` +
        `Startseite: ${pStart}\n` +
        `Endseite: ${pEnd}\n` +
        `Thema-Runde im aktuellen Abschnitt: ${pRound}\n` +
        `Wichtig: Beziehe dich nur auf diese Seiten (maximal ${MAX_PAGES_PER_EXPLANATION} Seiten).\n\n`

      const materialAnchor =
        metaHeader +
        '--- Inhalt der Vorlesung (extrahierter PDF-Text) ---\n' +
        pdfBlock +
        subjectSection +
        '\n\n--- Seitenkontext der sichtbaren Folien ---\n' +
        pageBlock

      let systemPrompt
      let maxTok
      let userText

      if (mode === 'explain') {
        systemPrompt = LECTURE_TUTOR_EXPLAIN_SYSTEM
        maxTok = TUTOR_CLAUDE_MAX_TOKENS_EXPLAIN
        userText =
          metaHeader +
          `Erkläre genau EIN nächstes Thema aus den Seiten ${pStart} bis ${pEnd} (maximal ${MAX_PAGES_PER_EXPLANATION} Seiten). ` +
          `Bei **Lernzielen / Modulüberblick / Organisatorischem**: nur knapper Fokus (siehe Systemregeln), **[[NO_VERSTAENDNISFRAGE]]** setzen, **keine** Verständnisfrage. ` +
          `Bei **fachexplikativen** Inhalten: danach genau **eine** offene Verständnisfrage. Weiter nur per Button „Nächstes Thema“.` +
          '\n\n--- Inhalt der Vorlesung (extrahierter PDF-Text) ---\n' +
          pdfBlock +
          subjectSection +
          '\n\n--- Seitenkontext der sichtbaren Folien ---\n' +
          pageBlock
      } else {
        systemPrompt = LECTURE_TUTOR_ANSWER_SYSTEM
        maxTok = TUTOR_CLAUDE_MAX_TOKENS_CHAT
        const chatForAnswer = chatSnapshot != null ? chatSnapshot : messages
        const transcript = buildTutorAnswerTranscript(chatForAnswer, TUTOR_ANSWER_CHAT_TRANSCRIPT_MAX_CHARS)
        userText =
          '--- Ankerkontext (Fach + PDF + Seiten) ---\n' +
          materialAnchor +
          '\n\n--- Bisheriger Chat (gekürzt, chronologisch) ---\n' +
          (transcript.trim() || '(Noch kein früherer Chat in dieser Ansicht.)') +
          '\n\n--- Aktuelle Nutzer-Nachricht ---\n' +
          (userMessage || '(keine zusätzliche Nachricht)')
      }

      const payload = {
        model: CLAUDE_MODEL,
        max_tokens: maxTok,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }],
          },
        ],
      }

      const response = await fetch(`${getApiBase()}/api/claude`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey, provider, payload, userId: user.id }),
      })

      const responseText = await response.text()

      if (!response.ok) {
        let errData = {}
        try {
          errData = JSON.parse(responseText)
        } catch (_) {
          errData = {}
        }
        console.error('[LectureTutor] Claude-API Fehler:', response.status, responseText)
        throw new Error(resolveClaudeProxyFailureMessage({ responseText, parsed: errData }))
      }

      let data
      try {
        data = JSON.parse(responseText)
      } catch (_) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (isBackendInfoRootResponse(data)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      const rawAssistant = data?.content?.[0]?.text || ''
      const infoOnlyNoQuestion =
        mode === 'explain' && /\[\[NO_VERSTAENDNISFRAGE\]\]/i.test(rawAssistant)

      let text = rawAssistant || 'Keine Antwort vom Tutor erhalten.'
      text = normalizeTutorTone(text)
      text = stripNextMarker(text)
      if (mode === 'explain') {
        // Interne Steuer-Markierung für "Nächstes Thema":
        // [[NEXT:same]] => im selben Abschnitt bleiben
        // [[NEXT:section]] => zum nächsten Abschnitt wechseln
        const nextMatch = rawAssistant.match(/\[\[NEXT:(same|section)\]\]/i)
        if (nextMatch?.[1]) {
          setNextThemeMode(nextMatch[1].toLowerCase() === 'section' ? 'section' : 'same')
        } else {
          // Konservativ: Ohne Marker nicht vorschnell weiterblättern.
          setNextThemeMode('same')
        }
        if (!infoOnlyNoQuestion) {
          text = ensureExplainQuestion(text, pStart, pEnd)
        }
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          startPage: pStart,
          endPage: pEnd,
          title: extractThemeTitle(text, `Thema ${explanationHistory.length + 1}`),
          text,
          createdAt: Date.now(),
        }
        setCurrentThemeId(entry.id)
        setExplanationHistory((prev) => {
          const next = [...prev, entry]
          setHistoryIndex(next.length - 1)
          return next
        })
        if (infoOnlyNoQuestion) {
          const themeKeyForThisExplain = `${pStart}-${pEnd}:${pRound}`
          setCompletedThemeKeys((prev) =>
            prev.includes(themeKeyForThisExplain) ? prev : [...prev, themeKeyForThisExplain],
          )
        }
      }

      setMessages((prev) => {
        const base = sanitizeTutorChatMessages(prev)
        return [
          ...base,
          ...(mode === 'answer' && userMessage
            ? [{ role: 'user', content: userMessage }]
            : []),
          { role: 'assistant', content: text },
        ]
      })
      if (mode === 'answer' && String(userMessage || '').trim() && !isExerciseMode) {
        setCompletedThemeKeys((prev) => (
          prev.includes(currentThemeKey) ? prev : [...prev, currentThemeKey]
        ))
      }
    } catch (err) {
      console.error('[LectureTutor] sendToClaude Fehler:', err)
      const connectionHint = formatTutorFetchConnectionError(err)
      const displayMessage =
        connectionHint ||
        err?.message ||
        'Es ist ein Fehler bei der Anfrage an die KI aufgetreten. Bitte prüfe deinen KI API Key in den Einstellungen.'
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

  function goToNextTheme(opts = {}) {
    /** `forceSection`: nächster Folienblock (topicIndex + N), unabhängig vom KI-[[NEXT:…]]-Marker. */
    const forceSection = opts?.forceSection === true
    const shouldAdvanceSection = forceSection || nextThemeMode === 'section'
    if (shouldAdvanceSection && pdfNumPages > 0 && currentEndPage >= pdfNumPages) {
      setIsCompleted(true)
      markTutorTasksCompleteIfNeeded()
      try {
        localStorage.setItem(`studiio_tutor_completed_${material.id}`, 'true')
      } catch (_) {}
      return
    }
    // Neues Thema = neue Chatseite (frischer Verlauf im Chatfenster).
    if (messages.length > 0) {
      setArchivedThemeChats((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length + 1}`,
          themeId: currentThemeId || explanationHistory[historyIndex]?.id || null,
          title: extractThemeTitle(
            explanationHistory[historyIndex]?.text || messages.find((m) => m.role === 'assistant')?.content || '',
            `Thema ${prev.length + 1}`,
          ),
          topicIndex,
          themeRoundInSection,
          startPage: currentStartPage,
          endPage: currentEndPage,
          messages: messages.filter((m) => m.role !== 'system'),
        },
      ])
    }
    setMessages([])
    setInput('')
    setCurrentTaskText(null)
    setChatWindowVersion((v) => v + 1)
    const topicAfter = topicIndex + (shouldAdvanceSection ? MAX_PAGES_PER_EXPLANATION : 0)
    const nextPromptStart = Math.max(1, Math.min(topicAfter, pdfNumPages || topicAfter))
    const nextPromptEnd = Math.min(
      nextPromptStart + MAX_PAGES_PER_EXPLANATION - 1,
      pdfNumPages || nextPromptStart + MAX_PAGES_PER_EXPLANATION - 1,
    )
    const nextPromptRound = shouldAdvanceSection ? 1 : themeRoundInSection + 1

    if (shouldAdvanceSection) {
      setTopicIndex((idx) => idx + MAX_PAGES_PER_EXPLANATION)
      setThemeRoundInSection(1)
      setNextThemeMode('same')
    } else {
      setThemeRoundInSection((n) => n + 1)
    }
    sendToClaude({
      userMessage: '',
      mode: 'explain',
      explainOverride: {
        startPage: nextPromptStart,
        endPage: nextPromptEnd,
        themeRoundInSection: nextPromptRound,
      },
    })
  }

  function handleNextTheme() {
    // Ohne Antwort auf die Verständnisfrage: trotzdem weiter (kein Zwangs-Dialog).
    if (!isExerciseMode && !isCurrentThemeAnswered) {
      setCompletedThemeKeys((prev) =>
        prev.includes(currentThemeKey) ? prev : [...prev, currentThemeKey],
      )
    }
    // Button „Nächstes Thema“: immer nächster Folienblock — sonst nur neue „Runde“ bei
    // [[NEXT:same]] auf denselben Seiten (wirkt wie Endlosschleife auf einer Folie).
    goToNextTheme({ forceSection: true })
  }

  function handleOpenArchivedTheme(chat) {
    if (!chat) return
    setMessages(sanitizeTutorChatMessages(chat.messages || []))
    if (typeof chat.topicIndex === 'number') setTopicIndex(chat.topicIndex)
    if (typeof chat.themeRoundInSection === 'number') setThemeRoundInSection(chat.themeRoundInSection)
    if (chat.themeId) {
      const idx = explanationHistory.findIndex((e) => e?.id === chat.themeId)
      if (idx >= 0) setHistoryIndex(idx)
      setCurrentThemeId(chat.themeId)
    }
    setCurrentTaskText(null)
    setInput('')
    setChatWindowVersion((v) => v + 1)
  }

  function handleHistoryNavigate(delta) {
    const nextIndex = Math.max(0, Math.min(explanationHistory.length - 1, historyIndex + delta))
    if (nextIndex === historyIndex) return
    setHistoryIndex(nextIndex)
    const nextEntry = explanationHistory[nextIndex]
    const targetArchivedChat = archivedThemeChats.find((chat) => chat.themeId && chat.themeId === nextEntry?.id)
    if (targetArchivedChat) {
      handleOpenArchivedTheme(targetArchivedChat)
      return
    }
    const entry = nextEntry
    if (!entry) return
    setCurrentThemeId(entry.id || null)
    setTopicIndex(entry.startPage)
    setMessages([{ role: 'assistant', content: entry.text }])
    setCurrentTaskText(null)
    setInput('')
    setChatWindowVersion((v) => v + 1)
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
      sendToClaude({ userMessage: text, mode: 'answer', chatSnapshot: messages })
    }
  }

  function handleNextExercise() {
    setTopicIndex((idx) => idx + 1)
    setCurrentTaskText(null)
    fetchExerciseTask(topicIndex + 1)
  }

  function handleFinishTutor() {
    setIsCompleted(true)
    markTutorTasksCompleteIfNeeded()
    try {
      localStorage.setItem(`studiio_tutor_completed_${material.id}`, 'true')
    } catch (_) {}
  }

  // Erst starten, wenn der Tutor den PDF-Inhalt lesen kann (extrahierter Text da)
  useEffect(() => {
    const hasExistingState =
      messages.length > 0 ||
      explanationHistory.length > 0 ||
      !!currentTaskText ||
      topicIndex > 1 ||
      initialRequestDone
    if (
      progressHydrated &&
      !started &&
      !initialRequestDone &&
      !hasExistingState &&
      pdfFile &&
      !pdfError &&
      !pdfTextLoading &&
      canExplainWithContext &&
      messages.length === 0
    ) {
      setStarted(true)
      setInitialRequestDone(true)
      setBootstrapping(true)
      if (isExerciseMode) fetchExerciseTask(1)
      else sendToClaude({ userMessage: '', mode: 'explain' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfFile, pdfError, pdfTextLoading, canExplainWithContext, started, initialRequestDone, messages.length, isExerciseMode, progressHydrated, explanationHistory.length, currentTaskText, topicIndex])

  // Recovery: Falls ein gespeicherter Zustand "angefangen" sagt, aber keine sichtbare Aufgabe/Erklärung existiert,
  // einmalig den aktuellen Schritt nachladen, damit der Tutor nicht leer hängen bleibt.
  useEffect(() => {
    const hasNoVisibleTutorContent =
      messages.length === 0 &&
      explanationHistory.length === 0 &&
      !currentTaskText
    if (
      progressHydrated &&
      (started || initialRequestDone) &&
      hasNoVisibleTutorContent &&
      !loading &&
      !pdfTextLoading &&
      canExplainWithContext &&
      !bootstrapping
    ) {
      setBootstrapping(true)
      if (isExerciseMode) fetchExerciseTask(Math.max(1, topicIndex))
      else sendToClaude({ userMessage: '', mode: 'explain' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    progressHydrated,
    started,
    initialRequestDone,
    messages.length,
    explanationHistory.length,
    currentTaskText,
    loading,
    pdfTextLoading,
    canExplainWithContext,
    isExerciseMode,
    topicIndex,
    bootstrapping,
  ])

  useEffect(() => {
    if (!loading) setBootstrapping(false)
  }, [loading])

  useEffect(() => {
    setCompletedThemeKeys([])
  }, [material?.id])

  /** Weiteste im Tutor erreichte PDF-Seite (aktuelle Ansicht + bisherige Themenblöcke in dieser Session). */
  const furthestWorkedEndPage =
    pdfNumPages > 0
      ? Math.min(
          pdfNumPages,
          Math.max(
            currentEndPage,
            currentStartPage,
            ...explanationHistory.map((e) => Number(e?.endPage) || 0),
          ),
        )
      : 0
  const progressPercent =
    isCompleted ? 100 : pdfNumPages > 0
      ? Math.min(100, Math.round((furthestWorkedEndPage / pdfNumPages) * 100))
      : null
  const isLastTopic = pdfNumPages > 0 && currentEndPage >= pdfNumPages

  const pdfBaseWidth = 470
  const pdfWidth = Math.round(pdfBaseWidth * pdfZoom)

  if (isCompleted) {
    const fileLabel =
      material?.filename?.trim() ||
      (isExerciseMode ? 'Übung/Tutorium' : 'Vorlesung')
    return (
      <CompletionCelebration
        open
        taskLabel={fileLabel}
        subjectName={subject?.name || ''}
        continueLabel="Zurück zum Fach"
        onContinue={onBack}
        onClose={onBack}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-studiio-cream overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 px-4 md:px-6 py-2">
      {/* Oben: Zurück + Fortschritt (kompakt) */}
      <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 py-3">
        <button
          type="button"
          onClick={async () => {
            if (!confirmFocusLeaveIfNeeded({ tutorLessonIncomplete: !isCompleted })) return
            dispatchPomodoroPauseForLeave()
            const totalSec = (Date.now() - sessionStartRef.current) / 1000
            const remainder = Math.max(0, Math.round(totalSec) - savedSecondsRef.current)
            if (remainder >= 1 && user?.id && subject?.id) await addLearningTime(user.id, subject.id, remainder)
            onBack()
          }}
          className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline font-medium"
        >
          <span className="inline-block rotate-180 text-base">➜</span>
          Zurück zum Fach
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-studiio-ink truncate">
            {isExerciseMode
              ? `Folie ${currentStartPage}${pdfNumPages > 0 ? ` von ${pdfNumPages}` : ''}`
              : `Folien ${currentStartPage}-${currentEndPage}${pdfNumPages > 0 ? ` von ${pdfNumPages}` : ''}`}
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

      <div className="flex-shrink-0 pb-1">
        <MiniFocusHint />
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
              {isExerciseMode
                ? `Aufgabe ${topicIndex} · Folie ${currentStartPage}`
                : `Folien ${currentStartPage}-${currentEndPage}${pdfNumPages > 0 ? ` von ${pdfNumPages}` : ''}`}
            </span>
          </header>
          <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto bg-studiio-sky/30 p-0">
            {pdfError ? (
              <div className="px-4 py-3 text-sm text-red-700 rounded-lg bg-red-50 border border-red-200 space-y-2">
                <p className="font-semibold">PDF konnte nicht geladen werden.</p>
                <p>{pdfError}</p>
                <p className="text-xs">
                  Prüfe im Supabase Dashboard unter <strong>Storage → Bucket „materials“ → Policies</strong>.
                </p>
                {pdfErrorDetails && (
                  <div className="pt-2 border-t border-red-200">
                    <p className="text-xs font-semibold text-red-800 mb-1">Technische Details (zum Kopieren)</p>
                    <pre className="text-[11px] leading-snug text-red-900/90 whitespace-pre-wrap break-words max-h-48 overflow-auto rounded bg-white/80 border border-red-100 p-2 font-mono">
                      {pdfErrorDetails}
                    </pre>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText?.(pdfErrorDetails).catch(() => {})
                      }}
                      className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
                    >
                      Details kopieren
                    </button>
                  </div>
                )}
                {pdfTabUrl && (
                  <p className="text-xs pt-1">
                    <a
                      href={pdfTabUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-studiio-accent font-medium hover:underline"
                    >
                      PDF trotzdem im neuen Tab versuchen
                    </a>
                  </p>
                )}
              </div>
            ) : pdfFile ? (
              <div className="w-full h-full overflow-auto flex flex-col items-center justify-start gap-3 p-2">
                <Document
                  key={`${material.id}-${material.storage_path}`}
                  file={pdfFile}
                  loading={<p className="text-sm text-studiio-muted py-6">PDF wird gerendert …</p>}
                  error="PDF-Vorschau: Laden fehlgeschlagen. Nutze den Link unten („PDF im neuen Tab öffnen“) oder lade die Seite neu."
                  onLoadSuccess={({ numPages: docPages }) => {
                    if (typeof docPages === 'number' && docPages > 0) {
                      setPdfNumPages((prev) => Math.max(prev || 0, docPages))
                    }
                  }}
                  onLoadError={(err) => {
                    console.error('[LectureTutor] react-pdf Document:', err)
                    setPdfErrorDetails(buildPdfPreviewDebugDetails('PDF-Dokument (react-pdf / pdf.js)', err))
                    setPdfError(
                      'Die PDF-Vorschau konnte nicht geladen werden. Du kannst die Datei unten im System-PDF öffnen.',
                    )
                  }}
                  className="flex flex-col items-center gap-3"
                >
                  {pagesToDisplay.map((page) => (
                    <Page
                      key={`${material.id}-p${page}-${pdfZoom}`}
                      pageNumber={page}
                      width={pdfWidth}
                      className="border border-studiio-lavender/40 bg-white shadow-sm"
                      loading={<p className="text-xs text-studiio-muted py-4">Folie wird gerendert …</p>}
                      error="Diese Folie konnte in der Vorschau nicht geladen werden. PDF im neuen Tab öffnen oder Seite neu laden."
                      onLoadError={(err) => {
                        console.error('[LectureTutor] react-pdf Page:', page, err)
                        setPdfErrorDetails(
                          buildPdfPreviewDebugDetails('PDF-Seite (react-pdf / pdf.js)', err, {
                            pageNumber: page,
                          }),
                        )
                        setPdfError(
                          'Eine Folie in der Vorschau konnte nicht geladen werden. Versuche „PDF im neuen Tab öffnen“ oder Seite neu laden.',
                        )
                      }}
                      renderAnnotationLayer
                      renderTextLayer
                    />
                  ))}
                </Document>
                <p className="text-xs text-studiio-muted">
                  <a
                    href={pdfTabUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-studiio-accent hover:underline"
                  >
                    PDF im neuen Tab öffnen
                  </a>
                </p>
              </div>
            ) : (
              <p className="text-sm text-studiio-muted">PDF wird geladen …</p>
            )}
          </div>
          {/* Zoom + Buttons */}
          <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-studiio-lavender/40 bg-white/90">
            <div className="flex items-center gap-2 flex-wrap max-w-full">
              <span className="text-xs text-studiio-muted mr-1">Zoom:</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.05"
                value={pdfZoom}
                onChange={(e) => setPdfZoom(Number(e.target.value))}
                className="w-32 sm:w-48 accent-studiio-accent"
                aria-label="PDF Zoom"
              />
              <span className="text-xs font-medium text-studiio-ink tabular-nums min-w-[52px] text-right">
                {Math.round(pdfZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setPdfZoom(1)}
                className="rounded px-2 py-1 text-xs font-medium transition bg-studiio-lavender/30 text-studiio-ink hover:bg-studiio-lavender/50"
              >
                Reset
              </button>
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
                <span className="text-xs text-studiio-muted">
                  Nächstes Thema wechselst du unten im Chat.
                </span>
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
              Rückfragen, Beispiele, Zusammenfassungen zu den Folien. Zu denselben Folien kann es mehrere Themen geben
              — dann liegt das vorherige Gespräch oben unter <span className="font-medium">Archiv</span>, das aktuelle unten.
            </p>
            {pageContextAiBanner && (
              <div
                className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-studiio-ink leading-snug"
                role="status"
              >
                <span className="font-semibold text-amber-900">Seitenkontext: </span>
                {pageContextAiBanner}
                {' '}
                <span className="text-studiio-muted">
                  Der Tutor nutzt weiterhin den vollen PDF-Text, falls dieser geladen ist.
                </span>
              </div>
            )}
            {explanationHistory.length > 0 && (
              <div className="mt-2 rounded-lg bg-studiio-lavender/20 border border-studiio-lavender/50 p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-studiio-ink">Erklärverlauf</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleHistoryNavigate(-1)}
                      disabled={historyIndex <= 0}
                      className="rounded px-2 py-0.5 bg-white border border-studiio-lavender/60 disabled:opacity-50"
                    >
                      ←
                    </button>
                    <span className="text-studiio-muted">
                      {Math.max(1, historyIndex + 1)} / {explanationHistory.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleHistoryNavigate(1)}
                      disabled={historyIndex >= explanationHistory.length - 1}
                      className="rounded px-2 py-0.5 bg-white border border-studiio-lavender/60 disabled:opacity-50"
                    >
                      →
                    </button>
                  </div>
                </div>
                {historyIndex >= 0 && explanationHistory[historyIndex] && (
                  <p className="mt-1 text-studiio-muted line-clamp-1">
                    {explanationHistory[historyIndex].title || `Folien ${explanationHistory[historyIndex].startPage}-${explanationHistory[historyIndex].endPage}`}
                  </p>
                )}
              </div>
            )}
          </header>
          <div key={chatWindowVersion} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
            {archivedThemeChats.map((chat) => (
              <div key={chat.id} className="rounded-xl border border-studiio-lavender/50 bg-studiio-lavender/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-studiio-muted">
                    Archiv · {chat.title} · Folien {chat.startPage}-{chat.endPage}
                    {typeof chat.themeRoundInSection === 'number' && chat.themeRoundInSection > 0
                      ? ` · Runde ${chat.themeRoundInSection}`
                      : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleOpenArchivedTheme(chat)}
                    className="rounded border border-studiio-lavender/60 px-2 py-1 text-[11px] font-medium text-studiio-ink hover:bg-white"
                  >
                    Öffnen
                  </button>
                </div>
                <div className="space-y-2 max-h-40 overflow-auto pr-1">
                  {chat.messages.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                      {m.role === 'user' ? (
                        <div className="inline-block max-w-[85%] rounded-2xl bg-studiio-accent text-white px-3 py-2 text-sm">
                          {m.content}
                        </div>
                      ) : (
                        (() => {
                          const { mainText, questionText } = splitTutorQuestion(m.content)
                          return (
                            <div className="inline-block max-w-[85%] space-y-2">
                              {!!mainText && (
                                <div className="rounded-2xl bg-white text-studiio-ink px-3 py-2 text-sm leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-headings:my-1 prose-headings:text-base prose-headings:font-semibold prose-h1:text-base prose-h2:text-base prose-h3:text-base prose-h4:text-base">
                                  <ReactMarkdown>{mainText}</ReactMarkdown>
                                </div>
                              )}
                              {!!questionText && (
                                <div className="rounded-xl border border-studiio-accent/50 bg-studiio-accent/10 px-3 py-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-studiio-accent mb-1">
                                    Verständnisfrage
                                  </p>
                                  <p className="text-sm font-medium text-studiio-ink">{questionText}</p>
                                </div>
                              )}
                            </div>
                          )
                        })()
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div ref={currentThemeRef} className="rounded-xl border border-studiio-lavender/50 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-studiio-muted">
                  Aktuelles Thema · Folien {currentStartPage}-{currentEndPage} · Runde {themeRoundInSection}
                </p>
                {archivedThemeChats.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleOpenArchivedTheme(archivedThemeChats[archivedThemeChats.length - 1])}
                    className="rounded border border-studiio-lavender/60 px-2 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-lavender/20"
                  >
                    Vorheriges Thema
                  </button>
                )}
              </div>
            {messages
              .filter((m) => m.role !== 'system')
              .map((m, index, arr) => (
                <div
                  key={index}
                  ref={index === arr.length - 1 ? latestMessageRef : null}
                  className={m.role === 'user' ? 'text-right' : 'text-left'}
                >
                  {m.role === 'user' ? (
                    <div className="inline-block max-w-[85%] rounded-2xl bg-studiio-accent text-white px-4 py-3 text-base">
                      {m.content}
                    </div>
                  ) : (
                    (() => {
                      const { mainText, questionText } = splitTutorQuestion(m.content)
                      return (
                        <div className="inline-block max-w-[85%] space-y-2">
                          {!!mainText && (
                            <div className="rounded-2xl bg-studiio-sky/40 text-studiio-ink px-4 py-3 text-[17px] leading-relaxed prose prose-base max-w-none prose-headings:my-1 prose-headings:text-studiio-ink prose-headings:text-[18px] prose-headings:font-semibold prose-h1:text-[18px] prose-h2:text-[18px] prose-h3:text-[18px] prose-h4:text-[18px] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:font-semibold prose-strong:text-studiio-ink">
                              <ReactMarkdown>{mainText}</ReactMarkdown>
                            </div>
                          )}
                          {!!questionText && (
                            <div className="rounded-xl border border-studiio-accent/60 bg-studiio-accent/15 px-4 py-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-studiio-accent mb-1">
                                Verständnisfrage
                              </p>
                              <p className="text-base font-semibold text-studiio-ink">{questionText}</p>
                            </div>
                          )}
                        </div>
                      )
                    })()
                  )}
                </div>
              ))}
            {loading && (
              <p className="text-sm text-studiio-muted">Tutor schreibt …</p>
            )}
            </div>
          </div>
          <form
            onSubmit={handleSubmitChat}
            className="flex-shrink-0 border-t border-studiio-lavender/40 px-4 py-3 flex gap-2 items-center bg-white/95"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (!loading && input.trim()) handleSubmitChat(e)
                }
              }}
              placeholder={isExerciseMode ? 'Deine Lösung oder Antwort eingeben …' : 'Deine Frage oder Bitte an den Tutor …'}
              className="studiio-input flex-1 text-base py-2.5 min-h-[90px] resize-y"
            />
            {!isExerciseMode && (
              <button
                type="button"
                onClick={handleNextTheme}
                disabled={loading || pdfTextLoading || !pdfExtractedText}
                className="rounded-lg border-2 border-studiio-accent/70 bg-white px-4 py-2.5 text-base font-semibold text-studiio-accent hover:bg-studiio-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!pdfExtractedText && !pdfTextLoading ? 'Zuerst PDF-Text laden' : undefined}
              >
                {loading ? '…' : pdfTextLoading ? 'Laden …' : (isLastTopic ? 'Lektion abschließen' : 'Nächstes Thema')}
              </button>
            )}
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

