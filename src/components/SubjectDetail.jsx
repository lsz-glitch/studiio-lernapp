import SubjectMaterials from './SubjectMaterials'

function formatCountdown(examDate) {
  if (!examDate) return 'Kein Termin eingetragen'
  const today = new Date()
  const target = new Date(examDate)

  const oneDayMs = 1000 * 60 * 60 * 24
  const diffDays = Math.round((target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / oneDayMs)

  if (Number.isNaN(diffDays)) return 'Ungültiges Datum'
  if (diffDays === 0) return 'Heute ist Klausurtag 💪'
  if (diffDays > 0) return `Noch ${diffDays} Tag${diffDays === 1 ? '' : 'e'}`
  const pastDays = Math.abs(diffDays)
  return `Klausur war vor ${pastDays} Tag${pastDays === 1 ? '' : 'en'}`
}

export default function SubjectDetail({ user, subject, onBack }) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-studiio-accent hover:underline"
      >
        <span className="inline-block rotate-180 text-base">➜</span>
        Zurück zur Übersicht
      </button>

      <section className="space-y-1">
        <h2 className="text-2xl font-semibold text-studiio-ink">{subject.name}</h2>
        <p className="text-sm text-studiio-muted">
          {subject.group_label || 'Ohne Semester/Kategorie'}
        </p>
        <p className="text-sm text-studiio-ink">
          Countdown:&nbsp;
          <span className="font-medium">
            {formatCountdown(subject.exam_date)}
          </span>
        </p>
        {subject.exam_date && (
          <p className="text-xs text-studiio-muted">
            Klausurtermin:&nbsp;
            {new Date(subject.exam_date).toLocaleDateString('de-DE')}
          </p>
        )}
      </section>

      <SubjectMaterials user={user} subject={subject} />
    </div>
  )
}

