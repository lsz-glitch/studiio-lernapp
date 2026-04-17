import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { FORMAT_LABELS } from './FlashcardCreateModal'
import ReactMarkdown from 'react-markdown'

// Anki-ähnlich: Intervall-Stufen in Tagen
const INTERVAL_STEPS = [0, 1, 3, 7, 14, 30, 60]

function normalizeReviewQuality(rawQuality, fallback = 'good') {
  const value = String(rawQuality || '').trim().toLowerCase()
  if (['again', 'hard', 'good', 'easy'].includes(value)) return value
  if (value === 'mittel' || value === 'medium') return 'good'
  if (value === 'schwer') return 'hard'
  if (value === 'leicht') return 'easy'
  return fallback
}

function nextInterval(currentIntervalDays, qualityInput) {
  const quality = normalizeReviewQuality(qualityInput, 'good')
  if (quality === 'again') return { interval_days: 0, next_review_at: null }
  const cur = currentIntervalDays ?? 0
  let idx = 0
  for (let i = 0; i < INTERVAL_STEPS.length; i++) {
    if (INTERVAL_STEPS[i] <= cur) idx = i
  }

  // Schwer: kleine Steigerung, Gut: normaler Schritt, Leicht: größerer Sprung.
  let nextStep = INTERVAL_STEPS[Math.min(idx + 1, INTERVAL_STEPS.length - 1)]
  if (quality === 'hard') {
    nextStep = cur <= 0 ? 1 : Math.max(1, Math.ceil(cur * 1.4))
  } else if (quality === 'easy') {
    nextStep = INTERVAL_STEPS[Math.min(idx + 2, INTERVAL_STEPS.length - 1)]
  }
  const next = new Date()
  next.setDate(next.getDate() + nextStep)
  return { interval_days: nextStep, next_review_at: next.toISOString() }
}

export default function FlashcardPractice({ user, cards, onBack, onEditCard, onCardChange }) {
  const [sessionCards, setSessionCards] = useState(cards || [])
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [selectedOption, setSelectedOption] = useState(null)
  const [finished, setFinished] = useState(false)
  // Offenes Antwortfeld
  const [openAnswer, setOpenAnswer] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [evaluation, setEvaluation] = useState(null) // { correct, feedback }
  // Definition: Selbstbewertung
  const [definitionGrade, setDefinitionGrade] = useState(null) // again|hard|good|easy|null
  const [choiceGrade, setChoiceGrade] = useState(null) // again|hard|good|easy|null
  const [choiceExplanation, setChoiceExplanation] = useState('')
  const [editingChoiceExplanation, setEditingChoiceExplanation] = useState(false)
  const [savedChoiceExplanations, setSavedChoiceExplanations] = useState({})
  const [explanationSaving, setExplanationSaving] = useState(false)
  const [openAnswerQuality, setOpenAnswerQuality] = useState(null)

  useEffect(() => {
    setSessionCards(cards || [])
    setIndex(0)
    setFinished(false)
  }, [cards])

  const card = sessionCards[index]
  const isLast = index === sessionCards.length - 1
  const total = sessionCards.length

  useEffect(() => {
    if (!card) return
    onCardChange?.(card)
  }, [card, onCardChange])

  function getDefaultGeneralExplanation(targetCard) {
    return 'Wenn du magst, ergänze hier eine eigene Erklärung.'
  }

  useEffect(() => {
    setSavedChoiceExplanations((prev) => {
      const next = { ...(prev || {}) }
      for (const c of cards || []) {
        if (!c?.id) continue
        // Lokale/neu gespeicherte Erklärung nie durch ältere Karten-Daten überschreiben.
        if (typeof next[c.id] === 'string') continue
        next[c.id] = c.general_explanation || getDefaultGeneralExplanation(c)
      }
      return next
    })
  }, [cards])

  useEffect(() => {
    if (!card) return
    const isChoiceCard =
      card.format === 'multiple_choice' || card.format === 'single_choice'
    if (!isChoiceCard) return
    const saved = savedChoiceExplanations?.[card.id]
    setChoiceExplanation(saved || getDefaultGeneralExplanation(card))
    setEditingChoiceExplanation(false)
  }, [card, savedChoiceExplanations])

  async function persistChoiceExplanation(cardId, text) {
    if (!cardId || !user?.id) return
    const next = { ...savedChoiceExplanations, [cardId]: text }
    setSavedChoiceExplanations(next)
    setExplanationSaving(true)
    const { error } = await supabase
      .from('flashcards')
      .update({ general_explanation: text })
      .eq('id', cardId)
      .eq('user_id', user.id)
    if (error) {
      console.error('Erklärung speichern fehlgeschlagen:', error)
      // Bei Fehler nicht stillschweigend überschreiben: vorherigen Wert wiederherstellen.
      setSavedChoiceExplanations((prev) => ({
        ...prev,
        [cardId]: savedChoiceExplanations?.[cardId] || getDefaultGeneralExplanation(card || {}),
      }))
    }
    setExplanationSaving(false)
  }

  async function saveReview(flashcardId, qualityInput, currentIntervalDays = 0) {
    if (!user?.id) return
    const quality = normalizeReviewQuality(qualityInput, 'good')
    const correct = quality !== 'again'
    await supabase.from('flashcard_reviews').insert({
      user_id: user.id,
      flashcard_id: flashcardId,
      correct,
    })
    const { interval_days, next_review_at } = nextInterval(currentIntervalDays, quality)
    await supabase
      .from('flashcards')
      .update({ interval_days, next_review_at })
      .eq('id', flashcardId)
  }

  async function evaluateOpenAnswer() {
    if (!openAnswer.trim()) return
    setEvaluating(true)
    setEvaluation(null)
    try {
      const { apiKey, provider } = await getUserAiConfig(user.id)
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
          provider,
          userId: user.id,
          question: card.question,
          correctAnswer: card.answer,
          userAnswer: openAnswer.trim(),
        }),
      })
      const raw = await res.text()
      if (isLikelyHtmlResponse(raw)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      let result = {}
      try {
        result = JSON.parse(raw || '{}')
      } catch (_) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      if (isBackendInfoRootResponse(result)) {
        throw new Error(MSG_API_WRONG_ENDPOINT)
      }
      const correct = !!result.correct
      const quality = normalizeReviewQuality(result.quality, correct ? 'good' : 'again')
      setOpenAnswerQuality(quality)
      setEvaluation({ correct, feedback: result.feedback || (correct ? 'Richtig.' : 'Leider nicht ganz.') })
      await saveReview(card.id, quality, card.interval_days ?? 0)
    } catch (e) {
      setEvaluation({ correct: false, feedback: 'Bewertung fehlgeschlagen. ' + (e.message || '') })
    } finally {
      setEvaluating(false)
    }
  }

  function shouldRepeatToday(quality) {
    const q = normalizeReviewQuality(quality, 'good')
    return q === 'again' || q === 'hard'
  }

  function queueCurrentCardForRepeat() {
    if (!card) return
    setSessionCards((prev) => [...prev, card])
  }

  function handleNext(forceHasMore = false) {
    if (isLast && !forceHasMore) {
      setFinished(true)
      return
    }
    setShowAnswer(false)
    setSelectedOption(null)
    setOpenAnswer('')
    setEvaluation(null)
    setDefinitionGrade(null)
    setChoiceGrade(null)
    setOpenAnswerQuality(null)
    setEditingChoiceExplanation(false)
    setIndex((i) => i + 1)
  }

  function getWhyWrongSentence(selected, correctAnswer, correct) {
    if (correct) return ''
    return `Du hast "${selected}" ausgewählt, aber korrekt wäre "${correctAnswer}".`
  }

  function handleOptionClick(opt) {
    if (showAnswer) return
    setSelectedOption(opt)
    setShowAnswer(true)
    setChoiceGrade(null)
    setEditingChoiceExplanation(false)
  }

  async function handleToggleChoiceExplanationEdit() {
    if (editingChoiceExplanation) {
      await persistChoiceExplanation(card?.id, choiceExplanation)
      setEditingChoiceExplanation(false)
      return
    }
    setEditingChoiceExplanation(true)
  }

  function handleExplanationKeyDown(e) {
    const isBoldShortcut = (e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 'b'
    if (!isBoldShortcut) return
    e.preventDefault()
    const input = e.currentTarget
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? 0
    const raw = choiceExplanation || ''
    const selected = raw.slice(start, end)

    if (start !== end) {
      const next = `${raw.slice(0, start)}**${selected}**${raw.slice(end)}`
      setChoiceExplanation(next)
      window.requestAnimationFrame(() => {
        input.focus()
        input.setSelectionRange(start + 2, end + 2)
      })
      return
    }

    const next = `${raw.slice(0, start)}****${raw.slice(start)}`
    setChoiceExplanation(next)
    window.requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + 2, start + 2)
    })
  }

  function handleShowAnswerDefinition() {
    setShowAnswer(true)
  }

  async function handleDefinitionSelfRate(grade) {
    setDefinitionGrade(grade)
    await saveReview(card.id, grade, card.interval_days ?? 0)
    const repeat = shouldRepeatToday(grade)
    if (repeat) queueCurrentCardForRepeat()
    handleNext(repeat)
  }

  async function handleChoiceRate(grade) {
    setChoiceGrade(grade)
    await saveReview(card.id, grade, card.interval_days ?? 0)
    const repeat = shouldRepeatToday(grade)
    if (repeat) queueCurrentCardForRepeat()
    handleNext(repeat)
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
          Zurück zum Fach
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
  const remainingCount = Math.max(0, total - index)

  const openEvaluated = isOpen && evaluation != null
  const definitionRated = isDefinition && definitionGrade != null
  const showNextButton =
    (isOpen && openEvaluated) || (isDefinition && definitionRated)

  return (
    <div className="rounded-xl border border-studiio-lavender/60 bg-white overflow-hidden">
      <div className="px-4 py-2 border-b border-studiio-lavender/40 bg-studiio-sky/20 text-sm text-studiio-muted flex items-center justify-between gap-2">
        <span>
          Noch {remainingCount} {remainingCount === 1 ? 'Karte' : 'Karten'} in dieser Session
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
                {definitionGrade === null ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDefinitionSelfRate('again')}
                      className="rounded-lg border-2 border-red-400 bg-red-50 text-red-800 px-4 py-2 text-sm font-medium"
                    >
                      Nochmal
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDefinitionSelfRate('hard')}
                      className="rounded-lg border-2 border-amber-400 bg-amber-50 text-amber-800 px-4 py-2 text-sm font-medium"
                    >
                      Schwer
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDefinitionSelfRate('good')}
                      className="rounded-lg border-2 border-studiio-accent bg-studiio-lavender/20 text-studiio-ink px-4 py-2 text-sm font-medium"
                    >
                      Gut
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDefinitionSelfRate('easy')}
                      className="rounded-lg border-2 border-green-500 bg-green-50 text-green-800 px-4 py-2 text-sm font-medium"
                    >
                      Leicht
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}

        {/* Multiple / Single Choice */}
        {hasOptions && options.length > 0 && (
          <>
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
            {showAnswer && (
              <div className="rounded-lg border border-studiio-lavender/50 bg-studiio-sky/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-studiio-muted">Erklärung</p>
                  <button
                    type="button"
                    onClick={handleToggleChoiceExplanationEdit}
                    className="text-xs font-medium text-studiio-accent hover:underline"
                  >
                    {editingChoiceExplanation ? 'Speichern' : 'Bearbeiten'}
                  </button>
                </div>
                {selectedOption && selectedOption === card.answer && (
                  <p className="mt-2 text-xs font-medium text-green-700">
                    Du hast die richtige Option ausgewählt.
                  </p>
                )}
                {selectedOption && selectedOption !== card.answer && (
                  <p className="mt-2 text-xs font-medium text-red-700">
                    {getWhyWrongSentence(selectedOption, card.answer || '', false)}
                  </p>
                )}
                {editingChoiceExplanation ? (
                  <textarea
                    value={choiceExplanation}
                    onChange={(e) => setChoiceExplanation(e.target.value)}
                    onKeyDown={handleExplanationKeyDown}
                    className="mt-2 w-full rounded-lg border border-studiio-lavender/60 bg-white px-3 py-2 text-sm text-studiio-ink focus:border-studiio-accent focus:outline-none focus:ring-1 focus:ring-studiio-accent"
                    rows={3}
                  />
                ) : (
                  <div className="mt-1 space-y-1">
                    <div className="prose prose-sm max-w-none text-studiio-ink prose-p:my-2 prose-strong:text-studiio-ink">
                      <ReactMarkdown>{String(choiceExplanation || '').replace(/\n/g, '  \n')}</ReactMarkdown>
                    </div>
                    {explanationSaving && (
                      <p className="text-xs text-studiio-muted">Erklärung wird gespeichert …</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {showAnswer && (
              <div className="flex flex-wrap gap-2">
                {selectedOption === card.answer ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleChoiceRate('hard')}
                      className="rounded-lg border-2 border-amber-400 bg-amber-50 text-amber-800 px-4 py-2 text-sm font-medium"
                    >
                      Schwer
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChoiceRate('good')}
                      className="rounded-lg border-2 border-studiio-accent bg-studiio-lavender/20 text-studiio-ink px-4 py-2 text-sm font-medium"
                    >
                      Mittel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChoiceRate('easy')}
                      className="rounded-lg border-2 border-green-500 bg-green-50 text-green-800 px-4 py-2 text-sm font-medium"
                    >
                      Leicht
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleChoiceRate('again')}
                    className="rounded-lg border-2 border-red-400 bg-red-50 text-red-800 px-4 py-2 text-sm font-medium"
                  >
                    Nochmal
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Weiter-Button: bei Open nach Bewertung, bei Definition nach Richtig/Falsch, bei MC/SC nach Auswahl */}
        {showNextButton && (
          <button
            type="button"
            onClick={() => {
              const repeat = isOpen && openEvaluated ? shouldRepeatToday(openAnswerQuality) : false
              if (repeat) queueCurrentCardForRepeat()
              handleNext(repeat)
            }}
            className="rounded-lg border-2 border-studiio-accent text-studiio-accent px-4 py-2 text-sm font-medium hover:bg-studiio-accent/10"
          >
            {isLast ? 'Fertig' : 'Weiter →'}
          </button>
        )}
      </div>
    </div>
  )
}
