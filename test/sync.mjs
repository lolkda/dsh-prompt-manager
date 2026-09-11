#!/usr/bin/env node
/**
 * Sync test: check → apply → revert over one source's files.
 *
 * The fetcher is a stub keyed by URL, so this exercises the three-slot rotation,
 * the staged plan, the change accounting, and every failure the pages have to
 * report — with no network and no real repository.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  applyChanges,
  checkSource,
  CheckError,
  diffCounts,
  revertChanges,
  SourceWorkspace,
} from '../lib/sync.js'
import { rawUrl, headAtomUrl } from '../lib/source.js'
import { bodyHash } from '../lib/store.js'

/** Throwaway storage root. */
const ROOT = mkdtempSync(join(tmpdir(), 'prompt-manager-sync-'))

/** The source every case below runs against. */
const SOURCE = { id: 'o-r', repo: 'o/r', ref: 'main', mirror: '', enabled: true }

const MANIFEST_URL = rawUrl('o/r', 'main', 'prompt-manager.json')
const ATOM_URL = headAtomUrl('o/r', 'main')
const A_URL = rawUrl('o/r', 'main', 'prompts/a.md')
const B_URL = rawUrl('o/r', 'main', 'prompts/b.md')

/**
 * Build a fetcher over a URL → response table.
 * @param routes - responses keyed by URL; a function is called with the options.
 * @returns a fetcher plus the calls it recorded.
 */
function fakeFetcher(routes) {
  const calls = []
  return {
    calls,
    async get(url, options = {}) {
      calls.push({ url, etag: options.etag })
      const entry = routes[url]
      if (entry === undefined) return { status: 404, text: '', etag: undefined, contentType: 'text/plain' }
      const resolved = typeof entry === 'function' ? entry(options) : entry
      return { status: 200, text: '', etag: undefined, contentType: 'text/plain', ...resolved }
    },
  }
}

/** A manifest declaring one or two prompts. */
const manifest = (prompts) => ({ status: 200, text: JSON.stringify({ prompts }), contentType: 'application/json' })

try {
  // ── line accounting ──────────────────────────────────────────────────────────

  assert.deepEqual(diffCounts('', 'a\nb'), { added: 2, removed: 0 }, 'a new file adds every line')
  assert.deepEqual(diffCounts('a\nb', ''), { added: 0, removed: 2 }, 'a removed file removes every line')
  assert.deepEqual(diffCounts('a\nb\nc', 'a\nX\nc'), { added: 1, removed: 1 }, 'one replacement is one and one')
  assert.deepEqual(diffCounts('a\nb', 'a\nb'), { added: 0, removed: 0 }, 'an identical body has no difference')
  assert.deepEqual(diffCounts('a\nb\nc', 'a\nc'), { added: 0, removed: 1 }, 'a deleted interior line is one removal')

  // ── first import ─────────────────────────────────────────────────────────────

  const workspace = new SourceWorkspace(ROOT, SOURCE.id)
  const first = await checkSource({
    source: SOURCE,
    workspace,
    fetcher: fakeFetcher({
      [ATOM_URL]: { status: 200, text: `<entry><id>Grit::Commit/${'a'.repeat(40)}</id></entry>` },
      [MANIFEST_URL]: manifest([
        { file: 'prompts/a.md', title: 'A', order: 30 },
        { file: 'prompts/b.md' },
      ]),
      [A_URL]: { status: 200, text: 'ONE\nTWO', etag: 'etag-a' },
      [B_URL]: { status: 200, text: 'BODY-B', etag: 'etag-b' },
    }),
  })
  assert.equal(first.upToDate, false, 'a first check finds work')
  assert.equal(first.headSha, 'a'.repeat(40), 'the commit is carried')
  assert.deepEqual(first.changes.map((change) => [change.path, change.kind, change.added]), [
    ['prompts/a.md', 'added', 2],
    ['prompts/b.md', 'added', 1],
  ], 'both files are staged as additions with their line counts')
  assert.equal(first.changes[0].id, 'o-r-a', 'the staged change carries the entry id it will become')
  assert.ok(existsSync(join(workspace.stagingDir, 'prompts/a.md')), 'the body is staged, not installed')

  const applied = applyChanges({
    workspace,
    state: workspace.readState(),
    plan: workspace.readPlan(),
    source: SOURCE,
    nowIso: '2026-01-01T00:00:00.000Z',
  })
  workspace.writeState(applied.state)
  workspace.clearStaging()
  assert.equal(applied.applied.length, 2, 'both staged files land')
  assert.equal(readFileSync(join(workspace.currentDir, 'prompts/a.md'), 'utf8'), 'ONE\nTWO', 'the body is in force')
  assert.equal(applied.state.files['prompts/a.md'].etag, 'etag-a', 'the validator is remembered')
  assert.equal(applied.state.files['prompts/a.md'].title, 'A', 'the manifest title is remembered')
  assert.equal(applied.state.headSha, 'a'.repeat(40), 'the commit is in force')
  assert.equal(applied.state.appliedAt, '2026-01-01T00:00:00.000Z', 'the apply is timestamped')

  // ── nothing changed ──────────────────────────────────────────────────────────

  const steady = await checkSource({
    source: SOURCE,
    workspace,
    fetcher: fakeFetcher({ [ATOM_URL]: { status: 200, text: `Grit::Commit/${'a'.repeat(40)}` } }),
  })
  assert.equal(steady.upToDate, true, 'the same commit needs no file requests')
  assert.deepEqual(steady.changes, [], 'and stages nothing')

  // ── an update, then a revert ─────────────────────────────────────────────────

  const updated = await checkSource({
    source: SOURCE,
    workspace,
    fetcher: fakeFetcher({
      [ATOM_URL]: { status: 200, text: `Grit::Commit/${'b'.repeat(40)}` },
      [MANIFEST_URL]: manifest([{ file: 'prompts/a.md', title: 'A', order: 30 }]),
      [A_URL]: { status: 200, text: 'ONE\nTWO\nTHREE', etag: 'etag-a2' },
    }),
  })
  assert.deepEqual(updated.changes.map((change) => [change.kind, change.added, change.removed]), [
    ['changed', 1, 0],
    ['removed', 0, 1],
  ], 'one body grew a line and the dropped file is reported as removed')

  const next = applyChanges({
    workspace,
    state: workspace.readState(),
    plan: workspace.readPlan(),
    source: SOURCE,
    nowIso: '2026-01-02T00:00:00.000Z',
  })
  workspace.writeState(next.state)
  workspace.clearStaging()
  assert.equal(readFileSync(join(workspace.previousDir, 'prompts/a.md'), 'utf8'), 'ONE\nTWO', 'the replaced body is kept')
  assert.ok(!existsSync(join(workspace.currentDir, 'prompts/b.md')), 'the dropped file left the snapshot')
  assert.equal(next.state.files['prompts/b.md'], undefined, 'and left the bookkeeping')

  const reverted = revertChanges({ workspace, state: workspace.readState() })
  workspace.writeState(reverted.state)
  assert.equal(readFileSync(join(workspace.currentDir, 'prompts/a.md'), 'utf8'), 'ONE\nTWO', 'revert puts the replaced body back')
  assert.equal(readFileSync(join(workspace.currentDir, 'prompts/b.md'), 'utf8'), 'BODY-B', 'revert restores the file that was dropped')
  assert.equal(reverted.state.files['prompts/b.md'].id, 'o-r-b', 'the restored file keeps its entry identity')
  assert.equal(reverted.state.files['prompts/a.md'].sha1, workspace.readState().files['prompts/a.md'].sha1, 'the bookkeeping is written where the state is read from')
  assert.equal(reverted.state.headSha, 'a'.repeat(40), 'revert puts the commit back')

  // ── partial apply ────────────────────────────────────────────────────────────

  const two = await checkSource({
    source: SOURCE,
    workspace,
    fetcher: fakeFetcher({
      [ATOM_URL]: { status: 200, text: `Grit::Commit/${'c'.repeat(40)}` },
      [MANIFEST_URL]: manifest([{ file: 'prompts/a.md' }, { file: 'prompts/b.md' }]),
      [A_URL]: { status: 200, text: 'A2', etag: 'e1' },
      [B_URL]: { status: 200, text: 'B2', etag: 'e2' },
    }),
  })
  assert.equal(two.changes.length, 2, 'both files differ')
  const partial = applyChanges({
    workspace,
    state: workspace.readState(),
    plan: workspace.readPlan(),
    source: SOURCE,
    selected: ['prompts/a.md'],
    nowIso: '2026-01-03T00:00:00.000Z',
  })
  assert.deepEqual(partial.applied.map((change) => change.path), ['prompts/a.md'], 'only the selected file lands')
  assert.equal(readFileSync(join(workspace.currentDir, 'prompts/a.md'), 'utf8'), 'A2', 'the selected body is in force')

  // ── failures the page has to report ──────────────────────────────────────────

  await assert.rejects(
    checkSource({ source: SOURCE, workspace: new SourceWorkspace(ROOT, 'missing'), fetcher: fakeFetcher({ [ATOM_URL]: { status: 404 } }) }),
    (error) => error instanceof CheckError && error.reason === 'manifest',
    'a repository without a manifest is refused',
  )
  await assert.rejects(
    checkSource({
      source: SOURCE,
      workspace: new SourceWorkspace(ROOT, 'html'),
      fetcher: fakeFetcher({
        [ATOM_URL]: { status: 404 },
        [MANIFEST_URL]: { status: 200, text: '<!doctype html><html>captcha</html>', contentType: 'text/html' },
      }),
    }),
    (error) => error instanceof CheckError && error.reason === 'mirror',
    'a mirror answering with a page is refused rather than staged',
  )
  await assert.rejects(
    checkSource({
      source: SOURCE,
      workspace: new SourceWorkspace(ROOT, 'offline'),
      fetcher: fakeFetcher({
        [ATOM_URL]: { status: 404 },
        [MANIFEST_URL]: () => {
          throw new Error('connect ECONNREFUSED')
        },
      }),
    }),
    (error) => error instanceof CheckError && error.reason === 'network',
    'a request that never lands is reported as a network failure',
  )

  const partialFailure = await checkSource({
    source: SOURCE,
    workspace: new SourceWorkspace(ROOT, 'warn'),
    fetcher: fakeFetcher({
      [ATOM_URL]: { status: 404 },
      [MANIFEST_URL]: manifest([{ file: 'prompts/a.md' }, { file: 'prompts/gone.md' }]),
      [A_URL]: { status: 200, text: 'A', etag: 'x' },
    }),
  })
  assert.equal(partialFailure.changes.length, 1, 'the file that exists is still staged')
  assert.ok(
    partialFailure.warnings.some((warning) => warning.includes('prompts/gone.md')),
    'the missing file is reported as a warning',
  )
  assert.ok(
    partialFailure.warnings.some((warning) => warning.includes('commit')),
    'an unreachable commits feed is reported, not fatal',
  )

  // ── a body file that vanished must be fetched again, never blanked ───────────

  /** Bookkeeping that remembers one body file, ready for the file to vanish. */
  const holed = (slug) => {
    const workspace = new SourceWorkspace(ROOT, slug)
    mkdirSync(join(workspace.currentDir, 'prompts'), { recursive: true })
    writeFileSync(join(workspace.currentDir, 'prompts/a.md'), 'ONE\nTWO', 'utf8')
    workspace.writeState({
      ref: 'main',
      files: { 'prompts/a.md': { id: `${slug}-a`, enabled: true, sha1: bodyHash('ONE\nTWO'), etag: 'etag-a' } },
    })
    return workspace
  }

  const holey = holed('holey')
  rmSync(join(holey.currentDir, 'prompts/a.md'))
  const refetch = fakeFetcher({
    [ATOM_URL]: { status: 404 },
    [MANIFEST_URL]: manifest([{ file: 'prompts/a.md', title: 'A' }]),
    [A_URL]: { status: 200, text: 'ONE\nTWO\nTHREE', etag: 'etag-a2' },
  })
  const recovered = await checkSource({ source: SOURCE, workspace: holey, fetcher: refetch })
  assert.equal(
    refetch.calls.find((call) => call.url === A_URL).etag,
    undefined,
    'a missing body file must drop the validator, so the answer carries content',
  )
  assert.deepEqual(
    recovered.changes.map((change) => [change.path, change.kind]),
    [['prompts/a.md', 'changed']],
    'the vanished file is staged as an ordinary change',
  )
  assert.equal(
    readFileSync(join(holey.stagingDir, 'prompts/a.md'), 'utf8'),
    'ONE\nTWO\nTHREE',
    'what is staged is the real body, never an empty 304 answer',
  )
  const restored = applyChanges({
    workspace: holey,
    state: holey.readState(),
    plan: holey.readPlan(),
    source: SOURCE,
    nowIso: '2026-01-04T00:00:00.000Z',
  })
  holey.writeState(restored.state)
  holey.clearStaging()
  assert.equal(
    readFileSync(join(holey.currentDir, 'prompts/a.md'), 'utf8'),
    'ONE\nTWO\nTHREE',
    'applying the plan puts a body back in force',
  )

  // An upstream that answers 304 anyway (a broken mirror, a stub) must be
  // skipped rather than staged as an empty body.
  const stubborn = holed('stubborn')
  rmSync(join(stubborn.currentDir, 'prompts/a.md'))
  const stubbornOutcome = await checkSource({
    source: SOURCE,
    workspace: stubborn,
    fetcher: fakeFetcher({
      [ATOM_URL]: { status: 404 },
      [MANIFEST_URL]: manifest([{ file: 'prompts/a.md' }]),
      [A_URL]: () => ({ status: 304, text: '', etag: 'etag-a' }),
    }),
  })
  assert.deepEqual(stubbornOutcome.changes, [], 'an unasked-for 304 stages nothing')
  assert.equal(existsSync(join(stubborn.stagingDir, 'prompts/a.md')), false, 'and leaves no empty body in staging')

  // ── the workspace refuses to escape itself ───────────────────────────────────

  const guard = new SourceWorkspace(ROOT, 'guard')
  assert.equal(guard.slotPath('current', '../../escape.md'), undefined, 'a traversal path resolves to nothing')
  assert.throws(() => guard.stage('../../escape.md', 'x'), /outside the source/, 'staging a traversal path is refused')

  console.log('sync ok')
  console.log('  rotation    staging -> current, replaced bodies kept in previous')
  console.log('  accounting  added / changed / removed with line counts, partial apply honoured')
  console.log('  revert      the replaced body and the dropped file both come back')
  console.log('  conditional a vanished body is refetched, and a 304 never stages an empty one')
  console.log('  failures    no manifest, an HTML mirror, a missing file, a traversal path')
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}
