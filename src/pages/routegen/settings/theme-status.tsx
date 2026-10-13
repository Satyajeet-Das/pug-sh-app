import type { FetchStatus } from '@/data/theme.atoms'
import { IssueList } from '@/pages/routegen/settings/theme-issues'
import type { LibraryEntry } from '@/theme/library'
import { isUrlTarget, parseReference } from '@/theme/reference'

const MODE = { follow: 'follows each member’s mode', light: 'always light', dark: 'always dark' } as const

/**
 * A reference in words: its theme's name (the host, until the file has loaded), the host for a file, and
 * its mode. Null for none, or for a reference this build can't read.
 */
export const describeReference = (value: string, library: LibraryEntry[]) => {
  const reference = parseReference(value)
  if (!reference) return null
  const host = isUrlTarget(reference.target) ? new URL(reference.target).host : undefined
  const name = library.find(e => e.id === reference.target)?.name ?? host ?? reference.target
  return { name, host, mode: MODE[reference.pin ?? 'follow'] }
}

/** How the last fetch of a reference's file went this session, when it names a file. */
export const statusOf = (value: string, statuses: Record<string, FetchStatus>) => {
  const reference = parseReference(value)
  if (!reference || !isUrlTarget(reference.target) || !Object.hasOwn(statuses, reference.target)) return undefined
  return statuses[reference.target]
}

const FAILED: Record<Extract<FetchStatus, { state: 'failed' }>['reason'], string> = {
  network: 'the host may not let other sites read the file (CORS)',
  timeout: 'the host took too long to answer',
  status: 'the host didn’t return the file',
  'too-large': 'the file is over 64 KB',
  insecure: 'only https URLs can be used',
  invalid: 'the file has errors',
}

/** The admin's line about a default's file: still checking, its warnings, or why the last check failed. */
export const FetchStatusLine = ({ status }: { status: FetchStatus }) => {
  if (status.state === 'loading') return <p className="mt-1 text-xs text-muted-foreground">Checking the file…</p>
  if (status.state === 'ok') {
    if (status.warnings === 0) return null
    const count = status.warnings === 1 ? '1 warning' : `${status.warnings} warnings`
    return <p className="mt-1 text-xs text-caution">The file has {count}.</p>
  }
  let reason = FAILED[status.reason]
  if (status.reason === 'status' && status.status) reason = `the host answered ${status.status}`
  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-negative">Last check failed: {reason}.</p>
      {status.issues && status.issues.length > 0 && <IssueList issues={status.issues} />}
    </div>
  )
}
