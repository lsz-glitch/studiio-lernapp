import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { formatLearningTime, getTodayLearningTimeDb, getTodayLearningTimeBySubjectDb } from '../utils/learningTime'
import { getStreak } from '../utils/streak'
const PERIOD_OPTIONS = [7, 14, 30]

function StatCard({ label, value, helper = '', tone = 'bg-white', badge = '' }) {
  return (
    <div className={`rounded-2xl border border-studiio-lavender/40 ${tone} px-4 py-4 shadow-[0_2px_10px_rgba(80,86,130,0.06)]`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-studiio-muted">{label}</p>
        {badge && (
          <span className="rounded-full border border-white/70 bg-white/60 px-2 py-0.5 text-[10px] font-semibold text-studiio-ink">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-semibold leading-none text-studiio-ink">{value}</p>
      {helper && <p className="mt-2 text-xs text-studiio-muted">{helper}</p>}
    </div>
  )
}

function TrendBadge({ value }) {
  if (!Number.isFinite(value)) return null
  if (value > 0) return <span className="text-[11px] font-semibold text-emerald-700">↑ {value}%</span>
  if (value < 0) return <span className="text-[11px] font-semibold text-rose-700">↓ {Math.abs(value)}%</span>
  return <span className="text-[11px] font-semibold text-studiio-muted">= 0%</span>
}

function toLocalDayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getLastNDays(n) {
  const days = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    days.push({
      key: toLocalDayKey(d),
      label: d.toLocaleDateString('de-DE', { weekday: 'short' }),
      shortDate: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
    })
  }
  return days
}

function LineChartCard({ title, subtitle, rows, valueFormatter, stroke = '#66bfa8', fill = 'rgba(102,191,168,0.12)' }) {
  const width = 640
  const height = 220
  const padX = 22
  const padTop = 16
  const padBottom = 44
  const chartW = width - padX * 2
  const chartH = height - padTop - padBottom
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)))
  const min = 0
  const points = rows.map((row, i) => {
    const x = padX + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * chartW)
    const y = padTop + chartH - ((Number(row.value || 0) - min) / (max - min || 1)) * chartH
    return { x, y, row }
  })
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`
      : ''

  return (
    <div className="rounded-xl border border-studiio-lavender/40 bg-white px-4 py-3">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-studiio-ink">{title}</h3>
        <p className="text-xs text-studiio-muted">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-studiio-lavender/30 bg-[#fcfdff] p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44">
          <line x1={padX} y1={padTop + chartH} x2={width - padX} y2={padTop + chartH} stroke="#d8dbe8" strokeWidth="1.5" />
          <line x1={padX} y1={padTop} x2={padX} y2={padTop + chartH} stroke="#e6e8f0" strokeWidth="1" />
          {areaPath && <path d={areaPath} fill={fill} />}
          {linePath && <path d={linePath} fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
          {points.map((p, idx) => {
            const dense = rows.length > 14
            const showTick = !dense || idx % 3 === 0 || idx === rows.length - 1
            return (
            <g key={p.row.key}>
              <circle cx={p.x} cy={p.y} r="4.5" fill={stroke} />
              {showTick && (
                <>
                  <text x={p.x} y={padTop + chartH + 16} textAnchor="middle" fontSize="10" fill="#6f7282">
                    {p.row.label}
                  </text>
                  <text x={p.x} y={padTop + chartH + 28} textAnchor="middle" fontSize="10" fill="#9aa0b5">
                    {p.row.shortDate}
                  </text>
                </>
              )}
            </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-studiio-muted">
        {rows.map((row) => (
          <span key={row.key} className="rounded bg-studiio-lavender/20 px-2 py-1">
            {row.label}: <span className="font-medium text-studiio-ink">{valueFormatter(row.value)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function StatisticsPage({ user }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [subjects, setSubjects] = useState([])
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [periodDays, setPeriodDays] = useState(7)
  const [stats, setStats] = useState({
    todayLearnedSeconds: 0,
    streakDays: 0,
    subjectsCount: 0,
    materialsCount: 0,
    flashcardsCount: 0,
    completedTutorRuns: 0,
    completedTasksToday: 0,
  })
  const [dailyLearningRows, setDailyLearningRows] = useState([])
  const [dailyVocabRows, setDailyVocabRows] = useState([])
  const [learningTrendPct, setLearningTrendPct] = useState(0)
  const [vocabTrendPct, setVocabTrendPct] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    let mounted = true

    async function loadStats() {
      setLoading(true)
      setError('')
      try {
        const subjectId = subjectFilter === 'all' ? null : subjectFilter
        const todayLearnedSeconds = subjectId
          ? await getTodayLearningTimeBySubjectDb(user.id, subjectId)
          : await getTodayLearningTimeDb(user.id)
        const streak = await getStreak(user.id)

        const startLocal = new Date()
        startLocal.setHours(0, 0, 0, 0)
        const endLocal = new Date(startLocal)
        endLocal.setDate(endLocal.getDate() + 1)
        const days = getLastNDays(periodDays)
        const prevDays = getLastNDays(periodDays * 2).slice(0, periodDays)
        const firstDayStart = new Date(days[0].key + 'T00:00:00')
        const endOfToday = new Date(days[days.length - 1].key + 'T23:59:59')
        const firstPrevDayStart = new Date(prevDays[0].key + 'T00:00:00')

        const [
          subjectsRes,
          materialsRes,
          flashcardsRes,
          tutorCompletedRes,
          tasksTodayRes,
          dailyLearningRes,
          dailyLearningPrevRes,
          vocabReviewsRes,
        ] = await Promise.all([
          supabase
            .from('subjects')
            .select('id, name')
            .eq('user_id', user.id),
          supabase
            .from('materials')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq(subjectId ? 'subject_id' : 'user_id', subjectId || user.id)
            .is('deleted_at', null),
          supabase
            .from('flashcards')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq(subjectId ? 'subject_id' : 'user_id', subjectId || user.id)
            .eq('is_draft', false),
          supabase
            .from('tutor_progress')
            .select('material_id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq(subjectId ? 'subject_id' : 'user_id', subjectId || user.id)
            .eq('is_completed', true),
          supabase
            .from('learning_plan_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq(subjectId ? 'subject_id' : 'user_id', subjectId || user.id)
            .gte('completed_at', startLocal.toISOString())
            .lt('completed_at', endLocal.toISOString()),
          supabase
            .from(subjectId ? 'user_daily_subject_learning_seconds' : 'user_daily_learning_seconds')
            .select('day, total_seconds')
            .eq('user_id', user.id)
            .eq(subjectId ? 'subject_id' : 'user_id', subjectId || user.id)
            .gte('day', days[0].key)
            .lte('day', days[days.length - 1].key),
          supabase
            .from(subjectId ? 'user_daily_subject_learning_seconds' : 'user_daily_learning_seconds')
            .select('day, total_seconds')
            .eq('user_id', user.id)
            .eq(subjectId ? 'subject_id' : 'user_id', subjectId || user.id)
            .gte('day', prevDays[0].key)
            .lte('day', prevDays[prevDays.length - 1].key),
          supabase
            .from('flashcard_reviews')
            .select('created_at, flashcard_id')
            .eq('user_id', user.id)
            .gte('created_at', firstPrevDayStart.toISOString())
            .lte('created_at', endOfToday.toISOString()),
        ])

        if (!mounted) return

        const anyError =
          subjectsRes.error ||
          materialsRes.error ||
          flashcardsRes.error ||
          tutorCompletedRes.error ||
          tasksTodayRes.error ||
          dailyLearningRes.error ||
          dailyLearningPrevRes.error ||
          vocabReviewsRes.error
        if (anyError) {
          throw anyError
        }
        setSubjects(subjectsRes.data || [])

        let subjectFlashcardIds = null
        if (subjectId) {
          const { data: idsData } = await supabase
            .from('flashcards')
            .select('id')
            .eq('user_id', user.id)
            .eq('subject_id', subjectId)
          subjectFlashcardIds = new Set((idsData || []).map((x) => x.id))
        }

        setStats({
          todayLearnedSeconds,
          streakDays: streak?.current_streak_days || 0,
          subjectsCount: subjectId ? 1 : (subjectsRes.data || []).length,
          materialsCount: materialsRes.count || 0,
          flashcardsCount: flashcardsRes.count || 0,
          completedTutorRuns: tutorCompletedRes.count || 0,
          completedTasksToday: tasksTodayRes.count || 0,
        })

        const learningMap = new Map(
          (dailyLearningRes?.data || []).map((row) => [String(row.day), Number(row.total_seconds || 0)]),
        )
        const vocabMap = new Map()
        const vocabMapPrev = new Map()
        for (const row of vocabReviewsRes?.data || []) {
          if (subjectFlashcardIds && !subjectFlashcardIds.has(row.flashcard_id)) continue
          const key = toLocalDayKey(row.created_at)
          vocabMap.set(key, (vocabMap.get(key) || 0) + 1)
          vocabMapPrev.set(key, (vocabMapPrev.get(key) || 0) + 1)
        }
        const thisWeekLearning = days.map((d) => ({
          ...d,
          value: learningMap.get(d.key) || 0,
        }))
        const thisWeekVocab = days.map((d) => ({
          ...d,
          value: vocabMap.get(d.key) || 0,
        }))
        setDailyLearningRows(thisWeekLearning)
        setDailyVocabRows(thisWeekVocab)

        const prevLearningMap = new Map(
          (dailyLearningPrevRes?.data || []).map((row) => [String(row.day), Number(row.total_seconds || 0)]),
        )
        const prevLearningTotal = prevDays.reduce((sum, d) => sum + (prevLearningMap.get(d.key) || 0), 0)
        const thisLearningTotal = thisWeekLearning.reduce((sum, d) => sum + d.value, 0)
        const learningTrend =
          prevLearningTotal <= 0
            ? (thisLearningTotal > 0 ? 100 : 0)
            : Math.round(((thisLearningTotal - prevLearningTotal) / prevLearningTotal) * 100)
        setLearningTrendPct(learningTrend)

        const prevVocabTotal = prevDays.reduce((sum, d) => sum + (vocabMapPrev.get(d.key) || 0), 0)
        const thisVocabTotal = thisWeekVocab.reduce((sum, d) => sum + d.value, 0)
        const vocabTrend =
          prevVocabTotal <= 0
            ? (thisVocabTotal > 0 ? 100 : 0)
            : Math.round(((thisVocabTotal - prevVocabTotal) / prevVocabTotal) * 100)
        setVocabTrendPct(vocabTrend)
      } catch (e) {
        console.error('Statistiken laden fehlgeschlagen:', e)
        if (mounted) setError('Statistiken konnten gerade nicht geladen werden.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadStats()
    const interval = window.setInterval(loadStats, 30000)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [user?.id, subjectFilter, periodDays])

  if (loading) return <p className="text-sm text-studiio-muted">Statistiken werden geladen …</p>

  return (
    <section className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="rounded-xl border border-studiio-lavender/40 bg-white px-3 py-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-studiio-muted mb-1">Ansicht</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="studiio-input w-full md:max-w-sm"
          >
            <option value="all">Gesamt</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <div className="inline-flex rounded-full border border-studiio-lavender/60 bg-studiio-lavender/15 p-1">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodDays(p)}
                className={periodDays === p
                  ? 'rounded-full bg-white px-3 py-1 text-xs font-semibold text-studiio-ink'
                  : 'rounded-full px-3 py-1 text-xs text-studiio-muted hover:bg-white/60'}
              >
                {p} Tage
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Heute gelernt"
          value={formatLearningTime(stats.todayLearnedSeconds)}
          helper="Lernzeit aus Tutor + Vokabeln"
          tone="bg-[#ecfbf6]"
          badge="Heute"
        />
        <StatCard
          label="Streak"
          value={`${stats.streakDays} ${stats.streakDays === 1 ? 'Tag' : 'Tage'}`}
          helper="Aufeinanderfolgende Lerntage"
          tone="bg-[#f8f2ff]"
          badge="Serie"
        />
        <StatCard label="Fächer" value={String(stats.subjectsCount)} helper="Aktive Lernfächer" tone="bg-[#fefcf7]" />
        <StatCard label="Materialien" value={String(stats.materialsCount)} helper="Nicht gelöschte Dateien" tone="bg-[#f4fbff]" />
        <StatCard label="Vokabeln" value={String(stats.flashcardsCount)} helper="Ohne Entwürfe" tone="bg-[#f7f6ff]" />
        <StatCard label="Tutor abgeschlossen" value={String(stats.completedTutorRuns)} helper="Fertig durchgearbeitete Läufe" tone="bg-[#effaf8]" />
        <StatCard label="Heute erledigte Aufgaben" value={String(stats.completedTasksToday)} helper="Im Lernplan abgehakt" tone="bg-[#fff8ef]" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <LineChartCard
          title="Lernzeit pro Tag"
          subtitle={`Letzte ${periodDays} Tage`}
          rows={dailyLearningRows}
          valueFormatter={(v) => formatLearningTime(v)}
          stroke="#66bfa8"
          fill="rgba(102,191,168,0.14)"
        />
        <LineChartCard
          title="Vokabeln geübt pro Tag"
          subtitle={`Letzte ${periodDays} Tage`}
          rows={dailyVocabRows}
          valueFormatter={(v) => `${v}`}
          stroke="#8d7bd8"
          fill="rgba(141,123,216,0.15)"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-studiio-lavender/40 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-studiio-muted flex items-center gap-1">
            Trend Lernzeit
            <span title={`Vergleich: letzte ${periodDays} Tage vs. die ${periodDays} Tage davor`} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-studiio-lavender/70 text-[10px] text-studiio-muted">i</span>
          </p>
          <div className="mt-2"><TrendBadge value={learningTrendPct} /></div>
        </div>
        <div className="rounded-xl border border-studiio-lavender/40 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-studiio-muted flex items-center gap-1">
            Trend Vokabeln
            <span title={`Vergleich: letzte ${periodDays} Tage vs. die ${periodDays} Tage davor`} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-studiio-lavender/70 text-[10px] text-studiio-muted">i</span>
          </p>
          <div className="mt-2"><TrendBadge value={vocabTrendPct} /></div>
        </div>
      </div>
    </section>
  )
}
