import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

function formatCountdown(examDate) {
  if (!examDate) return 'Kein Termin eingetragen'
  const today = new Date()
  const target = new Date(examDate)

  // Nur Datum vergleichen (ohne Uhrzeit)
  const oneDayMs = 1000 * 60 * 60 * 24
  const diffDays = Math.round((target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / oneDayMs)

  if (Number.isNaN(diffDays)) return 'Ungültiges Datum'
  if (diffDays === 0) return 'Heute ist Klausurtag 💪'
  if (diffDays > 0) return `Noch ${diffDays} Tag${diffDays === 1 ? '' : 'e'}`
  const pastDays = Math.abs(diffDays)
  return `Klausur war vor ${pastDays} Tag${pastDays === 1 ? '' : 'en'}`
}

export default function DashboardSubjects({ user, onOpenSubject, onStartPractice }) {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [examDate, setExamDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [editExamDate, setEditExamDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)

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

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-studiio-ink">Deine Fächer</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full bg-studiio-accent text-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-studiio-accentHover"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-base leading-none">
              +
            </span>
            <span className="hidden sm:inline">
              Neues Fach
            </span>
          </button>
        </div>
        {showCreateForm && (
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
      </section>

      <section className="space-y-4">
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
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((subject) =>
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
                      className="rounded-lg border-2 border-studiio-lavender/50 bg-white/90 px-5 py-5 min-h-[140px] flex flex-col gap-2 cursor-pointer hover:border-studiio-accent/70 hover:bg-studiio-sky/30 transition-colors"
                      onClick={() => onOpenSubject && onOpenSubject(subject)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-semibold text-studiio-ink">{subject.name}</h4>
                        <span className="inline-flex items-center rounded px-2.5 py-1 text-sm font-medium text-studiio-ink bg-studiio-sky/60">
                          {formatCountdown(subject.exam_date)}
                        </span>
                      </div>
                      {subject.exam_date && (
                        <p className="text-sm text-studiio-muted">
                          Klausurtermin:&nbsp;
                          {new Date(subject.exam_date).toLocaleDateString('de-DE')}
                        </p>
                      )}
                      <div className="flex justify-end pt-2 gap-2 flex-wrap mt-auto">
                        {onStartPractice && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onStartPractice(subject)
                            }}
                            className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
                          >
                            Vokabeln üben
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(subject)
                          }}
                          className="rounded-lg border border-studiio-lavender/60 px-4 py-2 text-sm font-medium text-studiio-accent hover:bg-studiio-sky/20"
                        >
                          Bearbeiten
                        </button>
                      </div>
                    </article>
                  ),
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

