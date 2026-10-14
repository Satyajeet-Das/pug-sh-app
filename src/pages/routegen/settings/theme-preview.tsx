import type { CompiledTheme } from '@/theme/compile'

// A theme drawn from its own compiled variant (canvas, a card, three inks, five data dots), so it can
// preview themes that aren't active.
const ThemePreview = ({ compiled }: { compiled: Pick<CompiledTheme, 'vars' | 'data'> }) => {
  const { vars, data } = compiled
  return (
    <span aria-hidden className="flex h-20 rounded-md p-2" style={{ background: vars['--background'] }}>
      <span className="flex flex-1 flex-col gap-1.5 rounded-sm p-2" style={{ background: vars['--card'] }}>
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: vars['--foreground'] }} />
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: vars['--muted-foreground'] }} />
        <span className="h-1.5 w-1/3 rounded-full" style={{ background: vars['--faint'] }} />
        <span className="mt-auto flex gap-1">
          {data.categorical.slice(0, 5).map((color, i) => (
            <span key={i} className="size-2 rounded-full" style={{ background: color.dot }} />
          ))}
        </span>
      </span>
    </span>
  )
}

export default ThemePreview
