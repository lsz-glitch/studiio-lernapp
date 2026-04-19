import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { deleteTask } from '../utils/learningPlan'

function toLocalDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDay(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`)
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function toDateKeyFromIso(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return toLocalDateKey(d)
}

/** Nur wirklich abgeschlossene Plan-Aufgaben (für grüne Hervorhebung). */
function isLearningPlanTaskComplete(task) {
  const c = task?.completed_at
  if (c == null) return false
  if (typeof c === 'string' && !c.trim()) return false
  return true
}

/** Offene Aufgaben von vergangenen Tagen unter „heute“ bündeln, damit sie nicht verschwinden. */
function enrichGroupedByDayWithOverdue(grouped, todayKey) {
  if (!grouped || !todayKey) return grouped || {}
  const overdue = []
  for (const [key, list] of Object.entries(grouped)) {
    if (key >= todayKey) continue
    for (const t of list || []) {
      if (!isLearningPlanTaskComplete(t)) overdue.push(t)
    }
  }
  if (!overdue.length) return grouped
  overdue.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
  const combined = [...overdue, ...(grouped[todayKey] || [])]
  combined.sort((a, b) => {
    const aDone = isLearningPlanTaskComplete(a)
    const bDone = isLearningPlanTaskComplete(b)
    if (aDone !== bDone) return aDone ? 1 : -1
    return new Date(a.scheduled_at) - new Date(b.scheduled_at)
  })
  return { ...grouped, [todayKey]: combined }
}

function canCreateVocabForMaterial(material) {
  const filename = String(material?.filename || '').toLowerCase()
  const storagePath = String(material?.storage_path || '').toLowerCase()
  const looksLikePdf = filename.endsWith('.pdf') || storagePath.endsWith('.pdf')
  if (!looksLikePdf) return false
  // Probeklausuren werden nicht als Vokabel-Quelle angeboten.
  if (String(material?.category || '') === 'Probeklausur') return false
  return true
}

function buildPlanningDays(subject) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out = []
  const end = subject?.exam_date ? new Date(`${subject.exam_date}T00:00:00`) : null
  if (!end || Number.isNaN(end.getTime()) || end < today) {
    for (let i = 0; i < 30; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      out.push(toLocalDateKey(d))
    }
    return out
  }
  const cursor = new Date(today)
  while (cursor <= end) {
    out.push(toLocalDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/** Alle Tage anzeigen, an denen mindestens eine Aufgabe liegt (zusätzlich zur Basis-Zeitleiste). */
function mergePlanningDaysWithTaskDates(baseDays, taskRows) {
  const set = new Set(baseDays || [])
  for (const task of taskRows || []) {
    const k = toDateKeyFromIso(task?.scheduled_at)
    if (k) set.add(k)
  }
  return [...set].sort()
}

function isMissingDescriptionColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('description') && msg.includes('column'))
}

function isMissingExternalUrlColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('external_url') && msg.includes('column'))
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('de-DE')
}

/** Dateinamen kommen manchmal HTML-escaped aus Metadaten — für die Anzeige decodieren. */
function decodeHtmlEntities(text) {
  if (text == null || text === '') return ''
  const s = String(text)
  if (typeof document === 'undefined') {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
  }
  const ta = document.createElement('textarea')
  ta.innerHTML = s
  return ta.value
}

/** Lange Titel zweizeilig mit festem Label, Dateiname mit hartem Umbruch (lange PDF-Namen). */
function splitCatalogTitle(title) {
  const raw = decodeHtmlEntities(title || '')
  if (/^Tutor:\s*/i.test(raw)) {
    return { label: 'Tutor', body: raw.replace(/^Tutor:\s*/i, '').trim() }
  }
  if (/^Vokabeln erstellen:\s*/i.test(raw)) {
    return { label: 'Vokabeln erstellen', body: raw.replace(/^Vokabeln erstellen:\s*/i, '').trim() }
  }
  return { label: null, body: raw }
}

function renderPlanTaskTitle(title) {
  const parts = splitCatalogTitle(title)
  if (parts.label) {
    return (
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">{parts.label}</p>
        <p className="break-all text-xs font-medium leading-snug text-studiio-ink">{parts.body}</p>
      </div>
    )
  }
  return <p className="min-w-0 flex-1 break-words text-xs font-medium text-studiio-ink">{parts.body}</p>
}

/** Gleiche Kategorien wie beim Material-Upload — Tutor- und Vokabeln-Katalog gruppiert danach. */
const TUTOR_MATERIAL_CATEGORY_ORDER = ['Vorlesung', 'Übung', 'Tutorium', 'Probeklausur', 'Zusatzmaterialien']

function groupKeyFromMaterialCategoryValue(category) {
  const cat = String(category || '').trim()
  if (!cat) return 'Ohne Kategorie'
  if (TUTOR_MATERIAL_CATEGORY_ORDER.includes(cat)) return cat
  return `other:${cat}`
}

/** Standard-Reihenfolge aus Bucket (ohne Sonder-Schlüssel wie __pending__). */
function orderedMaterialCategoryGroups(bucket) {
  const out = []
  for (const name of TUTOR_MATERIAL_CATEGORY_ORDER) {
    const arr = bucket.get(name)
    if (arr?.length) out.push({ key: name, label: name, items: arr })
  }
  const otherKeys = [...bucket.keys()].filter((k) => String(k).startsWith('other:')).sort()
  for (const k of otherKeys) {
    const arr = bucket.get(k)
    if (arr?.length) out.push({ key: k, label: String(k).replace(/^other:/, ''), items: arr })
  }
  const ohne = bucket.get('Ohne Kategorie')
  if (ohne?.length) out.push({ key: 'ohne', label: 'Ohne Kategorie', items: ohne })
  return out
}

export default function SubjectPlanMode({
  user,
  subject,
  onBack,
  showHeader = true,
  showCatalog = true,
  interactive = true,
  onTaskClick,
  allowSubjectSelection = false,
  onActiveSubjectChange,
  /** Wenn true: Höhe kommt vom Eltern-Container (z. B. Modal) statt Viewport-Rechnung. */
  fillParent = false,
  /** Erhöhen, wenn der Elternteil z. B. Vokabeln erstellt hat — Plan-Tasks neu aus DB laden. */
  tasksReloadKey = 0,
}) {
  const [tasks, setTasks] = useState([])
  const [allTasks, setAllTasks] = useState([])
  const [allTasksLoading, setAllTasksLoading] = useState(false)
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [availableSubjects, setAvailableSubjects] = useState([])
  const [activeSubjectId, setActiveSubjectId] = useState(subject?.id || '')
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [pendingTutorItems, setPendingTutorItems] = useState([])
  const [pendingManualItems, setPendingManualItems] = useState([])
  const [newTutorName, setNewTutorName] = useState('')
  const [newManualName, setNewManualName] = useState('')
  const [expandedSections, setExpandedSections] = useState({
    tutor: true,
    vocab: true,
    exam: false,
    manual: true,
  })
  const [commentDrafts, setCommentDrafts] = useState({})
  const [savingCommentId, setSavingCommentId] = useState('')
  const [activeTaskId, setActiveTaskId] = useState('')
  const [planModeError, setPlanModeError] = useState('')
  const activeSubject = useMemo(
    () => availableSubjects.find((s) => s.id === activeSubjectId) || subject,
    [availableSubjects, activeSubjectId, subject],
  )
  const planningDays = useMemo(() => {
    const todayKey = toLocalDateKey(new Date())
    const base = buildPlanningDays(activeSubject)
    const fromSubjectTasks = mergePlanningDaysWithTaskDates(base, tasks)
    const merged = !showAllTasks
      ? fromSubjectTasks
      : mergePlanningDaysWithTaskDates(fromSubjectTasks, allTasks)
    return merged.filter((k) => k >= todayKey)
  }, [activeSubject?.exam_date, tasks, showAllTasks, allTasks])

  const pendingTutorStorageKey = `studiio_subject_plan_pending_tutor_${user?.id || 'nouser'}_${activeSubjectId || 'nosubject'}`
  const pendingManualStorageKey = `studiio_subject_plan_pending_manual_${user?.id || 'nouser'}_${activeSubjectId || 'nosubject'}`

  useEffect(() => {
    setActiveSubjectId(subject?.id || '')
  }, [subject?.id])

  useEffect(() => {
    if (!onActiveSubjectChange || !activeSubjectId) return
    if (allowSubjectSelection) {
      const selected = availableSubjects.find((s) => s.id === activeSubjectId)
      if (selected) onActiveSubjectChange(selected)
      return
    }
    if (subject?.id === activeSubjectId) onActiveSubjectChange(subject)
  }, [onActiveSubjectChange, activeSubjectId, allowSubjectSelection, availableSubjects, subject])

  useEffect(() => {
    if (!user?.id || !allowSubjectSelection) return
    let mounted = true
    supabase
      .from('subjects')
      .select('id, name, exam_date')
      .eq('user_id', user.id)
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          console.error('Fachliste für Fachplan laden fehlgeschlagen:', error)
          setAvailableSubjects([])
          return
        }
        setAvailableSubjects(data || [])
      })
    return () => { mounted = false }
  }, [user?.id, allowSubjectSelection])

  useEffect(() => {
    if (!user?.id || !activeSubjectId) return
    let mounted = true
    setLoading(true)
    supabase
      .from('learning_plan_tasks')
      .select('id, type, title, description, scheduled_at, completed_at, material_id, external_url')
      .eq('user_id', user.id)
      .eq('subject_id', activeSubjectId)
      .order('scheduled_at', { ascending: true })
      .then(async ({ data, error }) => {
        if (error && isMissingExternalUrlColumn(error)) {
          const retry = await supabase
            .from('learning_plan_tasks')
            .select('id, type, title, description, scheduled_at, completed_at, material_id')
            .eq('user_id', user.id)
            .eq('subject_id', activeSubjectId)
            .order('scheduled_at', { ascending: true })
          if (!mounted) return
          if (retry.error) {
            console.error('Plan-Modus laden fehlgeschlagen:', retry.error)
            setTasks([])
            setLoading(false)
            return
          }
          setTasks((retry.data || []).map((t) => ({ ...t, external_url: null })))
          setLoading(false)
          return
        }
        if (error && isMissingDescriptionColumn(error)) {
          const retry = await supabase
            .from('learning_plan_tasks')
            .select('id, type, title, scheduled_at, completed_at, material_id')
            .eq('user_id', user.id)
            .eq('subject_id', activeSubjectId)
            .order('scheduled_at', { ascending: true })
          if (!mounted) return
          if (retry.error) {
            console.error('Plan-Modus laden fehlgeschlagen:', retry.error)
            setTasks([])
          } else {
            setTasks((retry.data || []).map((t) => ({ ...t, description: null })))
          }
          setLoading(false)
          return
        }
        if (!mounted) return
        if (error) {
          console.error('Plan-Modus laden fehlgeschlagen:', error)
          setTasks([])
        } else {
          setTasks(data || [])
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, activeSubjectId, tasksReloadKey])

  useEffect(() => {
    if (!user?.id || !activeSubjectId) return
    try {
      const rawTutor = window.localStorage.getItem(pendingTutorStorageKey)
      const rawManual = window.localStorage.getItem(pendingManualStorageKey)
      const tutorParsed = rawTutor ? JSON.parse(rawTutor) : []
      const manualParsed = rawManual ? JSON.parse(rawManual) : []
      setPendingTutorItems(Array.isArray(tutorParsed) ? tutorParsed : [])
      setPendingManualItems(Array.isArray(manualParsed) ? manualParsed : [])
    } catch (_) {
      setPendingTutorItems([])
      setPendingManualItems([])
    }
  }, [pendingTutorStorageKey, pendingManualStorageKey, user?.id, activeSubjectId])

  useEffect(() => {
    if (!user?.id || !activeSubjectId) return
    try {
      window.localStorage.setItem(pendingTutorStorageKey, JSON.stringify(pendingTutorItems))
    } catch (_) {}
  }, [pendingTutorItems, pendingTutorStorageKey, user?.id, activeSubjectId])

  useEffect(() => {
    if (!user?.id || !activeSubjectId) return
    try {
      window.localStorage.setItem(pendingManualStorageKey, JSON.stringify(pendingManualItems))
    } catch (_) {}
  }, [pendingManualItems, pendingManualStorageKey, user?.id, activeSubjectId])

  useEffect(() => {
    if (!user?.id || !activeSubjectId) return
    let mounted = true
    supabase
      .from('materials')
      .select('id, filename, category, storage_path')
      .eq('user_id', user.id)
      .eq('subject_id', activeSubjectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          console.error('Plan-Modus: Materialien laden fehlgeschlagen:', error)
          setMaterials([])
        } else {
          setMaterials(data || [])
        }
      })
    return () => { mounted = false }
  }, [user?.id, activeSubjectId])

  useEffect(() => {
    if (!user?.id || !showAllTasks) return
    let mounted = true
    setAllTasksLoading(true)
    supabase
      .from('learning_plan_tasks')
      .select('id, type, title, scheduled_at, completed_at, subject_id, external_url')
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: true })
      .then(async ({ data, error }) => {
        if (!mounted) return
        if (error && isMissingExternalUrlColumn(error)) {
          const retry = await supabase
            .from('learning_plan_tasks')
            .select('id, type, title, scheduled_at, completed_at, subject_id')
            .eq('user_id', user.id)
            .order('scheduled_at', { ascending: true })
          if (!mounted) return
          if (retry.error) {
            console.error('Alle Tasks laden fehlgeschlagen:', retry.error)
            setAllTasks([])
          } else {
            setAllTasks((retry.data || []).map((t) => ({ ...t, external_url: null })))
          }
          setAllTasksLoading(false)
          return
        }
        if (error) {
          console.error('Alle Tasks laden fehlgeschlagen:', error)
          setAllTasks([])
        } else {
          setAllTasks(data || [])
        }
        setAllTasksLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, showAllTasks])

  const tasksByDay = useMemo(() => {
    const grouped = {}
    for (const task of tasks) {
      const key = toLocalDateKey(new Date(task.scheduled_at))
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(task)
    }
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => {
        const aDone = isLearningPlanTaskComplete(a)
        const bDone = isLearningPlanTaskComplete(b)
        if (aDone !== bDone) return aDone ? 1 : -1
        return new Date(a.scheduled_at) - new Date(b.scheduled_at)
      })
    })
    return grouped
  }, [tasks])

  const allTasksByDay = useMemo(() => {
    const grouped = {}
    for (const task of allTasks) {
      const key = toDateKeyFromIso(task.scheduled_at)
      if (!key) continue
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(task)
    }
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    })
    return grouped
  }, [allTasks])

  const tasksByDayDisplay = useMemo(() => {
    const todayKey = toLocalDateKey(new Date())
    return enrichGroupedByDayWithOverdue(tasksByDay, todayKey)
  }, [tasksByDay])

  const allTasksByDayDisplay = useMemo(() => {
    const todayKey = toLocalDateKey(new Date())
    return enrichGroupedByDayWithOverdue(allTasksByDay, todayKey)
  }, [allTasksByDay])

  async function createTaskOnDay({ type, title, description, materialId }, dateKey) {
    setPlanModeError('')
    const scheduledAt = new Date(`${dateKey}T09:00:00`).toISOString()
    let insertPayload = {
      user_id: user.id,
      subject_id: activeSubjectId,
      material_id: materialId || null,
      type,
      title,
      description,
      external_url: null,
      scheduled_at: scheduledAt,
    }
    let selectLine =
      'id, type, title, description, external_url, scheduled_at, completed_at, material_id'

    async function tryInsert(payload, sel) {
      return supabase.from('learning_plan_tasks').insert(payload).select(sel).single()
    }

    let { data, error } = await tryInsert(insertPayload, selectLine)
    if (error && isMissingExternalUrlColumn(error)) {
      const { external_url: _e, ...noExt } = insertPayload
      insertPayload = noExt
      selectLine = 'id, type, title, description, scheduled_at, completed_at, material_id'
      ;({ data, error } = await tryInsert(insertPayload, selectLine))
      if (data) data = { ...data, external_url: null }
    }
    if (error && isMissingDescriptionColumn(error)) {
      const { description: _d, ...noDesc } = insertPayload
      insertPayload = noDesc
      selectLine = 'id, type, title, scheduled_at, completed_at, material_id'
      ;({ data, error } = await tryInsert(insertPayload, selectLine))
      if (data) data = { ...data, description: description ?? null, external_url: null }
    }
    if (error) {
      console.error('Plan-Modus: Aufgabe anlegen fehlgeschlagen:', error)
      setPlanModeError('Aufgabe konnte nicht angelegt werden. Bitte später erneut versuchen.')
      return
    }
    setPlanModeError('')
    setTasks((prev) => [...prev, data].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
  }

  async function moveTask(taskId, dateKey) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    setPlanModeError('')
    const oldDate = new Date(task.scheduled_at)
    const next = new Date(`${dateKey}T12:00:00`)
    next.setHours(oldDate.getHours(), oldDate.getMinutes(), 0, 0)
    const { error } = await supabase
      .from('learning_plan_tasks')
      .update({ scheduled_at: next.toISOString() })
      .eq('id', task.id)
      .eq('user_id', user.id)
    if (error) {
      console.error('Plan-Modus: Verschieben fehlgeschlagen:', error)
      setPlanModeError('Verschieben hat nicht geklappt. Bitte später erneut versuchen.')
      return
    }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, scheduled_at: next.toISOString() } : t)))
  }

  async function removeTaskFromPlan(taskId) {
    if (!user?.id) return
    setPlanModeError('')
    const { error } = await deleteTask(user.id, taskId)
    if (error) {
      console.error('Plan-Modus: Entfernen fehlgeschlagen:', error)
      setPlanModeError('Entfernen hat nicht geklappt. Bitte Verbindung prüfen und erneut versuchen.')
      return
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    setCommentDrafts((prev) => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }

  function getCommentDraft(task) {
    if (Object.prototype.hasOwnProperty.call(commentDrafts, task.id)) {
      return commentDrafts[task.id]
    }
    return task.description || ''
  }

  async function saveTaskComment(task) {
    const nextDescription = String(getCommentDraft(task) || '').trim()
    const currentDescription = String(task.description || '').trim()
    if (nextDescription === currentDescription) return
    setSavingCommentId(task.id)
    setPlanModeError('')
    const { error } = await supabase
      .from('learning_plan_tasks')
      .update({ description: nextDescription || null })
      .eq('id', task.id)
      .eq('user_id', user.id)
    setSavingCommentId('')
    if (error) {
      console.error('Plan-Modus: Kommentar speichern fehlgeschlagen:', error)
      setPlanModeError('Kommentar konnte nicht gespeichert werden.')
      return
    }
    setPlanModeError('')
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, description: nextDescription || null } : t)))
  }

  function toggleSection(sectionKey) {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
  }

  function addPendingTutorItem() {
    const value = newTutorName.trim()
    if (!value) return
    const pendingId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setPendingTutorItems((prev) => [...prev, { id: pendingId, name: value }])
    setNewTutorName('')
  }

  function addPendingManualItem() {
    const value = newManualName.trim()
    if (!value) return
    const pendingId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setPendingManualItems((prev) => [...prev, { id: pendingId, name: value }])
    setNewManualName('')
  }

  function renamePendingTutorItem(itemId, name) {
    setPendingTutorItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, name } : x)))
  }

  function renamePendingManualItem(itemId, name) {
    setPendingManualItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, name } : x)))
  }

  function removePendingTutorItem(itemId) {
    setPendingTutorItems((prev) => prev.filter((x) => x.id !== itemId))
  }

  function removePendingManualItem(itemId) {
    setPendingManualItems((prev) => prev.filter((x) => x.id !== itemId))
  }

  function handleCatalogDragStart(e, payload) {
    e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'catalog', payload }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleTaskDragStart(e, taskId) {
    e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'task', taskId }))
    e.dataTransfer.effectAllowed = 'move'
  }

  async function handleDayDrop(e, dayKey) {
    if (!interactive) return
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.kind === 'task' && parsed?.taskId) {
        await moveTask(parsed.taskId, dayKey)
        return
      }
      if (parsed?.kind === 'catalog' && parsed?.payload) {
        await createTaskOnDay(parsed.payload, dayKey)
      }
    } catch (_) {
      // ignore broken drop payload
    }
  }

  const tutorCatalogGroups = useMemo(() => {
    const uploaded = materials.map((m) => ({
      id: `tutor_${m.id}`,
      type: 'tutor',
      materialId: m.id,
      title: `Tutor: ${m.filename}`,
      description: m.category ? `Kategorie: ${m.category}` : 'Tutor-Aufgabe für dieses Material',
      catalogGroupKey: groupKeyFromMaterialCategoryValue(m.category),
    }))
    const pending = pendingTutorItems.map((item) => ({
      id: `pending_tutor_${item.id}`,
      type: 'tutor',
      materialId: null,
      title: `Tutor: ${item.name}`,
      description: 'Platzhalter-Datei (noch nicht hochgeladen)',
      pendingTutorId: item.id,
      catalogGroupKey: '__pending__',
    }))

    const bucket = new Map()
    for (const it of [...uploaded, ...pending]) {
      const k = it.catalogGroupKey
      if (!bucket.has(k)) bucket.set(k, [])
      bucket.get(k).push(it)
    }

    const out = orderedMaterialCategoryGroups(bucket)
    const pend = bucket.get('__pending__')
    if (pend?.length) out.push({ key: 'pending', label: 'Noch nicht hochgeladen', items: pend })
    return out
  }, [materials, pendingTutorItems])

  const plannedKeySet = useMemo(() => {
    const out = new Set()
    for (const task of tasks) {
      const type = String(task.type || '')
      const materialId = String(task.material_id || '')
      const title = normalizeText(task.title)
      out.add(`${type}|${materialId}|${title}`)
      out.add(`${type}||${title}`)
    }
    return out
  }, [tasks])

  function isAlreadyPlanned(item) {
    const type = String(item.type || '')
    const materialId = String(item.materialId || '')
    const title = normalizeText(item.title)
    return plannedKeySet.has(`${type}|${materialId}|${title}`) || plannedKeySet.has(`${type}||${title}`)
  }

  const manualCatalogItems = useMemo(() => {
    const defaults = [
      { id: 'summary', type: 'manual', materialId: null, title: 'Zusammenfassung ergänzen', description: 'Deine Fachzusammenfassung erweitern' },
    ]
    const freeNamed = pendingManualItems.map((item) => ({
      id: `pending_manual_${item.id}`,
      type: 'manual',
      materialId: null,
      title: item.name,
      description: 'Freie Aufgabe',
      pendingManualId: item.id,
    }))
    return [...defaults, ...freeNamed]
  }, [pendingManualItems])

  const vocabCreateCatalogGroups = useMemo(() => {
    const filtered = materials.filter((m) => canCreateVocabForMaterial(m))
    if (filtered.length === 0) {
      return [
        {
          key: 'generic',
          label: 'Allgemein',
          items: [
            {
              id: 'vocab_create_generic',
              type: 'manual',
              materialId: null,
              title: 'Vokabeln erstellen',
              description: 'Neue Vokabeln erstellen',
            },
          ],
        },
      ]
    }
    const uploaded = filtered.map((m) => ({
      id: `vocab_create_${m.id}`,
      type: 'manual',
      materialId: m.id,
      title: `Vokabeln erstellen: ${m.filename}`,
      description: m.category ? `Datei (${m.category})` : 'Datei',
      catalogGroupKey: groupKeyFromMaterialCategoryValue(m.category),
    }))
    const bucket = new Map()
    for (const it of uploaded) {
      const k = it.catalogGroupKey
      if (!bucket.has(k)) bucket.set(k, [])
      bucket.get(k).push(it)
    }
    return orderedMaterialCategoryGroups(bucket)
  }, [materials])

  const vocabPracticeCatalogItem = {
    id: 'vocab_practice',
    type: 'vocab',
    materialId: null,
    title: 'Vokabeln lernen',
    description: 'Vokabeln aktiv wiederholen',
  }

  const catalogSections = [
    {
      key: 'tutor',
      title: 'Tutor-Modus',
      items: [],
    },
    {
      key: 'vocab',
      title: 'Vokabeln',
      items: [],
    },
    {
      key: 'exam',
      title: 'Prüfung',
      items: [
        { id: 'exam', type: 'exam', materialId: null, title: 'Altklausur / Prüfungssimulation', description: 'Prüfungsnah üben' },
      ],
    },
    {
      key: 'manual',
      title: 'Weitere Aufgaben',
      items: manualCatalogItems,
    },
  ]

  return (
    <section
      className={
        showCatalog
          ? fillParent
            ? 'flex h-full min-h-0 flex-col gap-4 overflow-hidden'
            : 'flex h-[calc(100dvh-10rem)] min-h-0 flex-col gap-4 overflow-hidden max-md:h-[calc(100dvh-7rem)]'
          : 'space-y-4'
      }
    >
      {showHeader && (
        <div className={`flex items-center justify-between gap-3 ${showCatalog ? 'shrink-0' : ''}`}>
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline">
            <span className="inline-block rotate-180 text-base">➜</span>
            Zurück zum Fach
          </button>
          <h3 className="text-base font-semibold text-studiio-ink">Plan-Modus · {activeSubject?.name || subject?.name}</h3>
        </div>
      )}
      {planModeError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {planModeError}
        </p>
      ) : null}

      <div
        className={
          showCatalog
            ? 'grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]'
            : 'min-w-0'
        }
      >
        {showCatalog && (
        <aside className="flex min-h-0 h-full max-h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-studiio-lavender/50 bg-white/90 p-4 max-h-[min(44vh,22rem)] md:max-h-full">
          <div className="shrink-0 space-y-3">
            {allowSubjectSelection && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-studiio-muted">Fach auswählen</label>
                <select
                  value={activeSubjectId}
                  onChange={(e) => setActiveSubjectId(e.target.value)}
                  className="studiio-input w-full"
                >
                  {availableSubjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <h4 className="text-sm font-semibold text-studiio-ink">Aufgaben-Katalog</h4>
              <p className="mt-1 text-xs text-studiio-muted">Überthema aufklappen und Eintrag auf einen Tag ziehen.</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 pt-3 [scrollbar-gutter:stable]">
            <div className="space-y-2">
            {catalogSections.map((section) => (
              <div key={section.key} className="rounded-lg border border-studiio-lavender/40 bg-white">
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="text-sm font-medium text-studiio-ink">{section.title}</span>
                  <span className="text-xs text-studiio-muted">{expandedSections[section.key] ? '▾' : '▸'}</span>
                </button>
                {expandedSections[section.key] && (
                  <div className="border-t border-studiio-lavender/20 px-2 pb-2 pt-2">
                    {section.key === 'tutor' && (
                      <div className="mb-2 flex min-w-0 items-center gap-2">
                        <input
                          type="text"
                          value={newTutorName}
                          onChange={(e) => setNewTutorName(e.target.value)}
                          placeholder="Noch nicht hochgeladene Vorlesung benennen"
                          className="studiio-input min-w-0 flex-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={addPendingTutorItem}
                          className="rounded border border-studiio-lavender/70 px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-sky/20"
                        >
                          Hinzufügen
                        </button>
                      </div>
                    )}
                    {section.key === 'manual' && (
                      <div className="mb-2 flex min-w-0 items-center gap-2">
                        <input
                          type="text"
                          value={newManualName}
                          onChange={(e) => setNewManualName(e.target.value)}
                          placeholder="Frei benennbare Aufgabe"
                          className="studiio-input min-w-0 flex-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={addPendingManualItem}
                          className="rounded border border-studiio-lavender/70 px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-sky/20"
                        >
                          Hinzufügen
                        </button>
                      </div>
                    )}
                    {section.key === 'tutor' ? (
                      tutorCatalogGroups.length === 0 ? (
                        <p className="rounded-md bg-studiio-sky/10 px-2 py-1 text-[11px] text-studiio-muted">
                          Hier sind noch keine Einträge vorhanden.
                        </p>
                      ) : (
                        <div className="min-w-0 space-y-3">
                          {tutorCatalogGroups.map((grp) => (
                            <div key={grp.key} className="min-w-0">
                              <p className="mb-1.5 border-b border-studiio-lavender/30 pb-1 text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                                {grp.label}
                                <span className="ml-1 font-normal normal-case text-studiio-muted">
                                  ({grp.items.length})
                                </span>
                              </p>
                              <ul className="min-w-0 space-y-2">
                                {grp.items.map((item) => (
                                  <li
                                    key={item.id}
                                    draggable={interactive}
                                    onDragStart={(e) => handleCatalogDragStart(e, {
                                      type: item.type,
                                      title: item.title,
                                      description: item.description,
                                      materialId: item.materialId || null,
                                    })}
                                    className={`min-w-0 max-w-full cursor-grab rounded-md border px-2 py-1.5 active:cursor-grabbing ${
                                      isAlreadyPlanned(item)
                                        ? 'border-emerald-300 bg-emerald-50/70'
                                        : 'border-studiio-lavender/40 bg-studiio-sky/10'
                                    }`}
                                  >
                                    {item.pendingTutorId ? (
                                      <div className="mb-1 flex min-w-0 items-center gap-1">
                                        <input
                                          type="text"
                                          value={item.title.replace(/^Tutor:\s*/, '')}
                                          onChange={(e) => renamePendingTutorItem(item.pendingTutorId, e.target.value)}
                                          className="studiio-input min-w-0 flex-1 text-xs"
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            removePendingTutorItem(item.pendingTutorId)
                                          }}
                                          className="rounded border border-studiio-lavender/70 px-2 py-1 text-[11px] text-studiio-muted hover:bg-white"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ) : (() => {
                                      const parts = splitCatalogTitle(item.title)
                                      if (parts.label) {
                                        return (
                                          <div className="min-w-0 space-y-0.5">
                                            <p className="text-xs font-medium text-studiio-ink">
                                              {isAlreadyPlanned(item) ? (
                                                <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                              ) : null}
                                              <span className="text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                                                {parts.label}
                                              </span>
                                            </p>
                                            <p className="break-all text-xs font-medium leading-snug text-studiio-ink">
                                              {parts.body}
                                            </p>
                                          </div>
                                        )
                                      }
                                      return (
                                        <p className="min-w-0 break-words text-xs font-medium text-studiio-ink">
                                          {isAlreadyPlanned(item) ? (
                                            <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                          ) : null}
                                          {parts.body}
                                        </p>
                                      )
                                    })()}
                                    <p className="min-w-0 break-words text-[11px] text-studiio-muted">
                                      {decodeHtmlEntities(item.description || '')}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )
                    ) : section.key === 'vocab' ? (
                      <div className="min-w-0 space-y-3">
                        {vocabCreateCatalogGroups.map((grp) => (
                          <div key={grp.key} className="min-w-0">
                            <p className="mb-1.5 border-b border-studiio-lavender/30 pb-1 text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                              {grp.label}
                              <span className="ml-1 font-normal normal-case text-studiio-muted">
                                ({grp.items.length})
                              </span>
                            </p>
                            <ul className="min-w-0 space-y-2">
                              {grp.items.map((item) => (
                                <li
                                  key={item.id}
                                  draggable={interactive}
                                  onDragStart={(e) => handleCatalogDragStart(e, {
                                    type: item.type,
                                    title: item.title,
                                    description: item.description,
                                    materialId: item.materialId || null,
                                  })}
                                  className={`min-w-0 max-w-full cursor-grab rounded-md border px-2 py-1.5 active:cursor-grabbing ${
                                    isAlreadyPlanned(item)
                                      ? 'border-emerald-300 bg-emerald-50/70'
                                      : 'border-studiio-lavender/40 bg-studiio-sky/10'
                                  }`}
                                >
                                  {(() => {
                                    const parts = splitCatalogTitle(item.title)
                                    if (parts.label) {
                                      return (
                                        <div className="min-w-0 space-y-0.5">
                                          <p className="text-xs font-medium text-studiio-ink">
                                            {isAlreadyPlanned(item) ? (
                                              <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                            ) : null}
                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                                              {parts.label}
                                            </span>
                                          </p>
                                          <p className="break-all text-xs font-medium leading-snug text-studiio-ink">
                                            {parts.body}
                                          </p>
                                        </div>
                                      )
                                    }
                                    return (
                                      <p className="min-w-0 break-words text-xs font-medium text-studiio-ink">
                                        {isAlreadyPlanned(item) ? (
                                          <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                        ) : null}
                                        {parts.body}
                                      </p>
                                    )
                                  })()}
                                  <p className="min-w-0 break-words text-[11px] text-studiio-muted">
                                    {decodeHtmlEntities(item.description || '')}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        <div className="min-w-0 border-t border-studiio-lavender/20 pt-2">
                          <p className="mb-1.5 border-b border-studiio-lavender/30 pb-1 text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                            Gesamt
                          </p>
                          <ul className="min-w-0 space-y-2">
                            <li
                              key={vocabPracticeCatalogItem.id}
                              draggable={interactive}
                              onDragStart={(e) => handleCatalogDragStart(e, {
                                type: vocabPracticeCatalogItem.type,
                                title: vocabPracticeCatalogItem.title,
                                description: vocabPracticeCatalogItem.description,
                                materialId: vocabPracticeCatalogItem.materialId || null,
                              })}
                              className={`min-w-0 max-w-full cursor-grab rounded-md border px-2 py-1.5 active:cursor-grabbing ${
                                isAlreadyPlanned(vocabPracticeCatalogItem)
                                  ? 'border-emerald-300 bg-emerald-50/70'
                                  : 'border-studiio-lavender/40 bg-studiio-sky/10'
                              }`}
                            >
                              {(() => {
                                const parts = splitCatalogTitle(vocabPracticeCatalogItem.title)
                                if (parts.label) {
                                  return (
                                    <div className="min-w-0 space-y-0.5">
                                      <p className="text-xs font-medium text-studiio-ink">
                                        {isAlreadyPlanned(vocabPracticeCatalogItem) ? (
                                          <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                        ) : null}
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                                          {parts.label}
                                        </span>
                                      </p>
                                      <p className="break-all text-xs font-medium leading-snug text-studiio-ink">
                                        {parts.body}
                                      </p>
                                    </div>
                                  )
                                }
                                return (
                                  <p className="min-w-0 break-words text-xs font-medium text-studiio-ink">
                                    {isAlreadyPlanned(vocabPracticeCatalogItem) ? (
                                      <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                    ) : null}
                                    {parts.body}
                                  </p>
                                )
                              })()}
                              <p className="min-w-0 break-words text-[11px] text-studiio-muted">
                                {decodeHtmlEntities(vocabPracticeCatalogItem.description || '')}
                              </p>
                            </li>
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ul className="min-w-0 space-y-2">
                          {section.items.map((item) => (
                            <li
                              key={item.id}
                              draggable={interactive}
                              onDragStart={(e) => handleCatalogDragStart(e, {
                                type: item.type,
                                title: item.title,
                                description: item.description,
                                materialId: item.materialId || null,
                              })}
                              className={`min-w-0 max-w-full cursor-grab rounded-md border px-2 py-1.5 active:cursor-grabbing ${
                                isAlreadyPlanned(item)
                                  ? 'border-emerald-300 bg-emerald-50/70'
                                  : 'border-studiio-lavender/40 bg-studiio-sky/10'
                              }`}
                            >
                              {item.pendingTutorId ? (
                                <div className="mb-1 flex min-w-0 items-center gap-1">
                                  <input
                                    type="text"
                                    value={item.title.replace(/^Tutor:\s*/, '')}
                                    onChange={(e) => renamePendingTutorItem(item.pendingTutorId, e.target.value)}
                                    className="studiio-input min-w-0 flex-1 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removePendingTutorItem(item.pendingTutorId)
                                    }}
                                    className="rounded border border-studiio-lavender/70 px-2 py-1 text-[11px] text-studiio-muted hover:bg-white"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : item.pendingManualId ? (
                                <div className="mb-1 flex min-w-0 items-center gap-1">
                                  <input
                                    type="text"
                                    value={item.title}
                                    onChange={(e) => renamePendingManualItem(item.pendingManualId, e.target.value)}
                                    className="studiio-input min-w-0 flex-1 text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removePendingManualItem(item.pendingManualId)
                                    }}
                                    className="rounded border border-studiio-lavender/70 px-2 py-1 text-[11px] text-studiio-muted hover:bg-white"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (() => {
                                const parts = splitCatalogTitle(item.title)
                                if (parts.label) {
                                  return (
                                    <div className="min-w-0 space-y-0.5">
                                      <p className="text-xs font-medium text-studiio-ink">
                                        {isAlreadyPlanned(item) ? (
                                          <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                        ) : null}
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-studiio-muted">
                                          {parts.label}
                                        </span>
                                      </p>
                                      <p className="break-all text-xs font-medium leading-snug text-studiio-ink">
                                        {parts.body}
                                      </p>
                                    </div>
                                  )
                                }
                                return (
                                  <p className="min-w-0 break-words text-xs font-medium text-studiio-ink">
                                    {isAlreadyPlanned(item) ? (
                                      <span className="mr-0.5 text-emerald-700" aria-hidden>✓</span>
                                    ) : null}
                                    {parts.body}
                                  </p>
                                )
                              })()}
                              <p className="min-w-0 break-words text-[11px] text-studiio-muted">
                                {decodeHtmlEntities(item.description || '')}
                              </p>
                            </li>
                          ))}
                        </ul>
                        {section.items.length === 0 && (
                          <p className="rounded-md bg-studiio-sky/10 px-2 py-1 text-[11px] text-studiio-muted">
                            Hier sind noch keine Einträge vorhanden.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>
        </aside>
        )}

        <div
          className={`min-h-0 min-w-0 overflow-y-auto overflow-x-hidden rounded-2xl border border-studiio-lavender/50 bg-white/90 p-4 pr-3 ${
            showCatalog
              ? 'h-full max-h-full overscroll-contain [scrollbar-gutter:stable]'
              : ''
          }`}
        >
          {showCatalog && (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAllTasks((v) => !v)}
                className="rounded border border-studiio-lavender/70 px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-sky/20"
              >
                {showAllTasks ? 'Nur dieses Fach anzeigen' : 'Alle Tasks (fächerübergreifend)'}
              </button>
            </div>
          )}
          <h4 className="text-sm font-semibold text-studiio-ink">
            {showAllTasks
              ? 'Alle geplanten Aufgaben'
              : `Ab heute bis zur Klausur ${activeSubject?.exam_date ? `(bis ${new Date(activeSubject.exam_date).toLocaleDateString('de-DE')})` : '(nächste 30 Tage)'}`}
          </h4>
          {loading ? (
            <p className="mt-3 text-sm text-studiio-muted">Plan wird geladen …</p>
          ) : showAllTasks ? (
            allTasksLoading ? (
              <p className="mt-3 text-sm text-studiio-muted">Alle Aufgaben werden geladen …</p>
            ) : (
              <div className={`mt-3 grid gap-2 ${showCatalog ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
                {planningDays.map((dayKey) => (
                  <div key={`all-${dayKey}`} className="min-h-[120px] rounded-xl border border-studiio-lavender/40 bg-studiio-sky/10 p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-studiio-ink">{formatDay(dayKey)}</p>
                    </div>
                    <ul className="space-y-1">
                      {(allTasksByDayDisplay[dayKey] || []).map((task) => {
                        const subName = availableSubjects.find((s) => s.id === task.subject_id)?.name || 'Fach'
                        return (
                          <li
                            key={task.id}
                            className={`min-w-0 max-w-full rounded-md border px-2 py-1 text-xs ${isLearningPlanTaskComplete(task) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-studiio-lavender/40 bg-white text-studiio-ink'}`}
                          >
                            {renderPlanTaskTitle(task.title)}
                            <p className="mt-0.5 min-w-0 break-words text-[11px] text-studiio-muted">{subName}</p>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className={`mt-3 grid gap-2 ${showCatalog ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
              {planningDays.map((dayKey) => (
                <div
                  key={dayKey}
                  onDragOver={(e) => {
                    if (!interactive) return
                    e.preventDefault()
                  }}
                  onDrop={(e) => {
                    if (!interactive) return
                    handleDayDrop(e, dayKey)
                  }}
                  className="min-h-[120px] rounded-xl border border-studiio-lavender/40 bg-studiio-sky/10 p-2"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-studiio-ink">{formatDay(dayKey)}</p>
                  </div>
                  <ul className="space-y-1">
                    {(tasksByDayDisplay[dayKey] || []).map((task) => (
                      <li
                        key={task.id}
                        draggable={interactive}
                        onDragStart={(e) => {
                          if (!interactive) return
                          handleTaskDragStart(e, task.id)
                        }}
                        onClick={() => {
                          if (interactive) {
                            setActiveTaskId((prev) => (prev === task.id ? '' : task.id))
                            return
                          }
                          if (onTaskClick) onTaskClick(task)
                        }}
                        className={`min-w-0 max-w-full rounded-md border px-2 py-1 text-xs ${isLearningPlanTaskComplete(task) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-studiio-lavender/40 bg-white text-studiio-ink'} ${interactive ? 'cursor-grab' : onTaskClick ? 'cursor-pointer hover:bg-studiio-sky/20' : 'cursor-default'}`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            {renderPlanTaskTitle(task.title)}
                          </div>
                          {interactive && activeTaskId === task.id && (
                            <div className="space-y-1 border-t border-studiio-lavender/20 pt-1">
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    removeTaskFromPlan(task.id)
                                  }}
                                  className="rounded border border-studiio-lavender/70 px-1.5 py-0.5 text-[10px] text-studiio-muted hover:bg-studiio-sky/20"
                                >
                                  Entfernen
                                </button>
                              </div>
                              <textarea
                                value={getCommentDraft(task)}
                                onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [task.id]: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Kommentar zur Aufgabe …"
                                rows={2}
                                className="w-full rounded border border-studiio-lavender/50 bg-white px-2 py-1 text-[11px] text-studiio-ink placeholder:text-studiio-muted/70"
                              />
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    saveTaskComment(task)
                                  }}
                                  className="rounded border border-studiio-lavender/70 px-2 py-0.5 text-[10px] text-studiio-ink hover:bg-studiio-sky/20"
                                >
                                  {savingCommentId === task.id ? 'Speichert …' : 'Kommentar speichern'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
