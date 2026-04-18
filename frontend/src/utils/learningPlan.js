/**
 * Lernplan: Tasks abhaken (automatisch oder manuell).
 */
import { supabase } from '../supabaseClient'

const TABLE = 'learning_plan_tasks'

function isMissingDescriptionColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('description') && msg.includes('column'))
}

function isMissingExternalUrlColumn(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return code === '42703' || (msg.includes('external_url') && msg.includes('column'))
}

/** Task als erledigt markieren */
export async function completeTask(userId, taskId) {
  if (!userId || !taskId) return { error: null }
  const { error } = await supabase
    .from(TABLE)
    .update({ completed_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId)
  return { error }
}

/** Task dauerhaft aus dem Lernplan entfernen */
export async function deleteTask(userId, taskId) {
  if (!userId || !taskId) return { error: new Error('userId und taskId nötig') }
  const { error } = await supabase.from(TABLE).delete().eq('id', taskId).eq('user_id', userId)
  if (error) return { error }
  return { error: null }
}

/** Task wieder auf „nicht erledigt“ setzen (Kreuz entfernen) */
export async function uncompleteTask(userId, taskId) {
  if (!userId || !taskId) return { error: null }
  const { error } = await supabase
    .from(TABLE)
    .update({ completed_at: null })
    .eq('id', taskId)
    .eq('user_id', userId)
  return { error }
}

/** Task bearbeiten (Typ, Fach, Material, Titel, Beschreibung, optionaler Link, Datum/Uhrzeit) */
export async function updateTask(userId, taskId, payload) {
  if (!userId || !taskId) return { error: new Error('userId und taskId nötig') }

  const core = {
    type: payload.type,
    subject_id: payload.subject_id || null,
    material_id: payload.material_id ?? null,
    title: payload.title,
    scheduled_at: payload.scheduled_at,
  }

  async function doUpdate(updateObj, selectLine) {
    return supabase.from(TABLE).update(updateObj).eq('id', taskId).eq('user_id', userId).select(selectLine).single()
  }

  let updateObj = {
    ...core,
    description: payload.description ?? null,
    external_url: payload.external_url ?? null,
  }
  let selectLine =
    'id, type, subject_id, material_id, title, description, external_url, scheduled_at, completed_at'

  let { data, error } = await doUpdate(updateObj, selectLine)

  if (error && isMissingExternalUrlColumn(error)) {
    const { external_url: _e, ...noExt } = updateObj
    const r = await doUpdate(
      noExt,
      'id, type, subject_id, material_id, title, description, scheduled_at, completed_at',
    )
    data = r.data ? { ...r.data, external_url: payload.external_url ?? null } : null
    error = r.error
    updateObj = noExt
  }

  if (error && isMissingDescriptionColumn(error)) {
    const { description: _d, ...noDesc } = updateObj
    const r = await doUpdate(
      noDesc,
      'id, type, subject_id, material_id, title, scheduled_at, completed_at',
    )
    data = r.data
      ? {
          ...r.data,
          description: payload.description ?? null,
          external_url: payload.external_url ?? null,
        }
      : null
    error = r.error
  }

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
