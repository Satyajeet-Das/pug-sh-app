import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The inline first-paint script from index.html — the one piece of theming that executes before any
// module loads — so tests run the real one rather than a copy.
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

export const PAINT_SCRIPT = html.match(/<script>\s*(\/\/ Paint the stored theme[\s\S]*?)<\/script>/)?.[1] ?? ''

export const runPaintScript = () => new Function(PAINT_SCRIPT)()
