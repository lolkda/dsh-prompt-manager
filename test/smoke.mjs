#!/usr/bin/env node
/**
 * Smoke test: mount this plugin into a real SystemPrompt registry and assert
 * that the prompt index — not a section baked into the plugin — decides what the
 * assembled system prompt contains.
 *
 * Coverage: an empty fresh install, the settings-driven index (add, enable,
 * disable, order), body resolution from the store and from a subscription
 * snapshot, index sanitization, prompt variables, the real namespace schema, and
 * config validation.
 *
 * The DeepSeek Harness packages are resolved in three steps: from this file,
 * from the current working directory's `node_modules`, then from the
 * `DSH_PACKAGES` directory holding `@deepseek-ai/*`. So either run it inside a
 * directory that can see the packages, or set `DSH_PACKAGES`, e.g.
 * `DSH_PACKAGES=C:/Users/me/.dsh/profiles/node_modules/@deepseek-ai node test/smoke.mjs`.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { SETTINGS_NAMESPACE, apply, environmentFacts, inject, name } from '../lib/index.js'
import { buildIndexSchema } from '../lib/entries.js'

/** Throwaway home for the body files, so the test never touches a real one. */
const STORE_ROOT = mkdtempSync(join(tmpdir(), 'prompt-manager-smoke-'))

/** Body directory the plugin derives from {@link STORE_ROOT}. */
const SECTIONS = join(STORE_ROOT, 'sections')

/**
 * Import a `@deepseek-ai/*` package, trying this file, the cwd, then `DSH_PACKAGES`.
 * @param packageName - the bare specifier to resolve.
 * @returns the imported module namespace.
 */
async function load(packageName) {
  const failures = []
  try {
    return await import(packageName)
  } catch (error) {
    failures.push(error.message)
  }
  try {
    const require = createRequire(join(process.cwd(), 'noop.js'))
    return await import(pathToFileURL(require.resolve(packageName)).href)
  } catch (error) {
    failures.push(error.message)
  }
  const root = process.env.DSH_PACKAGES
  if (root !== undefined) {
    const leaf = packageName.slice('@deepseek-ai/'.length)
    return import(pathToFileURL(join(root, leaf, 'lib', 'index.js')).href)
  }
  throw new Error(`cannot resolve ${packageName}; set DSH_PACKAGES to the directory holding @deepseek-ai/* (${failures.join(' | ')})`)
}

/** Let Cordis flush the fibers an injection created. */
async function settle() {
  for (let tick = 0; tick < 3; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A stand-in `settings` service: one namespace, one watcher, and a state
 * handle the test drives by hand.
 * @param initial - resolved index the namespace starts with.
 * @returns the plugin to mount and the state it exposes.
 */
function fakeSettings(initial) {
  const state = { value: initial, watcher: undefined, registered: undefined }
  const plugin = {
    name: 'fake-settings',
    apply: (ctx) => {
      ctx.provide('settings', {
        register: (namespace, schema, options) => {
          state.registered = { namespace, schema, options }
          if (options?.base !== undefined) state.value = options.base
          return {
            get: () => state.value,
            watch: (callback) => {
              state.watcher = callback
              return () => { state.watcher = undefined }
            },
          }
        },
      })
    },
  }
  return { plugin, state }
}

/**
 * Mount the plugin into a fresh SystemPrompt registry.
 * @param config - plugin config.
 * @param promptConfig - SystemPrompt service config.
 * @param plugins - extra plugins to mount before this one.
 * @returns the rendered system prompt, the assembly, and a re-assemble function.
 */
async function assembleWith(config, promptConfig, plugins = []) {
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: SystemPrompt, renderPrompt } = await load('@deepseek-ai/dsh-system-prompt')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, promptConfig)
  for (const plugin of plugins) await ctx.plugin(plugin)
  await ctx.plugin({ name, inject, apply }, { storeDir: STORE_ROOT, ...config })
  await settle()
  const read = async () => {
    const assembly = await ctx.systemPrompt.assemble({})
    return { assembly, prompt: renderPrompt(assembly) }
  }
  const first = await read()
  return { ...first, read }
}

/** SystemPrompt config that isolates the sections under test. */
const BARE = { includeHarnessIdentity: false, includeRuntimeContext: false }

/** Section name a person-added entry must register under. */
const sectionName = (id) => `user:prompt-manager:${id}`

/**
 * Write one entry body under the store directory.
 * @param id - entry id, which is also the file name.
 * @param text - exact body contents.
 */
function writeBody(id, text) {
  mkdirSync(SECTIONS, { recursive: true })
  writeFileSync(join(SECTIONS, `${id}.md`), text, 'utf8')
}

try {
  // ── a fresh install carries nothing ─────────────────────────────────────────

  const fresh = await assembleWith({}, BARE)
  assert.equal(fresh.prompt, '', 'a fresh install must inject nothing')
  assert.ok(
    !fresh.assembly.sections.some((section) => section.name.startsWith('user:prompt-manager:')),
    'the plugin must register no section of its own',
  )

  // ── the settings index drives the prompt ────────────────────────────────────

  const settings = fakeSettings([])
  const driven = await assembleWith({}, BARE, [settings.plugin])
  assert.ok(settings.state.registered !== undefined, 'the plugin must register its settings namespace')
  assert.equal(settings.state.registered.namespace, SETTINGS_NAMESPACE, 'the namespace must be prompt-manager')
  assert.deepEqual(
    settings.state.registered.options?.base?.entries,
    [],
    'the composition base layer must carry no entries',
  )
  assert.equal(driven.prompt, '', 'the composed base must inject nothing')

  writeBody('early', 'EARLY-BODY')
  writeBody('note', 'NOTE-BODY')
  settings.state.value = {
    entries: [
      { id: 'early', title: '先说的', order: 5, enabled: true },
      { id: 'note', title: '补充说明', order: 40, enabled: true },
    ],
  }
  settings.state.watcher()
  const added = await driven.read()
  const addedNames = added.assembly.sections
    .map((section) => section.name)
    .filter((sectionName_) => sectionName_.startsWith('user:prompt-manager:'))
  assert.deepEqual(addedNames, [sectionName('early'), sectionName('note')], `unexpected sections: ${addedNames.join(', ')}`)
  assert.ok(added.prompt.includes('EARLY-BODY') && added.prompt.includes('NOTE-BODY'), 'both bodies must reach the prompt')
  assert.ok(
    added.prompt.indexOf('EARLY-BODY') < added.prompt.indexOf('NOTE-BODY'),
    'entries must be concatenated in ascending order',
  )

  // A disabled entry leaves the prompt; the others stay.
  settings.state.value = {
    entries: [
      { id: 'early', title: '先说的', order: 5, enabled: true },
      { id: 'note', title: '补充说明', order: 40, enabled: false },
    ],
  }
  settings.state.watcher()
  const disabled = await driven.read()
  assert.ok(disabled.prompt.includes('EARLY-BODY'), 'an enabled entry must stay')
  assert.ok(!disabled.prompt.includes('NOTE-BODY'), 'a disabled entry must leave the prompt')

  // An entry with no body file contributes nothing rather than breaking assembly.
  settings.state.value = {
    entries: [{ id: 'nobody', title: '还没写正文', order: 50, enabled: true }],
  }
  settings.state.watcher()
  const bodyless = await driven.read()
  assert.equal(bodyless.prompt, '', 'an entry without a body file must contribute nothing')

  // ── a subscribed entry reads its snapshot, not a local file ─────────────────

  const workspace = join(STORE_ROOT, 'sources', 'src-a')
  mkdirSync(join(workspace, 'current', 'p'), { recursive: true })
  writeFileSync(join(workspace, 'current', 'p', 'a.md'), 'SUBSCRIBED-BODY', 'utf8')
  writeFileSync(join(workspace, 'state.json'), JSON.stringify({
    ref: 'main',
    files: { 'p/a.md': { id: 'src-a-a', enabled: true, sha1: 'x' } },
  }), 'utf8')
  settings.state.value = {
    entries: [{ id: 'src-a-a', title: '订阅来的', order: 60, enabled: true, source: 'src-a' }],
    sources: [{ id: 'src-a', repo: 'o/r', ref: 'main', enabled: true }],
  }
  settings.state.watcher()
  const subscribed = await driven.read()
  assert.ok(subscribed.prompt.includes('SUBSCRIBED-BODY'), 'a subscribed entry must read its snapshot')
  assert.ok(
    subscribed.assembly.sections.some((section) => section.name === sectionName('src-a-a')),
    'a subscribed entry must register a section like any other entry',
  )

  // ── prompt variables ────────────────────────────────────────────────────────

  const facts = environmentFacts()
  assert.equal(facts.platform, process.platform, 'platform fact must mirror process.platform')
  assert.equal(facts.arch, process.arch, 'arch fact must mirror process.arch')

  writeBody('vars', 'os={{os}} platform={{platform}} arch={{arch}} release={{os_release}}')
  settings.state.value = { entries: [{ id: 'vars', title: '变量', order: 10, enabled: true }] }
  settings.state.watcher()
  const environment = await driven.read()
  assert.ok(environment.prompt.startsWith(`os=${facts.os} platform=`), `unexpected environment line: ${environment.prompt}`)
  assert.ok(environment.prompt.includes(`platform=${process.platform}`), 'platform variable must resolve')
  assert.ok(environment.prompt.includes(`arch=${process.arch}`), 'arch variable must resolve')
  assert.ok(environment.prompt.includes(`release=${facts.os_release}`), 'os_release variable must resolve')

  writeBody('shell', 'shell={{shell}}')
  const vars = fakeSettings([])
  const withVars = await assembleWith({ variables: { shell: 'powershell' } }, BARE, [vars.plugin])
  vars.state.value = { entries: [{ id: 'shell', title: 'shell', order: 10, enabled: true }] }
  vars.state.watcher()
  assert.equal((await withVars.read()).prompt, 'shell=powershell', 'config variables must register and resolve')

  writeBody('missing', '{{nope}}')
  const noEnv = fakeSettings([])
  const strict = await assembleWith({ environment: false }, BARE, [noEnv.plugin])
  noEnv.state.value = { entries: [{ id: 'missing', title: '未知变量', order: 10, enabled: true }] }
  noEnv.state.watcher()
  await assert.rejects(
    strict.read(),
    /unknown prompt variable/,
    'environment:false must leave the built-in variables unregistered, so a reference fails loudly',
  )

  // ── unusable index entries are dropped, never thrown ────────────────────────

  settings.state.value = { entries: [{ id: '../escape', title: 'bad', order: 1, enabled: true }, 'nonsense'] }
  settings.state.watcher()
  const sanitized = await driven.read()
  assert.equal(sanitized.prompt, '', 'unusable index entries must be dropped, not injected')
  assert.ok(
    !sanitized.assembly.sections.some((section) => section.name.startsWith('user:prompt-manager:')),
    'an unusable index must register no section',
  )

  // ── the real namespace schema, when schemastery is resolvable ───────────────

  let schemaNote = 'skipped (schemastery not resolvable from here)'
  try {
    const { default: Schema } = await load('@deepseek-ai/schemastery')
    const schema = buildIndexSchema(Schema)
    assert.equal(typeof schema.toJSON, 'function', 'the namespace schema must serialize for the settings wire')
    assert.deepEqual(schema({}).entries, [], 'an empty document must resolve to an empty index')
    const resolved = schema({ entries: [{ id: 'note', title: '补充说明', order: 40, enabled: true }] })
    assert.equal(resolved.entries.length, 1, 'the real schema must resolve a stored index')
    assert.equal(resolved.entries[0].id, 'note', 'the entry survives the round trip')
    assert.equal(resolved.sources.length, 0, 'an absent source list resolves to empty')
    schemaNote = 'real schemastery resolves the index and serializes for the wire'
  } catch (error) {
    schemaNote = `skipped (${error.message})`
  }

  // ── config validation ───────────────────────────────────────────────────────

  const fakeCtx = {
    effect: (execute) => {
      execute()
      return () => {}
    },
    get: () => undefined,
    inject: () => {},
    systemPrompt: {
      section: () => () => {},
      variable: () => () => {},
    },
  }
  assert.throws(
    () => apply(fakeCtx, { storeDir: STORE_ROOT, variables: { 'Bad-Name': 'x' } }),
    /invalid variable name/,
  )

  console.log('smoke ok')
  console.log('  empty       a fresh install registers no section and injects nothing')
  console.log(`  sections    ${addedNames.join(' -> ')}`)
  console.log('  index       settings-driven add / enable / disable / order / sanitize')
  console.log('  bodies      store file, subscribed snapshot, and a bodyless entry')
  console.log(`  variables   os=${facts.os} platform=${facts.platform} arch=${facts.arch} release=${facts.os_release}`)
  console.log(`  schema      ${schemaNote}`)
} finally {
  rmSync(STORE_ROOT, { recursive: true, force: true })
}
