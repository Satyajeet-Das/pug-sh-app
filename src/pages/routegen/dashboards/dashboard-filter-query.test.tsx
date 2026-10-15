import { create } from '@bufbuild/protobuf'
import { render, waitFor } from '@testing-library/react'
import { Provider } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { PropertySource } from '@/api/genproto/common/v1/filter_schema_pb'
import { FilterOperator } from '@/api/genproto/common/v1/filters_pb'
import { ComparePeriod, DashboardTileSchema } from '@/api/genproto/dashboard/dashboards/v1/dashboards_pb'
import { Granularity, InsightType, type QueryRequest } from '@/api/genproto/shared/insights/v1/insights_pb'
import { createFilter } from '@/components/event-filters/filter-model'

const { queryRPC } = vi.hoisted(() => ({ queryRPC: vi.fn(async (_query: QueryRequest) => ({ result: undefined })) }))
vi.mock('@/api/rpc', async () => {
  const { atom } = await import('jotai')
  return { insightsRPCAtom: atom({ query: queryRPC }) }
})
vi.mock('@/data/workspace.atoms', async () => {
  const { atom } = await import('jotai')
  return { projectHeaderAtom: atom({ 'x-project-id': 'p1' }), activeProjectTimezoneAtom: atom('UTC') }
})
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('@/components/share-chart-button', () => ({ ShareChartButton: () => null }))
vi.mock('./insight-tile-view', () => ({ InsightTileView: () => null }))

const { DashboardGrid } = await import('./grid')

describe('dashboard filters in tile RPCs', () => {
  it('filters every tile and its comparison, then reruns the original queries when cleared', async () => {
    const tiles = ['signup', 'purchase'].map((kind, i) =>
      create(DashboardTileSchema, {
        id: kind,
        compare: i === 0 ? ComparePeriod.PRIOR : ComparePeriod.UNSPECIFIED,
        content: {
          case: 'insight',
          value: {
            spec: {
              insightType: InsightType.TRENDS,
              events: [{ event: { kind, filters: [{ property: 'local', operator: FilterOperator.IS_SET }] } }],
              filterGroups: [{ filters: [{ property: 'saved', operator: FilterOperator.IS_SET }] }],
            },
          },
        },
      }),
    )
    const before = structuredClone(tiles)
    const range = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') }
    const filters = [createFilter('tenant', PropertySource.PROFILE, FilterOperator.EQUALS, 'acme')]
    const view = (globalFilters: typeof filters) => (
      <Provider>
        <DashboardGrid
          tiles={tiles}
          globalTimeRange={range}
          globalGranularity={Granularity.DAY}
          globalFilters={globalFilters}
        />
      </Provider>
    )
    const { rerender } = render(view(filters))
    await waitFor(() => expect(queryRPC).toHaveBeenCalledTimes(3))
    for (const [query] of queryRPC.mock.calls) {
      expect(query.spec?.filterGroups.flatMap(group => group.filters).map(filter => filter.property)).toEqual([
        'saved',
        'tenant',
      ])
      expect(query.spec?.events[0].event?.filters[0].property).toBe('local')
    }
    expect(queryRPC.mock.calls.filter(([query]) => query.spec?.events[0].event?.kind === 'signup')).toHaveLength(2)
    rerender(view([]))
    await waitFor(() => expect(queryRPC).toHaveBeenCalledTimes(6))
    for (const [query] of queryRPC.mock.calls.slice(3)) {
      expect(query.spec?.filterGroups.flatMap(group => group.filters).map(filter => filter.property)).toEqual(['saved'])
    }
    expect(tiles).toEqual(before)
  })
})
