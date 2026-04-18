/** Pomodoro läuft global in App.jsx — Events + SessionStorage für Pause beim Verlassen einer Aufgabe. */

export const POMODORO_META_KEY = 'studiio_pomodoro_meta'
export const POMODORO_LEAVE_SNAPSHOT_KEY = 'studiio_pomodoro_leave_snapshot'

export const POMODORO_PAUSE_FOR_LEAVE_EVENT = 'studiio-pomodoro-pause-for-leave'
export const POMODORO_RESUME_AFTER_TASK_EVENT = 'studiio-pomodoro-resume-after-task'

export function dispatchPomodoroPauseForLeave() {
  try {
    window.dispatchEvent(new Event(POMODORO_PAUSE_FOR_LEAVE_EVENT))
  } catch (_) {}
}

export function dispatchPomodoroResumeAfterTask() {
  try {
    window.dispatchEvent(new Event(POMODORO_RESUME_AFTER_TASK_EVENT))
  } catch (_) {}
}

export function clearPomodoroFocusStorage() {
  try {
    sessionStorage.removeItem(POMODORO_META_KEY)
    sessionStorage.removeItem(POMODORO_LEAVE_SNAPSHOT_KEY)
  } catch (_) {}
}
