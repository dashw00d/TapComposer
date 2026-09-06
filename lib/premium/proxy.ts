export interface PremiumConfig {
  enabled: boolean;
  origin?: string;
  token?: string;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
/** The demo entitlement is server-controlled. No inference secret reaches client code. */
export async function premiumRequest(
  request: Request,
  config: PremiumConfig,
  upstream: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\/premium\//, '');
  const configured = config.enabled && !!config.origin && !!config.token;
  if (path === 'status' && request.method === 'GET') {
    if (!configured) return json({ premium: false, ready: false });
    try {
      const response = await upstream(new URL('/health', config.origin), {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(5000),
      });
      const status = (await response.json()) as {
        ready?: boolean;
        queued?: number;
      };
      return json({
        premium: true,
        ready: response.ok && status.ready === true,
        queued: status.queued ?? 0,
      });
    } catch {
      return json({ premium: true, ready: false });
    }
  }
  if (!configured)
    return json(
      { error: 'Premium rendering is not enabled for this account.' },
      403,
    );
  const render = path === 'render' && request.method === 'POST';
  const job =
    /^jobs\/[a-f0-9-]{36}(?:\/audio)?$/.test(path) && request.method === 'GET';
  if (!render && !job) return json({ error: 'Not found.' }, 404);
  if (render) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin)
      return json({ error: 'Use the song studio to start a render.' }, 403);
    if (Number(request.headers.get('Content-Length') ?? 0) > 40 * 1024 * 1024)
      return json(
        {
          error:
            'This arrangement is too large. Keep the demo under three minutes.',
        },
        413,
      );
    if (!request.headers.get('Content-Type')?.startsWith('audio/wav'))
      return json({ error: 'Send an audio arrangement.' }, 400);
  }
  try {
    const headers = new Headers({ Authorization: `Bearer ${config.token}` });
    if (render) {
      headers.set('Content-Type', 'audio/wav');
      const metadata = request.headers.get('X-TapComposer-Arrangement');
      if (!metadata || metadata.length > 12000)
        return json({ error: 'Include valid arrangement settings.' }, 400);
      headers.set('X-TapComposer-Arrangement', metadata);
    }
    const response = await upstream(
      new URL(render ? '/jobs' : '/' + path, config.origin),
      {
        method: request.method,
        headers,
        body: render ? request.body : undefined,
        signal: AbortSignal.timeout(render ? 60000 : 20000),
        // Streaming avoids buffering the audio in the hosted Worker.
        ...(render ? { duplex: 'half' } : {}),
      },
    );
    if (!response.ok && response.status >= 500)
      return json(
        {
          error:
            'The studio is temporarily unavailable. Your original song is safe; try again shortly.',
        },
        503,
      );
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return json(
      {
        error:
          'The studio could not be reached. Your song is still saved here.',
      },
      503,
    );
  }
}
