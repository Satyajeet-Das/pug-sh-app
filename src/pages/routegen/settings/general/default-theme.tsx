import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { Can } from '@/auth/can'
import SectionHeader from '@/components/section-header'
import { Button } from '@/components/ui/button'
import { fetchStatusAtom, resolvableLibraryAtom } from '@/data/theme.atoms'
import { activeProjectAtom, saveProjectThemeAtom } from '@/data/workspace.atoms'
import { toastRPCError } from '@/lib/rpc-error'
import { cn } from '@/lib/utils'
import ThemePicker from '@/pages/routegen/settings/theme-picker'
import { describeReference, FetchStatusLine, statusOf } from '@/pages/routegen/settings/theme-status'
import { ignoredPin } from '@/theme/choice'

// Everyone sees the project's default theme; admins (project:update) set it.
const DefaultTheme = () => {
  const project = useAtomValue(activeProjectAtom)
  const library = useAtomValue(resolvableLibraryAtom)
  const statuses = useAtomValue(fetchStatusAtom)
  const save = useSetAtom(saveProjectThemeAtom)
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState(false)
  if (!project) return null

  const current = project.defaultTheme
  const described = describeReference(current, library)
  const status = statusOf(current, statuses)
  const ignored = ignoredPin(current, library)
  let summary = 'No default. Members see their own theme.'
  if (described) {
    const where = described.host && described.host !== described.name ? ` (${described.host})` : ''
    summary = `${described.name}${where}, ${described.mode}`
  } else if (current !== '') {
    summary = 'The saved default can’t be used. Members see their own theme.'
  }

  const run = async (reference: string) => {
    setSaving(true)
    try {
      await save(reference)
    } catch (err) {
      toastRPCError(err, 'Couldn’t save the default theme')
    } finally {
      setSaving(false)
      setArmed(false)
    }
  }

  return (
    <section>
      <SectionHeader title="Default theme" description="What members see in this project unless they pick their own" />
      <p className="text-sm">{summary}</p>
      {status && <FetchStatusLine status={status} />}
      {ignored && (
        <p className="mt-1 text-xs text-caution">
          Pinned to {ignored}, but the file has no {ignored} variant, so it follows each member’s mode.
        </p>
      )}
      <Can action="update" resource="project">
        <div className="mt-4 space-y-4">
          <ThemePicker
            shared
            followLabel="Follow each member’s mode"
            saveLabel="Save default theme"
            saving={saving}
            onSave={reference => void run(reference)}
          />
          {current !== '' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => (armed ? void run('') : setArmed(true))}
              onBlur={() => setArmed(false)}
              className={cn(armed && 'text-negative')}
            >
              {armed ? 'Clear the default?' : 'Clear default'}
            </Button>
          )}
        </div>
      </Can>
    </section>
  )
}

export default DefaultTheme
