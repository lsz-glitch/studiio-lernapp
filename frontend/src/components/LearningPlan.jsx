import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { completeTask, uncompleteTask, updateTask } from '../utils/learningPlan'
import CompletionCelebration from './CompletionCelebration'

const TASK_TYPES = [
  { value: 'tutor', label: 'Datei mit Tutor durcharbeiten' },
  { value: 'vocab', label: 'Vokabeln eines Fachs durcharbeiten' },
  { value: 'exam', label: 'Klausur bearbeiten' },
  { value: 'manual', label: 'Eigener Task (manuell)' },
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
  const [scheduledTime, setScheduledTime] = useState('09:00')
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
      .then(({ data, error }) => {
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
    setScheduledTime('09:00')
    setShowForm(false)
  }

  function startEdit(task) {
    setType(task.type)
    setSubjectId(task.subject_id || '')
    setMaterialId(task.material_id || '')
    setTitle(task.title || '')
    setDescription(task.description || '')
    setScheduledDate(task.scheduled_at ? task.scheduled_at.slice(0, 10) : '')
    setScheduledTime(task.scheduled_at ? task.scheduled_at.slice(11, 16) : '09:00')
    setEditingTask(task)
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user?.id) return
    const date = scheduledDate || new Date().toISOString().slice(0, 10)
    const scheduledAt = new Date(`${date}T${scheduledTime}:00`).toISOString()

    let taskTitle = title.trim()
    if (type !== 'manual') {
      const sub = subjects.find((s) => s.id === subjectId)
      const subName = sub?.name || 'Fach'
      if (type === 'tutor') {
        const mat = materials.find((m) => m.id === materialId)
        taskTitle = mat ? `Tutor: ${mat.filename}` : `Tutor: ${subName}`
      } else if (type === 'vocab') taskTitle = `Vokabeln: ${subName}`
      else if (type === 'exam') taskTitle = `Klausur: ${subName}`
    }
    if (!taskTitle) {
      setTitle('')
      return
    }

    setSaving(true)
    if (editingTask) {
      const { data, error } = await updateTask(user.id, editingTask.id, {
        type,
        subject_id: subjectId || null,
        material_id: type === 'tutor' ? materialId || null : null,
        title: taskTitle,
        description: description.trim() || null,
        scheduled_at: scheduledAt,
      })
      setSaving(false)
      if (error) {
        console.error('Task aktualisieren:', error)
        return
      }
      if (data) setTasks((prev) => prev.map((t) => (t.id === data.id ? data : t)))
      resetForm()
      return
    }

    const payload = {
      user_id: user.id,
      type,
      title: taskTitle,
      description: description.trim() || null,
      scheduled_at: scheduledAt,
      subject_id: subjectId || null,
      material_id: type === 'tutor' ? materialId || null : null,
    }
    const { data, error } = await supabase.from('learning_plan_tasks').insert(payload).select('id, type, subject_id, material_id, title, description, scheduled_at, completed_at').single()
    setSaving(false)
    if (error) {
      console.error('Task anlegen:', error)
      return
    }
    setTasks((prev) => [...prev, data])
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
                setScheduledTime('09:00')
                setShowForm(true)
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#49a99b] text-white px-4 py-2 text-sm font-semibold hover:brightness-95"
          >
            <span className="text-base leading-none">+</span>
            {showForm ? 'Schließen' : 'Task hinzufügen'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 grid gap-3 rounded-xl border border-studiio-lavender/40 bg-studiio-sky/10 p-4">
          {editingTask && <p className="text-sm font-medium text-studiio-ink">Task bearbeiten</p>}
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
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notiz oder Beschreibung zum Task" rows={2} className="studiio-input w-full resize-y" />
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
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="studiio-btn-primary">
              {saving ? 'Wird gespeichert …' : editingTask ? 'Änderungen speichern' : 'Task eintragen'}
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
        <p className="text-sm text-studiio-muted">Noch keine Tasks. Füge einen hinzu, um deinen Lernplan zu füllen.</p>
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
              const compactWrapper = `group rounded-xl border bg-white shadow-sm p-2.5 cursor-grab active:cursor-grabbing transition ${
                done ? 'border-emerald-200 bg-emerald-50/40' : 'border-studiio-lavender/40'
              } ${isDragging ? 'opacity-50' : ''}`
              return (
                <li
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleToggle(task)}
                  className={
                    weekView === 'timeline'
                      ? `rounded-lg border border-studiio-lavender/30 bg-white px-2 py-2 ${isDragging ? 'opacity-50' : ''} cursor-pointer`
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
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 h-10 w-1.5 rounded-full ${accentClass}`} />
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => startEdit(task)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(task) } }}
                          className="min-w-0 flex-1 cursor-pointer"
                          aria-label="Task bearbeiten"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className={`truncate text-sm font-semibold text-studiio-ink ${done ? 'line-through opacity-70' : ''}`}>{getTaskTitle(task)}</p>
                          </div>
                          <p className="mt-0.5 text-[11px] text-studiio-muted">{formatTaskTime(task.scheduled_at)}</p>
                        </div>
                      </div>
                      {!done && linkedSubject && weekView === 'extended' && (
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
                  <p className="text-sm font-semibold text-studiio-ink">Alle Tasks</p>
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
