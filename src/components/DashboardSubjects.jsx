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

export default function DashboardSubjects({ user }) {
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [examDate, setExamDate] = useState('')
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-studiio-ink">Deine Fächer</h2>
        <p className="text-sm text-studiio-muted">
          Lege hier deine Fächer an und ordne sie einem Semester oder einer eigenen Kategorie zu
          (z.&nbsp;B. „3. Semester“, „Schwerpunkt Recht“, „Wirtschaft“). Pro Fach kannst du einen Klausurtermin
          eintragen und siehst einen Countdown.
        </p>
        <form onSubmit={handleCreateSubject} className="mt-2 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto] items-end">
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
                {items.map((subject) => (
                  <article
                    key={subject.id}
                    className="rounded-2xl border border-studiio-lavender/50 bg-white/80 px-4 py-3 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-medium text-studiio-ink">{subject.name}</h4>
                      <span className="inline-flex items-center rounded-full bg-studiio-sky/60 px-2.5 py-0.5 text-xs font-medium text-studiio-ink">
                        {formatCountdown(subject.exam_date)}
                      </span>
                    </div>
                    {subject.exam_date && (
                      <p className="text-xs text-studiio-muted">
                        Klausurtermin:&nbsp;
                        {new Date(subject.exam_date).toLocaleDateString('de-DE')}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

