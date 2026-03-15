import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { FORMAT_LABELS } from './FlashcardCreateModal'
import { getApiBase } from '../config'
import { recordStreakActivity } from '../utils/streak'

// Anki-ähnlich: Intervall-Stufen in Tagen (falsch → 0, richtig → 1, 3, 7, 14, 30)
const INTERVAL_STEPS = [0, 1, 3, 7, 14, 30]

function nextInterval(currentIntervalDays, correct) {
  if (!correct) return { interval_days: 0, next_review_at: null }
  const cur = currentIntervalDays ?? 0
  let idx = 0
  for (let i = 0; i < INTERVAL_STEPS.length; i++) {
    if (INTERVAL_STEPS[i] <= cur) idx = i
  }
  const nextStep = INTERVAL_STEPS[Math.min(idx + 1, INTERVAL_STEPS.length - 1)]
  const next = new Date()
  next.setDate(next.getDate() + nextStep)
  return { interval_days: nextStep, next_review_at: next.toISOString() }
}

export default function FlashcardPractice({ user, cards, onBack, onEditCard }) {
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [selectedOption, setSelectedOption] = useState(null)
  const [finished, setFinished] = useState(false)
  // Offenes Antwortfeld
  const [openAnswer, setOpenAnswer] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [evaluation, setEvaluation] = useState(null) // { correct, feedback }
  // Definition: Selbstbewertung
  const [definitionCorrect, setDefinitionCorrect] = useState(null) // true | false | null

  const card = cards[index]
  const isLast = index === cards.length - 1
  const total = cards.length

  async function saveReview(flashcardId, correct, currentIntervalDays = 0) {
    if (!user?.id) return
    await supabase.from('flashcard_reviews').insert({
      user_id: user.id,
      flashcard_id: flashcardId,
      correct,
    })
    const { interval_days, next_review_at } = nextInterval(currentIntervalDays, correct)
    await supabase
      .from('flashcards')
      .update({ interval_days, next_review_at })
      .eq('id', flashcardId)
    // Streak: Jede Vokabel zählt als Lernaktivität (nur 1× pro Tag wird gezählt)
    recordStreakActivity(user.id)
  }

  async function evaluateOpenAnswer() {
    if (!openAnswer.trim()) return
    setEvaluating(true)
    setEvaluation(null)
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('claude_api_key_encrypted')
        .eq('id', user.id)
        .maybeSingle()
      const apiKey = profile?.claude_api_key_encrypted
      if (!apiKey) {
        setEvaluation({ correct: false, feedback: 'Kein API-Key. Bitte in den Einstellungen eintragen.' })
        setEvaluating(false)
        return
      }
      const res = await fetch(`${getApiBase()}/api/evaluate-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          question: card.question,
          correctAnswer: card.answer,
          userAnswer: openAnswer.trim(),
        }),
      })
      const result = await res.json().catch(() => ({}))
      const correct = !!result.correct
      setEvaluation({ correct, feedback: result.feedback || (correct ? 'Richtig.' : 'Leider nicht ganz.') })
      await saveReview(card.id, correct, card.interval_days ?? 0)
    } catch (e) {
      setEvaluation({ correct: false, feedback: 'Bewertung fehlgeschlagen. ' + (e.message || '') })
    } finally {
      setEvaluating(false)
    }
  }

  function handleNext() {
    if (isLast) {
      setFinished(true)
      return
    }
    setShowAnswer(false)
    setSelectedOption(null)
    setOpenAnswer('')
    setEvaluation(null)
    setDefinitionCorrect(null)
    setIndex((i) => i + 1)
  }

  function handleOptionClick(opt) {
    if (showAnswer) return
    setSelectedOption(opt)
    setShowAnswer(true)
    const correct = opt === card.answer
    saveReview(card.id, correct)
  }

  function handleShowAnswerDefinition() {
    setShowAnswer(true)
  }

  async function handleDefinitionSelfRate(correct) {
    setDefinitionCorrect(correct)
    await saveReview(card.id, correct, card.interval_days ?? 0)
    handleNext()
  }

  if (!card) {
    return (
      <div className="rounded-xl border border-studiio-lavender/60 bg-white p-6 text-center">
        <p className="text-studiio-muted">Keine Karten zum Üben.</p>
        <button type="button" onClick={onBack} className="mt-3 text-sm text-studiio-accent hover:underline">
          Zurück
        </button>
      </div>
    )
  }

  if (finished) {
    return (
      <div className="rounded-xl border border-studiio-lavender/60 bg-white p-6 space-y-4">
        <p className="text-lg font-medium text-studiio-ink">
          Fertig! Du hast alle {total} Karteikarten durchgearbeitet.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
        >
          Zurück zu den Vokabeln
        </button>
      </div>
    )
  }

  const isOpen = card.format === 'open'
  const isDefinition = card.format === 'definition'
  const isMultiple = card.format === 'multiple_choice'
  const isSingle = card.format === 'single_choice'
  const hasOptions = isMultiple || isSingle
  const options = Array.isArray(card.options) ? card.options : []

  const openEvaluated = isOpen && evaluation != null
  const definitionRated = isDefinition && definitionCorrect != null
  const showNextButton =
    (hasOptions && showAnswer) || (isOpen && openEvaluated) || (isDefinition && definitionRated)

  return (
    <div className="rounded-xl border border-studiio-lavender/60 bg-white overflow-hidden">
      <div className="px-4 py-2 border-b border-studiio-lavender/40 bg-studiio-sky/20 text-sm text-studiio-muted flex items-center justify-between gap-2">
        <span>
          Karte {index + 1} von {total}
          {card.format && (
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-studiio-lavender/40">
              {FORMAT_LABELS[card.format] || card.format}
            </span>
          )}
        </span>
        {onEditCard && (
          <button
            type="button"
            onClick={() => onEditCard(card)}
            className="text-xs font-medium text-studiio-accent hover:underline"
          >
            Bearbeiten
          </button>
        )}
      </div>
      <div className="p-5 space-y-4">
        <p className="text-base font-medium text-studiio-ink leading-relaxed">
          {card.question}
        </p>

        {/* Offenes Antwortfeld: Eingabe + KI-Bewertung */}
        {isOpen && (
          <>
            {!evaluation ? (
              <>
                <textarea
                  value={openAnswer}
                  onChange={(e) => setOpenAnswer(e.target.value)}
                  placeholder="Deine Antwort eingeben …"
                  className="w-full rounded-lg border border-studiio-lavender/60 px-3 py-2 text-sm text-studiio-ink placeholder:text-studiio-muted min-h-[100px] focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
                  disabled={evaluating}
                />
                <button
                  type="button"
                  onClick={evaluateOpenAnswer}
                  disabled={evaluating || !openAnswer.trim()}
                  className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover disabled:opacity-50"
                >
                  {evaluating ? 'Wird bewertet …' : 'Antwort prüfen'}
                </button>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-studiio-lavender/20 border border-studiio-lavender/50 p-3">
                  <p className="text-xs text-studiio-muted mb-1">Deine Antwort:</p>
                  <p className="text-sm text-studiio-ink whitespace-pre-wrap">{openAnswer}</p>
                </div>
                <div
                  className={`rounded-lg border-2 p-4 ${
                    evaluation.correct ? 'border-green-500 bg-green-50 text-green-800' : 'border-red-400 bg-red-50 text-red-800'
                  }`}
                >
                  <p className="font-medium">{evaluation.correct ? 'Richtig ✓' : 'Nicht ganz ✗'}</p>
                  <p className="text-sm mt-1">{evaluation.feedback}</p>
                </div>
                <div className="rounded-lg bg-studiio-sky/30 border border-studiio-lavender/40 p-3">
                  <p className="text-xs text-studiio-muted mb-1">Richtige Antwort:</p>
                  <p className="text-sm text-studiio-ink">{card.answer}</p>
                </div>
              </>
            )}
          </>
        )}

        {/* Definitions-Abfrage: Antwort anzeigen, dann Richtig/Falsch */}
        {isDefinition && !hasOptions && (
          <>
            {!showAnswer ? (
              <button
                type="button"
                onClick={handleShowAnswerDefinition}
                className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
              >
                Antwort anzeigen
              </button>
            ) : (
              <>
                <div className="rounded-lg bg-studiio-sky/30 border border-studiio-lavender/40 p-4">
                  <p className="text-xs text-studiio-muted mb-1">Antwort:</p>
                  <p className="text-sm text-studiio-ink">{card.answer}</p>
                </div>
                {definitionCorrect === null ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDefinitionSelfRate(true)}
                      className="rounded-lg border-2 border-green-500 bg-green-50 text-green-800 px-4 py-2 text-sm font-medium"
                    >
                      Richtig
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDefinitionSelfRate(false)}
                      className="rounded-lg border-2 border-red-400 bg-red-50 text-red-800 px-4 py-2 text-sm font-medium"
                    >
                      Falsch
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}

        {/* Multiple / Single Choice */}
        {hasOptions && options.length > 0 && (
          <ul className="space-y-2">
            {options.map((opt, i) => {
              const chosen = selectedOption === opt
              const correct = opt === card.answer
              const showCorrect = showAnswer && correct
              const showWrong = showAnswer && chosen && !correct
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handleOptionClick(opt)}
                    disabled={showAnswer}
                    className={`w-full text-left rounded-lg border-2 px-4 py-3 text-sm transition ${
                      showCorrect
                        ? 'border-green-500 bg-green-50 text-green-800'
                        : showWrong
                          ? 'border-red-400 bg-red-50 text-red-800'
                          : showAnswer
                            ? 'border-studiio-lavender/40 bg-studiio-lavender/20 text-studiio-ink'
                            : 'border-studiio-lavender/60 hover:border-studiio-accent hover:bg-studiio-sky/30 text-studiio-ink'
                    }`}
                  >
                    {opt}
                    {showCorrect && ' ✓'}
                    {showWrong && ' ✗'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Weiter-Button: bei Open nach Bewertung, bei Definition nach Richtig/Falsch, bei MC/SC nach Auswahl */}
        {showNextButton && (
          <button
            type="button"
            onClick={handleNext}
            className="rounded-lg border-2 border-studiio-accent text-studiio-accent px-4 py-2 text-sm font-medium hover:bg-studiio-accent/10"
          >
            {isLast ? 'Fertig' : 'Weiter →'}
          </button>
        )}
      </div>
    </div>
  )
}
