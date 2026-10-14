import { describe, expect, it } from 'vitest'
import { resolveKind } from './event-aliases'

describe('resolveKind', () => {
  it('normalizes and applies aliases', () => {
    expect(resolveKind('pageView')).toBe('page_view')
    expect(resolveKind('Log-In')).toBe('signin')
  })

  // EVENT_ALIASES is a plain object, so a lookup by a name it doesn't own reached Object.prototype and
  // handed back its constructor function.
  it('resolves a name Object.prototype owns to itself', () => {
    expect(resolveKind('constructor')).toBe('constructor')
  })
})
