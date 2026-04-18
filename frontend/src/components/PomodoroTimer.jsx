import { useCallback, useEffect, useRef, useState } from 'react'
import {
  POMODORO_FOCUS_MINUTES,
  POMODORO_SHORT_BREAK_MINUTES,
  POMODORO_LONG_BREAK_MINUTES,
  POMODORO_CYCLES_BEFORE_LONG_BREAK,
} from '../config'
import {
  POMODORO_META_KEY,
  POMODORO_LEAVE_SNAPSHOT_KEY,
  POMODORO_PAUSE_FOR_LEAVE_EVENT,
  POMODORO_RESUME_AFTER_TASK_EVENT,
} from '../utils/pomodoroFocusBridge'

function pad2(n) {
  return String(Math.max(0, n)).padStart(2, '0')
}

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${pad2(s)}`
}

/**
 * Klassisches Pomodoro: Fokus → kurze Pause (×3) → nach 4. Fokus lange Pause → wieder Fokus.
 * Schwebend unten rechts. `elevated`: weiter nach oben, damit nichts mit fester
 * Unterleiste (Willkommens-Balken, Tutor-Chat mit Senden-Button) überlappt.
 */
export default function PomodoroTimer({ elevated = false }) {
  const [expanded, setExpanded] = useState(false)
  /** idle = noch nicht gestartet; sonst aktuelle Phase */
  const [phase, setPhase] = useState('idle')
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_FOCUS_MINUTES * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [fociSinceLongBreak, setFociSinceLongBreak] = useState(0)

  const phaseRef = useRef(phase)
  const fociRef = useRef(fociSinceLongBreak)
  const stateRef = useRef({
    phase,
    secondsLeft,
    isRunning,
    fociSinceLongBreak,
    expanded,
  })
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    fociRef.current = fociSinceLongBreak
  }, [fociSinceLongBreak])
  useEffect(() => {
    stateRef.current = { phase, secondsLeft, isRunning, fociSinceLongBreak, expanded }
    try {
      sessionStorage.setItem(
        POMODORO_META_KEY,
        JSON.stringify({ phase, secondsLeft, isRunning, ts: Date.now() }),
      )
    } catch (_) {}
  }, [phase, secondsLeft, isRunning, fociSinceLongBreak, expanded])

  useEffect(() => {
    const onPauseLeave = () => {
      const cur = stateRef.current
      try {
        sessionStorage.setItem(
          POMODORO_LEAVE_SNAPSHOT_KEY,
          JSON.stringify({
            phase: cur.phase,
            secondsLeft: cur.secondsLeft,
            isRunning: cur.isRunning,
            fociSinceLongBreak: cur.fociSinceLongBreak,
            expanded: cur.expanded,
          }),
        )
      } catch (_) {}
      setIsRunning(false)
    }
    const onResumeAfterTask = () => {
      try {
        const raw = sessionStorage.getItem(POMODORO_LEAVE_SNAPSHOT_KEY)
        if (!raw) return
        const snap = JSON.parse(raw)
        sessionStorage.removeItem(POMODORO_LEAVE_SNAPSHOT_KEY)
        if (snap && typeof snap.secondsLeft === 'number') {
          setPhase(snap.phase || 'idle')
          setSecondsLeft(snap.secondsLeft)
          setFociSinceLongBreak(Number.isFinite(snap.fociSinceLongBreak) ? snap.fociSinceLongBreak : 0)
          setExpanded(!!snap.expanded)
          setIsRunning(!!snap.isRunning)
        }
      } catch (_) {}
    }
    window.addEventListener(POMODORO_PAUSE_FOR_LEAVE_EVENT, onPauseLeave)
    window.addEventListener(POMODORO_RESUME_AFTER_TASK_EVENT, onResumeAfterTask)
    return () => {
      window.removeEventListener(POMODORO_PAUSE_FOR_LEAVE_EVENT, onPauseLeave)
      window.removeEventListener(POMODORO_RESUME_AFTER_TASK_EVENT, onResumeAfterTask)
    }
  }, [])

  const transitionFromFocus = useCallback(() => {
    const next = fociRef.current + 1
    if (next >= POMODORO_CYCLES_BEFORE_LONG_BREAK) {
      setFociSinceLongBreak(0)
      setPhase('long_break')
      setSecondsLeft(POMODORO_LONG_BREAK_MINUTES * 60)
    } else {
      setFociSinceLongBreak(next)
      setPhase('short_break')
      setSecondsLeft(POMODORO_SHORT_BREAK_MINUTES * 60)
    }
    setIsRunning(true)
  }, [])

  const transitionFromBreak = useCallback(() => {
    setPhase('focus')
    setSecondsLeft(POMODORO_FOCUS_MINUTES * 60)
    setIsRunning(true)
  }, [])

  const finishPhase = useCallback(() => {
    setIsRunning(false)
    const p = phaseRef.current
    if (p === 'idle') return
    if (p === 'focus') {
      transitionFromFocus()
      return
    }
    if (p === 'short_break' || p === 'long_break') {
      transitionFromBreak()
    }
  }, [transitionFromFocus, transitionFromBreak])

  useEffect(() => {
    if (!isRunning || phase === 'idle') return
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === 0) return 0
        if (prev <= 1) {
          queueMicrotask(() => finishPhase())
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [isRunning, phase, finishPhase])

  function handleStartOrResume() {
    if (phase === 'idle') {
      setPhase('focus')
      setSecondsLeft(POMODORO_FOCUS_MINUTES * 60)
    }
    setIsRunning(true)
  }

  function handlePause() {
    setIsRunning(false)
  }

  function handleReset() {
    setIsRunning(false)
    setPhase('idle')
    setSecondsLeft(POMODORO_FOCUS_MINUTES * 60)
    setFociSinceLongBreak(0)
    try {
      sessionStorage.removeItem(POMODORO_LEAVE_SNAPSHOT_KEY)
    } catch (_) {}
  }

  function handleSkip() {
    if (phase === 'idle') return
    finishPhase()
  }

  const phaseLabel =
    phase === 'idle'
      ? 'Bereit'
      : phase === 'focus'
        ? 'Fokus'
        : phase === 'short_break'
          ? 'Kurze Pause'
          : 'Lange Pause'

  /** Tutor-Composer inkl. Textfeld min-h ~90px + Buttons — großzügig Abstand lassen */
  const bottomClass = elevated ? 'bottom-44 sm:bottom-52' : 'bottom-4 sm:bottom-6'

  return (
    <div
      className={`fixed right-3 z-[66] max-w-[min(100vw-1.5rem,17rem)] sm:right-5 ${bottomClass}`}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 rounded-2xl border border-studiio-lavender/60 bg-white/95 px-3 py-2 text-sm font-medium text-studiio-ink shadow-md backdrop-blur-sm hover:bg-studiio-sky/20"
          title="Pomodoro öffnen"
        >
          <span className="text-lg" aria-hidden>
            🍅
          </span>
          <span className="tabular-nums text-studiio-muted">{formatClock(secondsLeft)}</span>
        </button>
      ) : (
        <div className="rounded-2xl border border-studiio-lavender/60 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 border-b border-studiio-lavender/30 pb-2 mb-2">
            <span className="text-sm font-semibold text-studiio-ink">Pomodoro</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-md px-2 py-0.5 text-xs text-studiio-muted hover:bg-studiio-lavender/30"
              aria-label="Einklappen"
            >
              −
            </button>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-studiio-muted">{phaseLabel}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-studiio-ink">{formatClock(secondsLeft)}</p>
          <p className="mt-1 text-[11px] text-studiio-muted leading-snug">
            Fokus {POMODORO_FOCUS_MINUTES} min, danach kurze Pause {POMODORO_SHORT_BREAK_MINUTES} min. Nach {POMODORO_CYCLES_BEFORE_LONG_BREAK} Fokus-Runden: lange Pause{' '}
            {POMODORO_LONG_BREAK_MINUTES} min — dann geht es von vorne los.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {!isRunning ? (
              <button
                type="button"
                onClick={handleStartOrResume}
                className="rounded-lg bg-studiio-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-studiio-accentHover"
              >
                {phase === 'idle' ? 'Fokus starten' : 'Weiter'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePause}
                className="rounded-lg border border-studiio-lavender/70 px-3 py-1.5 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/20"
              >
                Pause
              </button>
            )}
            <button
              type="button"
              onClick={handleSkip}
              disabled={phase === 'idle'}
              className="rounded-lg border border-studiio-lavender/70 px-3 py-1.5 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/20 disabled:opacity-40"
            >
              Überspringen
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
