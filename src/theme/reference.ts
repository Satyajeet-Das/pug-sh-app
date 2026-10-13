import type { Polarity } from './tokens'

// A theme reference names a theme as one string, for a project's default and for a member's override
// alike:
//
//   reference := target [ "#" pin ]      pin := "light" | "dark"
//   target    := a built-in id | an installed id (this browser only) | an https URL of a format-v1 file
//
// A pin makes the project always that mode; without one the theme follows each member's mode. HTTP
// never sends the fragment, so a file and its pinned forms share one download and one cache entry.

export type ThemeReference = { target: string; pin?: Polarity }

/** The server's limit on a stored reference (UpdateMetaRequest.default_theme). */
export const MAX_REFERENCE_LENGTH = 2048

const ID = /^[a-z0-9-]{1,64}$/

export const isUrlTarget = (target: string) => target.startsWith('https://')

// The URL parser has the last word on a URL target. The server's rule can't mirror it — it takes any
// five-digit port — and every reader of a reference has to agree on which ones are usable.
const parsesAsHttps = (target: string) => {
  try {
    return new URL(target).protocol === 'https:'
  } catch {
    return false
  }
}

const isTarget = (target: string) => (isUrlTarget(target) ? parsesAsHttps(target) : ID.test(target))

/**
 * Splits a reference at its first '#'. In a URL an unencoded '#' can only begin the fragment, so one
 * rule serves both kinds of target. Null for an empty string, or anything that isn't a reference.
 */
export const parseReference = (value: string): ThemeReference | null => {
  if (value.length === 0 || value.length > MAX_REFERENCE_LENGTH) return null
  const at = value.indexOf('#')
  const target = at === -1 ? value : value.slice(0, at)
  if (!isTarget(target)) return null
  if (at === -1) return { target }
  const pin = value.slice(at + 1)
  if (pin !== 'light' && pin !== 'dark') return null
  return { target, pin }
}

export const formatReference = ({ target, pin }: ThemeReference) => (pin ? `${target}#${pin}` : target)

/**
 * What someone typed into a "Use a URL" box, as the URLs worth trying in order: as written, then as a
 * repository folder (`themes.pug.sh/linen` → `…/linen/theme.json`). Carries any pin the paste had. The
 * URL parser lowercases the host, as the server requires. Null when it can't be an https URL.
 */
export const parsePastedUrl = (input: string): { urls: string[]; pin?: Polarity } | null => {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const fragment = url.hash.slice(1)
  url.hash = ''
  const asWritten = url.href
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/theme.json`
  const urls = asWritten === url.href ? [asWritten] : [asWritten, url.href]
  if (fragment === 'light' || fragment === 'dark') return { urls, pin: fragment }
  return { urls }
}
