import { describe, expect, it, vi } from 'vitest'
import { formatColor, parseColor } from '../lib/color/parse'
import { buildLibrary, type InstalledTheme } from './library'
import { buildPaintCache, MAX_PAINTED_PROJECTS, PAINT_CACHE_KEY, readPaintCache, writePaintCache } from './paint-cache'

const grape: InstalledTheme = {
  id: 'installed-grape',
  text: JSON.stringify({ version: 1, name: 'Grape', variants: { dark: { colors: { background: '#1e1b2e' } } } }),
  hash: 'grape',
  installedAt: 0,
  source: 'file',
}
const library = buildLibrary([grape])
const own = { light: 'pug', dark: 'pug' }
const personal = { selection: own, source: 'personal' as const }

describe('buildPaintCache', () => {
  it('names built-ins and carries an installed theme as variables', () => {
    const cache = buildPaintCache({
      previous: null,
      projectId: null,
      choice: personal,
      personal: { light: 'pug', dark: grape.id },
      autoContrast: true,
      library,
    })
    expect(cache).toMatchObject({ v: 2, autoContrast: true, projects: {} })
    expect(cache.personal.light).toEqual({ builtin: 'pug', standard: true })
    const dark = cache.personal.dark
    expect('vars' in dark && dark.vars['--background']).toBe(formatColor(parseColor('#1e1b2e') as never))
  })

  it('paints the project’s choice with its pin, and remembers it as last', () => {
    const cache = buildPaintCache({
      previous: null,
      projectId: 'p1',
      choice: { selection: { light: 'pug-colourblind', dark: 'pug-colourblind' }, pin: 'dark', source: 'project' },
      personal: own,
      autoContrast: false,
      library,
    })
    expect(cache.last).toBe('p1')
    expect(cache.projects.p1).toMatchObject({ pin: 'dark', dark: { builtin: 'pug-colourblind', standard: true } })
  })

  it('keeps other projects, most recent last, up to the limit', () => {
    let cache: ReturnType<typeof buildPaintCache> | null = null
    for (let i = 0; i <= MAX_PAINTED_PROJECTS; i++) {
      cache = buildPaintCache({
        previous: cache,
        projectId: `p${i}`,
        choice: personal,
        personal: own,
        autoContrast: true,
        library,
      })
    }
    const ids = Object.keys(cache?.projects ?? {})
    expect(ids).toHaveLength(MAX_PAINTED_PROJECTS)
    expect(ids).not.toContain('p0')
    expect(ids.at(-1)).toBe(`p${MAX_PAINTED_PROJECTS}`)
  })
})

describe('readPaintCache', () => {
  // The first load after the release must paint what the old cache said.
  it('reads a version 1 cache as the member’s own', () => {
    localStorage.setItem(
      PAINT_CACHE_KEY,
      JSON.stringify({
        v: 1,
        autoContrast: false,
        light: { builtin: 'pug-colourblind', standard: true },
        dark: { builtin: 'pug', standard: true },
      }),
    )
    expect(readPaintCache()).toEqual({
      v: 2,
      autoContrast: false,
      personal: { light: { builtin: 'pug-colourblind', standard: true }, dark: { builtin: 'pug', standard: true } },
      projects: {},
    })
  })

  it('reads nothing from a cache that isn’t one', () => {
    localStorage.setItem(PAINT_CACHE_KEY, '{')
    expect(readPaintCache()).toBeNull()
    localStorage.setItem(PAINT_CACHE_KEY, JSON.stringify({ v: 3 }))
    expect(readPaintCache()).toBeNull()
  })
})

describe('writePaintCache', () => {
  // A refused write leaves the old cache in place, and the next load would paint whatever it says —
  // possibly a theme that has since been removed. With no cache it paints Pug, then React corrects.
  it('drops the old cache when storage refuses the new one', () => {
    localStorage.setItem(
      PAINT_CACHE_KEY,
      JSON.stringify({ v: 1, autoContrast: true, light: { builtin: 'pug-colourblind' } }),
    )
    const refusal = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      writePaintCache(
        buildPaintCache({
          previous: null,
          projectId: null,
          choice: personal,
          personal: own,
          autoContrast: true,
          library,
        }),
      )
    } finally {
      refusal.mockRestore()
    }
    expect(localStorage.getItem(PAINT_CACHE_KEY)).toBeNull()
  })
})
