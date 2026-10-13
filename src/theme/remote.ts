import { MAX_THEME_BYTES } from './format'
import { checkThemeText, type RemoteId, type TextCheck } from './library'
import { parsePastedUrl } from './reference'
import type { Polarity } from './tokens'

// Fetching a theme file named by URL. Members' browsers fetch a project's default straight from the host
// the admin chose — GitHub, a CDN, themes.pug.sh — so the request says nothing about the member, and the
// answer is untrusted: capped at the size an install allows and validated like one.

export type FetchFailure = 'network' | 'status' | 'too-large' | 'insecure' | 'timeout'
export type FetchResult = { ok: true; text: string } | { ok: false; reason: FetchFailure; status?: number }

/** How long a theme file may take, its answer and its body together. A host that stalls costs a member this, once. */
export const FETCH_TIMEOUT_MS = 10_000

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

// The global fetch, called as a plain function at request time — nothing at module scope.
const browserFetch: Fetcher = (url, init) => fetch(url, init)

// The body, up to MAX_THEME_BYTES. Anything longer is abandoned mid-stream, so a host answering with
// something huge costs a member at most the limit. Null when it was longer.
const readCapped = async (response: Response) => {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_THEME_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

// The request and its body. What the network does wrong is thrown; what the host answers is returned.
const fetchWithin = async (url: string, fetcher: Fetcher, signal: AbortSignal): Promise<FetchResult> => {
  const response = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', signal })
  if (response.url !== '' && !response.url.startsWith('https://')) return { ok: false, reason: 'insecure' }
  if (!response.ok) return { ok: false, reason: 'status', status: response.status }
  if (Number(response.headers.get('content-length')) > MAX_THEME_BYTES) return { ok: false, reason: 'too-large' }
  const text = await readCapped(response)
  if (text === null) return { ok: false, reason: 'too-large' }
  return { ok: true, text }
}

/**
 * GETs a theme file: no cookies, and no Referer, since dashboard URLs carry project and dashboard ids.
 * 'no-cache' revalidates through the HTTP cache, so an unchanged file costs a 304 and no body. The
 * content type is ignored: raw GitHub serves text/plain and jsDelivr application/octet-stream. A host that
 * stalls, before answering or partway through the body, is given up on after FETCH_TIMEOUT_MS.
 */
export const fetchThemeText = async (url: string, fetcher = browserFetch): Promise<FetchResult> => {
  if (!url.startsWith('https://')) return { ok: false, reason: 'insecure' }
  // An abort fails the request, or the body mid-read, the way a dropped connection would.
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetchWithin(url, fetcher, deadline.signal)
  } catch {
    // A CORS refusal looks exactly like a network failure from inside the page: the browser hides the response.
    return { ok: false, reason: deadline.signal.aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

export type PastedTheme =
  | { ok: true; url: RemoteId; pin?: Polarity; check: TextCheck }
  | { ok: false; reason: 'not-a-url' | FetchFailure | 'not-json'; status?: number }

type PastedFailure = Extract<PastedTheme, { ok: false }>

// Which failure says the most when every guess failed. A 404 on the folder guess shouldn't hide that the
// direct link was refused by CORS.
const TELLING: Record<PastedFailure['reason'], number> = {
  'not-a-url': 0,
  'not-json': 1,
  status: 2,
  timeout: 3,
  network: 4,
  'too-large': 5,
  insecure: 6,
}

const isJson = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Works out which file a pasted URL means: as written, else `<url>/theme.json`. The first answer that is
 * JSON is the file, checked like an install. Its errors block saving rather than send the search
 * further, so a broken theme is reported, not skipped.
 */
export const resolvePastedTheme = async (input: string, fetcher = browserFetch): Promise<PastedTheme> => {
  const pasted = parsePastedUrl(input)
  if (!pasted) return { ok: false, reason: 'not-a-url' }
  let failure: PastedFailure = { ok: false, reason: 'not-json' }
  for (const url of pasted.urls) {
    const fetched = await fetchThemeText(url, fetcher)
    let next: PastedFailure
    if (!fetched.ok) next = { ok: false, reason: fetched.reason, status: fetched.status }
    else if (!isJson(fetched.text)) next = { ok: false, reason: 'not-json' }
    else return { ok: true, url: url as RemoteId, pin: pasted.pin, check: checkThemeText(fetched.text) }
    if (TELLING[next.reason] >= TELLING[failure.reason]) failure = next
  }
  return failure
}
