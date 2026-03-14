import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const MAX_STORAGE_PER_USER_BYTES = 20 * 1024 * 1024 // 20 MB

const CATEGORY_OPTIONS = [
  'Vorlesung',
  'Übung',
  'Tutorium',
  'Probeklausur',
  'Zusatzmaterialien',
]

export default function SubjectMaterials({ user, subject }) {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [file, setFile] = useState(null)
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0])
  const [uploading, setUploading] = useState(false)

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

  async function handleUpload(e) {
    e.preventDefault()
    setError('')
    setInfo('')

    if (!file) {
      setError('Bitte wähle eine PDF-Datei aus.')
      return
    }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Es sind aktuell nur PDF-Dateien erlaubt.')
      return
    }

    const newTotal = totalBytes + file.size
    if (newTotal > MAX_STORAGE_PER_USER_BYTES) {
      setError(`Upload überschreitet das Speicherlimit von ${maxMb} MB pro Nutzer.`)
      return
    }

    setUploading(true)

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

    setUploading(false)

    if (dbError) {
      console.error('Fehler beim Speichern der Material-Metadaten:', dbError)
      setError(`Metadaten konnten nicht gespeichert werden: ${dbError.message || 'Bitte später erneut versuchen.'}`)
      return
    }

    setMaterials((prev) => [row, ...prev])
    setTotalBytes((prev) => prev + file.size)
    setFile(null)
    setCategory(CATEGORY_OPTIONS[0])
    setInfo('Datei wurde erfolgreich hochgeladen.')
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

      <form onSubmit={handleUpload} className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="block text-xs font-medium text-studiio-ink mb-1">
            PDF-Datei
          </label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-xs text-studiio-muted file:mr-3 file:rounded-lg file:border-0 file:bg-studiio-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-studiio-accentHover"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-studiio-ink mb-1">
            Kategorie
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="studiio-input w-full text-xs"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="studiio-btn-primary text-xs mt-1 md:mt-0"
        >
          {uploading ? 'Wird hochgeladen …' : 'PDF hochladen'}
        </button>
      </form>

      <div className="border-t border-studiio-lavender/40 pt-2 mt-1">
        {loading ? (
          <p className="text-xs text-studiio-muted">Dateien werden geladen …</p>
        ) : materials.length === 0 ? (
          <p className="text-xs text-studiio-muted">
            Noch keine Dateien für dieses Fach hochgeladen.
          </p>
        ) : (
          <ul className="space-y-1">
            {materials.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-studiio-ink truncate">{m.filename}</p>
                  <p className="text-[11px] text-studiio-muted">
                    {m.category} · {(m.size_bytes / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

