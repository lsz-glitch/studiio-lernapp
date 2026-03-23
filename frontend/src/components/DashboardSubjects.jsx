import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import SubjectProgressMini from './SubjectProgressMini'
import LearningPlan from './LearningPlan'
import { getStreak } from '../utils/streak'
import { formatLearningTime, getTodayLearningTimeLocal } from '../utils/learningTime'

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
      const learnedSeconds = getTodayLearningTimeLocal()
      setTodayStats({ planned, completed, learnedSeconds })
      if (onTodayPlannedChange) onTodayPlannedChange(planned)

      const { data: completedToday, error: completedErr } = await supabase
        .from('learning_plan_tasks')
        .select('id, title, type, completed_at')
        .eq('user_id', user.id)
        .gte('completed_at', startIso)
        .lt('completed_at', endIso)
        .order('completed_at', { ascending: false })

      if (!mounted) return
      if (completedErr) {
        console.error('Fehler beim Laden erledigter Tages-Tasks:', completedErr)
        setTodayCompletedTasks([])
      } else {
        setTodayCompletedTasks(completedToday || [])
      }
    }

    loadTodayStats()
    const intervalId = window.setInterval(loadTodayStats, 30000)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [user.id, onTodayPlannedChange])

  function getTaskTypeLabel(type) {
    if (type === 'tutor') return 'Tutor'
    if (type === 'vocab') return 'Vokabeln'
    if (type === 'exam') return 'Klausur'
    return 'Task'
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
                <p className="text-sm text-studiio-muted">Erledigt</p>
                <p className="text-lg font-semibold text-studiio-ink">{todayStats.completed}</p>
              </div>
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

