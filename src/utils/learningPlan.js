/**
 * Lernplan: Tasks abhaken (automatisch oder manuell).
 */
import { supabase } from '../supabaseClient'

const TABLE = 'learning_plan_tasks'

/** Task als erledigt markieren */
export async function completeTask(userId, taskId) {
  if (!userId || !taskId) return
  await supabase
    .from(TABLE)
    .update({ completed_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId)
}

/** Task wieder auf „nicht erledigt“ setzen (Kreuz entfernen) */
export async function uncompleteTask(userId, taskId) {
  if (!userId || !taskId) return
  await supabase
    .from(TABLE)
    .update({ completed_at: null })
    .eq('id', taskId)
    .eq('user_id', userId)
}

/** Task bearbeiten (Typ, Fach, Material, Titel, Beschreibung, Datum/Uhrzeit) */
export async function updateTask(userId, taskId, payload) {
  if (!userId || !taskId) return { error: new Error('userId und taskId nötig') }
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      type: payload.type,
      subject_id: payload.subject_id || null,
      material_id: payload.material_id ?? null,
      title: payload.title,
      description: payload.description ?? null,
      scheduled_at: payload.scheduled_at,
    })
    .eq('id', taskId)
    .eq('user_id', userId)
    .select('id, type, subject_id, material_id, title, description, scheduled_at, completed_at')
    .single()
  if (error) return { error, data: null }
  return { error: null, data }
}

/** Alle Tutor-Tasks für diese Material-ID und heute/vorher als erledigt markieren */
export async function completeTutorTasksForMaterial(userId, materialId) {
  if (!userId || !materialId) return
  const today = new Date().toISOString().slice(0, 10)
  const { data: tasks } = await supabase
    .from(TABLE)
    .select('id')
    .eq('user_id', userId)
    .eq('material_id', materialId)
    .eq('type', 'tutor')
    .is('completed_at', null)
  if (!tasks?.length) return
  for (const t of tasks) {
    await supabase.from(TABLE).update({ completed_at: new Date().toISOString() }).eq('id', t.id).eq('user_id', userId)
  }
}

/** Vokabel-Tasks für dieses Fach (fällig heute oder in der Vergangenheit) als erledigt markieren */
export async function completeVocabTasksForSubjectToday(userId, subjectId) {
  if (!userId || !subjectId) return
  const now = new Date().toISOString()
  const { data: tasks } = await supabase
    .from(TABLE)
    .select('id')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .eq('type', 'vocab')
    .is('completed_at', null)
    .lte('scheduled_at', now)
  if (!tasks?.length) return
  for (const t of tasks) {
    await supabase.from(TABLE).update({ completed_at: new Date().toISOString() }).eq('id', t.id).eq('user_id', userId)
  }
}
