/** Pastell-Akzente — gleiche Reihenfolge wie auf den Fach-Karten (Dashboard). */
export const SUBJECT_ACCENTS = ['#4fb4ad', '#e2ad4f', '#9fc7a3', '#df9a96', '#9ea8c2', '#88b6dc']

export function getAccentByIndex(index) {
  return SUBJECT_ACCENTS[index % SUBJECT_ACCENTS.length]
}

/**
 * Akzentfarbe wie auf dem Dashboard: Index = Position innerhalb der Semester-/Kategorie-Gruppe.
 */
export function getSubjectAccent(subject, allSubjects) {
  if (!subject?.id || !allSubjects?.length) return '#94a3b8'
  const groupKey = subject.group_label || 'Ohne Zuordnung'
  const inGroup = allSubjects.filter((s) => (s.group_label || 'Ohne Zuordnung') === groupKey)
  const idx = inGroup.findIndex((s) => s.id === subject.id)
  const i = idx >= 0 ? idx : 0
  return getAccentByIndex(i)
}
