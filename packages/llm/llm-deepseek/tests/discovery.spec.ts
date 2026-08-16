import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'

const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in provider answering scripted `GET /models` calls. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */
async function listingServer(behavior: {
  status?: number
  body?: string
  chunks?: string[]
  holdOpenMs?: number
}): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    if (behavior.chunks !== undefined) {
      // No declared length: the ceiling has to hold on what is read.
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      for (const chunk of behavior.chunks) response.write(chunk)
      if (behavior.holdOpenMs === undefined) { response.end(); return }
      // Left open so a caller's cancellation lands while the body is still
      // being read rather than after it completed.
      setTimeout(() => { response.end() }, behavior.holdOpenMs)
      return
    }
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

/** The plugin mounted with a stored key in the environment. */
async function harness(config: LlmDeepSeek.Config = {}): Promise<Context> {
  // Configuration carries only the reference; the key comes from the
  // environment, which is the whole credential plane without a mounted seam.
  vi.stubEnv('DEEPSEEK_API_KEY', 'stored-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, config)
  return ctx
}

describe('catalog answer', () => {
  it('answers the own route from its configured catalog without a network call', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'from-the-endpoint' }] }) })
    const ctx = await harness({ baseURL: server.url })

    const models = await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' })

    expect(models).toEqual([
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
    ])
    expect(server.paths).toEqual([])
  })

  it('maps only the catalog fields an entry carries', async () => {
    const ctx = await harness({
      models: [
        { id: 'full', name: 'Full', contextWindow: 1000, maxTokens: 100 },
        { id: 'bare' },
      ],
    })

    expect(await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' })).toEqual([
      { id: 'full', name: 'Full', contextWindow: 1000, maxTokens: 100 },
      { id: 'bare' },
    ])
  })
})

describe('endpoint interrogation', () => {
  it('validates a key with a live round-trip even for the own route', async () => {
    // The check-key action: the configured catalog cannot say whether the key
    // works, so `validate` always pays the round-trip.
    const server = await listingServer({
      body: JSON.stringify({ data: [{ id: 'from-the-endpoint' }] }),
    })
    const ctx = await harness({ baseURL: 'http://127.0.0.1:9' })

    const models = await ctx.llm.discoverModels('llm-deepseek', {
      provider: 'deepseek-official',
      baseURL: server.url,
      apiKey: 'probe-key',
      validate: true,
    })

    expect(models).toEqual([{ id: 'from-the-endpoint' }])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('resolves the stored credential when the draft carries none, and lets a typed key win', async () => {
    // What the Models page sends after a key is saved: the form holds the
    // redacted descriptor, so the draft names no credential at all and the
    // interrogation resolves the route's own reference rather than going out
    // unauthenticated and reporting the endpoint's 401 as a wrong key.
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await harness({ baseURL: server.url })

    await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official', validate: true })
    // A key typed into the form is the one being tested — possibly the
    // replacement for exactly the stored key that is failing — so it wins.
    await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official', validate: true, apiKey: 'typed' })

    expect(server.headers.map(headers => headers.authorization))
      .toEqual(['Bearer stored-key', 'Bearer typed'])
  })

  it('falls back to the configured endpoint when the draft names none, or an empty one', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await harness({ baseURL: server.url })

    // The seam requires a named route or endpoint; naming the route is enough,
    // and the interrogation falls back to the configured endpoint.
    await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official', validate: true, apiKey: 'k' })
    // A cleared endpoint field means "the configured endpoint", not a refusal.
    await ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official', baseURL: '', validate: true, apiKey: 'k' })

    expect(server.paths).toEqual(['/models', '/models'])
  })

  it('interrogates an arbitrary draft endpoint, keeping a deployment path', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    const ctx = await harness()

    await ctx.llm.discoverModels('llm-deepseek', { baseURL: `${server.url}/deepseek/v1/`, apiKey: 'k' })

    expect(server.paths).toEqual(['/deepseek/v1/models'])
  })

  it('parses the OpenAI listing, keeping disclosed names and dropping unusable rows', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'deepseek-v4-flash', object: 'model', created: 1, owned_by: 'deepseek' },
          { id: 'named', display_name: 'Named' },
          { id: 'also-named', name: 'Also Named' },
          { id: '' },
          { display_name: 'no id at all' },
          null,
        ],
      }),
    })
    const ctx = await harness()

    expect(await ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url, apiKey: 'k' })).toEqual([
      { id: 'deepseek-v4-flash' },
      { id: 'named', name: 'Named' },
      { id: 'also-named', name: 'Also Named' },
    ])
  })

  it('points at the credential for a rejected one, and only then', async () => {
    const ctx = await harness()

    for (const status of [401, 403]) {
      const refused = await listingServer({ status, body: '{"error":"nope"}' })
      await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: refused.url, validate: true }))
        .rejects.toThrow(new RegExp(`answered ${status}; check the API key`))
    }

    // A server fault is not a credential problem, so it must not send the user
    // off to re-check a key that is fine.
    const broken = await listingServer({ status: 500, body: '{"error":"boom"}' })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: broken.url, validate: true }))
      .rejects.toThrow(/answered 500$/)
  })

  it('reports a reply that is not a model listing', async () => {
    const server = await listingServer({ body: '{"models":[]}' })
    const ctx = await harness()

    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: server.url, validate: true }))
      .rejects.toThrow(/no "data" array; enter this provider's models by hand/)

    const broken = await listingServer({ body: 'not json at all' })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: broken.url, validate: true }))
      .rejects.toThrow(/did not answer with JSON/)
  })

  it('refuses an oversized reply, whether its length is declared or streamed', async () => {
    const ctx = await harness()
    // Just over the four-megabyte ceiling, as one padded model row.
    const oversized = `{"data":[{"id":"m","pad":"${'x'.repeat(4 * 1024 * 1024)}"}]}`

    const declared = await listingServer({ body: oversized })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: declared.url, validate: true }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)

    // A streamed reply declares no length, so the ceiling has to hold on the
    // body the harness actually read.
    const streamed = await listingServer({ chunks: ['{"data":[{"id":"m","pad":"', 'x'.repeat(4 * 1024 * 1024), '"}]}'] })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: streamed.url, validate: true }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)
  })

  it('reports an unreachable endpoint instead of an empty catalog', async () => {
    const ctx = await harness()
    // Port 9 is the discard service: nothing accepts a connection there.
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'http://127.0.0.1:9', validate: true }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'http://127.0.0.1:9', validate: true }))
      .rejects.toThrow(/^could not reach /)
  })

  it('fails with MISSING_CREDENTIAL when no key is configured anywhere', async () => {
    // An empty environment entry is no credential: the stored-key resolution
    // fails loud naming every configuration entry point.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {})

    await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official', validate: true }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('reports a blank or illegal probe key as a credential fault, not an unreachable endpoint', async () => {
    const ctx = await harness()

    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'https://acme.test', apiKey: '' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'https://acme.test', apiKey: 'sk-\u{1F600}' }))
      .rejects.toThrow(/no HTTP header/)
    // '' is judged as the empty key it is; only an absent apiKey falls
    // through to the stored credential.
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'https://acme.test', apiKey: '' }))
      .rejects.toThrow(/blank/)
  })

  it('reports cancellation during the body read as an abort, not a raw reason', async () => {
    const ctx = await harness()
    const controller = new AbortController()
    const bodyRead = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyRead.resolve(undefined)
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              stream.error(signal.reason)
              resolve()
            }, { once: true })
          })
        },
      }))
    })
    const probe = ctx.llm.discoverModels('llm-deepseek', {
      baseURL: 'https://slow.example',
      validate: true,
      signal: controller.signal,
    })
    await bodyRead.promise
    controller.abort('test cancellation')

    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('honors caller cancellation', async () => {
    const ctx = await harness()
    const aborted = AbortSignal.abort('test cancellation')
    await expect(ctx.llm.discoverModels('llm-deepseek', {
      baseURL: 'http://127.0.0.1:9',
      validate: true,
      signal: aborted,
    })).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('withdraws the offer when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmDeepSeek, {})
    await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
      .resolves.not.toHaveLength(0)

    await fiber.dispose()

    await expect(ctx.llm.discoverModels('llm-deepseek', { provider: 'deepseek-official' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
  })
})
