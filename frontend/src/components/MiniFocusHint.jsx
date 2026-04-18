import { useEffect, useState } from 'react'
import {
  getMiniFocusSnapshot,
  MINI_FOCUS_CHANGED_EVENT,
  MINI_FOCUS_DURATION_MS,
} from '../utils/miniFocusSession'

function formatMinutesCeil(ms) {
  return Math.max(1, Math.ceil(ms / 60000))
}

/**
 * Mini-Fokus: läuft nur, solange man bei der Aufgabe ist; beim Verlassen Pause + Rückkehr-Hinweis.
 */
export default function MiniFocusHint({ className = '' }) {
  const [snap, setSnap] = useState(() => getMiniFocusSnapshot())

  useEffect(() => {
    const sync = () => setSnap(getMiniFocusSnapshot())
    sync()
    const id = window.setInterval(sync, 2000)
    window.addEventListener(MINI_FOCUS_CHANGED_EVENT, sync)
    return () => {
      clearInterval(id)
      window.removeEventListener(MINI_FOCUS_CHANGED_EVENT, sync)
    }
  }, [])

  if (snap.kind === 'none') return null

  if (snap.kind === 'paused') {
    const minRemain = formatMinutesCeil(snap.remainingMs)
    const totalMin = Math.max(1, Math.round(MINI_FOCUS_DURATION_MS / 60000))
    return (
      <div
        className={`rounded-xl border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-xs text-amber-950 shadow-sm ${className}`}
        role="status"
      >
        <span className="font-medium">Mini-Fokus:</span> Kehre zurück zu deiner Aufgabe.{' '}
        <strong>
          {totalMin} Minuten Fokus
        </strong>{' '}
        — noch etwa <strong>{minRemain} Min.</strong> liegen vor dir. <strong>Du schaffst das!</strong>
      </div>
    )
  }

  const { until } = snap
  if (!until || Date.now() >= until) return null

  const minLeft = formatMinutesCeil(until - Date.now())

  return (
    <div
      className={`rounded-xl border border-teal-200/80 bg-teal-50/95 px-3 py-2 text-xs text-teal-900 shadow-sm ${className}`}
      role="status"
    >
      <span className="font-medium">Mini-Fokus:</span> Gib dieser Aufgabe noch etwa{' '}
      <strong>{minLeft} Min.</strong> ohne große Ablenkung.
    </div>
  )
}
