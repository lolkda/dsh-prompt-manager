/**
 * The browser-facing half of the prompt store: one prefix route carrying the
 * body files the settings page edits.
 *
 * Bodies cannot ride the settings transport, because they are markdown files a
 * person also edits directly. This route is therefore the only write path from
 * the page, and it is fenced twice: loopback peers only, and same-origin
 * requests only for anything that mutates. A stale editor is refused with 409
 * through the hash the page read, so two open drafts cannot silently overwrite
 * each other.
 *
 * @module dsh-prompt-manager/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ResolvedBody } from './entries.js'
import { DEFAULT_SOURCE_REF, MAX_BODY_BYTES } from './entries.js'
import { bodyHash, PromptStore, PromptStoreError } from './store.js'
import { isRepo, isRef, isSourceId, MAX_SOURCES, normalizeMirror, sourceSlug } from './source.js'
import { CheckError } from './sync.js'
import { FetchFailure } from './net.js'
import type { Subscriptions } from './subscriptions.js'

/** The single prefix every route below lives under. */
export const ROUTE_PREFIX = '/prompt-manager'

/** Slack over the body limit for JSON escaping overhead. */
const READ_LIMIT = MAX_BODY_BYTES * 2 + 8192

/** Largest accepted title on the id-allocation route. */
const TITLE_LIMIT = 4096

/** The `webServer` service slice this module registers with. */
interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** What the route needs from the plugin that owns the index. */
export interface PromptRouteHost {
  /** Body files. */
  store: PromptStore
  /** Effective body for one entry, whichever layer supplies it. */
  describe(id: string): ResolvedBody
  /** Allocate an unused entry id for a new title. */
  idFor(title: string): string
  /** Report a non-fatal problem. */
  warn(message: string): void
  /** The subscription engine, for the source routes. */
  subscriptions: Subscriptions
}

/**
 * Register the prompt-store route.
 *
 * A composition without a web server (the TUI and SDK profiles) simply gets no
 * route; the settings page then reports the store as unreachable.
 *
 * @param ctx - the plugin context whose `webServer` service is injected.
 * @param host - body resolution, id allocation, and logging.
 */
export function installPromptRoutes(ctx: Context, host: PromptRouteHost): void {
  ctx.inject(['webServer'], (scoped) => {
    const webServer = (scoped as unknown as { webServer?: WebServerFace }).webServer
    if (webServer === undefined) return
    try {
      const off = webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: createHandler(host) })
      ctx.effect(() => off, 'prompt-manager: prompt store route')
    } catch (error) {
      host.warn(`cannot register ${ROUTE_PREFIX}: ${messageOf(error)}`)
    }
  })
}

/**
 * Build the request handler.
 * @param host - body resolution, id allocation, and logging.
 * @returns the handler registered on {@link ROUTE_PREFIX}.
 */
function createHandler(host: PromptRouteHost): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    try {
      if (!isLoopback(request)) {
        sendJson(response, 403, { error: 'the prompt store is reachable from loopback clients only' })
        return
      }
      const method = request.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
        sendJson(response, 403, { error: 'cross-origin writes are refused' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const rest = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
      const slash = rest.indexOf('/')
      const head = slash < 0 ? rest : rest.slice(0, slash)
      const tail = slash < 0 ? '' : rest.slice(slash + 1)

      if (head === 'status' && method === 'GET') {
        sendJson(response, 200, host.store.status())
        return
      }
      if (head === 'id' && method === 'POST') {
        const payload = asRecord(await readJsonBody(request))
        const title = typeof payload?.['title'] === 'string' ? payload['title'] : ''
        if (title.trim().length === 0) {
          sendJson(response, 400, { error: 'title must be a non-empty string' })
          return
        }
        sendJson(response, 200, { id: host.idFor(title.slice(0, TITLE_LIMIT)) })
        return
      }
      if (head === 'body' && tail.length > 0) {
        await handleBody(host, method, decodeId(tail), request, response)
        return
      }
      if (head === 'sources') {
        await handleSources(host, method, tail, request, response)
        return
      }
      sendJson(response, 404, { error: 'unknown prompt route' })
    } catch (error) {
      handleFailure(host, error, response)
    }
  }
}

/**
 * Serve the source routes: list, add, check, apply, revert, and forget a source.
 *
 * @param host - the subscription engine.
 * @param method - HTTP method of the request.
 * @param tail - everything after `sources/`: empty, `<slug>`, or `<slug>/<action>`.
 * @param request - the request, read for a JSON body on add and apply.
 * @param response - the response to answer on.
 */
async function handleSources(
  host: PromptRouteHost,
  method: string,
  tail: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (tail.length === 0) {
    if (method === 'POST') {
      await handleSourceCreate(host, request, response)
      return
    }
    if (method !== 'GET') {
      sendJson(response, 405, { error: `method ${method} is not allowed on the source list` })
      return
    }
    sendJson(response, 200, { sources: host.subscriptions.list() })
    return
  }
  const slash = tail.indexOf('/')
  const slug = decodeId(slash < 0 ? tail : tail.slice(0, slash))
  const action = slash < 0 ? '' : tail.slice(slash + 1)
  if (slug === undefined || !isSourceId(slug)) {
    sendJson(response, 400, { error: 'the source id is not a valid slug' })
    return
  }
  if (method === 'DELETE' && action.length === 0) {
    sendJson(response, 200, await host.subscriptions.remove(slug))
    return
  }
  if (method === 'POST' && action === 'check') {
    sendJson(response, 200, await host.subscriptions.check(slug))
    return
  }
  if (method === 'POST' && action === 'apply') {
    const payload = asRecord(await readJsonBody(request))
    const raw = payload?.['files']
    const files = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : undefined
    sendJson(response, 200, await host.subscriptions.apply(slug, files))
    return
  }
  if (method === 'POST' && action === 'revert') {
    sendJson(response, 200, await host.subscriptions.revert(slug))
    return
  }
  sendJson(response, 405, { error: `unsupported source route: ${method} ${action}` })
}

/**
 * Validate a repository the settings page wants to subscribe to, and hand back
 * the slug no other source holds.
 *
 * The page stays the writer — sources ride the same settings namespace as the
 * entry index, and the page already writes that — so this route contributes the
 * two things the page cannot work out on its own: a slug that is still free, and
 * the shape checks a hand-typed repository, ref, and mirror need before the
 * engine turns them into outbound requests.
 *
 * @param host - the subscription engine, consulted for the sources in force.
 * @param request - the request, read for its JSON body.
 * @param response - the response to answer on.
 */
async function handleSourceCreate(
  host: PromptRouteHost,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const payload = asRecord(await readJsonBody(request))
  if (payload === undefined) {
    sendJson(response, 400, { error: 'the request body must be a JSON object', code: 'invalid-body' })
    return
  }

  const repo = typeof payload['repo'] === 'string' ? payload['repo'].trim() : ''
  if (!isRepo(repo)) {
    sendJson(response, 400, {
      error: `repo must be owner/name, got ${JSON.stringify(payload['repo'] ?? null)}`,
      code: 'invalid-repo',
    })
    return
  }

  const rawRef = payload['ref']
  const ref = rawRef === undefined || rawRef === null || (typeof rawRef === 'string' && rawRef.trim().length === 0)
    ? DEFAULT_SOURCE_REF
    : typeof rawRef === 'string'
      ? rawRef.trim()
      : undefined
  if (ref === undefined || !isRef(ref)) {
    sendJson(response, 400, {
      error: `ref must be a branch, tag, or commit, got ${JSON.stringify(rawRef ?? null)}`,
      code: 'invalid-ref',
    })
    return
  }

  const rawMirror = payload['mirror']
  if (rawMirror !== undefined && rawMirror !== null && typeof rawMirror !== 'string') {
    sendJson(response, 400, { error: 'mirror must be a string when present', code: 'invalid-mirror' })
    return
  }
  const mirror = normalizeMirror(typeof rawMirror === 'string' ? rawMirror : '')
  if (mirror === undefined) {
    sendJson(response, 400, {
      error: 'mirror must be an https origin without credentials, query, or fragment',
      code: 'invalid-mirror',
    })
    return
  }

  const configured = host.subscriptions.list()
  const duplicate = configured.find((source) => source.repo === repo && source.ref === ref)
  if (duplicate !== undefined) {
    sendJson(response, 409, {
      error: `${repo}@${ref} is already subscribed as ${duplicate.id}`,
      code: 'duplicate-source',
    })
    return
  }
  if (configured.length >= MAX_SOURCES) {
    sendJson(response, 409, {
      error: `at most ${String(MAX_SOURCES)} sources are supported`,
      code: 'too-many-sources',
    })
    return
  }

  sendJson(response, 200, {
    id: slugFor(repo, configured.map((source) => source.id)),
    repo,
    ref,
    mirror,
  })
}

/**
 * Allocate a source slug no configured source holds.
 * @param repo - a validated `owner/name`.
 * @param taken - slugs already in force.
 * @returns a slug inside the source-id grammar, at most 64 characters.
 */
function slugFor(repo: string, taken: readonly string[]): string {
  const base = sourceSlug(repo)
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 60)}-${String(suffix)}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 50)}-${String(Date.now())}`
}

/**
 * Serve one entry's body: read, write, or restore the bundled default.
 * @param host - body resolution and the store.
 * @param method - HTTP method of the request.
 * @param id - decoded entry id.
 * @param request - the request, read for a JSON body on PUT.
 * @param response - the response to answer on.
 */
async function handleBody(
  host: PromptRouteHost,
  method: string,
  id: string | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (id === undefined) {
    sendJson(response, 400, { error: 'the entry id is not a valid id' })
    return
  }
  if (method === 'GET') {
    sendJson(response, 200, viewOf(host, id))
    return
  }
  if (method === 'PUT') {
    if (host.describe(id).source === 'subscribed') {
      sendJson(response, 403, { error: 'a subscribed body is read-only; fork it into a local entry first' })
      return
    }
    const payload = asRecord(await readJsonBody(request))
    const body = typeof payload?.['body'] === 'string' ? payload['body'] : undefined
    if (body === undefined) {
      sendJson(response, 400, { error: 'body must be a string' })
      return
    }
    const fence = payload?.['fileSha1']
    if (fence !== undefined && fence !== null && typeof fence !== 'string') {
      sendJson(response, 400, { error: 'fileSha1 must be a string when present' })
      return
    }
    host.store.write(id, body, fence === undefined || fence === null
      ? { kind: 'absent' }
      : { kind: 'sha1', sha1: fence })
    sendJson(response, 200, viewOf(host, id))
    return
  }
  if (method === 'DELETE') {
    const removed = host.store.remove(id)
    sendJson(response, 200, { ...viewOf(host, id), removed })
    return
  }
  sendJson(response, 405, { error: `method ${method} is not allowed on a prompt body` })
}

/**
 * The page's view of one entry body.
 * @param host - body resolution and the store.
 * @param id - entry id.
 * @returns effective body, its source and hash, and the override file's hash when present.
 */
function viewOf(host: PromptRouteHost, id: string): {
  id: string
  body: string
  source: ResolvedBody['source']
  sha1: string
  fileSha1: string | null
} {
  const described = host.describe(id)
  const stored = host.store.has(id) ? host.store.read(id) : undefined
  return {
    id,
    body: described.text,
    source: described.source,
    sha1: hashOf(described.text),
    fileSha1: stored?.sha1 ?? null,
  }
}

/**
 * sha1 of a body, mirroring {@link PromptStore.read}.
 * @param body - the body to hash.
 * @returns a lowercase hex digest.
 */
function hashOf(body: string): string {
  return bodyHash(body)
}

/** Report a failed request with the status its reason deserves. */
function handleFailure(host: PromptRouteHost, error: unknown, response: ServerResponse): void {
  if (error instanceof PromptStoreError) {
    const status = error.code === 'conflict' ? 409 : error.code === 'invalid-id' || error.code === 'too-large' ? 400 : 500
    sendJson(response, status, { error: error.message, code: error.code })
    return
  }
  if (error instanceof CheckError) {
    const status = error.reason === 'unknown-source'
      ? 404
      : error.reason === 'nothing-staged'
        ? 409
        : error.reason === 'manifest'
          ? 422
          : error.reason === 'mirror' || error.reason === 'network'
            ? 502
            : 400
    sendJson(response, status, { error: error.message, code: error.reason })
    return
  }
  if (error instanceof FetchFailure) {
    sendJson(response, 502, { error: error.message, code: error.reason })
    return
  }
  host.warn(`prompt route failed: ${messageOf(error)}`)
  sendJson(response, 500, { error: messageOf(error) })
}

/**
 * Loopback-peer check: the prompt store is a local file surface.
 * @param request - the incoming request.
 * @returns `true` when the peer address is the local machine.
 */
function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

/**
 * Same-origin check for mutating routes.
 * @param request - the incoming request.
 * @returns `true` when the Origin header names the Host.
 */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Read a JSON request body under the route's own size limit.
 * @param request - the incoming request.
 * @returns the parsed JSON value, or `undefined` when the body is not JSON.
 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > READ_LIMIT) throw new PromptStoreError('too-large', `request body is ${String(size)} bytes; the limit is ${String(READ_LIMIT)}`)
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new PromptStoreError('invalid-id', 'request body is not valid JSON')
  }
}

/**
 * Narrow a parsed JSON value to a record.
 * @param value - the parsed value.
 * @returns the record, or `undefined` when the value is not a plain object.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Percent-decode one path segment.
 * @param segment - the raw segment.
 * @returns the decoded id, or `undefined` when decoding fails.
 */
function decodeId(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/** Write a JSON payload with no-store caching. */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Message text of an unknown thrown value.
 * @param error - the caught value.
 * @returns a human-facing message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
