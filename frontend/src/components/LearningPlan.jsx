import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { completeTask, uncompleteTask, updateTask } from '../utils/learningPlan'
import CompletionCelebration from './CompletionCelebration'

const TASK_TYPES = [
  { value: 'tutor', label: 'Datei mit Tutor durcharbeiten' },
  { value: 'vocab', label: 'Vokabeln eines Fachs durcharbeiten' },
  { value: 'exam', label: 'Klausur bearbeiten' },
  { value: 'manual', label: 'Eigene Aufgabe (manuell)' },
]

function formatTaskTime(scheduledAt) {
  const d = new Date(scheduledAt)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const WEEK_VIEW_OPTIONS = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'extended', label: 'Erweitert' },
]
const REPEAT_OPTIONS = [
  { value: 'none', label: 'Keine Wiederholung' },
  { value: 'interval', label: 'Intervall' },
]

function formatDayShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}

function getDateKey(scheduledAt) {
  if (scheduledAt == null) return null
  const d = new Date(scheduledAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Montag einer Woche zu einem Datum (YYYY-MM-DD) */
function getMondayKey(dateKey) {
  const d = new Date(dateKey + 'T12:00:00')
  const day = d.getDay()
  const toMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + toMonday)
  return d.toISOString().slice(0, 10)
}

/** Tasks nach Tagen gruppieren, Tage sortiert */
function groupTasksByDay(tasks) {
  const byDay = {}
  for (const task of tasks) {
    const key = getDateKey(task.scheduled_at)
    if (key == null) continue
    if (!byDay[key]) byDay[key] = []
    byDay[key].push(task)
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
  }
  const sortedDays = Object.keys(byDay).sort()
  return { byDay, sortedDays }
}

function toLocalDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getNextFullHourDate() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

/** Montag der aktuellen Woche (YYYY-MM-DD) */
function getCurrentWeekMonday() {
  const d = new Date()
  const day = d.getDay()
  const toMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + toMonday)
  return toLocalDateKey(d)
}

/** Die 7 Tage (Mo–So) für eine Woche mit gegebenem Montag */
function getWeekDays(mondayKey) {
  const [y, m, day] = mondayKey.split('-').map(Number)
  const mondayDate = new Date(y, m - 1, day)
  const weekRow = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate)
    d.setDate(d.getDate() + i)
    weekRow.push(toLocalDateKey(d))
  }
  return weekRow
}

function getTaskAccent(type) {
  if (type === 'tutor') return 'bg-teal-500'
  if (type === 'vocab') return 'bg-violet-500'
  if (type === 'exam') return 'bg-amber-500'
  return 'bg-slate-400'
}

function getTaskTypeLabel(type) {
  if (type === 'tutor') return 'Tutor'
  if (type === 'vocab') return 'Vokabeln'
  if (type === 'exam') return 'Klausur'
  return 'Manuell'
}

function normalizeText(value) {
  return String(value || '').toLocaleLowerCase('de-DE').trim()
}

function buildRecurringSchedule(baseDate, repeatRule, occurrenceCount, everyValue, everyUnit, infinite = false) {
  const dates = []
  const start = new Date(baseDate)
  if (Number.isNaN(start.getTime())) return [baseDate]

  if (repeatRule === 'none') return [start]

  if (repeatRule === 'interval') {
    const safeEvery = Math.max(1, Math.min(365, Number(everyValue) || 1))
    const stepDays = everyUnit === 'weeks' ? safeEvery * 7 : safeEvery
    const safeCount = infinite
      ? Math.max(2, Math.min(730, Math.ceil(365 / stepDays) + 1))
      : Math.max(1, Math.min(365, Number(occurrenceCount) || 1))
    for (let i = 0; i < safeCount; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i * stepDays)
      dates.push(d)
    }
    return dates
  }

  return [start]
}

function isMissingDescriptionColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('description') && msg.includes('column'))
}

export default function LearningPlan({ user, subjects, onOpenSubject, onStartPractice, onOpenTutor, refreshTrigger }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState('manual')
  const [subjectId, setSubjectId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [materials, setMaterials] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [repeatRule, setRepeatRule] = useState('none')
  const [repeatCount, setRepeatCount] = useState(6)
  const [repeatEvery, setRepeatEvery] = useState(2)
  const [repeatUnit, setRepeatUnit] = useState('days')
  const [repeatInfinite, setRepeatInfinite] = useState(false)
  const [editApplyScope, setEditApplyScope] = useState('single') // single | future
  const [editingSeriesCount, setEditingSeriesCount] = useState(1)
  const [saving, setSaving] = useState(false)
  const [completingId, setCompletingId] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekMonday())
  const [weekView, setWeekView] = useState('timeline')
  const [draggingTaskId, setDraggingTaskId] = useState(null)
  const [dropTargetDate, setDropTargetDate] = useState(null)
  const [celebration, setCelebration] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let mounted = true
    setLoading(true)
    supabase
      .from('learning_plan_tasks')
      .select('id, type, subject_id, material_id, title, description, scheduled_at, completed_at')
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: true })
      .then(async ({ data, error }) => {
        // Fallback für ältere DBs ohne "description"-Spalte.
        if (error && isMissingDescriptionColumn(error)) {
          const retry = await supabase
            .from('learning_plan_tasks')
            .select('id, type, subject_id, material_id, title, scheduled_at, completed_at')
            .eq('user_id', user.id)
            .order('scheduled_at', { ascending: true })
          if (!mounted) return
          if (retry.error) {
            console.error('Lernplan laden:', retry.error)
            setTasks([])
            setLoading(false)
            return
          }
          setTasks((retry.data || []).map((t) => ({ ...t, description: null })))
          setLoading(false)
          return
        }
        if (!mounted) return
        if (error) {
          console.error('Lernplan laden:', error)
          setTasks([])
        } else {
          setTasks(data || [])
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, refreshTrigger])

  useEffect(() => {
    if (type !== 'tutor' || !subjectId) {
      setMaterials([])
      if (!editingTask) setMaterialId('')
      return
    }
    let mounted = true
    supabase
      .from('materials')
      .select('id, filename')
      .eq('user_id', user.id)
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!mounted) return
        setMaterials(data || [])
        if (!editingTask) setMaterialId('')
      })
    return () => { mounted = false }
  }, [type, subjectId, user?.id, editingTask])

  function getTaskTitle(task) {
    if (task.title) return task.title
    const sub = subjects.find((s) => s.id === task.subject_id)
    const subName = sub?.name || 'Fach'
    if (task.type === 'tutor') return `Tutor: ${subName}`
    if (task.type === 'vocab') return `Vokabeln: ${subName}`
    if (task.type === 'exam') return `Klausur: ${subName}`
    return subName
  }

  function resolveSubjectForTask(task) {
    if (!subjects?.length || !task) return null

    // 1) Eindeutiger Primärweg: direkte subject_id
    if (task.subject_id) {
      const direct = subjects.find((s) => s.id === task.subject_id)
      if (direct) return direct
    }

    // 2) Fallback: Fachname in Titel/Beschreibung erkennen
    const haystack = normalizeText(`${task.title || ''} ${task.description || ''}`)
    if (!haystack) return null

    // Erst voller Name, dann längere Teilwörter
    const fullMatch = subjects.find((s) => haystack.includes(normalizeText(s.name)))
    if (fullMatch) return fullMatch

    let best = null
    let bestScore = 0
    for (const subject of subjects) {
      const words = normalizeText(subject.name).split(/\s+/).filter((w) => w.length >= 4)
      const score = words.reduce((acc, word) => (haystack.includes(word) ? acc + 1 : acc), 0)
      if (score > bestScore) {
        bestScore = score
        best = subject
      }
    }
    return bestScore > 0 ? best : null
  }

  function openCelebrationForTask(task) {
    const sub = resolveSubjectForTask(task)
    setCelebration({
      taskLabel: getTaskTitle(task),
      subjectName: sub?.name || '',
    })
  }

  function resetForm() {
    setEditingTask(null)
    setType('manual')
    setSubjectId('')
    setMaterialId('')
    setTitle('')
    setDescription('')
    setScheduledDate('')
    setScheduledTime('')
    setRepeatRule('none')
    setRepeatCount(6)
    setRepeatEvery(2)
    setRepeatUnit('days')
    setRepeatInfinite(false)
    setEditApplyScope('single')
    setEditingSeriesCount(1)
    setShowForm(false)
  }

  async function startEdit(task) {
    setEditApplyScope('single')
    setEditingSeriesCount(1)
    setType(task.type)
    setSubjectId(task.subject_id || '')
    setMaterialId(task.material_id || '')
    setTitle(task.title || '')
    setDescription(task.description || '')
    setScheduledDate(task.scheduled_at ? task.scheduled_at.slice(0, 10) : '')
    setScheduledTime(task.scheduled_at ? task.scheduled_at.slice(11, 16) : '09:00')
    setRepeatRule('none')
    setRepeatCount(1)
    setRepeatEvery(2)
    setRepeatUnit('days')
    setRepeatInfinite(false)
    setEditingTask(task)
    setShowForm(true)
    try {
      let q = supabase
        .from('learning_plan_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', task.type)
        .eq('title', task.title || '')
        .gte('scheduled_at', task.scheduled_at)

      if (task.subject_id) q = q.eq('subject_id', task.subject_id)
      else q = q.is('subject_id', null)

      if (task.material_id) q = q.eq('material_id', task.material_id)
      else q = q.is('material_id', null)

      const { count } = await q
      setEditingSeriesCount(count || 1)
    } catch (_) {
      setEditingSeriesCount(1)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user?.id) return
    const todayKey = toLocalDateKey(new Date())
    const date = scheduledDate || todayKey
    let effectiveTime = (scheduledTime || '').trim()
    if (!effectiveTime && date === todayKey) {
      const nextHour = getNextFullHourDate()
      effectiveTime = `${String(nextHour.getHours()).padStart(2, '0')}:00`
    }
    if (!effectiveTime) effectiveTime = '09:00'
    const scheduledAt = new Date(`${date}T${effectiveTime}:00`).toISOString()

    let taskTitle = title.trim()
    if (type !== 'manual') {
      const sub = subjects.find((s) => s.id === subjectId)
      const subName = sub?.name || 'Fach'
      if (type === 'tutor') {
        if (materialId === '__any_exercise__') {
          taskTitle = `Tutor: Beliebige Übung (${subName})`
        } else {
          const mat = materials.find((m) => m.id === materialId)
          taskTitle = mat ? `Tutor: ${mat.filename}` : `Tutor: ${subName}`
        }
      } else if (type === 'vocab') taskTitle = `Vokabeln: ${subName}`
      else if (type === 'exam') taskTitle = `Klausur: ${subName}`
    }
    if (!taskTitle) {
      setTitle('')
      return
    }

    setSaving(true)
    if (editingTask) {
      const updatePayload = {
        type,
        subject_id: subjectId || null,
        material_id: type === 'tutor' && materialId !== '__any_exercise__' ? materialId || null : null,
        title: taskTitle,
        description: description.trim() || null,
        scheduled_at: scheduledAt,
      }

      if (editApplyScope === 'future') {
        let q = supabase
          .from('learning_plan_tasks')
          .select('id, scheduled_at')
          .eq('user_id', user.id)
          .eq('type', editingTask.type)
          .eq('title', editingTask.title || '')
          .gte('scheduled_at', editingTask.scheduled_at)

        if (editingTask.subject_id) q = q.eq('subject_id', editingTask.subject_id)
        else q = q.is('subject_id', null)

        if (editingTask.material_id) q = q.eq('material_id', editingTask.material_id)
        else q = q.is('material_id', null)

        const { data: futureSeries, error: futureErr } = await q
        if (futureErr) {
          setSaving(false)
          console.error('Serien-Tasks laden:', futureErr)
          return
        }

        const hhmm = effectiveTime
        const [hh, mm] = hhmm.split(':').map(Number)
        const updatedRows = []

        for (const row of futureSeries || []) {
          const d = new Date(row.scheduled_at)
          d.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0)
          const { data: one, error: oneErr } = await updateTask(user.id, row.id, {
            ...updatePayload,
            scheduled_at: d.toISOString(),
          })
          if (oneErr) {
            setSaving(false)
            console.error('Serien-Task aktualisieren:', oneErr)
            return
          }
          if (one) updatedRows.push(one)
        }
        setSaving(false)
        if (updatedRows.length) {
          const byId = new Map(updatedRows.map((r) => [r.id, r]))
          setTasks((prev) =>
            prev
              .map((t) => (byId.has(t.id) ? byId.get(t.id) : t))
              .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
          )
        }
        resetForm()
        return
      }

      const { data, error } = await updateTask(user.id, editingTask.id, updatePayload)
      setSaving(false)
      if (error) {
        console.error('Task aktualisieren:', error)
        return
      }
      if (data) setTasks((prev) => prev.map((t) => (t.id === data.id ? data : t)))
      resetForm()
      return
    }

    const repeatDates = buildRecurringSchedule(
      new Date(`${date}T${effectiveTime}:00`),
      repeatRule,
      repeatRule === 'none' ? 1 : repeatCount,
      repeatEvery,
      repeatUnit,
      repeatInfinite,
    )
    const payloads = repeatDates.map((d) => ({
      user_id: user.id,
      type,
      title: taskTitle,
      description: description.trim() || null,
      scheduled_at: d.toISOString(),
      subject_id: subjectId || null,
      material_id: type === 'tutor' && materialId !== '__any_exercise__' ? materialId || null : null,
    }))
    let { data, error } = await supabase
      .from('learning_plan_tasks')
      .insert(payloads)
      .select('id, type, subject_id, material_id, title, description, scheduled_at, completed_at')
    if (!Array.isArray(data) && data) data = [data]

    if (error && isMissingDescriptionColumn(error)) {
      const payloadWithoutDescription = payloads.map(({ description: _description, ...rest }) => rest)
      const retry = await supabase
        .from('learning_plan_tasks')
        .insert(payloadWithoutDescription)
        .select('id, type, subject_id, material_id, title, scheduled_at, completed_at')
      const retryRows = Array.isArray(retry.data) ? retry.data : retry.data ? [retry.data] : []
      data = retryRows.map((row) => ({ ...row, description: description.trim() || null }))
      error = retry.error
    }
    setSaving(false)
    if (error) {
      console.error('Task anlegen:', error)
      return
    }
    const insertedRows = Array.isArray(data) ? data : data ? [data] : []
    setTasks((prev) => [...prev, ...insertedRows].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
    resetForm()
  }

  async function handleToggle(task) {
    setCompletingId(task.id)
    const done = !!task.completed_at
    if (done) {
      await uncompleteTask(user.id, task.id)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed_at: null } : t)))
    } else {
      await completeTask(user.id, task.id)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed_at: new Date().toISOString() } : t)))
      openCelebrationForTask(task)
    }
    setCompletingId(null)
  }

  async function handleMoveTaskToDay(task, targetDateKey) {
    const t = new Date(task.scheduled_at)
    const newDate = new Date(targetDateKey + 'T12:00:00')
    newDate.setHours(t.getHours(), t.getMinutes(), 0, 0)
    const newScheduledAt = newDate.toISOString()
    const { data, error } = await updateTask(user.id, task.id, {
      type: task.type,
      subject_id: task.subject_id ?? null,
      material_id: task.material_id ?? null,
      title: task.title,
      description: task.description ?? null,
      scheduled_at: newScheduledAt,
    })
    if (!error && data) setTasks((prev) => prev.map((x) => (x.id === task.id ? data : x)))
  }

  function handleTaskCardClick(task) {
    if (showForm) {
      startEdit(task)
      return
    }
    handleToggle(task)
  }

  return (
    <section className="rounded-3xl border border-white/40 bg-white/65 p-6 shadow-[0_18px_35px_rgba(57,67,105,0.12)] backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold text-studiio-ink">Lernplan</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-[#d8dee9] bg-[#e9edf3] p-1">
            {WEEK_VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setWeekView(opt.value)}
                className={
                  weekView === opt.value
                    ? 'rounded-full bg-[#49a99b] px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-full px-3 py-1 text-xs font-medium text-studiio-muted hover:bg-white/70'
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (showForm && !editingTask) setShowForm(false)
              else if (showForm && editingTask) resetForm()
              else {
                setEditingTask(null)
                setType('manual')
                setSubjectId('')
                setMaterialId('')
                setTitle('')
                setDescription('')
                setScheduledDate('')
                setScheduledTime('')
                setRepeatRule('none')
                setRepeatCount(6)
                setRepeatEvery(2)
                setRepeatUnit('days')
                setRepeatInfinite(false)
                setShowForm(true)
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#49a99b] text-white px-4 py-2 text-sm font-semibold hover:brightness-95"
          >
            <span className="text-base leading-none">+</span>
            {showForm ? 'Schließen' : 'Aufgabe hinzufügen'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 grid gap-3 rounded-xl border border-studiio-lavender/40 bg-studiio-sky/10 p-4">
          {editingTask && <p className="text-sm font-medium text-studiio-ink">Aufgabe bearbeiten</p>}
          <div>
            <label className="block text-sm font-medium text-studiio-ink mb-1">Typ</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="studiio-input w-full">
              {TASK_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {(type === 'tutor' || type === 'vocab' || type === 'exam') && (
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">Fach</label>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="studiio-input w-full" required>
                <option value="">— wählen —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {type === 'tutor' && (
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">Datei (Tutor)</label>
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="studiio-input w-full">
                <option value="">— wählen —</option>
                <option value="__any_exercise__">Beliebige Übung durcharbeiten</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.filename}</option>
                ))}
              </select>
            </div>
          )}
          {(type === 'manual' || editingTask) && (
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">Titel</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Zusammenfassung lesen" className="studiio-input w-full" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-studiio-ink mb-1">Beschreibung (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notiz oder Beschreibung zur Aufgabe" rows={2} className="studiio-input w-full resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">Datum</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="studiio-input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">Uhrzeit</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="studiio-input w-full" />
            </div>
          </div>
          {editingTask && editingSeriesCount > 1 && (
            <div>
              <label className="block text-sm font-medium text-studiio-ink mb-1">Änderung anwenden auf</label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-studiio-ink">
                  <input
                    type="radio"
                    name="edit-scope"
                    value="single"
                    checked={editApplyScope === 'single'}
                    onChange={(e) => setEditApplyScope(e.target.value)}
                  />
                  Nur diesen Termin
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-studiio-ink">
                  <input
                    type="radio"
                    name="edit-scope"
                    value="future"
                    checked={editApplyScope === 'future'}
                    onChange={(e) => setEditApplyScope(e.target.value)}
                  />
                  Alle zukünftigen ({editingSeriesCount})
                </label>
              </div>
            </div>
          )}
          {!editingTask && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-studiio-ink mb-1">Wiederholung</label>
                <select value={repeatRule} onChange={(e) => setRepeatRule(e.target.value)} className="studiio-input w-full">
                  {REPEAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {repeatRule === 'interval' && (
                <div>
                  <label className="block text-sm font-medium text-studiio-ink mb-1">Alle</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={repeatEvery}
                    onChange={(e) => setRepeatEvery(Number(e.target.value) || 1)}
                    className="studiio-input w-full"
                  />
                </div>
              )}
              {repeatRule === 'interval' && (
                <div>
                  <label className="block text-sm font-medium text-studiio-ink mb-1">Einheit</label>
                  <select
                    value={repeatUnit}
                    onChange={(e) => setRepeatUnit(e.target.value)}
                    className="studiio-input w-full"
                  >
                    <option value="days">Tag(e)</option>
                    <option value="weeks">Woche(n)</option>
                  </select>
                </div>
              )}
              {repeatRule !== 'none' && !repeatInfinite && (
                <div>
                  <label className="block text-sm font-medium text-studiio-ink mb-1">Anzahl Termine</label>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Number(e.target.value) || 1)}
                    className="studiio-input w-full"
                  />
                </div>
              )}
            </div>
          )}
          {!editingTask && repeatRule !== 'none' && (
            <div className="rounded-lg border border-studiio-lavender/50 bg-white/70 px-3 py-2">
              <label className="inline-flex items-center gap-2 text-sm text-studiio-ink">
                <input
                  type="checkbox"
                  checked={repeatInfinite}
                  onChange={(e) => setRepeatInfinite(e.target.checked)}
                  className="h-4 w-4 rounded border-studiio-lavender/70 text-studiio-accent focus:ring-studiio-accent"
                />
                Unendlich (automatisch ca. 12 Monate im Voraus)
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="studiio-btn-primary">
              {saving ? 'Wird gespeichert …' : editingTask ? 'Änderungen speichern' : 'Aufgabe eintragen'}
            </button>
            {editingTask && (
              <button type="button" onClick={resetForm} className="rounded-lg border border-studiio-lavender/60 px-3 py-1.5 text-sm text-studiio-ink hover:bg-studiio-sky/20">
                Abbrechen
              </button>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-studiio-muted">Lernplan wird geladen …</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-studiio-muted">Noch keine Aufgaben. Füge eine hinzu, um deinen Lernplan zu füllen.</p>
      ) : (
        <div className="space-y-5">
          {(() => {
            const { byDay, sortedDays } = groupTasksByDay(tasks)
            const weekRow = getWeekDays(weekStart)

            const handleDragStart = (e, task) => {
              e.dataTransfer.setData('application/json', JSON.stringify({ id: task.id }))
              e.dataTransfer.effectAllowed = 'move'
              setDraggingTaskId(task.id)
            }
            const handleDragEnd = () => {
              setDraggingTaskId(null)
              setDropTargetDate(null)
            }
            const handleDrop = (e, targetDateKey) => {
              e.preventDefault()
              setDropTargetDate(null)
              const raw = e.dataTransfer.getData('application/json')
              if (!raw) return
              try {
                const { id } = JSON.parse(raw)
                const task = tasks.find((t) => t.id === id)
                if (task && targetDateKey) handleMoveTaskToDay(task, targetDateKey)
              } catch (_) {}
            }
            const handleDragOver = (e, dateKey) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropTargetDate(dateKey)
            }

            const renderTaskRow = (task) => {
              const done = !!task.completed_at
              const subject = subjects.find((s) => s.id === task.subject_id)
              const linkedSubject = resolveSubjectForTask(task)
              const isDragging = draggingTaskId === task.id
              const accentClass = getTaskAccent(task.type)
              const compactWrapper = `group rounded-xl border bg-white shadow-sm p-2.5 transition ${
                done ? 'border-emerald-200 bg-emerald-50/40' : 'border-studiio-lavender/40'
              } ${isDragging ? 'opacity-50' : ''} ${showForm ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`
              return (
                <li
                  key={task.id}
                  draggable={!showForm}
                  onDragStart={(e) => handleDragStart(e, task)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleTaskCardClick(task)}
                  className={
                    weekView === 'timeline'
                      ? `rounded-lg border border-studiio-lavender/30 bg-white px-2 py-2 ${isDragging ? 'opacity-50' : ''} ${showForm ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`
                      : compactWrapper
                  }
                >
                  {weekView === 'timeline' ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-7 w-1.5 rounded-full ${accentClass}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-semibold text-studiio-ink ${done ? 'line-through opacity-70' : ''}`}>{getTaskTitle(task)}</p>
                        <p className="text-[11px] text-studiio-muted">{formatTaskTime(task.scheduled_at)}</p>
                      </div>
                      {!showForm && weekView === 'extended' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(task)
                          }}
                          className="shrink-0 rounded border border-studiio-lavender/60 px-2 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20"
                        >
                          Bearbeiten
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 h-10 w-1.5 rounded-full ${accentClass}`} />
                        <div
                          className="min-w-0 flex-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className={`truncate text-sm font-semibold text-studiio-ink ${done ? 'line-through opacity-70' : ''}`}>{getTaskTitle(task)}</p>
                          </div>
                          <p className="mt-0.5 text-[11px] text-studiio-muted">{formatTaskTime(task.scheduled_at)}</p>
                        </div>
                      </div>
                      {!showForm && !done && linkedSubject && weekView === 'extended' && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-3.5" onClick={(e) => e.stopPropagation()}>
                          {task.material_id && onOpenTutor ? (
                            <button
                              type="button"
                              onClick={() => onOpenTutor(linkedSubject, task.material_id)}
                              className="rounded border border-studiio-lavender/60 px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-sky/20"
                            >
                              Zur Vorlesung
                            </button>
                          ) : onOpenSubject ? (
                            <button type="button" onClick={() => onOpenSubject(linkedSubject)} className="rounded border border-studiio-lavender/60 px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-sky/20">
                              Fach öffnen
                            </button>
                          ) : null}
                        </div>
                      )}
                      {!showForm && weekView === 'extended' && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-3.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => startEdit(task)}
                            className="rounded border border-studiio-lavender/60 px-2 py-1 text-xs text-studiio-ink hover:bg-studiio-sky/20"
                          >
                            Bearbeiten
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            }
            if (sortedDays.length > 0) {
              const weekLabel = `${formatDayShort(weekRow[0])} – ${formatDayShort(weekRow[6])}`
              const todayKey = toLocalDateKey(new Date())
              return (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const [y, m, day] = weekStart.split('-').map(Number)
                        const d = new Date(y, m - 1, day)
                        d.setDate(d.getDate() - 7)
                        setWeekStart(toLocalDateKey(d))
                      }}
                      className="rounded-full border border-[#d3d8e0] bg-[#f2f0ea] px-4 py-2 text-sm font-semibold text-[#3b3f52] hover:bg-[#ece8de]"
                    >
                      ← Vorherige Woche
                    </button>
                    <p className="text-3xl font-semibold text-[#31344a]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{weekLabel}</p>
                    <button
                      type="button"
                      onClick={() => {
                        const [y, m, day] = weekStart.split('-').map(Number)
                        const d = new Date(y, m - 1, day)
                        d.setDate(d.getDate() + 7)
                        setWeekStart(toLocalDateKey(d))
                      }}
                      className="rounded-full border border-[#d3d8e0] bg-[#f2f0ea] px-4 py-2 text-sm font-semibold text-[#3b3f52] hover:bg-[#ece8de]"
                    >
                      Nächste Woche →
                    </button>
                  </div>
                  <div className="overflow-hidden">
                    <div
                      className="grid w-full gap-3"
                      style={{
                        gridTemplateColumns: weekRow.map((dateKey) => {
                          if (dateKey < todayKey) return '0.9fr' // vergangene Tage etwas kleiner
                          if (dateKey === todayKey) return '1.35fr' // heutiger Tag größer
                          return '1fr' // kommende Tage normal
                        }).join(' '),
                      }}
                    >
                      {weekRow.map((dateKey, di) => {
                        const dayTasks = byDay[dateKey] || []
                        const isDropTarget = dropTargetDate === dateKey
                        const isToday = dateKey === todayKey
                        const dayTint = ['#f2dde6', '#e0dcef', '#dbe8f4', '#dcefeb', '#efe8d8', '#efe2dd', '#efdfe6'][di]
                        return (
                          <div
                            key={dateKey}
                            onDragOver={(e) => handleDragOver(e, dateKey)}
                            onDragLeave={() => setDropTargetDate(null)}
                            onDrop={(e) => handleDrop(e, dateKey)}
                            className={`rounded-2xl border overflow-hidden flex flex-col min-w-0 transition-colors ${
                              isDropTarget
                                ? 'border-[#49a99b] bg-[#dff3ef]'
                                : isToday
                                  ? 'border-[#8fb8e2] bg-[#e8f2ff]'
                                  : 'border-white/40'
                            }`}
                            style={!isDropTarget ? { backgroundColor: dayTint } : undefined}
                          >
                            <div className="px-3 py-2 border-b border-white/40 shrink-0">
                              <p
                                className="text-[0.82rem] leading-tight font-semibold text-[#31344a] whitespace-nowrap"
                              >
                                {WEEKDAY_LABELS[di]}
                              </p>
                              <p className="text-xs text-studiio-muted mt-0.5">{formatDayShort(dateKey)}</p>
                            </div>
                            <ul className={`flex-1 min-h-0 overflow-auto p-1.5 space-y-1.5 ${
                              weekView === 'timeline' ? '' : 'divide-y-0'
                            }`}>
                              {dayTasks.map((task) => renderTaskRow(task))}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )
            }
            return (
              <div className="rounded-xl border border-studiio-lavender/40 bg-white/60 overflow-hidden">
                <div className="bg-studiio-lavender/20 px-3 py-2 border-b border-studiio-lavender/30">
                  <p className="text-sm font-semibold text-studiio-ink">Alle Aufgaben</p>
                </div>
                <ul className="divide-y divide-studiio-lavender/20">
                  {tasks.map(renderTaskRow)}
                </ul>
              </div>
            )
          })()}
        </div>
      )}
      <CompletionCelebration
        open={!!celebration}
        taskLabel={celebration?.taskLabel}
        subjectName={celebration?.subjectName}
        continueLabel="Weiter lernen"
        onContinue={() => setCelebration(null)}
        onClose={() => setCelebration(null)}
      />
    </section>
  )
}
