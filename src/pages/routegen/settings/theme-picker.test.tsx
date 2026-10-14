import { fireEvent, render, screen, within } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installedThemesAtom } from '@/data/theme.atoms'
import { fakeResponse } from '@/test/fake-response'
import type { InstalledTheme } from '@/theme/library'
import ThemePicker from './theme-picker'

const clay = JSON.stringify({ version: 1, name: 'Clay', variants: { light: { colors: { background: '#f3eee4' } } } })
const grape: InstalledTheme = {
  id: 'installed-grape',
  text: JSON.stringify({ version: 1, name: 'Grape', variants: { dark: { colors: { background: '#1e1b2e' } } } }),
  hash: 'grape',
  installedAt: 0,
  source: 'file',
}

const mount = ({ shared = true } = {}) => {
  const onSave = vi.fn()
  const store = createStore()
  store.set(installedThemesAtom, [grape])
  render(
    <Provider store={store}>
      <ThemePicker
        shared={shared}
        followLabel="Follow each member’s mode"
        saveLabel="Save default theme"
        onSave={onSave}
      />
    </Provider>,
  )
  return onSave
}

const pickSwatch = (name: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: 'Themes' })).getByRole('button', { name }))

const check = (value: string) => {
  fireEvent.change(screen.getByLabelText('Theme URL'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('ThemePicker', () => {
  it('saves a built-in that follows the mode', () => {
    const onSave = mount()
    pickSwatch('Pug Colourblind-safe')
    fireEvent.click(screen.getByRole('button', { name: 'Save default theme' }))
    expect(onSave).toHaveBeenCalledWith('pug-colourblind')
  })

  it('saves a built-in pinned to a mode', () => {
    const onSave = mount()
    pickSwatch('Pug Colourblind-safe')
    fireEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save default theme' }))
    expect(onSave).toHaveBeenCalledWith('pug-colourblind#dark')
  })

  it('leaves installed themes out of a project’s default', () => {
    mount()
    expect(within(screen.getByRole('group', { name: 'Themes' })).queryByRole('button', { name: 'Grape' })).toBeNull()
  })

  it('pins a single-variant installed theme to its only mode', () => {
    const onSave = mount({ shared: false })
    pickSwatch('Grape')
    expect(screen.getByText('Grape has only a dark variant.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save default theme' }))
    expect(onSave).toHaveBeenCalledWith('installed-grape#dark')
  })

  it('checks a URL, discloses its host, and saves the file’s URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(clay)),
    )
    const onSave = mount()
    check('raw.githubusercontent.com/acme/brand/main/clay.json')
    expect(
      await screen.findByText('Members’ browsers will load this file from raw.githubusercontent.com.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use this theme' }))
    expect(screen.getByRole('button', { name: 'Always light' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('button', { name: 'Always dark' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save default theme' }))
    expect(onSave).toHaveBeenCalledWith('https://raw.githubusercontent.com/acme/brand/main/clay.json#light')
  })

  it('drops a pasted pin the file has no variant for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(clay)),
    )
    const onSave = mount()
    check('example.com/clay.json#dark')
    fireEvent.click(await screen.findByRole('button', { name: 'Use this theme' }))
    expect(screen.getByRole('button', { name: 'Always light' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Save default theme' }))
    expect(onSave).toHaveBeenCalledWith('https://example.com/clay.json#light')
  })

  it('says why a URL can’t be used, and offers nothing to use', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    mount()
    check('cdn.example.com/brand.json')
    expect(
      await screen.findByText('Couldn’t reach the host, or it doesn’t let other sites read the file (CORS).'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this theme' })).toBeNull()
  })

  it('lists a broken file’s errors instead of using it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse('{"version":1,"name":"Broken","variants":{}}')),
    )
    mount()
    check('https://example.com/broken.json')
    expect(await screen.findByText('This file can’t be used.')).toBeTruthy()
    expect(screen.getByText('A theme needs a light or a dark variant')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this theme' })).toBeNull()
  })
})
