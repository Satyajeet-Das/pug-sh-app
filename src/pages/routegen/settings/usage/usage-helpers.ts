import type { UsageDay } from '@/api/genproto/dashboard/usage/v1/usage_pb'
import { getIndexedColor } from '@/lib/event-colors'
import { tsToDate, validDate } from '@/lib/timestamp'
import type { ChartPoint } from '../../insights/charts/types'

export const DAY_MS = 24 * 60 * 60 * 1000

// Usage is UTC end to end; date-presets.ts anchors on local midnight and would shift every cell a day.
const floorUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

// Half-open [from, to), matching the server. `to` is the midnight after today, so today is in.
export const lastNUtcDays = (days: RangeDays) => {
  const end = floorUtcDay(new Date()).getTime() + DAY_MS
  return { from: new Date(end - days * DAY_MS), to: new Date(end) }
}

// Must stay under the request's 400-day cap and the meter's 390-day retention (backend cron/usage).
export const RANGE_OPTIONS = [
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last 6 months', value: 180 },
  { label: 'Last 12 months', value: 365 },
] as const

// Not `number`: the server accepts any span under 400 days, and the chip shows an off-list one as a bare number.
type RangeDays = (typeof RANGE_OPTIONS)[number]['value']

// Derived from the list so the default can never fall out of it.
export const DEFAULT_RANGE_DAYS = RANGE_OPTIONS[0].value

export const CURRENT_PERIOD = 'period' as const

export type UsageRange = RangeDays | typeof CURRENT_PERIOD

type OrgPeriod = { from: Date; to: Date; label: string }

export const rangeOptions = (periodLabel: string | undefined) =>
  periodLabel ? [{ label: periodLabel, value: CURRENT_PERIOD }, ...RANGE_OPTIONS] : RANGE_OPTIONS

// Whole UTC days [day(start), day(end)), or null when that is empty or past the request's 400-day cap.
export const orgPeriod = (startMs: number | undefined, endMs: number | undefined, billing: boolean) => {
  if (startMs === undefined || endMs === undefined) return null
  const from = floorUtcDay(new Date(startMs))
  const to = floorUtcDay(new Date(endMs))
  const span = to.getTime() - from.getTime()
  if (!(span > 0 && span <= 400 * DAY_MS)) return null
  return { from, to, label: billing ? 'Current billing period' : 'Current period' }
}

export const resolveUsageWindow = (picked: UsageRange, period: OrgPeriod | null) => {
  if (picked !== CURRENT_PERIOD) return { key: picked, range: lastNUtcDays(picked) }
  if (period) return { key: picked, range: { from: period.from, to: period.to }, periodLabel: period.label }
  return { key: DEFAULT_RANGE_DAYS, range: lastNUtcDays(DEFAULT_RANGE_DAYS) }
}

// The backend's MaxDailyRows; a response this long may have lost its newest days.
export const DAILY_ROW_CAP = 10_000

const utcFormat = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' })

const DAY_FMT = utcFormat({ month: 'short', day: 'numeric', year: 'numeric' })
const DAY_NO_YEAR_FMT = utcFormat({ month: 'short', day: 'numeric' })
const STAMP_FMT = utcFormat({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export const formatUtcStamp = (d: Date) => `${STAMP_FMT.format(d)} UTC`

// `end` is exclusive, so the label stops the day before it.
export const formatPeriod = (start: Date, end: Date) => {
  const last = new Date(end.getTime() - DAY_MS)
  const startFmt = start.getUTCFullYear() === last.getUTCFullYear() ? DAY_NO_YEAR_FMT : DAY_FMT
  return `${startFmt.format(start)} – ${DAY_FMT.format(last)}`
}

const MAX_CHART_SERIES = 6
export const OTHERS_LABEL = 'Other projects'

export type ProjectTotal = {
  projectId: string
  name: string
  total: number
  // Index into `names` and its colors, null once folded. On the row so a sorted table keeps its dots right.
  seriesIndex: number | null
}

const utcDayKey = (d: Date) => d.toISOString().slice(0, 10)

// Days past the meter's last pass have no rows and draw as zero, which reads as a usage collapse. Counts the
// window's days from then through today: a period's later days haven't happened yet.
export const unmeteredTailDays = (range: { from: Date; to: Date }, meteredAt: Date | null, now = new Date()) => {
  if (!meteredAt) return 0
  const from = Math.max(floorUtcDay(meteredAt).getTime() + DAY_MS, range.from.getTime())
  const to = Math.min(range.to.getTime(), floorUtcDay(now).getTime() + DAY_MS)
  if (to <= from) return 0
  return Math.ceil((to - from) / DAY_MS)
}

// Why a cell was refused. `outOfWindow` is the only one that isn't a defect in the cell itself.
type RejectReason = 'unreadableDay' | 'outOfWindow' | 'noProject' | 'badCount' | 'duplicate'

export type RejectedCell = { reason: RejectReason; projectId: string; day: unknown }

// "3 unreadable cells" is not something anyone can act on. A few examples are.
const REJECTED_SAMPLE_MAX = 3

// One point per UTC day, gaps included: the vendored chart sizes bars by row count (the shell's columnWidth)
// but places them by timestamp, so a sparse series overdraws. Re-check after a re-vendor.
export const buildUsageSeries = (
  daily: UsageDay[],
  range: { from: Date; to: Date },
  projectName: (id: string) => string,
  // Later days draw empty rather than zero: they are still to come, or the meter hasn't reached them.
  meteredThrough = new Date(),
) => {
  const totals = new Map<string, number>()
  const byDay = new Map<string, Map<string, number>>()
  const fromMs = floorUtcDay(range.from).getTime()
  const toMs = range.to.getTime()
  const lastMeteredMs = floorUtcDay(meteredThrough).getTime()
  let malformed = 0
  let outOfWindow = 0
  const rejected: RejectedCell[] = []

  // Counted, never dropped: a bad cell would otherwise understate the total, or zero it.
  const reject = (reason: RejectReason, cell: UsageDay) => {
    if (reason === 'outOfWindow') outOfWindow++
    else malformed++
    if (rejected.length < REJECTED_SAMPLE_MAX) {
      rejected.push({ reason, projectId: cell.projectId, day: cell.day })
    }
  }

  for (const cell of daily) {
    // An Invalid Date is truthy and compares false against everything, so it would pass a bare
    // `!day`, slip through the range test below, and only blow up later in utcDayKey's toISOString.
    const day = validDate(tsToDate(cell.day))
    if (!day) {
      reject('unreadableDay', cell)
      continue
    }
    const dayMs = floorUtcDay(day).getTime()
    if (dayMs < fromMs || dayMs >= toMs) {
      reject('outOfWindow', cell)
      continue
    }

    // An omitted string arrives as '', which would bucket every unattributed cell under one blank project.
    if (!cell.projectId) {
      reject('noProject', cell)
      continue
    }

    // A negative count would subtract from the total and give the share column a negative percentage.
    const count = Number(cell.eventCount)
    if (!Number.isFinite(count) || count < 0) {
      reject('badCount', cell)
      continue
    }

    const key = utcDayKey(day)
    let row = byDay.get(key)
    if (!row) {
      row = new Map()
      byDay.set(key, row)
    }
    // A repeated (project, day) is out of contract, and summing it is the one path here that could overstate.
    if (row.has(cell.projectId)) {
      reject('duplicate', cell)
      continue
    }
    row.set(cell.projectId, count)
    totals.set(cell.projectId, (totals.get(cell.projectId) ?? 0) + count)
  }

  // Id breaks ties, not name: names change as projects load, and this order assigns the colors.
  const ranked = [...totals.entries()]
    .map(([projectId, total]) => ({ projectId, name: projectName(projectId), total }))
    .sort((a, b) => b.total - a.total || a.projectId.localeCompare(b.projectId))

  const projectTotals: ProjectTotal[] = ranked.map((p, i) => ({
    ...p,
    seriesIndex: i < MAX_CHART_SERIES ? i : null,
  }))

  const charted = projectTotals.slice(0, MAX_CHART_SERIES)
  const folded = projectTotals.slice(MAX_CHART_SERIES)
  const names = charted.map(p => p.name)
  if (folded.length > 0) names.push(OTHERS_LABEL)

  const points: ChartPoint[] = []
  for (let t = fromMs; t < toMs; t += DAY_MS) {
    const row = byDay.get(utcDayKey(new Date(t)))
    const values = charted.map(p => row?.get(p.projectId) ?? 0)
    if (folded.length > 0) values.push(folded.reduce((sum, p) => sum + (row?.get(p.projectId) ?? 0), 0))
    points.push({ date: new Date(t), values, pending: t > lastMeteredMs })
  }

  return {
    names,
    points,
    projectTotals,
    malformed,
    outOfWindow,
    rejected,
    windowTotal: projectTotals.reduce((sum, p) => sum + p.total, 0),
  }
}

// Colored by index, as a breakdown. ProjectTotal.seriesIndex indexes into this array.
export const usageSeriesColors = (names: string[]) => names.map((_, i) => getIndexedColor(i))
