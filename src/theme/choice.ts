import type { LibraryEntry } from './library'
import { parseReference } from './reference'
import type { Polarity } from './tokens'

// Which theme a member sees in a project: their override for it, else the project's default, else their
// own choice, else Pug. A reference that can't be used yet — an unknown id, an installed theme that's gone
// or broken, a URL with no validated copy — is skipped. The winner's pin fixes the mode when its family
// has that variant; chooseActive then applies auto-contrast and the missing-variant fallback.

export type ChoiceSource = 'override' | 'project' | 'personal'

export type ThemeChoice = { selection: Record<Polarity, string>; pin?: Polarity; source: ChoiceSource }

const usableFamily = (target: string, library: LibraryEntry[]) =>
  library.find(entry => entry.id === target)?.family ?? null

export const chooseTheme = (input: {
  override?: string
  projectDefault?: string
  personal: Record<Polarity, string>
  library: LibraryEntry[]
}): ThemeChoice => {
  const candidates: [ChoiceSource, string | undefined][] = [
    ['override', input.override],
    ['project', input.projectDefault],
  ]
  for (const [source, value] of candidates) {
    const reference = value ? parseReference(value) : null
    if (!reference) continue
    const family = usableFamily(reference.target, input.library)
    if (!family) continue
    const selection = { light: reference.target, dark: reference.target }
    if (reference.pin && family.variants[reference.pin]) return { selection, pin: reference.pin, source }
    return { selection, source }
  }
  return { selection: input.personal, source: 'personal' }
}

/** The pin a reference names that its file has no variant for: it's ignored, and an admin should hear so. */
export const ignoredPin = (value: string, library: LibraryEntry[]): Polarity | null => {
  const reference = parseReference(value)
  if (!reference?.pin) return null
  const family = usableFamily(reference.target, library)
  if (!family || family.variants[reference.pin]) return null
  return reference.pin
}
