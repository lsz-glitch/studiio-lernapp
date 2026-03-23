import { useEffect } from 'react'
import confetti from 'canvas-confetti'

const TEAL = '#4CAF9E'

function fireConfettiBurst() {
  const colors = ['#4CAF9E', '#d4a574', '#8ebfbf', '#e8b4b4', '#7a9e9a']

  confetti({
    particleCount: 130,
    spread: 88,
    origin: { y: 0.55 },
    colors,
    ticks: 260,
    gravity: 0.95,
    scalar: 1,
  })

  const duration = 2400
  const end = Date.now() + duration
  const id = window.setInterval(() => {
    if (Date.now() > end) {
      window.clearInterval(id)
      return
    }
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 68,
      origin: { x: 0, y: 0.65 },
      colors,
      ticks: 200,
      gravity: 1.05,
      scalar: 0.9,
    })
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 68,
      origin: { x: 1, y: 0.65 },
      colors,
      ticks: 200,
      gravity: 1.05,
      scalar: 0.9,
    })
  }, 220)
  return id
}

function TrophyIcon() {
  return (
    <svg
      className="h-10 w-10 text-amber-500"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
    </svg>
  )
}

/**
 * Erfolgs-Overlay im Stil der Studiio-Vorlage: Konfetti, Trophäe, Sterne, Spruch.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.taskLabel – fetter Teil (z. B. Task-Titel oder Dateiname)
 * @param {string} [props.subjectName] – Fachname (teal), optional
 * @param {string} [props.continueLabel='Weiter lernen']
 * @param {() => void} props.onContinue – Hauptbutton
 * @param {() => void} props.onClose – Schließen (X) – oft gleich onContinue
 */
export default function CompletionCelebration({
  open,
  taskLabel,
  subjectName,
  continueLabel = 'Weiter lernen',
  onContinue,
  onClose,
}) {
  useEffect(() => {
    if (!open) return
    const intervalId = fireConfettiBurst()
    return () => {
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [open])

  if (!open) return null

  const safeTask = (taskLabel || 'deine Aufgabe').trim()
  const safeSubject = (subjectName || '').trim()

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-celebration-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Schließen"
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-2xl">
        <div
          className="h-1 w-full bg-gradient-to-r from-teal-400 via-amber-200 to-rose-300"
          aria-hidden
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-4 z-20 rounded-full p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
          aria-label="Schließen"
        >
          <span className="block text-xl leading-none">×</span>
        </button>

        <div className="relative px-6 pb-8 pt-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100/90">
            <TrophyIcon />
          </div>

          <h2
            id="completion-celebration-title"
            className="text-2xl font-bold tracking-tight text-stone-800"
          >
            Geschafft!
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-stone-500">
            {safeSubject ? (
              <>
                Du hast{' '}
                <span className="font-semibold text-stone-800">{safeTask}</span> in{' '}
                <span className="font-semibold" style={{ color: TEAL }}>
                  {safeSubject}
                </span>{' '}
                abgeschlossen!
              </>
            ) : (
              <>
                Du hast{' '}
                <span className="font-semibold text-stone-800">{safeTask}</span> abgeschlossen!
              </>
            )}
          </p>
          <p className="mt-2 text-xl font-semibold leading-snug text-teal-700">
            Bleib dran, du bist auf einem richtig guten Weg.
          </p>

          <button
            type="button"
            onClick={onContinue}
            className="mt-8 w-full rounded-full px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:brightness-[1.03] active:brightness-95"
            style={{ backgroundColor: TEAL }}
          >
            {continueLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
