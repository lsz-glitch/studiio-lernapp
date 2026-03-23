/**
 * Timetracking: Lernzeit pro Fach (Tutor + Vokabeln).
 */

import { supabase } from '../supabaseClient'

const TABLE = 'user_learning_time'
const DAILY_SECONDS_PREFIX = 'studiio_daily_learning_seconds_'

function getTodayLocalKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Lernzeit hinzufügen (nur addieren, nie zurücksetzen).
 * Wird beim Verlassen und alle 60 Sekunden im Tutor/Vokabelmodus aufgerufen.
 */
export async function addLearningTime(userId, subjectId, secondsToAdd) {
  if (!userId || !subjectId || secondsToAdd <= 0) return
  const roundedSeconds = Math.round(secondsToAdd)

  // Zusätzlich lokal den Tageswert führen, damit das Dashboard "heute gelernt" zeigen kann.
  if (typeof window !== 'undefined') {
    const key = `${DAILY_SECONDS_PREFIX}${getTodayLocalKey()}`
    const currentDaily = Number(window.localStorage.getItem(key) || 0)
    window.localStorage.setItem(key, String(currentDaily + roundedSeconds))
  }

  const { data: row, error: fetchErr } = await supabase
    .from(TABLE)
    .select('total_seconds')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .maybeSingle()

  if (fetchErr) {
    console.error('Lernzeit: Laden fehlgeschlagen', fetchErr)
    return
  }

  const current = Number(row?.total_seconds ?? 0)
  const newTotal = current + roundedSeconds // immer nur addieren, nie zurücksetzen

  const { error: upsertErr } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        subject_id: subjectId,
        total_seconds: newTotal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: ['user_id', 'subject_id'] }
    )

  if (upsertErr) console.error('Lernzeit: Speichern fehlgeschlagen', upsertErr)
}

/**
 * Gesamt-Lernzeit für ein Fach laden (in Sekunden).
 */
export async function getLearningTime(userId, subjectId) {
  if (!userId || !subjectId) return 0
  const { data, error } = await supabase
    .from(TABLE)
    .select('total_seconds')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .maybeSingle()
  if (error) {
    console.error('Lernzeit: Laden fehlgeschlagen', error)
    return 0
  }
  return Number(data?.total_seconds ?? 0)
}

/**
 * Sekunden in lesbare Form bringen: "45 min", "1 h 30 min", "2 h 15 min".
 */
export function formatLearningTime(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return '0 min'
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0 && minutes > 0) return `${hours} h ${minutes} min`
  if (hours > 0) return `${hours} h`
  return `${minutes} min`
}

/**
 * Tages-Lernzeit aus lokalem Speicher (nur für Dashboard-Widget "heute gelernt").
 */
export function getTodayLearningTimeLocal() {
  if (typeof window === 'undefined') return 0
  const key = `${DAILY_SECONDS_PREFIX}${getTodayLocalKey()}`
  return Number(window.localStorage.getItem(key) || 0)
}
