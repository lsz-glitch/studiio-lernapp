import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import FlashcardEditModal from './FlashcardEditModal'
import { FORMAT_LABELS } from './FlashcardCreateModal'

const MAX_STORAGE_PER_USER_BYTES = 20 * 1024 * 1024 // 20 MB

const CATEGORY_OPTIONS = [
  'Vorlesung',
  'Übung',
  'Tutorium',
  'Probeklausur',
  'Zusatzmaterialien',
]

function getCategoryHeaderClasses(category) {
  const c = String(category || '').toLowerCase()
  if (c.includes('vorlesung')) return 'bg-[#e8eefc] border-[#c9d8f7]'
  if (c.includes('übung') || c.includes('uebung') || c.includes('tutorium')) return 'bg-[#e7f7ef] border-[#bfead3]'
  if (c.includes('probe')) return 'bg-[#fff2e5] border-[#ffd8b8]'
  if (c.includes('zusatz')) return 'bg-[#f3edff] border-[#dbccff]'
  return 'bg-white/70 border-studiio-lavender/40'
}

export default function SubjectMaterials({ user, subject, refreshTrigger, onOpenLecture, onOpenFlashcardCreate, onStartPractice }) {
  const [materials, setMaterials] = useState([])
  const [materialIdsWithGeneratedCards, setMaterialIdsWithGeneratedCards] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [selectedFiles, setSelectedFiles] = useState([]) // [{file, category}]
  const [uploading, setUploading] = useState(false)
  const [deletingMaterialId, setDeletingMaterialId] = useState(null)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState({})
  const [quickDraftCards, setQuickDraftCards] = useState([])
  const [quickDraftExpanded, setQuickDraftExpanded] = useState(false)
  const [editingDraftCard, setEditingDraftCard] = useState(null)
  const [vocabCountsByMaterial, setVocabCountsByMaterial] = useState({})
  const [manualVocabCount, setManualVocabCount] = useState(0)
  const [vocabByDocumentExpanded, setVocabByDocumentExpanded] = useState(false)

  const [totalBytes, setTotalBytes] = useState(0)
  const [completedTutorMaterialIds, setCompletedTutorMaterialIds] = useState(new Set())

  useEffect(() => {
    let isMounted = true

    async function load() {
      setLoading(true)
      setError('')
      setInfo('')

      const { data, error: err } = await supabase
        .from('materials')
        .select('id, filename, category, size_bytes, created_at, storage_path')
        .eq('user_id', user.id)
        .eq('subject_id', subject.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (!isMounted) return

      if (err) {
        console.error('Fehler beim Laden der Materialien:', err)
        setError(
          `Dateien konnten nicht geladen werden: ${
            err?.message || 'Bitte prüfe die Tabelle \"materials\" und den Storage-Bucket in Supabase.'
          }`,
        )
        setLoading(false)
        return
      }

      setMaterials(data || [])
      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [user.id, subject.id])

  // Gesamtgröße nur laden, wenn Upload-Bereich sichtbar ist (deutlich leichter beim Öffnen eines Fachs).
  useEffect(() => {
    if (!showUploadForm) return
    let mounted = true
    ;(async () => {
      const { data: sizeRows, error: sizeErr } = await supabase
        .from('materials')
        .select('size_bytes')
        .eq('user_id', user.id)
        .is('deleted_at', null)
      if (!mounted || sizeErr) return
      const sumBytes = (sizeRows || []).reduce((sum, row) => sum + (row.size_bytes || 0), 0)
      setTotalBytes(sumBytes)
    })()
    return () => { mounted = false }
  }, [showUploadForm, user.id])

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    supabase
      .from('flashcards')
      .select('id, format, question, answer, is_draft, material_id, created_at')
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .eq('is_draft', true)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          console.error('Schnellkarteikarten konnten nicht geladen werden:', error)
          setQuickDraftCards([])
          return
        }
        setQuickDraftCards(data || [])
      })
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshTrigger, deletingMaterialId])

  // Pro Datei nur einmal KI-Vokabeln: welche Materialien haben bereits Karten?
  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    supabase
      .from('flashcards')
      .select('material_id')
      .eq('subject_id', subject.id)
      .eq('user_id', user.id)
      .eq('is_draft', false)
      .not('material_id', 'is', null)
      .then(({ data }) => {
        if (!mounted) return
        const ids = new Set((data || []).map((r) => r.material_id).filter(Boolean))
        setMaterialIdsWithGeneratedCards(ids)
      })
    return () => { mounted = false }
  }, [user.id, subject.id, refreshTrigger])

  useEffect(() => {
    if (!subject?.id || !user?.id) return
    let mounted = true
    ;(async () => {
      const { data, error } = await supabase
        .from('flashcards')
        .select('id, material_id')
        .eq('user_id', user.id)
        .eq('subject_id', subject.id)
        .eq('is_draft', false)
      if (!mounted) return
      if (error) {
        console.error('Vokabeln pro Dokument konnten nicht geladen werden:', error)
        setVocabCountsByMaterial({})
        setManualVocabCount(0)
        return
      }
      const counts = {}
      let manualCount = 0
      for (const row of data || []) {
        if (row.material_id) counts[row.material_id] = (counts[row.material_id] || 0) + 1
        else manualCount += 1
      }
      setVocabCountsByMaterial(counts)
      setManualVocabCount(manualCount)
    })()
    return () => { mounted = false }
  }, [user?.id, subject?.id, refreshTrigger, deletingMaterialId])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('tutor_progress')
          .select('material_id')
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('is_completed', true)
        if (!mounted || error) return
        const ids = new Set((data || []).map((r) => r.material_id).filter(Boolean))
        setCompletedTutorMaterialIds(ids)
      } catch (_) {}
    })()
    return () => { mounted = false }
  }, [user.id, subject.id, refreshTrigger])

  const usedMb = (totalBytes / (1024 * 1024)).toFixed(1)
  const maxMb = (MAX_STORAGE_PER_USER_BYTES / (1024 * 1024)).toFixed(0)

  const groupedMaterials = useMemo(() => {
    const groups = new Map()
    for (const m of materials) {
      const key = m.category || 'Ohne Kategorie'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(m)
    }
    return Array.from(groups.entries())
  }, [materials])

  useEffect(() => {
    // Kategorien standardmäßig eingeklappt halten, um lange Listen kompakt zu machen.
    const next = {}
    for (const [category] of groupedMaterials) {
      next[category] = expandedCategories[category] ?? false
    }
    setExpandedCategories(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedMaterials.length, subject?.id])

  function addFiles(files, replace = false) {
    const list = Array.from(files || []).filter((f) => f && f instanceof File)
    if (!list.length) return
    const invalid = list.find(
      (f) => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'),
    )
    if (invalid) {
      setError('Es sind aktuell nur PDF-Dateien erlaubt.')
      return
    }
    setError('')
    setInfo('')
    const newEntries = list.map((f) => ({ file: f, category: CATEGORY_OPTIONS[0] }))
    setSelectedFiles((prev) => (replace ? newEntries : [...prev, ...newEntries]))
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    addFiles(files, true)
    event.target.value = ''
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (!files?.length) return
    setShowUploadForm(true)
    addFiles(files)
  }

  function handleSelectedCategoryChange(index, value) {
    setSelectedFiles((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, category: value } : entry)),
    )
  }

  function handleOpenTutor(materialRow) {
    if (!onOpenLecture) return
    const alreadyCompleted = completedTutorMaterialIds.has(materialRow.id)
    if (!alreadyCompleted) {
      onOpenLecture(materialRow)
      return
    }
    const shouldReopen = window.confirm(
      'Diese Datei ist bereits als "Tutor erledigt" markiert. Möchtest du sie erneut durcharbeiten?',
    )
    if (shouldReopen) onOpenLecture(materialRow)
  }

  async function handleUpload(e) {
    e.preventDefault()
    setError('')
    setInfo('')

    if (!selectedFiles.length) {
      setError('Bitte wähle mindestens eine PDF-Datei aus.')
      return
    }

    const sumNewSizes = selectedFiles.reduce((sum, entry) => sum + entry.file.size, 0)
    if (totalBytes + sumNewSizes > MAX_STORAGE_PER_USER_BYTES) {
      setError(`Upload überschreitet das Speicherlimit von ${maxMb} MB pro Nutzer.`)
      return
    }

    setUploading(true)
    const newRows = []

    for (const entry of selectedFiles) {
      const { file, category } = entry
      const path = `${user.id}/${subject.id}/${Date.now()}_${file.name}`

      const { error: storageError } = await supabase.storage
        .from('materials')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (storageError) {
        console.error('Fehler beim Upload in Supabase Storage:', storageError)
        setError(`Upload fehlgeschlagen: ${storageError.message || 'Bitte später erneut versuchen.'}`)
        setUploading(false)
        return
      }

      const { data: row, error: dbError } = await supabase
        .from('materials')
        .insert({
          user_id: user.id,
          subject_id: subject.id,
          filename: file.name,
          category,
          size_bytes: file.size,
          storage_path: path,
        })
        .select('id, filename, category, size_bytes, created_at, storage_path')
        .single()

      if (dbError) {
        console.error('Fehler beim Speichern der Material-Metadaten:', dbError)
        setError(
          `Metadaten konnten nicht gespeichert werden: ${
            dbError.message || 'Bitte später erneut versuchen.'
          }`,
        )
        setUploading(false)
        return
      }

      // PDF direkt nach Upload indizieren (best effort), damit Tutor später nicht erneut parsen muss.
      try {
        await fetch('/api/index-material-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            materialId: row.id,
            storagePath: path,
          }),
        })
      } catch (_) {
        // Kein harter Fehler: Tutor nutzt dann Fallback-Extraktion bei Bedarf.
      }

      newRows.push({ row, size: file.size })
    }

    // Wenn wir hier sind, war alles erfolgreich
    setMaterials((prev) => [...newRows.map((n) => n.row), ...prev])
    const addedBytes = newRows.reduce((sum, n) => sum + n.size, 0)
    setTotalBytes((prev) => prev + addedBytes)
    setSelectedFiles([])
    setInfo('Dateien wurden erfolgreich hochgeladen.')
    setUploading(false)
  }

  async function handleDeleteMaterial(materialRow) {
    const ok = window.confirm(
      `Datei wirklich aus diesem Fach entfernen?\n\n${materialRow.filename}\n\nDanach kannst du entscheiden, ob verknüpfte Vokabeln mitgelöscht oder beibehalten werden.`,
    )
    if (!ok) return
    setDeletingMaterialId(materialRow.id)
    setError('')
    setInfo('')

    // Option für verknüpfte Vokabeln
    let linkedCardsCount = 0
    const { count: linkedCount, error: countErr } = await supabase
      .from('flashcards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('subject_id', subject.id)
      .eq('material_id', materialRow.id)
    if (countErr) {
      setError(`Vokabeln zur Datei konnten nicht geprüft werden: ${countErr.message}`)
      setDeletingMaterialId(null)
      return
    }
    linkedCardsCount = linkedCount || 0

    let deleteLinkedCards = false
    if (linkedCardsCount > 0) {
      const choice = window.prompt(
        `Zu dieser Datei gibt es ${linkedCardsCount} verknüpfte Vokabel${linkedCardsCount === 1 ? '' : 'n'}.\n\n` +
        `Bitte auswählen:\n` +
        `1 = Vokabeln und Folien\n` +
        `2 = Nur Folien\n\n` +
        `Hinweis: Der gespeicherte Folienkontext bleibt immer erhalten.`,
        '2',
      )
      if (choice == null) {
        setDeletingMaterialId(null)
        return
      }
      const normalizedChoice = String(choice).trim()
      if (normalizedChoice === '1') {
        deleteLinkedCards = true
      } else if (normalizedChoice === '2') {
        deleteLinkedCards = false
      } else {
        setError('Ungültige Auswahl. Bitte erneut löschen und 1 oder 2 eingeben.')
        setDeletingMaterialId(null)
        return
      }
    }

    const { error: delErr } = await supabase
      .from('materials')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', materialRow.id)
      .eq('user_id', user.id)
    if (delErr) {
      setError(
        `Löschen nicht möglich: ${delErr.message}. Bitte zuerst die SQL-Datei für Soft-Delete ausführen.`,
      )
      setDeletingMaterialId(null)
      return
    }

    if (linkedCardsCount > 0) {
      if (deleteLinkedCards) {
        const { error: deleteCardsErr } = await supabase
          .from('flashcards')
          .delete()
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('material_id', materialRow.id)
        if (deleteCardsErr) {
          setError(`Datei wurde gelöscht, aber verknüpfte Vokabeln nicht: ${deleteCardsErr.message}`)
          setDeletingMaterialId(null)
          return
        }
      } else {
        // Vokabeln bleiben erhalten, verlieren aber die Datei-Zuordnung.
        const { error: keepCardsErr } = await supabase
          .from('flashcards')
          .update({ material_id: null })
          .eq('user_id', user.id)
          .eq('subject_id', subject.id)
          .eq('material_id', materialRow.id)
        if (keepCardsErr) {
          setError(`Datei wurde gelöscht, aber Vokabeln konnten nicht beibehalten werden: ${keepCardsErr.message}`)
          setDeletingMaterialId(null)
          return
        }
      }
    }

    setMaterials((prev) => prev.filter((x) => x.id !== materialRow.id))
    setTotalBytes((prev) => Math.max(0, prev - (materialRow.size_bytes || 0)))
    setCompletedTutorMaterialIds((prev) => {
      const next = new Set(prev)
      next.delete(materialRow.id)
      return next
    })
    setMaterialIdsWithGeneratedCards((prev) => {
      const next = new Set(prev)
      next.delete(materialRow.id)
      return next
    })
    if (linkedCardsCount > 0) {
      setInfo(
        deleteLinkedCards
          ? `Datei entfernt inkl. ${linkedCardsCount} verknüpfter Vokabel${linkedCardsCount === 1 ? '' : 'n'}.`
          : `Datei entfernt. ${linkedCardsCount} Vokabel${linkedCardsCount === 1 ? '' : 'n'} wurden beibehalten.`,
      )
    } else {
      setInfo(`Datei entfernt: ${materialRow.filename}`)
    }
    setDeletingMaterialId(null)
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-studiio-lavender/60 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-studiio-ink">Materialien für dieses Fach</h5>
        <div className="flex flex-wrap items-center gap-2">
          {onStartPractice && (
            <button
              type="button"
              onClick={() => onStartPractice(null)}
              className="rounded-full border border-studiio-lavender/70 bg-white px-3 py-1.5 text-xs font-medium text-studiio-ink hover:bg-studiio-sky/20"
            >
              Vokabeln üben
            </button>
          )}
          {showUploadForm && (
            <p className="text-xs text-studiio-muted">
              Speicher: {usedMb} / {maxMb} MB
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowUploadForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full bg-studiio-accent text-white px-3 py-1.5 text-xs font-medium hover:bg-studiio-accentHover"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/15 text-sm leading-none">+</span>
            {showUploadForm ? 'Upload ausblenden' : 'Dateien hochladen'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {info && (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {info}
        </p>
      )}

      {showUploadForm && (
        <form
          onSubmit={handleUpload}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`space-y-3 rounded-xl border-2 border-dashed px-3 py-4 transition-colors ${
            isDragging ? 'border-studiio-accent bg-studiio-sky/40' : 'border-studiio-lavender/50 bg-white/70'
          }`}
        >
          <div>
            <label className="block text-xs font-medium text-studiio-ink mb-1">
              {isDragging ? 'Dateien hier ablegen …' : 'PDF-Dateien auswählen oder hierher ziehen (mehrere möglich)'}
            </label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={handleFileChange}
              className="block w-full text-xs text-studiio-muted file:mr-3 file:rounded-lg file:border-0 file:bg-studiio-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-studiio-accentHover"
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-studiio-muted">
                Weise jeder Datei eine Kategorie zu. Der Upload startet für alle Dateien gemeinsam.
              </p>
              <ul className="space-y-1 max-h-40 overflow-auto pr-1">
                {selectedFiles.map((entry, index) => (
                  <li
                    key={`${entry.file.name}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-studiio-sky/30 px-2 py-1"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-studiio-ink">
                        {entry.file.name}
                      </p>
                      <p className="text-[11px] text-studiio-muted">
                        {(entry.file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    <select
                      value={entry.category}
                      onChange={(e) => handleSelectedCategoryChange(index, e.target.value)}
                      className="studiio-input text-[11px] w-32"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  className="rounded-lg border border-studiio-lavender/70 px-3 py-1.5 text-[11px] font-medium text-studiio-muted hover:text-studiio-ink hover:bg-studiio-lavender/30"
                >
                  Auswahl zurücksetzen
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="studiio-btn-primary text-xs"
                >
                  {uploading ? 'Wird hochgeladen …' : 'Upload starten'}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      <div>
        {loading ? (
          <p className="text-xs text-studiio-muted">Dateien werden geladen …</p>
        ) : materials.length === 0 ? (
          <p className="text-xs text-studiio-muted">
            Noch keine Dateien für dieses Fach hochgeladen.
          </p>
        ) : (
          <div className="space-y-2">
            {groupedMaterials.map(([category, items]) => {
              const expanded = !!expandedCategories[category]
              const vocabReadyCount = items.filter((m) => materialIdsWithGeneratedCards.has(m.id)).length
              return (
              <div key={category}>
                <button
                  type="button"
                  onClick={() => setExpandedCategories((prev) => ({ ...prev, [category]: !expanded }))}
                  className={`mb-1 w-full flex items-center justify-between rounded-lg border px-3 py-1.5 text-left hover:brightness-[0.98] ${getCategoryHeaderClasses(category)}`}
                >
                  <div className="min-w-0">
                    <h6 className="text-sm font-semibold text-studiio-ink">
                      {category} <span className="font-normal">({items.length})</span>
                    </h6>
                    <p className="text-[11px] text-studiio-muted">
                      Vokabeln: {vocabReadyCount}/{items.length} Dateien
                    </p>
                  </div>
                  <span className="text-sm text-studiio-muted ml-2">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                <ul className="space-y-1">
                  {items.map((m) => (
                    (() => {
                      const tutorDone = completedTutorMaterialIds.has(m.id)
                      const cardsDone = materialIdsWithGeneratedCards.has(m.id)
                      const fullyDone = tutorDone && cardsDone
                      return (
                    <li
                      key={m.id}
                      className={`rounded-lg border px-2 py-1 ${
                        fullyDone
                          ? 'bg-green-50 border-green-200'
                          : 'bg-white/90 border-studiio-lavender/40'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-studiio-ink truncate">
                            {m.filename}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2">
                            <p className="text-[10px] text-studiio-muted">
                              {(m.size_bytes / (1024 * 1024)).toFixed(2)} MB
                            </p>
                            {fullyDone && (
                              <span
                                className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700"
                                title="Tutor abgeschlossen und Vokabeln erstellt"
                              >
                                Vollständig
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                        {onOpenFlashcardCreate && (
                          cardsDone ? (
                            <button
                              type="button"
                              onClick={() => onStartPractice?.({ id: m.id, filename: m.filename })}
                              className="inline-flex items-center justify-center rounded border border-studiio-lavender/60 px-2.5 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20"
                            >
                              Vokabeln üben
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenFlashcardCreate(m)}
                              className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20"
                            >
                              Vokabeln erstellen
                            </button>
                          )
                        )}
                        {['Vorlesung', 'Übung', 'Tutorium', 'Zusatzmaterialien'].includes(m.category) && onOpenLecture && (
                          tutorDone ? (
                            <span className="rounded border border-green-300 px-2.5 py-1 text-[11px] font-medium text-green-700">
                              Tutor abgeschlossen
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenTutor(m)}
                              className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-[11px] font-medium text-studiio-accent hover:bg-studiio-sky/20"
                            >
                              Im Tutor öffnen
                            </button>
                          )
                        )}
                        {showUploadForm && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMaterial(m)}
                            disabled={deletingMaterialId === m.id}
                            className="rounded border border-red-200 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingMaterialId === m.id ? 'Löscht …' : 'Löschen'}
                          </button>
                        )}
                      </div>
                    </li>
                      )
                    })()
                  ))}
                </ul>
                )}
              </div>
            )})}

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setVocabByDocumentExpanded((v) => !v)}
                className="mb-1 w-full flex items-center justify-between rounded-lg border border-[#c9d8f7] bg-[#e8eefc] px-3 py-1.5 text-left hover:brightness-[0.98]"
              >
                <div>
                  <h6 className="text-sm font-semibold text-studiio-ink">
                    Vokabeln nach Dokument
                  </h6>
                  <p className="text-[11px] text-studiio-muted">
                    Nur die Karten einer einzelnen Datei üben
                  </p>
                </div>
                <span className="text-sm text-studiio-muted ml-2">{vocabByDocumentExpanded ? '▾' : '▸'}</span>
              </button>
              {vocabByDocumentExpanded && (
                <ul className="mb-2 space-y-1">
                  {materials.map((m) => {
                    const count = vocabCountsByMaterial[m.id] || 0
                    return (
                      <li key={`vocab-doc-${m.id}`} className="rounded-lg border border-studiio-lavender/40 bg-white/90 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-xs font-medium text-studiio-ink">{m.filename}</p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-studiio-lavender/25 px-2 py-0.5 text-[11px] font-medium text-studiio-ink">
                              {count} Karte{count === 1 ? '' : 'n'}
                            </span>
                            <button
                              type="button"
                              disabled={!count}
                              onClick={() => onStartPractice?.({ id: m.id, filename: m.filename })}
                              className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Nur diese üben
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                  {manualVocabCount > 0 && (
                    <li className="rounded-lg border border-studiio-lavender/40 bg-white/90 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-studiio-ink">Manuell erstellte Karten</p>
                        <span className="rounded-full bg-studiio-lavender/25 px-2 py-0.5 text-[11px] font-medium text-studiio-ink">
                          {manualVocabCount} Karte{manualVocabCount === 1 ? '' : 'n'}
                        </span>
                      </div>
                    </li>
                  )}
                </ul>
              )}

              <button
                type="button"
                onClick={() => setQuickDraftExpanded((v) => !v)}
                className="w-full flex items-center justify-between rounded-lg border border-[#dbccff] bg-[#f3edff] px-3 py-1.5 text-left hover:brightness-[0.98]"
              >
                <div>
                  <h6 className="text-sm font-semibold text-studiio-ink">
                    Schnellkarteikarten <span className="font-normal">({quickDraftCards.length})</span>
                  </h6>
                  <p className="text-[11px] text-studiio-muted">Entwürfe aus dem Schnellfragenmodus</p>
                </div>
                <span className="text-sm text-studiio-muted ml-2">{quickDraftExpanded ? '▾' : '▸'}</span>
              </button>
              {quickDraftExpanded && (
                <ul className="mt-1 space-y-1">
                  {quickDraftCards.length === 0 ? (
                    <li className="rounded-lg border border-studiio-lavender/40 bg-white/85 px-3 py-2 text-xs text-studiio-muted">
                      Noch keine Schnellkarteikarten vorhanden.
                    </li>
                  ) : (
                    quickDraftCards.map((card) => (
                      <li key={card.id} className="rounded-lg border border-studiio-lavender/40 bg-white/90 px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-studiio-ink truncate">{card.question}</p>
                          <p className="text-[11px] text-studiio-muted">
                            {FORMAT_LABELS[card.format] || card.format} • {String(card.answer || '').trim() ? 'Antwort vorhanden' : 'Antwort offen'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingDraftCard(card)}
                          className="rounded border border-studiio-lavender/60 px-2.5 py-1 text-[11px] font-medium text-studiio-ink hover:bg-studiio-sky/20"
                        >
                          Bearbeiten
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
      {editingDraftCard && (
        <FlashcardEditModal
          user={user}
          card={editingDraftCard}
          onClose={() => setEditingDraftCard(null)}
          onSuccess={(updated) => {
            const currentId = editingDraftCard.id
            setEditingDraftCard(null)
            setQuickDraftCards((prev) => {
              const next = prev.map((c) => (c.id === currentId ? { ...c, ...updated } : c))
              return next.filter((c) => !!c.is_draft)
            })
          }}
          onDelete={(deletedCard) => {
            setQuickDraftCards((prev) => prev.filter((c) => c.id !== deletedCard.id))
            setEditingDraftCard(null)
          }}
        />
      )}
    </div>
  )
}

