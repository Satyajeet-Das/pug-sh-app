import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { toast } from 'sonner'
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

// A page that answers only once released, so a test can land it after the page has moved on.
const heldPage = (profiles: string[], nextPageToken: string) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const stream = (async function* () {
    await gate
    yield { profiles: profiles.map(id => create(ProfileSchema, { id })), nextPageToken }
  })()
  return { stream, release }
}

const argOf = (call: number) => list.mock.calls[call][0]
const sortParam = () => new URLSearchParams(window.location.search).get('sort')

beforeEach(() => {
  vi.restoreAllMocks()
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
    // Only the active column claims a sort, or a screen reader announces both as sorted.
    expect(screen.getByRole('columnheader', { name: 'First Seen' }).hasAttribute('aria-sort')).toBe(false)
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

  // A re-click on the active column must not count as a sort. React already skips a same-value
  // setSort, so the refetch and Load more checks hold either way; the trackFeature check is the one
  // handleSort's early return answers for.
  it('leaves pagination intact when the active column is clicked', async () => {
    list.mockImplementationOnce(() => page(['anon-a'], 'T1'))
    render(<Profiles />)
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Last Seen' }))
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Load more profiles')).toBeTruthy()
    expect(trackFeature).not.toHaveBeenCalled()
  })

  // The headers stay clickable while a Load more is in flight. If its answer lands after the sort
  // changed, appending it would mix the old sort's rows in and leave a token the server refuses.
  it('drops a Load more that lands after the sort changed', async () => {
    list.mockImplementationOnce(() => page(['anon-a'], 'T-last-1'))
    render(<Profiles />)
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    const stale = heldPage(['anon-stale'], 'T-last-2')
    list.mockImplementationOnce(() => stale.stream)
    fireEvent.click(screen.getByText('Load more profiles'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    list.mockImplementationOnce(() => page(['anon-c'], 'T-first-1'))
    fireEvent.click(screen.getByRole('button', { name: 'First Seen' }))
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    await act(async () => {
      stale.release()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(screen.queryAllByText('anon-stale')).toHaveLength(0)

    list.mockImplementationOnce(() => page(['anon-d'], ''))
    fireEvent.click(screen.getByText('Load more profiles'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4))
    expect(argOf(3).sort).toBe(ProfileListSort.FIRST_SEEN)
    expect(argOf(3).pageToken).toBe('T-first-1')
  })

  // The server refuses a page token it can't seek on — one an older server minted, met across a
  // deploy. Resending it is refused again, so Retry has to start over from the first page, and the
  // toast mustn't hand a dashboard user the API's wording.
  it('retries a refused page token from the first page', async () => {
    const toastError = vi.spyOn(toast, 'error')
    list.mockImplementationOnce(() => page(['anon-a'], 'T1'))
    render(<Profiles />)
    await waitFor(() => expect(screen.getByText('Load more profiles')).toBeTruthy())

    list.mockImplementationOnce(() => {
      throw new ConnectError(
        'page token was issued for a different sort; restart from an empty token to change it',
        Code.InvalidArgument,
      )
    })
    fireEvent.click(screen.getByText('Load more profiles'))
    await waitFor(() => expect(screen.getByText('Retry')).toBeTruthy())
    expect(toastError).toHaveBeenCalledOnce()
    expect(String(toastError.mock.calls[0][0])).not.toMatch(/token/)

    list.mockImplementationOnce(() => page(['anon-b'], ''))
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
    expect(argOf(2).pageToken).toBe('')
    expect(argOf(2).sort).toBe(ProfileListSort.LAST_SEEN)
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
