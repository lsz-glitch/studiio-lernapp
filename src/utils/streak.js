/**
 * Streak-System: Eine Lernaktivität pro Tag hält den Streak am Leben.
 * Nutzt die Tabelle "user_streaks" (nicht profiles).
 */

import { supabase } from '../supabaseClient'

const STREAK_TABLE = 'user_streaks'

/** Heutiges Datum in lokaler Zeitzone als YYYY-MM-DD */
function getTodayLocal() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** Gestern (lokale Zeitzone) als YYYY-MM-DD */
function getYesterdayLocal() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/**
 * Eine Lernaktivität eintragen und Streak ggf. erhöhen.
 * Mehrfach pro Tag: nur erste Aktivität zählt (idempotent).
 */
export async function recordStreakActivity(userId) {
  if (!userId) return
  const today = getTodayLocal()
  const yesterday = getYesterdayLocal()

  const { data: row, error: fetchErr } = await supabase
    .from(STREAK_TABLE)
    .select('last_activity_date, current_streak_days')
    .eq('user_id', userId)
    .maybeSingle()

  if (fetchErr) {
    console.error('Streak: Laden fehlgeschlagen', fetchErr)
    return
  }

  const last = row?.last_activity_date != null ? String(row.last_activity_date).slice(0, 10) : null
  const current = row?.current_streak_days ?? 0

  let newStreak = current
  if (!last) {
    newStreak = 1
  } else if (last === today) {
    return
  } else if (last === yesterday) {
    newStreak = current + 1
  } else {
    newStreak = 1
  }

  const { error: upsertErr } = await supabase
    .from(STREAK_TABLE)
    .upsert(
      { user_id: userId, last_activity_date: today, current_streak_days: newStreak, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  if (upsertErr) console.error('Streak: Speichern fehlgeschlagen', upsertErr)
}

/**
 * Aktuellen Streak für die Anzeige laden.
 */
export async function getStreak(userId) {
  if (!userId) return { current_streak_days: 0, last_activity_date: null }
  const { data, error } = await supabase
    .from(STREAK_TABLE)
    .select('last_activity_date, current_streak_days')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('Streak: Anzeige laden fehlgeschlagen', error)
    return { current_streak_days: 0, last_activity_date: null }
  }

  const last = data?.last_activity_date != null ? String(data.last_activity_date).slice(0, 10) : null
  const today = getTodayLocal()
  const yesterday = getYesterdayLocal()
  let days = data?.current_streak_days ?? 0
  if (last !== today && last !== yesterday) days = 0
  return { current_streak_days: days, last_activity_date: last }
}
