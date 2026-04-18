import { getMiniFocusSnapshot } from './miniFocusSession'
import { POMODORO_META_KEY } from './pomodoroFocusBridge'

function readPomodoroMeta() {
  try {
    const raw = sessionStorage.getItem(POMODORO_META_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

/** Pomodoro wurde gestartet oder läuft — dann Fokus nicht „still“ verlassen. */
export function isPomodoroActivelyTrackingFocus() {
  const m = readPomodoroMeta()
  if (!m) return false
  if (m.isRunning) return true
  if (m.phase && m.phase !== 'idle') return true
  return false
}

/**
 * Rückfrage nötig? (unvollständige Tutor-Lektion, Mini-Fokus, Pomodoro-Session, Vokabeln mit fälligen Karten)
 */
export function shouldConfirmFocusLeave(opts = {}) {
  const { tutorLessonIncomplete = false, flashcardsWithDueCards = false } = opts
  const mini = getMiniFocusSnapshot()
  if (mini.kind === 'running' || mini.kind === 'paused') return true
  if (isPomodoroActivelyTrackingFocus()) return true
  if (tutorLessonIncomplete) return true
  if (flashcardsWithDueCards) return true
  return false
}

/**
 * Browser-Rückfrage (wie eine kurze Push-/Systemmeldung), bevor Fokus verlassen wird.
 * @returns {boolean} true = wirklich verlassen
 */
export function confirmFocusLeaveIfNeeded(opts = {}) {
  if (!shouldConfirmFocusLeave(opts)) return true
  const ok = window.confirm(
    [
      'Fokus wirklich verlassen?',
      '',
      'Du hast noch eine laufende Lerneinheit (Mini-Fokus, Pomodoro und/oder eine offene Aufgabe).',
      'Timer werden angehalten — du kannst später nahtlos weitermachen.',
    ].join('\n'),
  )
  if (ok && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('Studiio', {
        body: 'Fokus pausiert. Schön, dass du dranbleibst — bis gleich!',
        silent: true,
      })
    } catch (_) {}
  }
  return ok
}
