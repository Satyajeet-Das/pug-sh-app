import { create } from '@bufbuild/protobuf'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GetFilterSchemaResponseSchema, PropertySource } from '@/api/genproto/common/v1/filter_schema_pb'
import { FilterOperator } from '@/api/genproto/common/v1/filters_pb'
import { DashboardTileSchema } from '@/api/genproto/dashboard/dashboards/v1/dashboards_pb'
import { createFilter } from '@/components/event-filters/filter-model'
import { clearSchemaCache } from '@/hooks/use-global-filter-schema'

const { getSchema } = vi.hoisted(() => ({ getSchema: vi.fn() }))
const { testHeaders } = await vi.hoisted(async () => {
  const { atom } = await import('jotai')
  return { testHeaders: atom({ 'x-project-id': 'p1' }) }
})
vi.mock('@/api/rpc', async () => {
  const { atom } = await import('jotai')
  return { insightsRPCAtom: atom({ getFilterSchema: getSchema }) }
})
vi.mock('@/data/workspace.atoms', () => ({ projectHeaderAtom: testHeaders }))
// Exercise schema loading and controller behavior without the popover's focus machinery.
vi.mock('@/components/event-filters/filter-builder', () => ({
  FilterBuilder: ({ schema }: { schema: { customPropertyKeys: { name: string }[] } }) => (
    <div data-testid="available">{schema.customPropertyKeys.map(key => key.name).join(',')}</div>
  ),
}))

const { DashboardFilterBar } = await import('./dashboard-filter-bar')
const tiles = [
  create(DashboardTileSchema, {
    content: {
      case: 'insight',
      value: { spec: { events: [{ event: { kind: 'signup' } }, { event: { kind: 'purchase' } }] } },
    },
  }),
]
const base = create(GetFilterSchemaResponseSchema)
const scoped = create(GetFilterSchemaResponseSchema, { customPropertyKeys: [{ name: 'shared' }] })

beforeEach(() => {
  clearSchemaCache()
  getSchema.mockReset()
})

describe('dashboard shared filter loading', () => {
  it('waits for every event schema and offers no partial intersection on failure, then retries', async () => {
    let rejectPurchase = (_reason: Error) => {}
    getSchema.mockImplementation(({ eventKind }: { eventKind: string }) => {
      if (!eventKind) return Promise.resolve(base)
      if (eventKind === 'signup') return Promise.resolve(scoped)
      return new Promise((_, reject) => {
        rejectPurchase = reject
      })
    })
    render(
      <Provider>
        <DashboardFilterBar tiles={tiles} filters={[]} onChange={vi.fn()} />
      </Provider>,
    )
    await waitFor(() => expect(getSchema).toHaveBeenCalledTimes(3))
    expect(screen.queryByTestId('available')).toBeNull()
    await act(async () => rejectPurchase(new Error('unavailable')))
    expect(screen.queryByTestId('available')).toBeNull()
    getSchema.mockResolvedValue(scoped)
    fireEvent.click(screen.getByText('Could not load shared filters. Retry'))
    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('shared'))
  })

  it('hides the previous project schema immediately and ignores its late responses', async () => {
    let resolveOld = (_value: typeof base) => {}
    getSchema.mockImplementation((_req, options) => {
      if (options.headers['x-project-id'] === 'p1')
        return new Promise(resolve => {
          resolveOld = resolve
        })
      return Promise.resolve(scoped)
    })
    const store = createStore()
    render(
      <Provider store={store}>
        <DashboardFilterBar tiles={tiles} filters={[]} onChange={vi.fn()} />
      </Provider>,
    )
    await waitFor(() => expect(getSchema).toHaveBeenCalledTimes(1))
    await act(async () => store.set(testHeaders, { 'x-project-id': 'p2' }))
    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('shared'))
    await act(async () => resolveOld(create(GetFilterSchemaResponseSchema, { customPropertyKeys: [{ name: 'old' }] })))
    expect(screen.getByTestId('available').textContent).toBe('shared')
  })

  it('keeps restored filters visible and clearable even when schemas fail', async () => {
    getSchema.mockRejectedValue(new Error('offline'))
    const onChange = vi.fn()
    const filters = [createFilter('tenant', PropertySource.PROFILE, FilterOperator.EQUALS, 'acme')]
    render(
      <Provider>
        <DashboardFilterBar tiles={tiles} filters={filters} onChange={onChange} />
      </Provider>,
    )
    await screen.findByText('Could not load shared filters. Retry')
    expect(screen.getByText('tenant')).toBeTruthy()
    fireEvent.click(screen.getByText('Clear all'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
