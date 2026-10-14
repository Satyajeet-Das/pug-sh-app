import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeResponse } from '@/test/fake-response'
import { MAX_THEME_BYTES } from './format'
import { FETCH_TIMEOUT_MS, fetchThemeText, resolvePastedTheme } from './remote'

const URL1 = 'https://themes.pug.sh/linen/theme.json'
const grape = JSON.stringify({ version: 1, name: 'Grape', variants: { dark: { colors: { background: '#1e1b2e' } } } })

describe('fetchThemeText', () => {
  it('sends no cookies and no referrer, and revalidates', async () => {
    const fetcher = vi.fn(async () => fakeResponse('{}'))
    await fetchThemeText(URL1, fetcher)
    expect(fetcher).toHaveBeenCalledWith(URL1, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-cache',
      signal: expect.any(AbortSignal),
    })
  })

  // Raw GitHub serves text/plain and jsDelivr application/octet-stream.
  it('reads the body whatever the content type says', async () => {
    const fetcher = async () => fakeResponse('{"a":1}', { headers: { 'content-type': 'application/octet-stream' } })
    expect(await fetchThemeText(URL1, fetcher)).toEqual({ ok: true, text: '{"a":1}' })
  })

  it('refuses http without fetching', async () => {
    const fetcher = vi.fn()
    expect(await fetchThemeText('http://themes.pug.sh/x.json', fetcher)).toEqual({ ok: false, reason: 'insecure' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses a redirect that ended on http', async () => {
    const fetcher = async () => fakeResponse('{}', { url: 'http://themes.pug.sh/x.json' })
    expect(await fetchThemeText(URL1, fetcher)).toEqual({ ok: false, reason: 'insecure' })
  })

  it('reports the status of an answer that isn’t the file', async () => {
    expect(await fetchThemeText(URL1, async () => fakeResponse('', { status: 404 }))).toEqual({
      ok: false,
      reason: 'status',
      status: 404,
    })
  })

  // What a CORS refusal looks like from inside the page: the browser hides the response.
  it('reports a network failure', async () => {
    const fetcher = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await fetchThemeText(URL1, fetcher)).toEqual({ ok: false, reason: 'network' })
  })

  it('refuses a declared length over the limit without reading the body', async () => {
    const getReader = vi.fn()
    const response = {
      ok: true,
      status: 200,
      url: URL1,
      headers: new Headers({ 'content-length': String(MAX_THEME_BYTES + 1) }),
      body: { getReader },
    } as unknown as Response
    expect(await fetchThemeText(URL1, async () => response)).toEqual({ ok: false, reason: 'too-large' })
    expect(getReader).not.toHaveBeenCalled()
  })

  it('abandons a body that runs past the limit', async () => {
    const cancel = vi.fn()
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20))
      },
      cancel,
    })
    const response = { ok: true, status: 200, url: URL1, headers: new Headers(), body: endless } as unknown as Response
    expect(await fetchThemeText(URL1, async () => response)).toEqual({ ok: false, reason: 'too-large' })
    expect(cancel).toHaveBeenCalled()
  })

  // A host can take the connection and then say nothing, or trickle. Either is given up on at the
  // deadline and reported as slow rather than as a CORS refusal.
  describe('from a host that stalls', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    // What fetch does with an aborted signal: it rejects the request, or errors a body still arriving.
    const aborted = () => new DOMException('The operation was aborted.', 'AbortError')

    it('gives up waiting for an answer', async () => {
      const fetcher = (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(aborted())))
      const result = fetchThemeText(URL1, fetcher)
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
      await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' })
    })

    it('gives up on a body that never ends', async () => {
      const fetcher = async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"version":1,'))
            init.signal?.addEventListener('abort', () => controller.error(aborted()))
          },
        })
        return { ok: true, status: 200, url: URL1, headers: new Headers(), body } as unknown as Response
      }
      const result = fetchThemeText(URL1, fetcher)
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
      await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' })
    })
  })
})

describe('resolvePastedTheme', () => {
  it('uses a direct link as written, with its pin', async () => {
    const fetcher = vi.fn(async () => fakeResponse(grape))
    const result = await resolvePastedTheme('https://raw.githubusercontent.com/acme/brand/main/pug.json#dark', fetcher)
    expect(result).toMatchObject({
      ok: true,
      url: 'https://raw.githubusercontent.com/acme/brand/main/pug.json',
      pin: 'dark',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('tries the repository folder when the URL isn’t a file', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/theme.json') ? fakeResponse(grape) : fakeResponse('<!doctype html>'),
    )
    expect(await resolvePastedTheme('themes.pug.sh/grape', fetcher)).toMatchObject({
      ok: true,
      url: 'https://themes.pug.sh/grape/theme.json',
    })
  })

  // A broken theme is reported, not skipped for the next guess.
  it('reports a broken theme rather than looking further', async () => {
    const fetcher = vi.fn(async () => fakeResponse('{"version":1,"name":"Broken","variants":{}}'))
    expect(await resolvePastedTheme('https://example.com/broken.json', fetcher)).toMatchObject({
      ok: true,
      check: { ok: false },
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports the most telling failure', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/theme.json')) return fakeResponse('', { status: 404 })
      throw new TypeError('Failed to fetch')
    })
    expect(await resolvePastedTheme('https://cdn.example.com/brand.json', fetcher)).toEqual({
      ok: false,
      reason: 'network',
    })
  })

  it('says a page isn’t a theme file rather than report the folder guess’s 404', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/theme.json') ? fakeResponse('', { status: 404 }) : fakeResponse('<!doctype html>'),
    )
    expect(await resolvePastedTheme('https://acme.dev/themes/linen', fetcher)).toEqual({
      ok: false,
      reason: 'not-json',
    })
  })

  it('refuses what can’t be an https URL', async () => {
    expect(await resolvePastedTheme('http://example.com/x.json', vi.fn())).toEqual({ ok: false, reason: 'not-a-url' })
  })
})
