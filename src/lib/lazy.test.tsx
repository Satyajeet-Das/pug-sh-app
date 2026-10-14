import { act, render, screen } from '@testing-library/react'
import { atom, createStore, Provider, useAtomValue } from 'jotai'
import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { lazyWithRetry } from './lazy'

describe('lazyWithRetry', () => {
  it('renders a component preloaded before it mounts without showing the fallback', async () => {
    const Page = lazyWithRetry(() => Promise.resolve({ default: () => <p>page</p> }))
    await Page.preload()

    render(
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>,
    )

    expect(screen.getByText('page')).toBeTruthy()
  })

  // use() would suspend here too, but a sync act() holds back the whole render while a use() promise is
  // pending, and every test that mounts App updates it with one.
  it('lets a sync act commit the rest of the tree while its chunk loads', () => {
    const countAtom = atom(0)
    const Count = () => <p>count {useAtomValue(countAtom)}</p>
    const Page = lazyWithRetry(() => new Promise(() => {}))
    const store = createStore()
    render(
      <Provider store={store}>
        <Count />
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </Provider>,
    )

    act(() => store.set(countAtom, 1))

    expect(screen.getByText('count 1')).toBeTruthy()
  })
})
