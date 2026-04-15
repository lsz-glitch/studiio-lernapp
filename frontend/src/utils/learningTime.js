/**
 * Timetracking: Lernzeit pro Fach (Tutor + Vokabeln).
 */

import { supabase } from '../supabaseClient'
import { recordStreakActivity } from './streak'

const TABLE = 'user_learning_time'
const DAILY_TABLE = 'user_daily_learning_seconds'
const DAILY_SUBJECT_TABLE = 'user_daily_subject_learning_seconds'
const DAILY_SECONDS_PREFIX = 'studiio_daily_learning_seconds_'
const DAILY_STREAK_MARK_PREFIX = 'studiio_daily_streak_marked_'
const STREAK_THRESHOLD_SECONDS = 180

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
  const todayKey = getTodayLocalKey()
  let newDailySeconds = 0

  // Zusätzlich lokal den Tageswert führen, damit das Dashboard "heute gelernt" zeigen kann.
  if (typeof window !== 'undefined') {
    const key = `${DAILY_SECONDS_PREFIX}${todayKey}`
    const currentDaily = Number(window.localStorage.getItem(key) || 0)
    newDailySeconds = currentDaily + roundedSeconds
    window.localStorage.setItem(key, String(newDailySeconds))
  }

  // Daily Sekunden serverseitig syncen (für Public/andere Geräte).
  try {
    const { data: dailyRow, error: dailyFetchErr } = await supabase
      .from(DAILY_TABLE)
      .select('total_seconds')
      .eq('user_id', userId)
      .eq('day', todayKey)
      .maybeSingle()

    if (!dailyFetchErr) {
      const currentDailyDb = Number(dailyRow?.total_seconds ?? 0)
      newDailySeconds = currentDailyDb + roundedSeconds
    }

    const { error: dailyUpsertErr } = await supabase.from(DAILY_TABLE).upsert(
      {
        user_id: userId,
        day: todayKey,
        total_seconds: newDailySeconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: ['user_id', 'day'] },
    )

    if (dailyUpsertErr) console.error('Daily Lernzeit: Speichern fehlgeschlagen', dailyUpsertErr)
  } catch (e) {
    console.error('Daily Lernzeit: Fehler', e)
  }

  // Daily Sekunden pro Fach syncen (für Fach-Filter in Statistiken).
  try {
    const { data: dailySubjectRow, error: subjectFetchErr } = await supabase
      .from(DAILY_SUBJECT_TABLE)
      .select('total_seconds')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .eq('day', todayKey)
      .maybeSingle()

    const currentSubjectDaily = subjectFetchErr ? 0 : Number(dailySubjectRow?.total_seconds ?? 0)
    const { error: subjectUpsertErr } = await supabase.from(DAILY_SUBJECT_TABLE).upsert(
      {
        user_id: userId,
        subject_id: subjectId,
        day: todayKey,
        total_seconds: currentSubjectDaily + roundedSeconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: ['user_id', 'subject_id', 'day'] },
    )
    if (subjectUpsertErr) console.error('Daily Fach-Lernzeit: Speichern fehlgeschlagen', subjectUpsertErr)
  } catch (e) {
    console.error('Daily Fach-Lernzeit: Fehler', e)
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

  // Streak-Regel: Erst ab 3 Minuten Lernzeit pro Tag +1 (maximal einmal pro Tag).
  if (newDailySeconds >= STREAK_THRESHOLD_SECONDS) {
    const ok = await recordStreakActivity(userId)
    if (ok && typeof window !== 'undefined') {
      const markKey = `${DAILY_STREAK_MARK_PREFIX}${todayKey}`
      window.localStorage.setItem(markKey, '1')
    }
  }
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

/**
 * Tages-Lernzeit aus Supabase für "Heute gelernt".
 */
export async function getTodayLearningTimeDb(userId) {
  if (!userId) return 0
  const todayKey = getTodayLocalKey()
  const { data, error } = await supabase
    .from(DAILY_TABLE)
    .select('total_seconds')
    .eq('user_id', userId)
    .eq('day', todayKey)
    .maybeSingle()

  if (error) {
    console.error('Daily Lernzeit: Laden fehlgeschlagen', error)
    return 0
  }
  return Number(data?.total_seconds ?? 0)
}

/**
 * Tages-Lernzeit aus Supabase für ein bestimmtes Fach.
 */
export async function getTodayLearningTimeBySubjectDb(userId, subjectId) {
  if (!userId || !subjectId) return 0
  const todayKey = getTodayLocalKey()
  const { data, error } = await supabase
    .from(DAILY_SUBJECT_TABLE)
    .select('total_seconds')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .eq('day', todayKey)
    .maybeSingle()

  if (error) {
    console.error('Daily Fach-Lernzeit: Laden fehlgeschlagen', error)
    return 0
  }
  return Number(data?.total_seconds ?? 0)
}
