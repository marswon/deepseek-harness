/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" and "check this key" actions on the
 * `deepseek-official` route.
 *
 * The route's own configured catalog answers without a network call, the same
 * posture the pi-ai twin takes for its catalog routes: the adapter's registry
 * is the better answer, and it costs nothing. A request carrying
 * `validate: true` is the exception — it asks whether the *key* works, which
 * only a live authenticated round-trip can answer, so the endpoint is always
 * interrogated: `GET {baseURL}/models`, OpenAI-compatible, bearer key. The
 * base URL defaults to the configured connection's, which itself defaults to
 * the public API, so a cleared endpoint field still validates against the
 * right host.
 *
 * Neither path stores anything: the request carries a draft the user is still
 * editing, and the reply is candidate metadata the surface offers for
 * adoption.
 *
 * The structure mirrors `dsh-llm-pi-ai`'s discovery module — same byte
 * ceiling, same abort discipline, same error taxonomy — copied rather than
 * shared because that package keeps its discovery package-internal.
 *
 * @module dsh-llm-deepseek/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { DeepSeekCatalogModel } from './adapter.ts'

/**
 * Endpoint replies larger than this are refused; see the pi-ai module this
 * mirrors. The endpoint may be a URL the user typed, so the ceiling holds on
 * the bytes actually read, and an unparseable overflow rejects rather than
 * truncates.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from DeepSeek's own listing. */
  name?: unknown
  display_name?: unknown
}

/* jscpd:ignore-start -- deliberate mirror of dsh-llm-pi-ai's discovery plumbing
   (label/listingUrl/readBounded/readListing); that module is package-internal,
   and the task split keeps each adapter's interrogation self-contained rather
   than widening a public API to share it. */

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the listing path. The base is treated as a
 * prefix rather than a URL to resolve against, so a deployment path such as
 * `https://gateway.example/deepseek/v1` keeps its segments instead of losing
 * them to `URL` resolution.
 */
function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one OpenAI-compatible listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
function readListing(body: unknown): LlmDiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of data) {
    const entry = raw as ListingEntry | null
    const id = label(entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name)
    models.push({
      id,
      ...name === undefined ? {} : { name },
    })
  }
  return models
}

/* jscpd:ignore-end */

/**
 * The facts an interrogation reads from the plugin's resolved configuration,
 * as thunks so each operation re-reads the current snapshot — the same
 * per-operation resolution the adapter itself uses.
 */
export interface DeepSeekDiscoverySource {
  /** The provider route this plugin owns (`deepseek-official`). */
  route: string
  /** The route's configured catalog, for the network-free answer. */
  catalog: () => readonly DeepSeekCatalogModel[]
  /** The configured endpoint, already defaulted to the public API. */
  baseURL: () => string
  /**
   * The credential the route already resolves, asked for only when the draft
   * carries none and only on the path that reaches the network. A
   * configuration surface never holds a stored secret — it edits a redacted
   * descriptor — so without this an already-configured route would be
   * interrogated unauthenticated and answer 401. Throws
   * `LlmError('MISSING_CREDENTIAL')` when no key is configured anywhere.
   */
  storedApiKey: () => Promise<string>
}

/**
 * Interrogate the provider endpoint for the models it advertises.
 * @param request - the draft: route, optional endpoint override, one-shot
 *   credential, whether a live authenticated round-trip is required, and the
 *   operation's cancellation.
 * @param source - the plugin's resolved configuration facts.
 * @returns the advertised (or configured, on the catalog answer) models.
 * @throws LlmError when the endpoint refuses or fails the request, or the
 *   reply is not a model listing.
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  source: DeepSeekDiscoverySource,
): Promise<readonly LlmDiscoveredModel[]> {
  // The configured catalog already has the answer for this plugin's own
  // route — unless the caller asked to validate the key, which the registry
  // cannot speak for.
  if (request.provider === source.route && request.validate !== true) {
    return source.catalog().map(model => ({
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }))
  }
  // An empty baseURL is a cleared form field: validate against the configured
  // endpoint, not against nothing.
  const baseURL = request.baseURL !== undefined && request.baseURL.length > 0
    ? request.baseURL
    : source.baseURL()
  const url = listingUrl(baseURL)
  // A key typed into the form wins: it is the one the user is testing, and it
  // may be the replacement for exactly the stored key that is failing. The
  // stored one is only asked for here, past the catalog short-circuit, so the
  // registry answer costs no credential lookup.
  const supplied = request.apiKey ?? await source.storedApiKey()
  const checked = normalizeApiKey(supplied)
  if (!checked.ok) {
    throw new LlmError(
      checked.reason === 'empty'
        ? 'this provider\'s API key is blank; enter it on the Models page first'
        : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
      INVALID_CREDENTIAL_CODE,
    )
  }
  let response: Response
  /* jscpd:ignore-start -- same deliberate mirror: the pi-ai discovery module's
     fetch/classify tail, kept self-contained per adapter. */
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${checked.value}`,
        ...attributionHeaders(),
      },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  /* jscpd:ignore-end */
  return readListing(body)
}
