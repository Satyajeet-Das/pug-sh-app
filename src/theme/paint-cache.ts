import type { ThemeChoice } from './choice'
import { compileOnce } from './compile'
import { chooseActive, type LibraryEntry } from './library'
import { POLARITIES, type Polarity } from './tokens'

// What the index.html script paints before React loads: each project with a theme of its own, plus the
// member's own for everything else. Both modes are cached because the OS can flip between visits. Keep the
// key, the shape and the auto-contrast rule in sync with that script — paint-script.test.ts runs the real
// one against this output.

export const PAINT_CACHE_KEY = 'pug:theme-paint'

/** How many projects the cache remembers. The least recently painted go first. */
export const MAX_PAINTED_PROJECTS = 10

export type Paint = { builtin: string; standard: boolean } | { vars: Record<string, string>; standard: boolean }
export type ModePaints = Record<Polarity, Paint>
export type ProjectPaint = ModePaints & { pin?: Polarity }

export type PaintCache = {
  v: 2
  autoContrast: boolean
  /** The project visited most recently, while it has a theme of its own: what `/` paints, since it redirects there. */
  last?: string
  /** The member's own choice: pages outside a project, projects on it, and projects not cached yet. */
  personal: ModePaints
  projects: Record<string, ProjectPaint>
}

const FALLBACK: Paint = { builtin: 'pug', standard: true }

const paintsFor = (selection: Record<Polarity, string>, library: LibraryEntry[]): ModePaints => {
  const paintFor = (polarity: Polarity): Paint => {
    // The script applies auto-contrast itself, against the live media query.
    const active = chooseActive({ selection, library, polarity, autoContrast: false, moreContrast: false })
    const standard = active.family.contrast === 'standard'
    if (active.builtin) return { builtin: active.id, standard }
    return { vars: compileOnce(active).vars, standard }
  }
  const [light, dark] = POLARITIES.map(paintFor)
  return { light, dark }
}

/** The stored cache, or null. A version 1 cache, one paint per mode, reads as the member's own. */
export const readPaintCache = (): PaintCache | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(PAINT_CACHE_KEY) ?? 'null')
    if (raw?.v === 2 && typeof raw.projects === 'object' && raw.projects !== null) return raw as PaintCache
    if (raw?.v === 1) {
      return {
        v: 2,
        autoContrast: raw.autoContrast !== false,
        personal: { light: raw.light ?? FALLBACK, dark: raw.dark ?? FALLBACK },
        projects: {},
      }
    }
  } catch {
    // Unreadable is the same as absent.
  }
  return null
}

export const buildPaintCache = (input: {
  previous: PaintCache | null
  projectId: string | null
  choice: ThemeChoice
  personal: Record<Polarity, string>
  autoContrast: boolean
  library: LibraryEntry[]
}): PaintCache => {
  const projects = { ...input.previous?.projects }
  let last = input.previous?.last
  if (input.projectId) {
    // Re-inserted so it moves to the end: key order is the recency the trim below reads. Project ids
    // are 20-character xids, never integer-like keys that objects would sort first.
    delete projects[input.projectId]
    // A project on the member's own theme gets no entry: the script paints `personal` there, which
    // follows their choice wherever they change it. An entry would keep the theme it had at the time.
    if (input.choice.source !== 'personal') {
      const paint: ProjectPaint = paintsFor(input.choice.selection, input.library)
      if (input.choice.pin) paint.pin = input.choice.pin
      projects[input.projectId] = paint
    }
    last = input.projectId
  }
  const kept = Object.fromEntries(Object.entries(projects).slice(-MAX_PAINTED_PROJECTS))
  const cache: PaintCache = {
    v: 2,
    autoContrast: input.autoContrast,
    personal: paintsFor(input.personal, input.library),
    projects: kept,
  }
  if (last && Object.hasOwn(kept, last)) cache.last = last
  return cache
}

export const writePaintCache = (cache: PaintCache) => {
  try {
    localStorage.setItem(PAINT_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Private mode or a full quota. A refused write leaves the old cache, which may name a theme
    // that's gone — drop it, so the next load paints Pug and React corrects it.
    try {
      localStorage.removeItem(PAINT_CACHE_KEY)
    } catch {
      // Storage refuses even that: the next load paints whatever is left, and React still corrects it.
    }
  }
}
