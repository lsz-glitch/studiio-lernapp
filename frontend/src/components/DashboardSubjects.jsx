import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import SubjectProgressMini from './SubjectProgressMini'
import LearningPlan from './LearningPlan'
import { getApiBase } from '../config'
import { getStreak } from '../utils/streak'
import { formatLearningTime, getTodayLearningTimeDb, getTodayLearningTimeLocal } from '../utils/learningTime'

function getAccentByIndex(index) {
  const accents = ['#4fb4ad', '#e2ad4f', '#9fc7a3', '#df9a96', '#9ea8c2', '#88b6dc']
  return accents[index % accents.length]
}

function formatCountdown(examDate) {
  if (!examDate) return 'Kein Termin eingetragen'
  const today = new Date()
  const target = new Date(examDate)

  // Nur Datum vergleichen (ohne Uhrzeit)
  const oneDayMs = 1000 * 60 * 60 * 24
  const diffDays = Math.round((target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / oneDayMs)

  if (Number.isNaN(diffDays)) return 'Ungültiges Datum'
  if (diffDays === 0) return 'Heute ist Klausurtag'
  if (diffDays > 0) return `Noch ${diffDays} Tag${diffDays === 1 ? '' : 'e'}`
  const pastDays = Math.abs(diffDays)
  return `Klausur war vor ${pastDays} Tag${pastDays === 1 ? '' : 'en'}`
}

function normalizeSubjectName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('de-DE')
}

function getDisplayName(user) {
  const metaName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.display_name
  if (metaName && String(metaName).trim()) return String(metaName).trim()
  const email = user?.email || ''
  const localPart = email.split('@')[0] || 'Lernende'
  const clean = localPart.replace(/[._-]+/g, ' ').trim()
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Lernende'
}

function getGreetingText() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Guten Morgen!'
  return 'Guten Tag!'
}

export default function DashboardSubjects({
  user,
  onOpenSubject,
  onStartPractice,
  onOpenTutor,
  onTodayPlannedChange,
  showTopSection = true,
  showLearningPlanSection = true,
  showSubjectsSection = true,
}) {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [streak, setStreak] = useState({ current_streak_days: 0, last_activity_date: null })
  const [todayStats, setTodayStats] = useState({
    planned: 0,
    completed: 0,
    learnedSeconds: 0,
  })
  const [todayCompletedTasks, setTodayCompletedTasks] = useState([])

  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [examDate, setExamDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [manageMode, setManageMode] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [editExamDate, setEditExamDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [shareTarget, setShareTarget] = useState(null)
  const [shareIncludeSubject, setShareIncludeSubject] = useState(true)
  const [shareIncludeNotes, setShareIncludeNotes] = useState(true)
  const [shareIncludeMaterials, setShareIncludeMaterials] = useState(true)
  const [shareIncludeFlashcards, setShareIncludeFlashcards] = useState(true)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState('')
  const [shareCode, setShareCode] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareCodeLabel, setShareCodeLabel] = useState('')
  const [shareCodes, setShareCodes] = useState([])
  const [shareCodesLoading, setShareCodesLoading] = useState(false)
  const [shareCodesError, setShareCodesError] = useState('')
  const [shareFilter, setShareFilter] = useState('active')
  const [importOpen, setImportOpen] = useState(false)
  const [importCode, setImportCode] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')
  const [copyStatusCode, setCopyStatusCode] = useState('')
  const [importPreviewLoading, setImportPreviewLoading] = useState(false)
  const [importPreview, setImportPreview] = useState(null)

  useEffect(() => {
    let isMounted = true
    async function loadSubjects() {
      setLoading(true)
      setError('')
      const { data, error: err } = await supabase
        .from('subjects')
        .select('id, name, group_label, exam_date')
        .eq('user_id', user.id)
        .order('group_label', { ascending: true, nullsFirst: true })
        .order('name', { ascending: true })

      if (!isMounted) return

      if (err) {
        console.error('Fehler beim Laden der Fächer:', err)
        setError(
          `Fächer konnten nicht geladen werden: ${err.message || 'Bitte prüfe die Tabelle \"subjects\" in Supabase.'}`,
        )
        setLoading(false)
        return
      }

      setSubjects(data || [])
      setLoading(false)
    }

    loadSubjects()
    return () => {
      isMounted = false
    }
  }, [user.id])

  useEffect(() => {
    let mounted = true

    function getTodayRangeUtc() {
      const startLocal = new Date()
      startLocal.setHours(0, 0, 0, 0)
      const endLocal = new Date(startLocal)
      endLocal.setDate(endLocal.getDate() + 1)
      return {
        startIso: startLocal.toISOString(),
        endIso: endLocal.toISOString(),
      }
    }

    async function loadTodayStats() {
      const { startIso, endIso } = getTodayRangeUtc()
      const { data, error: err } = await supabase
        .from('learning_plan_tasks')
        .select('id, completed_at')
        .eq('user_id', user.id)
        .gte('scheduled_at', startIso)
        .lt('scheduled_at', endIso)

      if (!mounted) return

      if (err) {
        console.error('Fehler beim Laden der Tages-Statistiken:', err)
        setTodayStats((prev) => ({ ...prev, learnedSeconds: getTodayLearningTimeLocal() }))
        return
      }

      const planned = (data || []).length
      const completed = (data || []).filter((task) => !!task.completed_at).length
      let learnedSeconds = 0
      try {
        learnedSeconds = await getTodayLearningTimeDb(user.id)
      } catch (_) {
        learnedSeconds = getTodayLearningTimeLocal()
      }
      setTodayStats({ planned, completed, learnedSeconds })
      if (onTodayPlannedChange) onTodayPlannedChange(planned)

      const { data: completedToday, error: completedErr } = await supabase
        .from('learning_plan_tasks')
        .select('id, title, type, subject_id, material_id, completed_at')
        .eq('user_id', user.id)
        .gte('completed_at', startIso)
        .lt('completed_at', endIso)
        .order('completed_at', { ascending: false })

      if (!mounted) return
      if (completedErr) {
        console.error('Fehler beim Laden erledigter Tages-Tasks:', completedErr)
        setTodayCompletedTasks([])
      } else {
        const taskRows = completedToday || []
        const taskTutorMaterialIds = new Set(
          taskRows
            .filter((t) => t.type === 'tutor' && t.material_id)
            .map((t) => t.material_id),
        )

        const { data: tutorRows, error: tutorErr } = await supabase
          .from('tutor_progress')
          .select('material_id, updated_at')
          .eq('user_id', user.id)
          .eq('is_completed', true)
          .gte('updated_at', startIso)
          .lt('updated_at', endIso)

        if (tutorErr) {
          console.error('Fehler beim Laden erledigter Tutor-Durchläufe:', tutorErr)
          setTodayCompletedTasks(taskRows)
          return
        }

        const tutorRowsWithoutTask = (tutorRows || []).filter(
          (row) => row.material_id && !taskTutorMaterialIds.has(row.material_id),
        )
        if (!tutorRowsWithoutTask.length) {
          setTodayCompletedTasks(taskRows)
          return
        }

        const materialIds = Array.from(new Set(tutorRowsWithoutTask.map((row) => row.material_id)))
        const { data: materialRows } = await supabase
          .from('materials')
          .select('id, filename')
          .in('id', materialIds)
          .eq('user_id', user.id)
          .is('deleted_at', null)
        const filenameById = new Map((materialRows || []).map((m) => [m.id, m.filename]))

        const tutorEntries = tutorRowsWithoutTask.map((row) => ({
          id: `tutor-${row.material_id}`,
          title: `Tutor: ${filenameById.get(row.material_id) || 'Datei'}`,
          type: 'tutor',
          completed_at: row.updated_at,
          material_id: row.material_id,
        }))

        const completedVocabSubjectIds = new Set(
          taskRows
            .filter((t) => t.type === 'vocab' && t.subject_id)
            .map((t) => t.subject_id),
        )

        const { data: reviewRows, error: reviewErr } = await supabase
          .from('flashcard_reviews')
          .select('flashcard_id, created_at')
          .eq('user_id', user.id)
          .gte('created_at', startIso)
          .lt('created_at', endIso)

        let vocabEntries = []
        if (reviewErr) {
          console.error('Fehler beim Laden heutiger Vokabel-Übungen:', reviewErr)
        } else if ((reviewRows || []).length > 0) {
          const flashcardIds = Array.from(new Set((reviewRows || []).map((r) => r.flashcard_id).filter(Boolean)))
          if (flashcardIds.length > 0) {
            const { data: flashcardRows, error: flashcardErr } = await supabase
              .from('flashcards')
              .select('id, subject_id')
              .in('id', flashcardIds)
              .eq('user_id', user.id)
            if (flashcardErr) {
              console.error('Fehler beim Zuordnen der Vokabel-Übungen zu Fächern:', flashcardErr)
            } else {
              const subjectByCardId = new Map((flashcardRows || []).map((f) => [f.id, f.subject_id]))
              const countBySubject = new Map()
              let latestBySubject = new Map()
              for (const row of reviewRows || []) {
                const sid = subjectByCardId.get(row.flashcard_id)
                if (!sid || completedVocabSubjectIds.has(sid)) continue
                countBySubject.set(sid, (countBySubject.get(sid) || 0) + 1)
                const ts = row.created_at ? new Date(row.created_at).getTime() : 0
                const prev = latestBySubject.get(sid) || 0
                if (ts > prev) latestBySubject.set(sid, ts)
              }

              const subjectIds = Array.from(countBySubject.keys())
              let subjectNameById = new Map()
              if (subjectIds.length > 0) {
                const { data: subjectRows } = await supabase
                  .from('subjects')
                  .select('id, name')
                  .in('id', subjectIds)
                  .eq('user_id', user.id)
                subjectNameById = new Map((subjectRows || []).map((s) => [s.id, s.name]))
              }
              vocabEntries = subjectIds.map((sid) => ({
                id: `vocab-${sid}`,
                title: `Vokabeln geübt: ${subjectNameById.get(sid) || 'Fach'}`,
                type: 'vocab',
                subject_id: sid,
                completed_at: new Date(latestBySubject.get(sid) || Date.now()).toISOString(),
              }))
            }
          }
        }

        const merged = [...taskRows, ...tutorEntries, ...vocabEntries].sort((a, b) => {
          const at = a?.completed_at ? new Date(a.completed_at).getTime() : 0
          const bt = b?.completed_at ? new Date(b.completed_at).getTime() : 0
          return bt - at
        })
        setTodayCompletedTasks(merged)
      }
    }

    loadTodayStats()
    const intervalId = window.setInterval(loadTodayStats, 30000)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [user.id, onTodayPlannedChange])

  useEffect(() => {
    let mounted = true
    async function loadStreak() {
      const data = await getStreak(user.id)
      if (!mounted) return
      setStreak(data || { current_streak_days: 0, last_activity_date: null })
    }
    loadStreak()
    const intervalId = window.setInterval(loadStreak, 30000)
    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [user.id])

  function getTaskTypeLabel(type) {
    if (type === 'tutor') return 'Tutor'
    if (type === 'vocab') return 'Vokabeln'
    if (type === 'exam') return 'Klausur'
    return 'Aufgabe'
  }

  const groupedSubjects = useMemo(() => {
    const groups = new Map()
    for (const subject of subjects) {
      const key = subject.group_label || 'Ohne Zuordnung'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(subject)
    }
    return Array.from(groups.entries())
  }, [subjects])

  const filteredShareCodes = useMemo(() => {
    return shareCodes.filter((item) => {
      const expired = item.expires_at ? new Date(item.expires_at).getTime() < Date.now() : false
      const active = item.is_active && !expired
      if (shareFilter === 'active') return active
      if (shareFilter === 'expired') return expired
      return true
    })
  }, [shareCodes, shareFilter])
  async function handleCreateSubject(e) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Bitte gib deinem Fach einen Namen.')
      return
    }

    setSaving(true)
    const { data, error: err } = await supabase
      .from('subjects')
      .insert({
        user_id: user.id,
        name: name.trim(),
        group_label: group.trim() || null,
        exam_date: examDate || null,
      })
      .select('id, name, group_label, exam_date')
      .single()

    setSaving(false)

    if (err) {
      console.error('Fehler beim Anlegen eines Fachs:', err)
      setError(`Fach konnte nicht angelegt werden: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setSubjects((prev) => [...prev, data])
    setName('')
    setGroup('')
    setExamDate('')
  }

  function startEdit(subject) {
    if (!manageMode) return
    setEditingId(subject.id)
    setEditName(subject.name || '')
    setEditGroup(subject.group_label || '')
    setEditExamDate(subject.exam_date || '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditGroup('')
    setEditExamDate('')
  }

  function startDelete(subject) {
    if (!manageMode) return
    setDeleteTarget(subject)
    setDeleteConfirmName('')
    setDeleteError('')
  }

  function cancelDelete() {
    setDeleteTarget(null)
    setDeleteConfirmName('')
    setDeleteError('')
  }

  async function loadShareCodes(subjectId) {
    if (!subjectId) return
    setShareCodesLoading(true)
    setShareCodesError('')
    const { data, error: err } = await supabase
      .from('subject_share_exports')
      .select('id, share_code, code_label, is_active, created_at, expires_at, include_subject, include_notes, include_materials, include_flashcards')
      .eq('owner_user_id', user.id)
      .eq('source_subject_id', subjectId)
      .order('created_at', { ascending: false })
      .limit(12)
    setShareCodesLoading(false)
    if (err) {
      console.error('Share-Codes laden fehlgeschlagen:', err)
      setShareCodesError('Bisherige Codes konnten nicht geladen werden.')
      setShareCodes([])
      return
    }
    setShareCodes(data || [])
  }

  function startShare(subject) {
    setShareTarget(subject)
    setShareIncludeSubject(true)
    setShareIncludeNotes(true)
    setShareIncludeMaterials(true)
    setShareIncludeFlashcards(true)
    setShareError('')
    setShareCode('')
    setShareCodeLabel('')
    setShareExpiresAt('')
    setShareFilter('active')
    loadShareCodes(subject.id)
  }

  function cancelShare() {
    setShareTarget(null)
    setShareError('')
    setShareCode('')
    setShareCodeLabel('')
    setShareExpiresAt('')
    setShareCodes([])
    setShareCodesError('')
    setShareLoading(false)
  }

  async function handleUpdateSubject(e) {
    e.preventDefault()
    if (!editingId) return
    setError('')

    if (!editName.trim()) {
      setError('Bitte gib deinem Fach einen Namen.')
      return
    }

    setEditSaving(true)
    const { data, error: err } = await supabase
      .from('subjects')
      .update({
        name: editName.trim(),
        group_label: editGroup.trim() || null,
        exam_date: editExamDate || null,
      })
      .eq('id', editingId)
      .select('id, name, group_label, exam_date')
      .single()

    setEditSaving(false)

    if (err) {
      console.error('Fehler beim Bearbeiten eines Fachs:', err)
      setError(`Fach konnte nicht aktualisiert werden: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setSubjects((prev) => prev.map((s) => (s.id === data.id ? data : s)))
    cancelEdit()
  }

  async function handleDeleteSubject(e) {
    if (e?.preventDefault) e.preventDefault()
    if (!deleteTarget) return
    setDeleteError('')

    if (normalizeSubjectName(deleteConfirmName) !== normalizeSubjectName(deleteTarget.name)) {
      setDeleteError('Der eingegebene Name passt nicht zum Fachnamen.')
      return
    }

    setDeleting(true)
    const { error: err } = await supabase
      .from('subjects')
      .delete()
      .eq('id', deleteTarget.id)
      .eq('user_id', user.id)

    setDeleting(false)

    if (err) {
      console.error('Fehler beim Löschen eines Fachs:', err)
      setDeleteError(`Fach konnte nicht gelöscht werden: ${err.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setSubjects((prev) => prev.filter((s) => s.id !== deleteTarget.id))
    cancelDelete()
  }

  async function handleCreateShareCode() {
    if (!shareTarget) return
    const hasAny = shareIncludeSubject || shareIncludeNotes || shareIncludeMaterials || shareIncludeFlashcards
    if (!hasAny) {
      setShareError('Bitte wähle mindestens einen Bereich zum Teilen aus.')
      return
    }
    setShareLoading(true)
    setShareError('')
    setShareCode('')
    setShareExpiresAt('')
    try {
      const res = await fetch(`${getApiBase()}/api/subject-share/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerUserId: user.id,
          subjectId: shareTarget.id,
          codeLabel: shareCodeLabel.trim() || null,
          includeSubject: shareIncludeSubject,
          includeNotes: shareIncludeNotes,
          includeMaterials: shareIncludeMaterials,
          includeFlashcards: shareIncludeFlashcards,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.details || 'Code konnte nicht erstellt werden.')
      setShareCode(data?.export?.share_code || '')
      setShareExpiresAt(data?.export?.expires_at || '')
      await loadShareCodes(shareTarget.id)
    } catch (err) {
      setShareError(err.message || 'Code konnte nicht erstellt werden.')
    } finally {
      setShareLoading(false)
    }
  }

  async function handleDeactivateShareCode(exportId) {
    if (!exportId) return
    const { error: err } = await supabase
      .from('subject_share_exports')
      .update({ is_active: false })
      .eq('id', exportId)
      .eq('owner_user_id', user.id)
    if (err) {
      console.error('Code deaktivieren fehlgeschlagen:', err)
      setShareError('Code konnte nicht deaktiviert werden.')
      return
    }
    if (shareTarget?.id) await loadShareCodes(shareTarget.id)
  }

  async function handleImportByCode() {
    if (!importCode.trim()) {
      setImportError('Bitte gib einen Code ein.')
      return
    }
    setImportLoading(true)
    setImportError('')
    setImportSuccess('')
    try {
      let previewData = importPreview
      if (!previewData) {
        const previewRes = await fetch(`${getApiBase()}/api/subject-share/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: importCode.trim().toUpperCase() }),
        })
        const previewJson = await previewRes.json().catch(() => ({}))
        if (!previewRes.ok) throw new Error(previewJson?.error || previewJson?.details || 'Code konnte nicht geprüft werden.')
        previewData = previewJson?.preview || null
        setImportPreview(previewData)
      }

      let mergeTargetSubjectId = null
      const incomingName = normalizeSubjectName(previewData?.subjectName || '')
      if (incomingName) {
        const sameNameSubject = subjects.find((s) => normalizeSubjectName(s?.name || '') === incomingName)
        if (sameNameSubject) {
          const shouldMerge = window.confirm(
            `Du hast schon ein Fach mit dem Namen "${sameNameSubject.name}".\n\nMöchtest du die Inhalte in dieses bestehende Fach zusammenlegen?\n\nOK = Zusammenlegen\nAbbrechen = neues Fach anlegen`,
          )
          if (shouldMerge) mergeTargetSubjectId = sameNameSubject.id
        }
      }

      const res = await fetch(`${getApiBase()}/api/subject-share/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importerUserId: user.id,
          code: importCode.trim().toUpperCase(),
          mergeTargetSubjectId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.details || 'Import fehlgeschlagen.')
      if (data?.subject && !data?.mergedIntoExisting) {
        setSubjects((prev) => [...prev, data.subject])
      }
      const copied = data?.copied || {}
      const summary = [
        copied.subjectMeta ? 'Rahmendaten' : null,
        copied.notes ? 'Notizen' : null,
        typeof copied.materials === 'number' ? `${copied.materials} Dateien` : null,
        typeof copied.failedMaterials === 'number' && copied.failedMaterials > 0 ? `${copied.failedMaterials} Datei(en) nicht kopiert` : null,
        typeof copied.flashcards === 'number' ? `${copied.flashcards} Vokabeln` : null,
      ].filter(Boolean).join(' • ')
      const prefix = data?.mergedIntoExisting ? 'Fach erfolgreich zusammengelegt' : 'Fach erfolgreich importiert'
      setImportSuccess(summary ? `${prefix} (${summary}).` : `${prefix}.`)
      setImportCode('')
      setImportPreview(null)
    } catch (err) {
      setImportError(err.message || 'Import fehlgeschlagen.')
    } finally {
      setImportLoading(false)
    }
  }

  async function handleCopyShareCode(code) {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopyStatusCode(code)
      window.setTimeout(() => setCopyStatusCode(''), 1400)
    } catch (_) {
      setShareError('Code konnte nicht in die Zwischenablage kopiert werden.')
    }
  }

  async function handlePreviewImportCode() {
    if (!importCode.trim()) {
      setImportError('Bitte gib einen Code ein.')
      setImportPreview(null)
      return
    }
    setImportPreviewLoading(true)
    setImportError('')
    setImportPreview(null)
    try {
      const res = await fetch(`${getApiBase()}/api/subject-share/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: importCode.trim().toUpperCase() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.details || 'Code konnte nicht geprüft werden.')
      setImportPreview(data?.preview || null)
    } catch (err) {
      setImportError(err.message || 'Code konnte nicht geprüft werden.')
    } finally {
      setImportPreviewLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="px-1">
        {showTopSection && (
          <>
            <h2 className="text-5xl font-semibold tracking-tight text-[#26233c]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              {getGreetingText()}
            </h2>
            <p className="mt-2 text-2xl text-[#6c7388]">
              Bereit für einen produktiven Tag, {getDisplayName(user)}?
            </p>
          </>
        )}
      </section>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          onClick={cancelDelete}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-red-800">Fach wirklich löschen?</h3>
            <p className="mt-2 text-sm text-studiio-muted">
              Zum Bestätigen gib bitte den Fachnamen ein:
              <span className="font-semibold text-red-700"> {deleteTarget.name}</span>
            </p>

            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder="Fachname eingeben"
              className="studiio-input mt-3 w-full"
            />

            {deleteError && (
              <p className="mt-2 text-xs text-red-700">{deleteError}</p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                className="rounded-md border border-studiio-lavender/70 px-3 py-1.5 text-sm font-medium text-studiio-muted hover:bg-studiio-lavender/30"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleDeleteSubject}
                disabled={deleting || normalizeSubjectName(deleteConfirmName) !== normalizeSubjectName(deleteTarget.name)}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? 'Löschen …' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4" onClick={cancelShare}>
          <div className="w-full max-w-lg rounded-2xl border border-studiio-lavender/40 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-studiio-ink">Fach teilen per Code</h3>
            <p className="mt-1 text-sm text-studiio-muted">
              Du teilst: <span className="font-semibold text-studiio-ink">{shareTarget.name}</span>
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm text-studiio-ink mb-1">Code-Name (optional)</label>
                <input
                  type="text"
                  value={shareCodeLabel}
                  onChange={(e) => setShareCodeLabel(e.target.value)}
                  placeholder="z. B. Für Anna – nur Vokabeln"
                  className="studiio-input w-full"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-studiio-ink">
                <input type="checkbox" checked={shareIncludeSubject} onChange={(e) => setShareIncludeSubject(e.target.checked)} />
                Rahmendaten
              </label>
              <label className="flex items-center gap-2 text-sm text-studiio-ink">
                <input type="checkbox" checked={shareIncludeNotes} onChange={(e) => setShareIncludeNotes(e.target.checked)} />
                Notizen
              </label>
              <label className="flex items-center gap-2 text-sm text-studiio-ink">
                <input type="checkbox" checked={shareIncludeMaterials} onChange={(e) => setShareIncludeMaterials(e.target.checked)} />
                Dateien
              </label>
              <label className="flex items-center gap-2 text-sm text-studiio-ink">
                <input type="checkbox" checked={shareIncludeFlashcards} onChange={(e) => setShareIncludeFlashcards(e.target.checked)} />
                Vokabeln
              </label>
            </div>
            {shareError && <p className="mt-2 text-xs text-red-700">{shareError}</p>}
            {shareCode && (
              <div className="mt-3 rounded-lg border border-studiio-lavender/50 bg-studiio-sky/20 px-3 py-2">
                <p className="text-xs text-studiio-muted">Dein Import-Code</p>
                <p className="text-lg font-semibold tracking-wider text-studiio-ink">{shareCode}</p>
                {shareExpiresAt && (
                  <p className="mt-1 text-xs text-studiio-muted">
                    Gültig bis: {new Date(shareExpiresAt).toLocaleDateString('de-DE')}
                  </p>
                )}
              </div>
            )}
            <div className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-studiio-muted">Deine letzten Codes</p>
                <div className="inline-flex rounded-full border border-[#d8dee9] bg-[#eef1f6] p-1">
                  {[
                    { id: 'active', label: 'Aktiv' },
                    { id: 'expired', label: 'Abgelaufen' },
                    { id: 'all', label: 'Alle' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setShareFilter(f.id)}
                      className={
                        shareFilter === f.id
                          ? 'rounded-full bg-[#49a99b] px-2.5 py-0.5 text-[11px] font-medium text-white'
                          : 'rounded-full px-2.5 py-0.5 text-[11px] font-medium text-studiio-muted hover:bg-white/70'
                      }
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {shareCodesLoading ? (
                <p className="mt-2 text-xs text-studiio-muted">Codes werden geladen …</p>
              ) : shareCodesError ? (
                <p className="mt-2 text-xs text-red-700">{shareCodesError}</p>
              ) : filteredShareCodes.length === 0 ? (
                <p className="mt-2 text-xs text-studiio-muted">Noch keine Codes erstellt.</p>
              ) : (
                <ul className="mt-2 space-y-2 max-h-44 overflow-auto pr-1">
                  {filteredShareCodes.map((item) => {
                    const expired = item.expires_at ? new Date(item.expires_at).getTime() < Date.now() : false
                    const active = item.is_active && !expired
                    const daysLeft = item.expires_at
                      ? Math.max(0, Math.ceil((new Date(item.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                      : null
                    const expiringSoon = active && daysLeft != null && daysLeft <= 3
                    const includeLabels = [
                      item.include_subject ? 'Rahmendaten' : null,
                      item.include_notes ? 'Notizen' : null,
                      item.include_materials ? 'Dateien' : null,
                      item.include_flashcards ? 'Vokabeln' : null,
                    ].filter(Boolean).join(', ')
                    return (
                      <li
                        key={item.id}
                        className={`rounded-lg border bg-white px-3 py-2 ${
                          expiringSoon ? 'border-amber-300 bg-amber-50/40' : 'border-studiio-lavender/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold tracking-wider text-studiio-ink">{item.share_code}</p>
                            {item.code_label && (
                              <p className="text-[11px] text-studiio-muted truncate">{item.code_label}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-medium ${active ? 'text-emerald-700' : 'text-studiio-muted'}`}>
                              {active ? 'Aktiv' : expired ? 'Abgelaufen' : 'Inaktiv'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyShareCode(item.share_code)}
                              className="rounded border border-studiio-lavender/60 px-2 py-0.5 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20"
                            >
                              {copyStatusCode === item.share_code ? 'Kopiert' : 'Kopieren'}
                            </button>
                          </div>
                        </div>
                        <p className="mt-0.5 text-[11px] text-studiio-muted">
                          Gültig bis: {item.expires_at ? new Date(item.expires_at).toLocaleDateString('de-DE') : '—'}
                        </p>
                        {expiringSoon && (
                          <p className="text-[11px] font-medium text-amber-700">
                            Läuft bald ab ({daysLeft} {daysLeft === 1 ? 'Tag' : 'Tage'}).
                          </p>
                        )}
                        <p className="text-[11px] text-studiio-muted truncate">{includeLabels}</p>
                        {active && (
                          <div className="mt-1.5 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleDeactivateShareCode(item.id)}
                              className="rounded border border-studiio-lavender/60 px-2 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20"
                            >
                              Deaktivieren
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={cancelShare} className="rounded-md border border-studiio-lavender/70 px-3 py-1.5 text-sm font-medium text-studiio-muted hover:bg-studiio-lavender/30">
                Schließen
              </button>
              <button
                type="button"
                onClick={handleCreateShareCode}
                disabled={shareLoading}
                className="rounded-md bg-studiio-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-studiio-accentHover disabled:opacity-60"
              >
                {shareLoading ? 'Erstellt …' : 'Code generieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4" onClick={() => setImportOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-studiio-lavender/40 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-studiio-ink">Fach importieren</h3>
            <p className="mt-1 text-sm text-studiio-muted">Code eingeben und Inhalte übernehmen.</p>
            <div className="mt-2 rounded-lg border border-studiio-lavender/40 bg-[#f8f6fc] px-3 py-2">
              <p className="text-xs text-studiio-muted">
                Kein Code vorhanden? Öffne in <span className="font-medium text-studiio-ink">Meine Fächer</span> den
                Bearbeitungsmodus und klicke beim gewünschten Fach auf <span className="font-medium text-studiio-ink">Teilen</span>,
                dann auf <span className="font-medium text-studiio-ink">Code generieren</span>.
              </p>
            </div>
            <input
              type="text"
              value={importCode}
              onChange={(e) => {
                setImportCode(e.target.value.toUpperCase())
                setImportPreview(null)
              }}
              placeholder="z. B. A7K9P2Q8"
              className="studiio-input mt-3 w-full"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handlePreviewImportCode}
                disabled={importPreviewLoading}
                className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-sky/20 disabled:opacity-60"
              >
                {importPreviewLoading ? 'Prüft …' : 'Code prüfen'}
              </button>
            </div>
            {importPreview && (
              <div className="mt-2 rounded-lg border border-studiio-lavender/50 bg-studiio-sky/20 px-3 py-2">
                <p className="text-sm font-medium text-studiio-ink">{importPreview.subjectName}</p>
                {importPreview.codeLabel && (
                  <p className="text-xs text-studiio-muted">{importPreview.codeLabel}</p>
                )}
                <p className="mt-1 text-xs text-studiio-muted">
                  Gültig bis: {importPreview.expiresAt ? new Date(importPreview.expiresAt).toLocaleDateString('de-DE') : '—'}
                </p>
                <p className="text-xs text-studiio-muted">
                  Enthält: {[
                    importPreview.includeSubject ? 'Rahmendaten' : null,
                    importPreview.includeNotes ? (importPreview.hasNotes ? 'Notizen' : 'Notizen (leer)') : null,
                    importPreview.includeMaterials ? `${importPreview.materialCount || 0} Dateien` : null,
                    importPreview.includeFlashcards ? `${importPreview.flashcardCount || 0} Vokabeln` : null,
                  ].filter(Boolean).join(' • ')}
                </p>
              </div>
            )}
            {importError && <p className="mt-2 text-xs text-red-700">{importError}</p>}
            {importSuccess && <p className="mt-2 text-xs text-emerald-700">{importSuccess}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setImportOpen(false)} className="rounded-md border border-studiio-lavender/70 px-3 py-1.5 text-sm font-medium text-studiio-muted hover:bg-studiio-lavender/30">
                Schließen
              </button>
              <button
                type="button"
                onClick={handleImportByCode}
                disabled={importLoading}
                className="rounded-md bg-studiio-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-studiio-accentHover disabled:opacity-60"
              >
                {importLoading ? 'Importiert …' : 'Importieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLearningPlanSection && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <LearningPlan
            user={user}
            subjects={subjects}
            onOpenSubject={onOpenSubject}
            onStartPractice={onStartPractice}
            onOpenTutor={onOpenTutor}
          />
          <aside className="rounded-2xl border border-white/30 bg-white/20 backdrop-blur-md p-4 shadow-[0_4px_12px_rgba(42,56,95,0.03)] h-fit">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight text-[#2f3150]">Heute erreicht</h3>
              <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-medium text-studiio-muted">
                Tagesblick
              </span>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="flex items-center justify-between rounded-lg bg-white/40 px-3 py-2">
                <p className="text-sm text-studiio-muted">Gelernt</p>
                <p className="text-lg font-semibold text-studiio-ink">{formatLearningTime(todayStats.learnedSeconds)}</p>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white/40 px-3 py-2">
                <p className="text-sm text-studiio-muted">Streak</p>
                <p className="text-lg font-semibold text-studiio-ink">
                  {streak.current_streak_days} {streak.current_streak_days === 1 ? 'Tag' : 'Tage'}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-wide text-studiio-muted font-semibold">
                Heute abgeschlossene Aufgaben
              </p>
              {todayCompletedTasks.length === 0 ? (
                <p className="mt-2 rounded-lg bg-white/35 px-3 py-2 text-sm text-studiio-muted">
                  Heute noch keine Aufgabe abgeschlossen.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {todayCompletedTasks.slice(0, 6).map((task) => (
                    <li key={task.id} className="rounded-lg border border-white/50 bg-white/55 px-3 py-2">
                      <p className="text-sm font-medium text-studiio-ink truncate">{task.title || getTaskTypeLabel(task.type)}</p>
                      <p className="text-xs text-studiio-muted">{getTaskTypeLabel(task.type)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </section>
      )}

      {showSubjectsSection && (
        <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-studiio-ink">Meine Fächer</h2>
            <p className="text-sm text-studiio-muted mt-0.5">
              {subjects.length} {subjects.length === 1 ? 'Fach' : 'Fächer'} angelegt
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setImportOpen(true)
                setImportError('')
                setImportSuccess('')
                setImportPreview(null)
                setImportCode('')
              }}
              className="inline-flex items-center gap-2 rounded-full border border-studiio-lavender/60 bg-white px-3 py-1.5 text-sm font-medium text-studiio-ink hover:bg-studiio-sky/20"
            >
              Fach importieren
            </button>
            <button
              type="button"
              onClick={() => {
                setManageMode((prev) => {
                  const next = !prev
                  if (!next) {
                    cancelEdit()
                    cancelDelete()
                  }
                  return next
                })
              }}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#7c6b9e] to-[#8b79af] text-white px-3 py-1.5 text-sm font-medium shadow-sm hover:brightness-95"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-base leading-none">
                {manageMode ? '×' : '✎'}
              </span>
              <span className="hidden sm:inline">
                {manageMode ? 'Bearbeiten beenden' : 'Fächer bearbeiten'}
              </span>
            </button>
          </div>
        </div>
        {manageMode && (
          <>
            <form
              onSubmit={handleCreateSubject}
              className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto] items-end"
            >
              <div>
                <label htmlFor="subject-name" className="block text-sm font-medium text-studiio-ink mb-1">
                  Fachname
                </label>
                <input
                  id="subject-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="z. B. BWL I, Strafrecht, Analysis"
                  className="studiio-input w-full"
                />
              </div>
              <div>
                <label htmlFor="subject-group" className="block text-sm font-medium text-studiio-ink mb-1">
                  Semester / Kategorie
                </label>
                <input
                  id="subject-group"
                  type="text"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="z. B. 3. Semester, Schwerpunkt Recht"
                  className="studiio-input w-full"
                />
              </div>
              <div>
                <label htmlFor="subject-exam-date" className="block text-sm font-medium text-studiio-ink mb-1">
                  Klausurtermin (optional)
                </label>
                <input
                  id="subject-exam-date"
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="studiio-input w-full"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="studiio-btn-primary whitespace-nowrap md:ml-2"
              >
                {saving ? 'Wird angelegt …' : 'Fach hinzufügen'}
              </button>
            </form>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                {error}
              </p>
            )}
          </>
        )}
        {loading ? (
          <p className="text-sm text-studiio-muted">Fächer werden geladen …</p>
        ) : subjects.length === 0 ? (
          <p className="text-sm text-studiio-muted">
            Du hast noch keine Fächer angelegt. Starte oben mit deinem ersten Fach.
          </p>
        ) : (
          groupedSubjects.map(([groupLabel, items]) => (
            <div key={groupLabel}>
              <h3 className="text-sm font-semibold text-studiio-muted mb-2">
                {groupLabel === 'Ohne Zuordnung' ? 'Ohne Semester/Kategorie' : groupLabel}
              </h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((subject, index) =>
                  editingId === subject.id ? (
                    <form
                      key={subject.id}
                      onSubmit={handleUpdateSubject}
                      className="rounded-lg border-2 border-studiio-lavender/70 bg-white px-5 py-5 min-h-[140px] flex flex-col gap-3"
                    >
                      <div>
                        <label className="block text-xs font-medium text-studiio-ink mb-1">
                          Fachname
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          required
                          className="studiio-input w-full"
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-studiio-ink mb-1">
                            Semester / Kategorie
                          </label>
                          <input
                            type="text"
                            value={editGroup}
                            onChange={(e) => setEditGroup(e.target.value)}
                            className="studiio-input w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-studiio-ink mb-1">
                            Klausurtermin
                          </label>
                          <input
                            type="date"
                            value={editExamDate}
                            onChange={(e) => setEditExamDate(e.target.value)}
                            className="studiio-input w-full"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => startDelete(subject)}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Fach löschen
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-lg border border-studiio-lavender/70 px-3 py-1.5 text-xs font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/30"
                        >
                          Abbrechen
                        </button>
                        <button
                          type="submit"
                          disabled={editSaving}
                          className="studiio-btn-primary text-xs"
                        >
                          {editSaving ? 'Speichern …' : 'Speichern'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <article
                      key={subject.id}
                      className="relative overflow-hidden rounded-2xl border bg-white px-5 py-5 min-h-[220px] flex flex-col gap-3 cursor-pointer shadow-sm transition-shadow hover:shadow-md"
                      style={{
                        borderColor: `${getAccentByIndex(index)}55`,
                        backgroundColor: `${getAccentByIndex(index)}11`,
                      }}
                      onClick={() => onOpenSubject && onOpenSubject(subject)}
                    >
                      <span
                        className="absolute left-0 top-0 h-full w-3 rounded-l-2xl"
                        style={{ backgroundColor: getAccentByIndex(index) }}
                        aria-hidden
                      />
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="pl-1 text-[2rem] leading-[1.05] font-semibold tracking-tight text-studiio-ink" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                          {subject.name}
                        </h4>
                        {subject.exam_date && (
                          <span
                            className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
                            style={{
                              backgroundColor: `${getAccentByIndex(index)}22`,
                              color: '#3f3b36',
                            }}
                          >
                            {formatCountdown(subject.exam_date)}
                          </span>
                        )}
                      </div>
                      <p className="pl-1 text-base text-studiio-muted">
                        {subject.exam_date ? (
                          <>Klausur: {new Date(subject.exam_date).toLocaleDateString('de-DE')}</>
                        ) : (
                          'Kein Termin'
                        )}
                      </p>
                      <SubjectProgressMini
                        user={user}
                        subject={subject}
                        accentColor={getAccentByIndex(index)}
                      />
                      <div className="flex justify-start pt-2 gap-2 flex-wrap mt-auto">
                        {onStartPractice && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onStartPractice(subject)
                            }}
                            className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"
                            style={{ backgroundColor: getAccentByIndex(index) }}
                          >
                            Vokabeln üben
                          </button>
                        )}
                        {manageMode && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                startEdit(subject)
                              }}
                              className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-[#f8f8f6]"
                              style={{
                                borderColor: `${getAccentByIndex(index)}66`,
                                color: '#3f3b36',
                              }}
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                startShare(subject)
                              }}
                              className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-[#f8f8f6]"
                              style={{
                                borderColor: `${getAccentByIndex(index)}66`,
                                color: '#3f3b36',
                              }}
                            >
                              Teilen
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ),
                )}
              </div>
            </div>
          ))
        )}
        </section>
      )}
    </div>
  )
}

