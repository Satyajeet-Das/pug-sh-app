import { create } from '@bufbuild/protobuf'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackFeature } from '@/analytics/pug'
import { GetFilterSchemaResponseSchema } from '@/api/genproto/common/v1/filter_schema_pb'
import { ProfileListSort, ProfileSchema } from '@/api/genproto/shared/profiles/v1/profiles_pb'
import { includeBotsAtom } from '@/data/bots.atoms'

const { list, getFilterSchema } = vi.hoisted(() => ({ list: vi.fn(), getFilterSchema: vi.fn() }))

vi.mock('@/api/rpc', async () => {
  const { atom } = await import('jotai')
  return { profilesRPCAtom: atom({ list }), insightsRPCAtom: atom({ getFilterSchema }) }
})

vi.mock('@/data/workspace.atoms', async importOriginal => {
  const actual = await importOriginal<typeof import('@/data/workspace.atoms')>()
  const { atom } = await import('jotai')
  return {
    ...actual,
    activeProjectAtom: atom({ id: 'p1', displayName: 'Test' }),
    projectHeaderAtom: atom({ 'x-project-id': 'p1' }),
  }
})

vi.mock('@/analytics/pug', () => ({
  trackEvent: vi.fn(),
  trackFeature: vi.fn(),
  identifyCustomer: vi.fn(),
  resetIdentity: vi.fn(),
  initAnalytics: vi.fn(),
  analyticsEnabled: false,
}))

const Profiles = (await import('./index.page')).default

const page = (profiles: string[], nextPageToken: string) =>
  (async function* () {
    yield { profiles: profiles.map(id => create(ProfileSchema, { id })), nextPageToken }
  })()

const argOf = (call: number) => list.mock.calls[call][0]
const sortParam = () => new URLSearchParams(window.location.search).get('sort')

beforeEach(() => {
  list.mockReset()
  getFilterSchema.mockReset().mockResolvedValue(create(GetFilterSchemaResponseSchema, {}))
  vi.mocked(trackFeature).mockClear()
  window.history.replaceState(null, '', '/profiles')
  getDefaultStore().set(includeBotsAtom, false)
})

describe('profiles sort', () => {
  // The list is paged on the server, so its order is whatever the request names. Without a sort the
  // server falls back to create time, and someone active a minute ago can sit pages down.
  it('asks for the most recently active people first', async () => {
    list.mockImplementationOnce(() => page(['anon-a'], ''))
    render(<Profiles />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    expect(argOf(0).sort).toBe(ProfileListSort.LAST_SEEN)
    expect(argOf(0).pageToken).toBe('')
    expect(screen.getByRole('columnheader', { name: 'Last Seen' }).getAttribute('aria-sort')).toBe('descending')
  })

  // A page token is bound to the sort it was issued under: the server rejects it under another. A
  // sort change must restart from page one, and later pages must carry the new sort with its token.
  it('reloads from the first page under a clicked seen column, and pages on under it', async () => {
    list.mockImplementationOnce(() => page(['anon-a', 'anon-b'], 'T1'))
    render(<Profiles />)
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    list.mockImplementationOnce(() => page(['anon-c'], 'T2'))
    fireEvent.click(screen.getByRole('button', { name: 'First Seen' }))
    await waitFor(() => expect(screen.queryAllByText('anon-a')).toHaveLength(0))
    expect(screen.getAllByText('anon-c').length).toBeGreaterThan(0)
    expect(argOf(1).sort).toBe(ProfileListSort.FIRST_SEEN)
    expect(argOf(1).pageToken).toBe('')
    expect(trackFeature).toHaveBeenCalledOnce()
    expect(trackFeature).toHaveBeenCalledWith({ featureId: 'profiles.sort', featureName: 'Sort profiles' })

    list.mockImplementationOnce(() => page(['anon-d'], ''))
    fireEvent.click(screen.getByText('Load more profiles'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
    expect(argOf(2).sort).toBe(ProfileListSort.FIRST_SEEN)
    expect(argOf(2).pageToken).toBe('T2')
  })

  // Re-clicking the active column changes nothing, so it must neither refetch, drop the pages already
  // loaded, nor count as a sort.
  it('leaves pagination intact when the active column is clicked', async () => {
    list.mockImplementationOnce(() => page(['anon-a'], 'T1'))
    render(<Profiles />)
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Last Seen' }))
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Load more profiles')).toBeTruthy()
    expect(trackFeature).not.toHaveBeenCalled()
  })

  // Opening a profile and coming Back remounts the page. Filters come back from the URL, so a sort
  // that didn't would put the list back in another order under the same filters.
  it('restores a sort chosen before the page remounted', async () => {
    window.history.replaceState(null, '', '/profiles?sort=first_seen')
    list.mockImplementationOnce(() => page(['anon-a'], ''))
    render(<Profiles />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    expect(argOf(0).sort).toBe(ProfileListSort.FIRST_SEEN)
    expect(screen.getByRole('columnheader', { name: 'First Seen' }).getAttribute('aria-sort')).toBe('descending')
  })

  // Only a non-default sort is written, like the bots toggle's param, so a default-view link never
  // accumulates one.
  it('writes a chosen sort to the URL, and drops it for the default', async () => {
    list.mockImplementationOnce(() => page(['anon-a'], ''))
    render(<Profiles />)
    await waitFor(() => expect(screen.getAllByText('anon-a').length).toBeGreaterThan(0))
    expect(sortParam()).toBeNull()

    list.mockImplementationOnce(() => page(['anon-b'], ''))
    fireEvent.click(screen.getByRole('button', { name: 'First Seen' }))
    await waitFor(() => expect(sortParam()).toBe('first_seen'))

    list.mockImplementationOnce(() => page(['anon-c'], ''))
    fireEvent.click(screen.getByRole('button', { name: 'Last Seen' }))
    await waitFor(() => expect(sortParam()).toBeNull())
  })

  // A person's sort key can move between pages (an identify merging older history moves first seen
  // earlier), so a later page can repeat someone already listed. Keyed by id, a repeated row would
  // render twice under a duplicate key.
  it('lists a person once when a later page repeats them', async () => {
    list.mockImplementationOnce(() => page(['anon-a', 'anon-b'], 'T1'))
    render(<Profiles />)
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    list.mockImplementationOnce(() => page(['anon-b', 'anon-c'], ''))
    fireEvent.click(screen.getByText('Load more profiles'))
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'anon-c' })).toHaveLength(1))
    expect(screen.getAllByRole('link', { name: 'anon-b' })).toHaveLength(1)
  })
})
