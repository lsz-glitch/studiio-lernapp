import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { FORMAT_LABELS } from './FlashcardCreateModal'
import FlashcardAddManualModal from './FlashcardAddManualModal'
import FlashcardEditModal from './FlashcardEditModal'

export default function FlashcardsSection({
  user,
  subject,
  refreshTrigger,
  onStartPractice,
  showAddModal = false,
  onCloseAddModal,
  onOpenAddModal,
}) {
  const [cards, setCards] = useState([])
  const [draftCards, setDraftCards] = useState([])
  const [materialsById, setMaterialsById] = useState({})
  const [manualFolderName, setManualFolderName] = useState('Manuelle Karten')
  const [editingManualFolderName, setEditingManualFolderName] = useState(false)
  const [manualFolderInput, setManualFolderInput] = useState('')
  const [manualFolderSaving, setManualFolderSaving] = useState(false)
  const [manualFolderError, setManualFolderError] = useState('')
  const [toPracticeCount, setToPracticeCount] = useState(null) // null = noch nicht geladen
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addModalRefresh, setAddModalRefresh] = useState(0)
  const [showManageList, setShowManageList] = useState(false)
  const [showDraftList, setShowDraftList] = useState(false)
  const [expandedManageGroups, setExpandedManageGroups] = useState({})
  const [editingCard, setEditingCard] = useState(null)

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    setLoading(true)
    supabase
      .from('flashcards')
      .select('id, format, question, answer, options, position, next_review_at, material_id, is_draft')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .order('position', { ascending: true })
      .then(({ data, error: e }) => {
        if (!mounted) return
        if (e) {
          setError(e.message)
          setCards([])
          setToPracticeCount(null)
        } else {
          setError('')
          const all = data || []
          setCards(all.filter((c) => !c.is_draft))
          setDraftCards(all.filter((c) => !!c.is_draft))
        }
        setLoading(false)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshTrigger, addModalRefresh])

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    setManualFolderError('')
    supabase
      .from('subjects')
      .select('flashcards_manual_folder_name')
      .eq('id', subject.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (!mounted) return
        if (e) {
          console.error('Manueller Unterordner konnte nicht geladen werden:', e)
          setManualFolderError('Unterordner-Name konnte nicht geladen werden. Bitte SQL dafür ausführen.')
          setManualFolderName('Manuelle Karten')
          setManualFolderInput('Manuelle Karten')
          return
        }
        const name = (data?.flashcards_manual_folder_name || '').trim() || 'Manuelle Karten'
        setManualFolderName(name)
        setManualFolderInput(name)
      })
    return () => { mounted = false }
  }, [subject?.id, user?.id, refreshTrigger, addModalRefresh])

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    supabase
      .from('materials')
      .select('id, filename')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .is('deleted_at', null)
      .then(({ data }) => {
        if (!mounted) return
        const map = {}
        for (const row of data || []) map[row.id] = row
        setMaterialsById(map)
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshTrigger, addModalRefresh])

  // Leichte Berechnung: zu üben = überfällig oder ohne next_review_at.
  // Vermeidet große flashcard_reviews-Abfragen beim Öffnen eines Fachs.
  useEffect(() => {
    if (cards.length === 0) {
      setToPracticeCount(cards.length)
      return
    }
    const nowIso = new Date().toISOString()
    const needPractice = cards.filter(
      (c) => !c.next_review_at || c.next_review_at <= nowIso,
    ).length
    setToPracticeCount(needPractice)
  }, [cards])

  const toPractice = toPracticeCount ?? cards.length
  const groupedByMaterial = cards.reduce((acc, c) => {
    const key = c.material_id || '__manual__'
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})
  const materialGroups = Object.entries(groupedByMaterial).sort(([a], [b]) => {
    if (a === '__manual__') return 1
    if (b === '__manual__') return -1
    const nameA = materialsById[a]?.filename || ''
    const nameB = materialsById[b]?.filename || ''
    return nameA.localeCompare(nameB, 'de')
  })
  const manageGroups = materialGroups.map(([materialId, groupCards]) => ({
    id: materialId,
    label:
      materialId === '__manual__'
        ? manualFolderName
        : (materialsById[materialId]?.filename || 'Unbekannte Datei'),
    cards: groupCards,
  }))

  useEffect(() => {
    if (!showManageList) return
    // Standardmäßig alle Gruppen öffnen, damit man Karten sofort sieht.
    const next = {}
    for (const g of manageGroups) next[g.id] = true
    setExpandedManageGroups(next)
  }, [showManageList, cards.length, subject?.id])

  if (loading) return <p className="text-sm text-studiio-muted">Vokabeln werden geladen …</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  if (cards.length === 0 && draftCards.length === 0) {
    return (
      <>
        {showAddModal && (
          <FlashcardAddManualModal
            user={user}
            subject={subject}
            materialOptions={Object.values(materialsById)}
            currentCardCount={0}
            onClose={onCloseAddModal}
            onSuccess={() => { setAddModalRefresh((n) => n + 1); onCloseAddModal?.() }}
          />
        )}
      </>
    )
  }

  async function handleDeleteCard(card) {
    if (!window.confirm('Diese Vokabel-Karte wirklich löschen?')) return
    const { error: e } = await supabase.from('flashcards').delete().eq('id', card.id)
    if (e) {
      console.error(e)
      return
    }
    setCards((prev) => prev.filter((c) => c.id !== card.id))
    setAddModalRefresh((n) => n + 1)
  }

  function handleEditSuccess(updated) {
    setCards((prev) => prev.map((c) => (c.id === editingCard.id ? { ...c, ...updated } : c)))
    setEditingCard(null)
    setAddModalRefresh((n) => n + 1)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-studiio-ink">
          <strong>{cards.length}</strong> {cards.length === 1 ? 'Vokabel' : 'Vokabeln'} in diesem Fach.
          <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            {toPractice} noch zu üben
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1">
        <button
          type="button"
          onClick={() => onStartPractice?.(null)}
          className="rounded-lg bg-studiio-accent px-4 py-2 text-sm font-medium text-white hover:bg-studiio-accentHover"
        >
          Vokabeln üben
        </button>
        <button
          type="button"
          onClick={() => setShowManageList((v) => !v)}
          className="rounded-lg border border-studiio-lavender/60 px-4 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/30"
        >
          {showManageList ? 'Verwalten ausblenden' : 'Vokabeln verwalten'}
        </button>
        <button
          type="button"
          onClick={() => setShowDraftList((v) => !v)}
          className="rounded-lg border border-studiio-lavender/60 px-4 py-2 text-sm font-medium text-studiio-ink hover:bg-studiio-lavender/30"
        >
          {showDraftList ? `Entwürfe ausblenden (${draftCards.length})` : `Entwürfe (${draftCards.length})`}
        </button>
      </div>

      {showDraftList && draftCards.length > 0 && (
        <div className="rounded-xl border border-studiio-lavender/50 bg-white/85 overflow-hidden">
          <p className="text-xs text-studiio-muted px-3 py-2 border-b border-studiio-lavender/30">
            Entwürfe ({draftCards.length}) — noch nicht im Wiederholungsmodus
          </p>
          <ul className="divide-y divide-studiio-lavender/25 max-h-56 overflow-auto">
            {draftCards.map((card) => (
              <li key={card.id} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-studiio-ink truncate">{card.question}</p>
                  <p className="text-xs text-studiio-muted">
                    {FORMAT_LABELS[card.format] || card.format} • {card.answer?.trim() ? 'Antwort vorhanden' : 'Antwort offen'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingCard(card)}
                  className="rounded border border-studiio-lavender/60 px-2 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/30"
                >
                  Bearbeiten
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {materialGroups.length > 0 && (
        <div className="rounded-xl border border-studiio-lavender/50 bg-white/85 overflow-hidden">
          <p className="text-xs text-studiio-muted px-3 py-2 border-b border-studiio-lavender/30">
            Nach Vorlesung/Datei gruppiert
          </p>
          <ul className="divide-y divide-studiio-lavender/25">
            {materialGroups.map(([materialId, groupCards]) => {
              const isManual = materialId === '__manual__'
              const label = isManual
                ? manualFolderName
                : (materialsById[materialId]?.filename || 'Unbekannte Datei')
              const nowIso = new Date().toISOString()
              const dueCount = groupCards.filter((c) => !c.next_review_at || c.next_review_at <= nowIso).length
              return (
                <li key={materialId} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-studiio-ink truncate">{label}</p>
                    <p className="text-xs text-studiio-muted">
                      {groupCards.length} Karten • {dueCount} fällig
                    </p>
                  </div>
                  {!isManual && (
                    <button
                      type="button"
                      onClick={() => onStartPractice?.({ id: materialId, filename: label })}
                      className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-sky/20"
                    >
                      Nur diese üben
                    </button>
                  )}
                  {isManual && (
                    <button
                      type="button"
                      onClick={() => setEditingManualFolderName((v) => !v)}
                      className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-sky/20"
                    >
                      {editingManualFolderName ? 'Schließen' : 'Umbenennen'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {editingManualFolderName && (
            <div className="border-t border-studiio-lavender/25 px-3 py-3 space-y-2">
              <label className="block text-xs font-medium text-studiio-ink">
                Name für manuellen Unterordner
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={manualFolderInput}
                  onChange={(e) => setManualFolderInput(e.target.value)}
                  placeholder="z. B. Eigene Prüfungskarten"
                  className="studiio-input w-full sm:w-auto sm:min-w-[280px]"
                />
                <button
                  type="button"
                  disabled={manualFolderSaving}
                  onClick={async () => {
                    const nextName = manualFolderInput.trim() || 'Manuelle Karten'
                    setManualFolderSaving(true)
                    setManualFolderError('')
                    const { error: updateErr } = await supabase
                      .from('subjects')
                      .update({ flashcards_manual_folder_name: nextName })
                      .eq('id', subject.id)
                      .eq('user_id', user.id)
                    setManualFolderSaving(false)
                    if (updateErr) {
                      console.error('Unterordner-Name speichern fehlgeschlagen:', updateErr)
                      setManualFolderError('Speichern fehlgeschlagen. Bitte SQL für Unterordner-Namen ausführen.')
                      return
                    }
                    setManualFolderName(nextName)
                    setEditingManualFolderName(false)
                  }}
                  className="rounded-lg bg-studiio-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-studiio-accentHover disabled:opacity-60"
                >
                  {manualFolderSaving ? 'Speichert …' : 'Speichern'}
                </button>
              </div>
              {manualFolderError && (
                <p className="text-xs text-red-600">{manualFolderError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {showManageList && (
        <div className="rounded-xl border border-studiio-lavender/50 bg-white/90 overflow-hidden">
          <p className="text-xs text-studiio-muted px-3 py-2 border-b border-studiio-lavender/30">
            Karten pro Datei ausklappen, dann bearbeiten oder löschen.
          </p>
          <ul className="divide-y divide-studiio-lavender/30 max-h-72 overflow-auto">
            {manageGroups.map((group) => {
              const expanded = !!expandedManageGroups[group.id]
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedManageGroups((prev) => ({ ...prev, [group.id]: !expanded }))}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-studiio-sky/10"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-studiio-ink truncate">{group.label}</span>
                      <span className="ml-2 text-[11px] text-studiio-muted">{group.cards.length} Karten</span>
                    </span>
                    <span className="text-xs text-studiio-muted">{expanded ? '▾' : '▸'}</span>
                  </button>
                  {expanded && (
                    <ul className="border-t border-studiio-lavender/20 bg-white">
                      {group.cards.map((card) => (
                        <li key={card.id} className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium text-studiio-ink line-clamp-1">{card.question}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-studiio-sky/50 text-studiio-ink ml-1">
                              {FORMAT_LABELS[card.format] || card.format}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingCard(card)}
                              className="rounded border border-studiio-lavender/60 px-2 py-1 text-xs font-medium text-studiio-ink hover:bg-studiio-lavender/30"
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCard(card)}
                              className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Löschen
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {showAddModal && (
        <FlashcardAddManualModal
          user={user}
          subject={subject}
          materialOptions={Object.values(materialsById)}
          currentCardCount={cards.length}
          onClose={onCloseAddModal}
          onSuccess={() => { setAddModalRefresh((n) => n + 1); onCloseAddModal?.() }}
        />
      )}
      {editingCard && (
        <FlashcardEditModal
          user={user}
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSuccess={handleEditSuccess}
          onDelete={(deletedCard) => {
            setCards((prev) => prev.filter((c) => c.id !== deletedCard.id))
            setDraftCards((prev) => prev.filter((c) => c.id !== deletedCard.id))
            setAddModalRefresh((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}
