import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IssueList, warningSummary } from '@/pages/routegen/settings/theme-issues'
import ThemePreview from '@/pages/routegen/settings/theme-preview'
import { compileOnce } from '@/theme/compile'
import type { ThemeFamily } from '@/theme/format'
import type { RemoteId } from '@/theme/library'
import { type PastedTheme, resolvePastedTheme } from '@/theme/remote'
import { POLARITIES, type Polarity } from '@/theme/tokens'

export type CheckedFile = { url: RemoteId; pin?: Polarity; family: ThemeFamily }

type Failure = Extract<PastedTheme, { ok: false }>

const FAILURE: Record<Failure['reason'], string> = {
  'not-a-url': 'Enter an https URL.',
  insecure: 'Only https URLs can be used.',
  network: 'Couldn’t load it. The host may not let other sites read the file (CORS).',
  timeout: 'Couldn’t load it. The host took too long to answer.',
  status: 'The host didn’t return the file.',
  'too-large': 'Theme files are limited to 64 KB.',
  'not-json': 'That URL doesn’t return a theme file.',
}

const failureMessage = (failure: Failure) => {
  if (failure.reason === 'status' && failure.status) return `The host answered ${failure.status}.`
  return FAILURE[failure.reason]
}

const Report = ({
  result,
  disclosure,
  onUse,
}: {
  result: PastedTheme
  disclosure: boolean
  onUse: (file: CheckedFile) => void
}) => {
  if (!result.ok) return <p className="text-xs text-negative">{failureMessage(result)}</p>
  const { check, url, pin } = result
  if (!check.ok) {
    return (
      <div className="space-y-2">
        <p className="text-sm">This file can’t be used.</p>
        <IssueList issues={check.issues} />
      </div>
    )
  }
  const { family, issues } = check
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {POLARITIES.filter(polarity => family.variants[polarity]).map(polarity => (
          <figure key={polarity} className="w-36 space-y-1">
            <ThemePreview compiled={compileOnce({ id: url, builtin: false, family, polarity })} />
            <figcaption className="text-xs text-muted-foreground">
              {family.name}, {polarity}
            </figcaption>
          </figure>
        ))}
      </div>
      {issues.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm">{warningSummary(issues)}</p>
          <IssueList issues={issues} />
        </div>
      )}
      {disclosure && (
        <p className="text-xs text-muted-foreground">Members’ browsers will load this file from {new URL(url).host}.</p>
      )}
      <Button size="sm" variant="outline" onClick={() => onUse({ url, pin, family })}>
        Use this theme
      </Button>
    </div>
  )
}

/**
 * "Use a URL": fetches what was pasted, in this browser — the same origin members' browsers fetch from,
 * so a file that loads here loads for them — and reports it: previews, issues, or why it can't be used.
 */
const ThemeUrlField = ({
  id,
  disclosure,
  onUse,
}: {
  id: string
  disclosure: boolean
  onUse: (file: CheckedFile) => void
}) => {
  const [input, setInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<PastedTheme | null>(null)
  const latest = useRef(0)

  const check = async () => {
    const seq = ++latest.current
    setChecking(true)
    const next = await resolvePastedTheme(input)
    // Checks finish in any order: only the latest one's answer is shown.
    if (seq !== latest.current) return
    setChecking(false)
    setResult(next)
  }

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          void check()
        }}
      >
        <Input
          id={id}
          aria-label="Theme URL"
          placeholder="themes.pug.sh/linen, or a link to a theme file"
          value={input}
          onChange={event => setInput(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={checking || input.trim() === ''}>
          {checking && <Loader2 className="animate-spin" />}
          Check
        </Button>
      </form>
      {result && (
        <div role="status">
          <Report result={result} disclosure={disclosure} onUse={onUse} />
        </div>
      )}
    </div>
  )
}

export default ThemeUrlField
