import { afterEach, describe, expect, it, vi } from 'vitest'
import { appOrigin, demoHandoffUrl, isDemoHost } from './demo'

const here = window.location.origin

describe('the demo origin variables', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  for (const [name, demo, app, host, handoff] of [
    ['stay off with neither set', '', '', false, null],
    ['stay off with only the demo origin set', 'https://demo.example', '', false, null],
    ['stay off when both name this origin', here, here, false, null],
    ['stay off for a value without a scheme', 'demo.localhost:5173', here, false, null],
    ['take an origin with a trailing slash', 'https://demo.example/', `${here}/`, false, 'https://demo.example/'],
    ['make this the demo host when it is the demo origin', here, 'https://app.example', true, null],
  ] as const) {
    it(name, () => {
      vi.stubEnv('VITE_DEMO_ORIGIN', demo)
      vi.stubEnv('VITE_APP_ORIGIN', app)

      expect(isDemoHost()).toBe(host)
      expect(demoHandoffUrl()).toBe(handoff)
      if (host) expect(appOrigin()).toBe('https://app.example')
    })
  }

  for (const [name, demo, app, warns] of [
    ['warn at load about a pair they cannot use', 'demo.localhost:5173', 'http://localhost:5173', true],
    ['say nothing at load with neither set', '', '', false],
    ['say nothing at load about a usable pair', 'https://demo.example', 'https://app.example', false],
  ] as const) {
    it(name, async () => {
      vi.stubEnv('VITE_DEMO_ORIGIN', demo)
      vi.stubEnv('VITE_APP_ORIGIN', app)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.resetModules()

      await import('./demo')

      expect(warn).toHaveBeenCalledTimes(warns ? 1 : 0)
    })
  }
})
