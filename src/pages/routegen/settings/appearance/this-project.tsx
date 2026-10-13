import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import SectionHeader from '@/components/section-header'
import { Button } from '@/components/ui/button'
import {
  fetchStatusAtom,
  projectOverridesAtom,
  resolvableLibraryAtom,
  STORAGE_REFUSED,
  setProjectOverrideAtom,
  themeChoiceAtom,
} from '@/data/theme.atoms'
import { activeProjectAtom } from '@/data/workspace.atoms'
import ThemePicker from '@/pages/routegen/settings/theme-picker'
import { describeReference, statusOf } from '@/pages/routegen/settings/theme-status'
import type { LibraryEntry } from '@/theme/library'

const nameOf = (id: string, library: LibraryEntry[]) => library.find(entry => entry.id === id)?.name ?? id

// What this project looks like in this browser, and a way to make it look different here only. The
// project's default is the admins' (Settings → General); this choice is the member's, per project.
const ThisProject = () => {
  const project = useAtomValue(activeProjectAtom)
  const choice = useAtomValue(themeChoiceAtom)
  const library = useAtomValue(resolvableLibraryAtom)
  const overrides = useAtomValue(projectOverridesAtom)
  const statuses = useAtomValue(fetchStatusAtom)
  const setOverride = useSetAtom(setProjectOverrideAtom)
  if (!project) return null

  // A write the browser refused changed nothing — say so, or the click looks like it did nothing.
  const saved = (ok: boolean) => {
    if (!ok) toast.error(STORAGE_REFUSED)
  }
  const projectDefault = describeReference(project.defaultTheme, library)
  const defaultStatus = statusOf(project.defaultTheme, statuses)

  let summary = 'No project default, using your theme'
  if (choice.source === 'override') {
    summary = `Using ${nameOf(choice.selection.light, library)} in this project.`
  } else if (choice.source === 'project' && projectDefault) {
    summary = `Project default: ${projectDefault.name}, ${projectDefault.mode}`
  } else if (projectDefault && defaultStatus?.state === 'failed') {
    summary = 'Couldn’t load this project’s theme. Showing your theme instead.'
  } else if (projectDefault) {
    summary = 'Loading this project’s theme…'
  }

  return (
    <section>
      <SectionHeader title="This project" description={`${project.displayName}, in this browser`} />
      <p className="text-sm">{summary}</p>
      {Object.hasOwn(overrides, project.id) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => saved(setOverride({ projectId: project.id, reference: null }))}
        >
          {projectDefault ? 'Back to project default' : 'Back to your theme'}
        </Button>
      )}
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Use a different theme here</p>
        <ThemePicker
          urlId="project-theme-url"
          followLabel="Follow my mode"
          saveLabel="Use in this project"
          includeInstalled
          disclosure={false}
          saving={false}
          onSave={reference => saved(setOverride({ projectId: project.id, reference }))}
        />
      </div>
    </section>
  )
}

export default ThisProject
