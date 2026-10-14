import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolvedThemeAtom, themeLibraryAtom } from '@/data/theme.atoms'
import { cn } from '@/lib/utils'
import ThemeSwatch from '@/pages/routegen/settings/appearance/theme-swatch'
import ThemeUrlField from '@/pages/routegen/settings/theme-url-field'
import type { ThemeFamily } from '@/theme/format'
import type { UsableEntry } from '@/theme/library'
import { formatReference } from '@/theme/reference'
import { POLARITIES, type Polarity } from '@/theme/tokens'

type Target = { id: string; family: ThemeFamily }
type ModeChoice = 'follow' | Polarity

// The one variant a single-variant family has. Picking such a family pins it, or its other mode would
// show Pug.
const onlyVariant = (family: ThemeFamily) => {
  const variants = POLARITIES.filter(polarity => family.variants[polarity])
  return variants.length === 1 ? variants[0] : null
}

// Picks a theme reference and its mode. `shared` is a project's default, which every member's browser
// loads: no installed themes, and the URL's host is disclosed.
const ThemePicker = ({
  shared,
  followLabel,
  saveLabel,
  saving = false,
  onSave,
}: {
  shared: boolean
  followLabel: string
  saveLabel: string
  saving?: boolean
  onSave: (reference: string) => void
}) => {
  const library = useAtomValue(themeLibraryAtom)
  const mode = useAtomValue(resolvedThemeAtom)
  const [target, setTarget] = useState<Target | null>(null)
  const [choice, setChoice] = useState<ModeChoice>('follow')

  const pick = (next: Target, pin?: Polarity) => {
    setTarget(next)
    setChoice(pin && next.family.variants[pin] ? pin : (onlyVariant(next.family) ?? 'follow'))
  }
  const previewMode = (family: ThemeFamily) => (family.variants[mode] ? mode : (onlyVariant(family) ?? mode))
  const entries = library.filter((entry): entry is UsableEntry => entry.family !== null && (entry.builtin || !shared))
  const choices: [ModeChoice, string][] = [
    ['follow', followLabel],
    ['light', 'Always light'],
    ['dark', 'Always dark'],
  ]
  const single = target ? onlyVariant(target.family) : null

  const save = () => {
    if (target) onSave(formatReference({ target: target.id, pin: choice === 'follow' ? undefined : choice }))
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Themes" className="flex flex-wrap gap-3">
        {entries.map(entry => (
          <ThemeSwatch
            key={entry.id}
            entry={entry}
            polarity={previewMode(entry.family)}
            selected={target?.id === entry.id}
            onSelect={() => pick(entry)}
          />
        ))}
      </div>
      <ThemeUrlField disclosure={shared} onUse={file => pick({ id: file.url, family: file.family }, file.pin)} />
      {target && (
        <div className="space-y-3">
          <p className="text-sm">{target.family.name}</p>
          {single && (
            <p className="text-xs text-muted-foreground">
              {target.family.name} has only a {single} variant.
            </p>
          )}
          <div
            role="group"
            aria-label="Mode for this theme"
            className="inline-flex rounded-lg border border-border p-0.5"
          >
            {choices.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={choice === value}
                disabled={value !== 'follow' && !target.family.variants[value]}
                onClick={() => setChoice(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
                  choice === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            <Button size="sm" disabled={saving} onClick={save}>
              {saveLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ThemePicker
