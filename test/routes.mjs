#!/usr/bin/env node
/**
 * Route test: the `/prompt-manager` prefix route the settings page edits bodies
 * through.
 *
 * The handler is driven directly with fake request and response objects, so the
 * test covers what the browser cannot be trusted to decide: the loopback gate,
 * same-origin enforcement on writes, path and id validation, the optimistic
 * write fence, and the status codes each failure earns.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installPromptRoutes, ROUTE_PREFIX } from '../lib/routes.js'
import { PromptStore } from '../lib/store.js'
import { entryIdFor } from '../lib/entries.js'
import { MAX_SOURCES } from '../lib/source.js'
import { CheckError } from '../lib/sync.js'

/** Throwaway root for the whole run. */
const ROOT = mkdtempSync(join(tmpdir(), 'prompt-manager-routes-'))
/** Directory the store owns. */
const SECTIONS = join(ROOT, 'sections')

/**
 * Build one fake request.
 * @param options - method, url, peer address, headers, and raw body.
 * @returns an object good enough for the route handler.
 */
function fakeRequest(options) {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body, 'utf8')]
  const headers = {}
  if (options.origin !== undefined) headers.origin = options.origin
  headers.host = options.host ?? '127.0.0.1:3080'
  return {
    method: options.method ?? 'GET',
    url: options.url,
    headers,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/**
 * Build one fake response that records what the handler wrote.
 * @returns the response plus its captured state.
 */
function fakeResponse() {
  const state = { status: 0, headers: undefined, body: '' }
  return {
    state,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers
    },
    end(body) {
      state.body = body ?? ''
    },
    json() {
      return JSON.parse(state.body)
    },
  }
}

try {
  const store = new PromptStore(SECTIONS)
  const warnings = []
  const routes = []
  const ctx = {
    inject: (deps, callback) => callback({ webServer: { register: (route) => { routes.push(route); return () => {} } } }),
    effect: (execute) => {
      const disposer = execute()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  /** What the fake engine recorded, and how it answers. */
  const engine = {
    calls: [],
    /** Sources the engine reports as configured; the add route allocates against these. */
    configured: [{ id: 'src-a', repo: 'o/r', ref: 'main', mirror: '', enabled: true, files: 2, pending: 1 }],
    list: () => engine.configured,
    check: async (slug) => {
      engine.calls.push({ action: 'check', slug })
      if (slug === 'nope') throw new CheckError('unknown-source', '没有这个订阅源：nope')
      return { slug, upToDate: false, headSha: 'a'.repeat(40), changes: [{ path: 'p/a.md', id: 'src-a-a', kind: 'changed', added: 2, removed: 1 }], prompts: [], warnings: [] }
    },
    apply: async (slug, files) => {
      if (slug === 'stale') throw new CheckError('nothing-staged', 'src-a 还没有检查结果')
      engine.calls.push({ action: 'apply', slug, files })
      return { slug, applied: [], entries: [] }
    },
    revert: async (slug) => {
      engine.calls.push({ action: 'revert', slug })
      return { slug, reverted: ['p/a.md'], entries: [] }
    },
    remove: async (slug) => {
      engine.calls.push({ action: 'remove', slug })
      return { slug, entries: [] }
    },
  }

  installPromptRoutes(ctx, {
    store,
    describe: (id) => {
      if (id === 'src-a-a') return { text: 'SUBSCRIBED', source: 'subscribed' }
      const stored = store.read(id)
      return stored === undefined
        ? { text: '', source: 'empty' }
        : { text: stored.body, source: 'user' }
    },
    idFor: (title) => entryIdFor(title, store.ids()),
    warn: (message) => warnings.push(message),
    subscriptions: engine,
  })

  assert.equal(routes.length, 1, 'the plugin must register exactly one route')
  assert.equal(routes[0].kind, 'prefix', 'the route must be a prefix route')
  assert.equal(routes[0].path, ROUTE_PREFIX, 'the route must live under the documented prefix')
  const handler = routes[0].handler

  /**
   * Call the handler once.
   * @param options - fake request options.
   * @returns the captured response state.
   */
  async function call(options) {
    const response = fakeResponse()
    await handler(fakeRequest(options), response)
    return response
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  const status = await call({ url: `${ROUTE_PREFIX}/status` })
  assert.equal(status.state.status, 200, 'status must answer 200')
  assert.equal(status.json().dir, SECTIONS, 'status must report the body directory')

  const bodyless = await call({ url: `${ROUTE_PREFIX}/body/nobody` })
  assert.equal(bodyless.json().body, '', 'an entry with no body file must report an empty body')
  assert.equal(bodyless.json().source, 'empty', 'and must be labelled empty')
  assert.equal(bodyless.json().fileSha1, null, 'an entry without a body file must report no file hash')

  // ── writes, escapes, and fencing ────────────────────────────────────────────

  const created = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/draft`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ body: 'EDITED', fileSha1: null }),
  })
  assert.equal(created.state.status, 200, 'a fenced create must succeed')
  assert.equal(created.json().source, 'user', 'the answered view must read the stored body')
  assert.equal(store.read('draft').body, 'EDITED', 'the body must land on disk')

  const replayed = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/draft`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ body: 'SECOND-EDIT', fileSha1: null }),
  })
  assert.equal(replayed.state.status, 409, 'a draft that saw no file must not overwrite one that appeared')

  const stale = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/draft`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ body: 'STALE', fileSha1: 'deadbeef' }),
  })
  assert.equal(stale.state.status, 409, 'a stale hash must be refused')

  const current = store.read('draft').sha1
  const updated = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/draft`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ body: 'THIRD-EDIT', fileSha1: current }),
  })
  assert.equal(updated.state.status, 200, 'a matching hash must write')

  const deleted = await call({
    method: 'DELETE',
    url: `${ROUTE_PREFIX}/body/draft`,
    origin: 'http://127.0.0.1:3080',
  })
  assert.equal(deleted.json().removed, true, 'deleting a body file must report it was removed')
  assert.equal(deleted.json().body, '', 'the view must fall back to an empty body')
  assert.equal(deleted.json().source, 'empty', 'and report the entry as empty')
  assert.equal(store.has('draft'), false, 'the body file must be gone')

  // ── gates ───────────────────────────────────────────────────────────────────

  const remote = await call({ url: `${ROUTE_PREFIX}/status`, remoteAddress: '192.168.1.5' })
  assert.equal(remote.state.status, 403, 'a non-loopback peer must be refused')

  const crossOrigin = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/note`,
    origin: 'http://evil.example',
    body: JSON.stringify({ body: 'X', fileSha1: null }),
  })
  assert.equal(crossOrigin.state.status, 403, 'a cross-origin write must be refused')
  assert.equal(store.has('note'), false, 'a refused write must not touch the disk')

  const traversal = await call({ url: `${ROUTE_PREFIX}/body/${encodeURIComponent('../secrets')}` })
  assert.equal(traversal.state.status, 400, 'a traversal id must be refused before it reaches the filesystem')

  const oversized = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/note`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ body: 'x'.repeat(1024 * 1024) }),
  })
  assert.equal(oversized.state.status, 400, 'an oversized request must be refused')

  const wrongMethod = await call({ method: 'PATCH', url: `${ROUTE_PREFIX}/body/note`, origin: 'http://127.0.0.1:3080' })
  assert.equal(wrongMethod.state.status, 405, 'an unsupported method must be refused')

  const unknown = await call({ url: `${ROUTE_PREFIX}/nope` })
  assert.equal(unknown.state.status, 404, 'an unknown path must 404')

  // ── id allocation ───────────────────────────────────────────────────────────

  const allocated = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/id`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ title: 'My Note' }),
  })
  assert.equal(allocated.json().id, 'my-note', 'the id route must slug the title')

  writeFileSync(join(SECTIONS, 'my-note.md'), 'exists', 'utf8')
  const again = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/id`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ title: 'My Note' }),
  })
  assert.equal(again.json().id, 'my-note-2', 'the id route must avoid stored ids')

  // ── subscription sources ────────────────────────────────────────────────────

  const listed = await call({ url: `${ROUTE_PREFIX}/sources` })
  assert.equal(listed.state.status, 200, 'the source list answers')
  assert.equal(listed.json().sources[0].id, 'src-a', 'the list carries the configured source')

  // ── adding a source ─────────────────────────────────────────────────────────

  const added = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ repo: 'lolkda/dsh-prompt-pack', ref: 'main' }),
  })
  assert.equal(added.state.status, 200, 'adding a source answers 200')
  assert.equal(added.json().id, 'lolkda-dsh-prompt-pack', 'the slug is derived from owner/name')
  assert.equal(added.json().repo, 'lolkda/dsh-prompt-pack', 'the Host echoes the validated repository')
  assert.equal(added.json().mirror, '', 'an absent mirror means inherit the global one')
  engine.configured = [...engine.configured, {
    id: added.json().id,
    repo: added.json().repo,
    ref: added.json().ref,
    mirror: added.json().mirror,
    enabled: true,
    files: 0,
    pending: 0,
  }]

  const duplicated = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ repo: 'lolkda/dsh-prompt-pack', ref: 'main' }),
  })
  assert.equal(duplicated.state.status, 409, 'one repository and ref cannot be subscribed twice')
  assert.equal(duplicated.json().code, 'duplicate-source', 'and the reason is machine-readable')

  const otherRef = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ repo: 'lolkda/dsh-prompt-pack', ref: 'dev' }),
  })
  assert.equal(otherRef.json().id, 'lolkda-dsh-prompt-pack-2', 'a taken slug gets a numeric suffix')

  const mirrored = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ repo: 'o/r2', mirror: 'https://gh-proxy.example/' }),
  })
  assert.equal(mirrored.json().ref, 'main', 'an omitted ref defaults to the branch the schema names')
  assert.equal(mirrored.json().mirror, 'https://gh-proxy.example', 'the mirror is normalized before it is stored')

  for (const [label, payload] of [
    ['a bare owner', { repo: 'lolkda' }],
    ['a third path segment', { repo: 'a/b/c' }],
    ['a traversal ref', { repo: 'o/r', ref: '../evil' }],
    ['a non-string ref', { repo: 'o/r', ref: 7 }],
    ['an http mirror', { repo: 'o/r', mirror: 'http://plain.example' }],
    ['a credentialed mirror', { repo: 'o/r', mirror: 'https://user:pass@host' }],
  ]) {
    const refused = await call({
      method: 'POST',
      url: `${ROUTE_PREFIX}/sources`,
      origin: 'http://127.0.0.1:3080',
      body: JSON.stringify(payload),
    })
    assert.equal(refused.state.status, 400, `${label} must be refused`)
  }

  const notAnObject = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify('lolkda/dsh-prompt-pack'),
  })
  assert.equal(notAnObject.state.status, 400, 'a body that is not a JSON object is refused')

  const crossOriginAdd = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://evil.example',
    body: JSON.stringify({ repo: 'o/r3' }),
  })
  assert.equal(crossOriginAdd.state.status, 403, 'a cross-origin add is refused')

  const filled = engine.configured
  engine.configured = Array.from({ length: MAX_SOURCES }, (_, index) => ({
    id: `src-${String(index)}`,
    repo: `o/r${String(index)}`,
    ref: 'main',
    mirror: '',
    enabled: true,
    files: 0,
    pending: 0,
  }))
  const capped = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ repo: 'o/one-too-many' }),
  })
  assert.equal(capped.state.status, 409, 'the source cap is enforced')
  assert.equal(capped.json().code, 'too-many-sources', 'and the cap reports its own reason')
  engine.configured = filled

  const checked = await call({ method: 'POST', url: `${ROUTE_PREFIX}/sources/src-a/check`, origin: 'http://127.0.0.1:3080' })
  assert.equal(checked.state.status, 200, 'a check answers 200')
  assert.equal(checked.json().changes[0].kind, 'changed', 'the check reports what moved')

  const appliedSource = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources/src-a/apply`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ files: ['p/a.md'] }),
  })
  assert.equal(appliedSource.state.status, 200, 'an apply answers 200')
  assert.deepEqual(engine.calls.at(-1), { action: 'apply', slug: 'src-a', files: ['p/a.md'] }, 'the selected files reach the engine')

  const reverted = await call({ method: 'POST', url: `${ROUTE_PREFIX}/sources/src-a/revert`, origin: 'http://127.0.0.1:3080' })
  assert.equal(reverted.json().reverted[0], 'p/a.md', 'a revert answers what moved back')

  const unknownSource = await call({ method: 'POST', url: `${ROUTE_PREFIX}/sources/nope/check`, origin: 'http://127.0.0.1:3080' })
  assert.equal(unknownSource.state.status, 404, 'an unknown source is a 404')
  const nothingStaged = await call({ method: 'POST', url: `${ROUTE_PREFIX}/sources/stale/apply`, origin: 'http://127.0.0.1:3080' })
  assert.equal(nothingStaged.state.status, 409, 'applying without a check result is a 409')

  const badSlug = await call({ url: `${ROUTE_PREFIX}/sources/BAD_SLUG/check` })
  assert.equal(badSlug.state.status, 400, 'an unusable slug never reaches the engine')

  const crossOriginCheck = await call({
    method: 'POST',
    url: `${ROUTE_PREFIX}/sources/src-a/check`,
    origin: 'http://evil.example',
  })
  assert.equal(crossOriginCheck.state.status, 403, 'a cross-origin check is refused')

  const removedSource = await call({ method: 'DELETE', url: `${ROUTE_PREFIX}/sources/src-a`, origin: 'http://127.0.0.1:3080' })
  assert.equal(removedSource.state.status, 200, 'forgetting a source answers 200')
  assert.equal(engine.calls.at(-1).action, 'remove', 'the engine is asked to forget it')

  const subscribedWrite = await call({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/body/src-a-a`,
    origin: 'http://127.0.0.1:3080',
    body: JSON.stringify({ body: 'NOPE', fileSha1: null }),
  })
  assert.equal(subscribedWrite.state.status, 403, 'a subscribed body is refused a write')
  assert.equal(store.has('src-a-a'), false, 'and nothing reaches the disk')

  assert.deepEqual(warnings, [], `no warning expected, got: ${warnings.join(' | ')}`)

  console.log('routes ok')
  console.log('  gates       loopback peers only, same-origin writes only, traversal ids refused')
  console.log('  fencing     409 on absent-or-changed override, 200 on a matching hash')
  console.log('  statuses    400 malformed/oversized, 404 unknown path, 405 wrong method, 403 gates')
  console.log('  sources     add / list / check / apply / revert / forget, subscribed bodies read-only')
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}
