import { useAtomValue } from 'jotai'
import { CalendarRange, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackFeature } from '@/analytics/pug'
import type { GetUsageResponse } from '@/api/genproto/dashboard/usage/v1/usage_pb'
import { Granularity } from '@/api/genproto/shared/insights/v1/insights_pb'
import { usageRPCAtom } from '@/api/rpc'
import LoadingSpinner from '@/components/loading-spinner'
import { OptionChip } from '@/components/option-chip'
import SectionHeader from '@/components/section-header'
import { Button } from '@/components/ui/button'
import { themeRevisionAtom } from '@/data/theme.atoms'
import { activeOrgAtom, projectsAtom, projectsLoadedAtom } from '@/data/workspace.atoms'
import { useBilling } from '@/hooks/use-billing'
import { formatEvents, hasLiveSubscription } from '@/lib/billing'
import { rpcErrorMessage, toastRPCError } from '@/lib/rpc-error'
import { toProtoTimeRange, tsToDate, validDate } from '@/lib/timestamp'
import { BarChart } from '../../insights/charts'
import ProjectBreakdown from './project-breakdown'
import {
  buildUsageSeries,
  CURRENT_PERIOD,
  DAILY_ROW_CAP,
  formatPeriod,
  formatUtcStamp,
  orgPeriod,
  rangeOptions,
  resolveUsageWindow,
  type UsageRange,
  unmeteredTailDays,
  usageSeriesColors,
} from './usage-helpers'

// Carried with the response: derived from the picker, a pending pick would re-window and relabel it.
type Loaded = ReturnType<typeof resolveUsageWindow> & { usage: GetUsageResponse }

const NO_RANGE = { from: new Date(0), to: new Date(0) }
const LOAD_FAILED = 'Failed to load usage'

// Connect applies no deadline of its own, so a stalled socket would leave the page on a spinner.
const LOAD_TIMEOUT_MS = 20_000

const BILLING_WAIT_MS = 3_000

const EMPTY_STATE_CLASS = 'flex flex-col items-center justify-center py-16 text-muted-foreground'

// Only `metered` shows a number or any rows: a sum of no rows reads as a measured zero.
type WindowState =
  | { kind: 'never' }
  | { kind: 'pending'; meteredAt: Date }
  | { kind: 'unreadable'; meteredAt: Date }
  | { kind: 'metered'; meteredAt: Date }

const windowState = ({ usage, range }: Loaded, readable: boolean): WindowState => {
  const meteredAt = validDate(tsToDate(usage.usageComputedAt))
  if (!meteredAt) return { kind: 'never' }
  // `counted` speaks only for the usage period; any other window is judged by the meter's last pass.
  const usagePeriod = validDate(tsToDate(usage.periodStart))?.getTime() === range.from.getTime()
  if ((usagePeriod && !usage.counted) || meteredAt.getTime() < range.from.getTime()) {
    return { kind: 'pending', meteredAt }
  }
  if (!readable) return { kind: 'unreadable', meteredAt }
  return { kind: 'metered', meteredAt }
}

const WindowTotal = ({ state, total }: { state: WindowState; total: number }) => {
  if (state.kind === 'metered') return <span className="text-4xl tabular-nums">{formatEvents(total)}</span>
  if (state.kind === 'pending') return <span className="text-4xl text-muted-foreground">Not counted yet</span>
  return <span className="text-4xl text-muted-foreground">Unknown</span>
}

const WindowNote = ({ state }: { state: WindowState }) => {
  if (state.kind === 'never') {
    return <>Usage has never been metered for this organization, so there is no count to show, not a zero.</>
  }
  if (state.kind === 'pending') {
    return (
      <>
        The meter has not reached this window yet, so there is no total for it, not a zero. Last metered{' '}
        {formatUtcStamp(state.meteredAt)}.
      </>
    )
  }
  return <>Last metered {formatUtcStamp(state.meteredAt)}</>
}

const EmptyWindow = ({ unusable, metered }: { unusable: number; metered: boolean }) => {
  if (unusable > 0) {
    return (
      <div className={EMPTY_STATE_CLASS}>
        <p className="text-sm font-medium mb-1">Usage could not be read for this window</p>
        <p className="text-xs">
          {unusable === 1 ? '1 row was' : `${unusable} rows were`} unusable, so there is no total to show, not a zero.
        </p>
      </div>
    )
  }
  return (
    <div className={EMPTY_STATE_CLASS}>
      <p className="text-sm font-medium mb-1">No metered events in this window</p>
      {metered && <p className="text-xs">A day with no events is stored as no row at all.</p>}
    </div>
  )
}

const RejectedRows = ({ malformed, outOfWindow }: { malformed: number; outOfWindow: number }) => (
  <>
    {malformed > 0 && (
      <p className="mt-2 text-xs text-caution">
        {malformed === 1 ? '1 usage row' : `${malformed} usage rows`} could not be read and{' '}
        {malformed === 1 ? 'is' : 'are'} missing from these totals.
      </p>
    )}
    {outOfWindow > 0 && (
      <p className="mt-2 text-xs text-caution">
        {outOfWindow === 1 ? '1 usage row' : `${outOfWindow} usage rows`} fell outside the requested window and{' '}
        {outOfWindow === 1 ? 'is' : 'are'} missing from these totals.
      </p>
    )}
  </>
)

const Usage = () => {
  const org = useAtomValue(activeOrgAtom)
  const projects = useAtomValue(projectsAtom)
  const projectsLoaded = useAtomValue(projectsLoadedAtom)
  const usageRPC = useAtomValue(usageRPCAtom)
  const themeRevision = useAtomValue(themeRevisionAtom)
  const billing = useBilling()

  // A subscriber never gets the usage period: their allowance and bill both run on the billing period.
  const status = billing.status
  const subscribed = !!status && hasLiveSubscription(status)
  const periodStartMs = validDate(tsToDate(subscribed ? status?.currentPeriodStart : status?.periodStart))?.getTime()
  const periodEndMs = validDate(tsToDate(subscribed ? status?.currentPeriodEnd : status?.periodEnd))?.getTime()
  // Memoized on the instants: billing refetches on every focus, and a new object would refetch usage.
  const period = useMemo(
    () => orgPeriod(periodStartMs, periodEndMs, subscribed),
    [periodStartMs, periodEndMs, subscribed],
  )
  // Per render, since the memo never sees the clock.
  const currentPeriod = period && period.to.getTime() > Date.now() ? period : null

  const [picked, setPicked] = useState<UsageRange>(CURRENT_PERIOD)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  // Range changes, Refresh and Retry race each other; only the latest request may paint.
  const latestRequestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++latestRequestRef.current
    if (!org?.id) {
      setError('No organization selected')
      // The bump above keeps an in-flight response from painting over this, and orphans its `finally`.
      setFetching(false)
      return
    }
    // Per call, or a tab left open overnight refreshes into yesterday's window.
    const requested = resolveUsageWindow(picked, currentPeriod)
    const protoRange = toProtoTimeRange(requested.range)
    setFetching(true)

    // Only the call is guarded, so a bug in the state updates reaches the error boundary, not a retry.
    let resp: GetUsageResponse
    try {
      resp = await usageRPC.getUsage({ orgId: org.id, range: protoRange }, { timeoutMs: LOAD_TIMEOUT_MS })
    } catch (err) {
      if (requestId !== latestRequestRef.current) return
      // Keeps `loaded`, so a flaky refresh leaves the data on screen.
      setError(rpcErrorMessage(err, LOAD_FAILED))
      toastRPCError(err, LOAD_FAILED)
      return
    } finally {
      if (requestId === latestRequestRef.current) setFetching(false)
    }

    if (requestId !== latestRequestRef.current) return
    setLoaded({ ...requested, usage: resp })
    setError(null)
  }, [usageRPC, org, picked, currentPeriod])

  // Waits for billing so a cold load doesn't draw 30 days and then swap to the period, but never past BILLING_WAIT_MS.
  const [billingWaitOver, setBillingWaitOver] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setBillingWaitOver(true), BILLING_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])
  const billingSettled = billing.loaded || !org || billingWaitOver
  useEffect(() => {
    if (billingSettled) load()
  }, [load, billingSettled])

  // Tracked here, not in load(), which also runs on mount and on range changes.
  const refresh = () => {
    trackFeature({ featureId: 'usage.refresh', featureName: 'Refresh usage' })
    load()
  }

  // Until projects load, a missing name is not yet a deleted project.
  const projectName = useCallback(
    (id: string) => {
      const known = projects.find(p => p.id === id)?.displayName
      if (known) return known
      if (!projectsLoaded) return `Project ${id.slice(0, 8)}…`
      return `Unknown project (${id.slice(0, 8)}…)`
    },
    [projects, projectsLoaded],
  )

  const series = useMemo(
    () =>
      buildUsageSeries(
        loaded?.usage.daily ?? [],
        loaded?.range ?? NO_RANGE,
        projectName,
        validDate(tsToDate(loaded?.usage.usageComputedAt)) ?? undefined,
      ),
    [loaded, projectName],
  )

  useEffect(() => {
    if (series.malformed === 0 && series.outOfWindow === 0) return
    console.error(
      `usage: ${series.malformed} unreadable and ${series.outOfWindow} out-of-window cell(s) in response for org ${org?.id ?? 'unknown'}`,
      series.rejected,
    )
  }, [series.malformed, series.outOfWindow, series.rejected, org])

  // Keyed on themeRevision: the palette is module state (see lib/event-colors.ts).
  const seriesColors = useMemo(() => usageSeriesColors(series.names), [series.names, themeRevision])

  if (!loaded) {
    if (!error) return <LoadingSpinner />
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="mb-1 text-sm font-medium">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={load} disabled={fetching}>
          Try again
        </Button>
      </div>
    )
  }

  const unusable = series.malformed + series.outOfWindow
  const state = windowState(loaded, series.projectTotals.length > 0 || unusable === 0)
  const metered = state.kind === 'metered'
  const unmeteredDays = metered ? unmeteredTailDays(loaded.range, state.meteredAt) : 0

  return (
    <div className="space-y-8 max-w-4xl">
      {error && (
        <p className="text-xs text-negative first-letter:uppercase">{error}. Showing the last data that loaded.</p>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* Names the window on screen, not the pending pick. */}
        <OptionChip
          label="range"
          icon={CalendarRange}
          options={rangeOptions(loaded.periodLabel ?? currentPeriod?.label)}
          value={loaded.key}
          onChange={key => {
            // A pick that failed is still `picked`, and setPicked bails on an unchanged value.
            if (key === picked) load()
            else setPicked(key)
            trackFeature({ featureId: 'usage.range', featureName: 'Usage range' })
          }}
        />
        <Button variant="ghost" size="sm" onClick={refresh} disabled={fetching} aria-label="Refresh usage">
          <RefreshCw className={fetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      </div>

      <section>
        <SectionHeader
          title="Events"
          description="Distinct events recorded across every project in this organization. Counted in UTC, so days and periods here won't line up with a project reporting in another timezone."
        />

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <WindowTotal state={state} total={series.windowTotal} />
          <span className="text-xs text-muted-foreground">{formatPeriod(loaded.range.from, loaded.range.to)}</span>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          <WindowNote state={state} />
        </p>
        {metered && (
          <>
            <RejectedRows malformed={series.malformed} outOfWindow={series.outOfWindow} />
            {unmeteredDays > 0 && (
              <p className="mt-2 text-xs text-caution">
                {unmeteredDays === 1 ? 'Today is' : `The ${unmeteredDays} days through today are`} unmetered, not zero.
              </p>
            )}
            {loaded.usage.daily.length >= DAILY_ROW_CAP && (
              <p className="mt-2 text-xs text-caution">
                This window hit the row limit for one request, so its latest days may be missing from these totals. Pick
                a shorter window.
              </p>
            )}
          </>
        )}

        <div className="mt-6">
          {metered && series.projectTotals.length > 0 ? (
            <BarChart
              data={series.points}
              seriesNames={series.names}
              seriesColors={seriesColors}
              granularity={Granularity.DAY}
              timeZone="UTC"
              stacked
            />
          ) : (
            <EmptyWindow unusable={unusable} metered={metered && unmeteredDays === 0} />
          )}
        </div>
      </section>

      {metered && (
        <ProjectBreakdown projectTotals={series.projectTotals} windowTotal={series.windowTotal} colors={seriesColors} />
      )}
    </div>
  )
}

export default Usage
