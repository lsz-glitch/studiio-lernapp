import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

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

function isMissingDescriptionColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('description') && msg.includes('column'))
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('de-DE')
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
  const activeSubject = useMemo(
    () => availableSubjects.find((s) => s.id === activeSubjectId) || subject,
    [availableSubjects, activeSubjectId, subject],
  )
  const planningDays = useMemo(() => buildPlanningDays(activeSubject), [activeSubject?.exam_date])

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
      .select('id, type, title, description, scheduled_at, completed_at, material_id')
      .eq('user_id', user.id)
      .eq('subject_id', activeSubjectId)
      .order('scheduled_at', { ascending: true })
      .then(async ({ data, error }) => {
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
  }, [user?.id, activeSubjectId])

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
      .select('id, type, title, scheduled_at, completed_at, subject_id')
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: true })
      .then(({ data, error }) => {
        if (!mounted) return
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
        const aDone = !!a.completed_at
        const bDone = !!b.completed_at
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

  async function createTaskOnDay({ type, title, description, materialId }, dateKey) {
    const scheduledAt = new Date(`${dateKey}T09:00:00`).toISOString()
    const payload = {
      user_id: user.id,
      subject_id: activeSubjectId,
      material_id: materialId || null,
      type,
      title,
      description,
      scheduled_at: scheduledAt,
    }
    let { data, error } = await supabase
      .from('learning_plan_tasks')
      .insert(payload)
      .select('id, type, title, description, scheduled_at, completed_at, material_id')
      .single()
    if (error && isMissingDescriptionColumn(error)) {
      const { description: _desc, ...payloadWithoutDescription } = payload
      const retry = await supabase
        .from('learning_plan_tasks')
        .insert(payloadWithoutDescription)
        .select('id, type, title, scheduled_at, completed_at, material_id')
        .single()
      data = retry.data ? { ...retry.data, description: null } : null
      error = retry.error
    }
    if (error) {
      console.error('Plan-Modus: Aufgabe anlegen fehlgeschlagen:', error)
      return
    }
    setTasks((prev) => [...prev, data].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
  }

  async function moveTask(taskId, dateKey) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
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
      return
    }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, scheduled_at: next.toISOString() } : t)))
  }

  async function removeTaskFromPlan(taskId) {
    const { error } = await supabase
      .from('learning_plan_tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', user.id)
    if (error) {
      console.error('Plan-Modus: Entfernen fehlgeschlagen:', error)
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
    const { error } = await supabase
      .from('learning_plan_tasks')
      .update({ description: nextDescription || null })
      .eq('id', task.id)
      .eq('user_id', user.id)
    setSavingCommentId('')
    if (error) {
      console.error('Plan-Modus: Kommentar speichern fehlgeschlagen:', error)
      return
    }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, description: nextDescription || null } : t)))
  }

  function toggleSection(sectionKey) {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
  }

  function addPendingTutorItem() {
    const value = newTutorName.trim()
    if (!value) return
    setPendingTutorItems((prev) => [...prev, { id: crypto.randomUUID(), name: value }])
    setNewTutorName('')
  }

  function addPendingManualItem() {
    const value = newManualName.trim()
    if (!value) return
    setPendingManualItems((prev) => [...prev, { id: crypto.randomUUID(), name: value }])
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

  const tutorCatalogItems = useMemo(() => {
    const uploaded = materials.map((m) => ({
      id: `tutor_${m.id}`,
      type: 'tutor',
      materialId: m.id,
      title: `Tutor: ${m.filename}`,
      description: m.category ? `Kategorie: ${m.category}` : 'Tutor-Aufgabe für dieses Material',
    }))
    const pending = pendingTutorItems.map((item) => ({
      id: `pending_tutor_${item.id}`,
      type: 'tutor',
      materialId: null,
      title: `Tutor: ${item.name}`,
      description: 'Platzhalter-Datei (noch nicht hochgeladen)',
      pendingTutorId: item.id,
    }))
    return [...uploaded, ...pending]
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

  const vocabCreateCatalogItems = useMemo(() => {
    const byMaterial = materials
      .filter((m) => canCreateVocabForMaterial(m))
      .map((m) => ({
      id: `vocab_create_${m.id}`,
      type: 'manual',
      materialId: m.id,
      title: `Vokabeln erstellen: ${m.filename}`,
      description: m.category ? `Datei (${m.category})` : 'Datei',
    }))
    if (byMaterial.length > 0) return byMaterial
    return [
      {
        id: 'vocab_create_generic',
        type: 'manual',
        materialId: null,
        title: 'Vokabeln erstellen',
        description: 'Neue Vokabeln erstellen',
      },
    ]
  }, [materials])

  const catalogSections = [
    {
      key: 'tutor',
      title: 'Tutor-Modus',
      items: tutorCatalogItems,
    },
    {
      key: 'vocab',
      title: 'Vokabeln',
      items: [
        ...vocabCreateCatalogItems,
        { id: 'vocab_practice', type: 'vocab', materialId: null, title: 'Vokabeln lernen', description: 'Vokabeln aktiv wiederholen' },
      ],
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
    <section className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline">
            <span className="inline-block rotate-180 text-base">➜</span>
            Zurück zum Fach
          </button>
          <h3 className="text-base font-semibold text-studiio-ink">Plan-Modus · {activeSubject?.name || subject?.name}</h3>
        </div>
      )}

      <div className={showCatalog ? 'grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]' : ''}>
        {showCatalog && (
        <aside className="h-fit rounded-2xl border border-studiio-lavender/50 bg-white/90 p-4 md:sticky md:top-4">
          {allowSubjectSelection && (
            <div className="mb-3">
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
          <h4 className="text-sm font-semibold text-studiio-ink">Aufgaben-Katalog</h4>
          <p className="mt-1 text-xs text-studiio-muted">Überthema aufklappen und Eintrag auf einen Tag ziehen.</p>
          <div className="mt-3 space-y-2">
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
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={newTutorName}
                          onChange={(e) => setNewTutorName(e.target.value)}
                          placeholder="Noch nicht hochgeladene Vorlesung benennen"
                          className="studiio-input w-full text-xs"
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
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={newManualName}
                          onChange={(e) => setNewManualName(e.target.value)}
                          placeholder="Frei benennbare Aufgabe"
                          className="studiio-input w-full text-xs"
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
                    <ul className="space-y-2">
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
                        className={`cursor-grab rounded-md border px-2 py-1.5 active:cursor-grabbing ${
                          isAlreadyPlanned(item)
                            ? 'border-emerald-300 bg-emerald-50/70'
                            : 'border-studiio-lavender/40 bg-studiio-sky/10'
                        }`}
                      >
                        {item.pendingTutorId ? (
                          <div className="mb-1 flex items-center gap-1">
                            <input
                              type="text"
                              value={item.title.replace(/^Tutor:\s*/, '')}
                              onChange={(e) => renamePendingTutorItem(item.pendingTutorId, e.target.value)}
                              className="studiio-input w-full text-xs"
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
                          <div className="mb-1 flex items-center gap-1">
                            <input
                              type="text"
                              value={item.title}
                              onChange={(e) => renamePendingManualItem(item.pendingManualId, e.target.value)}
                              className="studiio-input w-full text-xs"
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
                        ) : (
                          <p className="text-xs font-medium text-studiio-ink">
                            {isAlreadyPlanned(item) ? '✓ ' : ''}
                            {item.title}
                          </p>
                        )}
                        <p className="text-[11px] text-studiio-muted">{item.description}</p>
                      </li>
                    ))}
                    </ul>
                    {section.items.length === 0 && (
                      <p className="rounded-md bg-studiio-sky/10 px-2 py-1 text-[11px] text-studiio-muted">
                        Hier sind noch keine Einträge vorhanden.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
        )}

        <div className="rounded-2xl border border-studiio-lavender/50 bg-white/90 p-4">
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
              : `Tage bis zur Klausur ${activeSubject?.exam_date ? `(bis ${new Date(activeSubject.exam_date).toLocaleDateString('de-DE')})` : '(nächste 30 Tage)'}`}
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
                      {(allTasksByDay[dayKey] || []).map((task) => {
                        const subName = availableSubjects.find((s) => s.id === task.subject_id)?.name || 'Fach'
                        return (
                          <li
                            key={task.id}
                            className={`rounded-md border px-2 py-1 text-xs ${task.completed_at ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-studiio-lavender/40 bg-white text-studiio-ink'}`}
                          >
                            <p className="font-medium break-words">{task.title}</p>
                            <p className="text-[11px] text-studiio-muted">{subName}</p>
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
                    {(tasksByDay[dayKey] || []).map((task) => (
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
                        className={`rounded-md border px-2 py-1 text-xs ${task.completed_at ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-studiio-lavender/40 bg-white text-studiio-ink'} ${interactive ? 'cursor-grab' : onTaskClick ? 'cursor-pointer hover:bg-studiio-sky/20' : 'cursor-default'}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="break-words font-medium">{task.title}</p>
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
