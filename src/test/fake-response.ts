// A Response with only what theme/remote.ts reads. A real one's url can't be set, and its body depends on
// the environment's stream support.
export const fakeResponse = (
  body: string,
  { status = 200, headers = {}, url = '' }: { status?: number; headers?: Record<string, string>; url?: string } = {},
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(headers),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
  }) as unknown as Response
