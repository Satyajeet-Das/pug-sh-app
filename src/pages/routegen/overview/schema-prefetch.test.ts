import { create } from '@bufbuild/protobuf'
import { createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { GetFilterSchemaResponseSchema } from '@/api/genproto/common/v1/filter_schema_pb'
import { ProjectSchema } from '@/api/genproto/dashboard/projects/v1/projects_pb'
import { jwtFor } from '@/test/jwt'

const { getFilterSchema } = vi.hoisted(() => ({ getFilterSchema: vi.fn() }))

vi.mock('@/api/rpc', async () => {
  const { atom } = await import('jotai')
  return {
    orgsRPCAtom: atom({}),
    projectsRPCAtom: atom({}),
    insightsRPCAtom: atom({ getFilterSchema }),
  }
})

const { activeProjectAtom, lastOrgIdAtom, rememberLastProjectAtom } = await import('@/data/workspace.atoms')
const { jwtAtom } = await import('@/auth/jwt.atoms')
const { fetchOverviewSchemaAtom, overviewSchemaAtom, prefetchOverviewSchemaAtom } = await import('./overview.atoms')

const p1 = create(ProjectSchema, { id: 'p1', displayName: 'P1' })
const schema = create(GetFilterSchemaResponseSchema, { events: [{ name: 'page_view', count: 1n }] })

// A browser whose stored workspace is org-a, last opened on p1.
const restoring = () => {
  const store = createStore()
  store.set(jwtAtom, jwtFor('cust-1'))
  store.set(lastOrgIdAtom, 'org-a')
  store.set(rememberLastProjectAtom, { orgId: 'org-a', projectId: 'p1' })
  return store
}

describe('the overview schema prefetch', () => {
  it('answers only the first fetch, and is on screen before that fetch runs', async () => {
    getFilterSchema.mockResolvedValue(schema)
    const store = restoring()
    store.set(prefetchOverviewSchemaAtom, 'p1')
    store.set(activeProjectAtom, p1)
    await vi.waitFor(() => expect(store.get(overviewSchemaAtom)).toBe(schema))

    await store.set(fetchOverviewSchemaAtom)
    expect(getFilterSchema).toHaveBeenCalledTimes(1)
    expect(getFilterSchema).toHaveBeenCalledWith({}, { headers: { 'x-project-id': 'p1' } })

    await store.set(fetchOverviewSchemaAtom)
    expect(getFilterSchema).toHaveBeenCalledTimes(2)
  })

  it('waits for a prefetch still in flight rather than asking twice', async () => {
    let land = (_: typeof schema) => {}
    getFilterSchema.mockReturnValue(
      new Promise(resolve => {
        land = resolve
      }),
    )
    const store = restoring()
    store.set(prefetchOverviewSchemaAtom, null)
    store.set(activeProjectAtom, p1)

    const fetching = store.set(fetchOverviewSchemaAtom)
    land(schema)
    await fetching

    expect(store.get(overviewSchemaAtom)).toBe(schema)
    expect(getFilterSchema).toHaveBeenCalledTimes(1)
  })

  it('leaves alone a project the bootstrap will not restore', () => {
    const store = restoring()
    store.set(prefetchOverviewSchemaAtom, 'p2')
    expect(getFilterSchema).not.toHaveBeenCalled()
  })
})
