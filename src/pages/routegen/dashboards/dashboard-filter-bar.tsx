import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import type { GetFilterSchemaResponse } from '@/api/genproto/common/v1/filter_schema_pb'
import type { DashboardTile } from '@/api/genproto/dashboard/dashboards/v1/dashboards_pb'
import { insightsRPCAtom } from '@/api/rpc'
import { FilterBuilder } from '@/components/event-filters/filter-builder'
import { FilterChip } from '@/components/event-filters/filter-chip'
import type { ActiveFilter } from '@/components/event-filters/filter-model'
import { projectHeaderAtom } from '@/data/workspace.atoms'
import { fetchSchemaForKind } from '@/hooks/use-global-filter-schema'
import { commonDashboardSchema, dashboardEventKinds } from './dashboard-filters'

export const DashboardFilterBar = ({
  tiles,
  filters,
  onChange,
}: {
  tiles: DashboardTile[]
  filters: readonly ActiveFilter[]
  onChange: (filters: ActiveFilter[]) => void
}) => {
  const rpc = useAtomValue(insightsRPCAtom)
  const headers = useAtomValue(projectHeaderAtom)
  const [attempt, setAttempt] = useState(0)
  // The signature changes for event selection, not layout, titles or formatting.
  const kindsKey = JSON.stringify(dashboardEventKinds(tiles, ['']))
  const projectId = headers?.['x-project-id'] ?? ''
  const key = JSON.stringify([projectId, kindsKey, attempt])
  const [result, setResult] = useState<{
    key: string
    schema: GetFilterSchemaResponse | null
    error: boolean
  } | null>(null)

  useEffect(() => {
    if (!headers) return
    let cancelled = false
    const load = async () => {
      try {
        const base = await fetchSchemaForKind('', rpc, headers, { force: attempt > 0 })
        const kinds = JSON.parse(kindsKey) as string[]
        const selected = kinds.includes('')
          ? [...new Set([...kinds.filter(Boolean), ...base.events.map(e => e.name)])]
          : kinds
        // A partial intersection could offer properties unavailable to a failed event kind.
        const schemas = await Promise.all(
          selected.map(kind => fetchSchemaForKind(kind, rpc, headers, { force: attempt > 0 })),
        )
        if (!cancelled) setResult({ key, schema: commonDashboardSchema(base, schemas), error: false })
      } catch {
        if (!cancelled) setResult({ key, schema: null, error: true })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [rpc, headers, kindsKey, key, attempt])

  const current = result?.key === key ? result : null
  return (
    <div className="mb-6 space-y-2" role="group" aria-label="Dashboard filters">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Dashboard filters</span>
        {filters.map((filter, index) => (
          <FilterChip
            key={`${filter.source}:${filter.property}:${index}`}
            filter={filter}
            onUpdate={next => onChange(filters.map((value, i) => (i === index ? next : value)))}
            onRemove={() => onChange(filters.filter((_, i) => i !== index))}
          />
        ))}
        {current?.schema ? (
          <FilterBuilder schema={current.schema} schemaError={null} onAdd={filter => onChange([...filters, filter])} />
        ) : current?.error ? (
          <button type="button" className="text-xs text-destructive" onClick={() => setAttempt(value => value + 1)}>
            Could not load shared filters. Retry
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">Loading shared filters…</span>
        )}
        {filters.length > 0 ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange([])}
          >
            Clear all
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Applies to every chart alongside its own filters. Changes are saved in this URL.
      </p>
    </div>
  )
}
