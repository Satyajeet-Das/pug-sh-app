import type { Issue } from '@/theme/format'

// What a file's warnings are about. An ignored key is not a contrast problem: telling someone a
// file with a typo'd key "may be hard to read" installs it as a copy of Pug.
export const warningSummary = (issues: Issue[]) => {
  const lines: string[] = []
  if (issues.some(issue => issue.rule !== 'V12')) {
    lines.push('This theme has warnings. It still works, but some colours may be hard to read.')
  }
  if (issues.some(issue => issue.rule === 'V12')) lines.push('Parts of this file were ignored. They’re listed below.')
  return lines.join(' ')
}

export const IssueList = ({ issues }: { issues: Issue[] }) => (
  <ul className="space-y-1 text-xs">
    {issues.map((issue, i) => (
      <li key={i} className={issue.severity === 'error' ? 'text-negative' : 'text-caution'}>
        {issue.path && <span className="font-mono">{issue.path}: </span>}
        {issue.message}
      </li>
    ))}
  </ul>
)
