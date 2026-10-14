import { act, render, screen } from '@testing-library/react'
import { atom, createStore, Provider, useAtomValue } from 'jotai'
import { Suspense, startTransition, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
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

  // Pins React.lazy over use(): a pending use() promise makes a sync act() hold back the whole tree, and
  // theme-applier and auth-canvas render App under sync act.
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

  // No act() here: it renders synchronously, and only a concurrent render commits <Lazy> resolved in place.
  it('keeps a page mounted when its chunk lands during a concurrent render', async () => {
    let mounts = 0
    const Mounted = () => {
      useEffect(() => {
        mounts++
      }, [])
      return <p>page</p>
    }
    const Page = lazyWithRetry(() => Promise.resolve({ default: Mounted }))
    const container = document.createElement('div')
    const root = createRoot(container)
    const show = (label: string) =>
      startTransition(() =>
        root.render(
          <Suspense fallback={null}>
            <Page />
            {label}
          </Suspense>,
        ),
      )

    show('first')
    await vi.waitFor(() => expect(container.textContent).toBe('pagefirst'))
    show('second')
    await vi.waitFor(() => expect(container.textContent).toBe('pagesecond'))
    root.unmount()

    expect(mounts).toBe(1)
  })

  it('reloads when a chunk fails to preload its stylesheet', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Page = lazyWithRetry(() => Promise.reject(new Error('Unable to preload CSS for /assets/vendor-maplibre.css')))

    void Page.preload()

    await vi.waitFor(() => expect(reload).toHaveBeenCalled())
  })
})
