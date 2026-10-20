import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { expect, it, vi } from 'vitest'
import { ActivityMapView } from '@/components/activity-map-view'
import { CRASHED, CrashBoundary, withoutWebGL2 } from '@/test/no-webgl'

// The shapes are fetched from the map-assets origin, and nothing here gets far enough to draw them.
vi.mock('@/lib/world-countries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/world-countries')>()),
  loadWorldCountries: () => new Promise(() => {}),
}))

// The bug: MapLibre's constructor throws GPUInitializationError when the browser has no WebGL2, and
// it threw from an effect, so the route's error boundary took the whole Overview down with the one
// tile that couldn't draw.
it('swaps the map for a note when the browser has no WebGL2, instead of crashing the page', () => {
  withoutWebGL2()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  render(
    <Provider store={createStore()}>
      <CrashBoundary>
        <ActivityMapView countries={[{ iso: 'IN', count: 3 }]} loading={false} error={null} retry={() => {}} />
      </CrashBoundary>
    </Provider>,
  )

  expect(screen.queryByText(CRASHED)).toBeNull()
  screen.getByText('Map unavailable in this browser')
})
