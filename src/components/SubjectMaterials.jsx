import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

const MAX_STORAGE_PER_USER_BYTES = 20 * 1024 * 1024 // 20 MB

const CATEGORY_OPTIONS = [
  'Vorlesung',
  'Übung',
  'Tutorium',
  'Probeklausur',
  'Zusatzmaterialien',
]

export default function SubjectMaterials({ user, subject, onOpenLecture }) {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [selectedFiles, setSelectedFiles] = useState([]) // [{file, category}]
  const [uploading, setUploading] = useState(false)
  const [showUploadForm, setShowUploadForm] = useState(false)

  const [totalBytes, setTotalBytes] = useState(0)

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
        .order('created_at', { ascending: false })

      const { data: sizeRows, error: sizeErr } = await supabase
        .from('materials')
        .select('size_bytes')
        .eq('user_id', user.id)

      if (!isMounted) return

      if (err || sizeErr) {
        console.error('Fehler beim Laden der Materialien:', err || sizeErr)
        setError(
          `Dateien konnten nicht geladen werden: ${
            (err || sizeErr)?.message || 'Bitte prüfe die Tabelle \"materials\" und den Storage-Bucket in Supabase.'
          }`,
        )
        setLoading(false)
        return
      }

      setMaterials(data || [])
      const sumBytes = (sizeRows || []).reduce((sum, row) => sum + (row.size_bytes || 0), 0)
      setTotalBytes(sumBytes)
      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [user.id, subject.id])

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

  function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) {
      setSelectedFiles([])
      return
    }

    const invalid = files.find(
      (f) => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'),
    )
    if (invalid) {
      setError('Es sind aktuell nur PDF-Dateien erlaubt.')
      setSelectedFiles([])
      return
    }

    setError('')
    setInfo('')
    setSelectedFiles(
      files.map((f) => ({
        file: f,
        category: CATEGORY_OPTIONS[0],
      })),
    )
  }

  function handleSelectedCategoryChange(index, value) {
    setSelectedFiles((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, category: value } : entry)),
    )
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

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-studiio-lavender/50 bg-studiio-sky/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-studiio-ink">Dateien für dieses Fach</h5>
        <p className="text-xs text-studiio-muted">
          Speicher: {usedMb} / {maxMb} MB
        </p>
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

      <button
        type="button"
        onClick={() => setShowUploadForm((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-studiio-accent text-white px-3 py-1.5 text-xs font-medium hover:bg-studiio-accentHover"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/15 text-sm leading-none">
          +
        </span>
        {showUploadForm ? 'Upload ausblenden' : 'Dateien hochladen'}
      </button>

      {showUploadForm && (
        <form onSubmit={handleUpload} className="space-y-3 rounded-xl bg-white/70 px-3 py-3">
          <div>
            <label className="block text-xs font-medium text-studiio-ink mb-1">
              PDF-Dateien auswählen (mehrere möglich)
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

      <div className="border-t border-studiio-lavender/40 pt-2 mt-1">
        {loading ? (
          <p className="text-xs text-studiio-muted">Dateien werden geladen …</p>
        ) : materials.length === 0 ? (
          <p className="text-xs text-studiio-muted">
            Noch keine Dateien für dieses Fach hochgeladen.
          </p>
        ) : (
          <div className="space-y-2">
            {groupedMaterials.map(([category, items]) => (
              <div key={category}>
                <h6 className="text-[11px] font-semibold text-studiio-muted mb-1">{category}</h6>
                <ul className="space-y-1">
                  {items.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-studiio-ink truncate">
                          {m.filename}
                        </p>
                        <p className="text-[11px] text-studiio-muted">
                          {(m.size_bytes / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      {m.category === 'Vorlesung' && onOpenLecture && (
                        <button
                          type="button"
                          onClick={() => onOpenLecture(m)}
                          className="text-[11px] font-medium text-studiio-accent hover:underline"
                        >
                          Im Tutor öffnen
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

