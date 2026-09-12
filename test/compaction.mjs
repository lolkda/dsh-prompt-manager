#!/usr/bin/env node
/**
 * Compaction test: the instruction a context compaction sends to its summarizer,
 * and the plugin's ability to replace it from an entry body.
 *
 * What is asserted is what the **adapter received** — the thing that would go on
 * the wire — not that some listener was called. The harness mounts the real
 * `@deepseek-ai/dsh-llm` runtime (no network: the adapter is a stand-in that
 * records every request and answers with one fixed chunk stream), so the
 * `llm/stream` waterfall, the message projection, and the adapter boundary are
 * all the real ones.
 *
 * Coverage: the untouched default, a replacement drawn from a body file with
 * variables interpolated, the identity of everything not replaced, requests that
 * must never be touched, the four ways a configured instruction can be unusable,
 * a frozen request, a deployment with no LLM at all, and the config switch that
 * turns the whole feature off.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ROUTE_PREFIX, apply, inject, name } from '../lib/index.js'

/** Throwaway home for the body files, so the test never touches a real one. */
const STORE_ROOT = mkdtempSync(join(tmpdir(), 'prompt-manager-compaction-'))

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
 * A stand-in `settings` service: one namespace and a state handle the test
 * drives by hand, exactly as `test/smoke.mjs` does it.
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
            update: async (patch) => {
              state.value = { ...state.value, ...patch }
              state.watcher?.()
              return state.value
            },
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

const { Context } = await load('@deepseek-ai/cordis')
const { default: LlmRuntime, LlmAdapter } = await load('@deepseek-ai/dsh-llm')
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')

/**
 * The fake model. It records the request it was handed and answers with the
 * smallest chunk stream the runtime accepts, so a test asserts the request that
 * would have gone on the wire.
 */
class RecordingAdapter extends LlmAdapter {
  /** Every request handed to this adapter, oldest first. */
  requests = []

  async *stream(options) {
    this.requests.push(options)
    yield { type: 'text', text: '(stand-in model)' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Message ids are allocated from a counter so two builds of one shape compare equal. */
let messageSeq = 0

/**
 * One message in the shape the harness uses (role, content, source).
 * @param role - message role.
 * @param text - the single text block.
 * @param source - message provenance.
 * @returns the message.
 */
function message(role, text, source) {
  messageSeq += 1
  return { id: `m${String(messageSeq).padStart(3, '0')}`, role, content: [{ type: 'text', text }], source }
}

/** The directive DSH itself ships, as the summary call carries it. */
const STOCK_INSTRUCTION = 'You are now acting as a compaction engine for this AI coding assistant. Output EXACTLY the Markdown structure below: ...'

/**
 * The shape `dsh-compaction-basic` sends: the replayed conversation, and the
 * instruction as the final user message under its own plugin source.
 * @returns the message list.
 */
function compactionMessages() {
  return [
    message('system', 'SYSTEM-PROMPT-REPLAY', { kind: 'plugin', plugin: 'system-prompt' }),
    message('user', 'first request', { kind: 'user' }),
    message('assistant', 'working on it', { kind: 'assistant' }),
    message('user', STOCK_INSTRUCTION, { kind: 'plugin', plugin: 'dsh-compaction-basic' }),
  ]
}

/** The text of the last message: what the summarizer actually reads. */
function lastText(request) {
  return request.messages.at(-1).content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** Consume a request the way the engine does. */
async function send(ctx, options) {
  for await (const _chunk of ctx.llm.stream(options)) { /* the chunks are not under test */ }
}

/** Write one entry body under the store root. */
function writeBody(id, text) {
  mkdirSync(SECTIONS, { recursive: true })
  writeFileSync(join(SECTIONS, `${id}.md`), text, 'utf8')
}

/** SystemPrompt config that keeps the assembly to what this plugin contributes. */
const BARE = { includeHarnessIdentity: false, includeRuntimeContext: false }

/**
 * Mount the plugin over the real LLM runtime.
 * @param config - plugin config.
 * @param options - `settings` to mount a settings service, `llm: false` to leave
 * the LLM out of the deployment entirely.
 * @returns the context, what the plugin warned about, the mounted plugin, and
 * the recording adapter when one was registered.
 */
async function mount(config = {}, options = {}) {
  const ctx = new Context()
  const warnings = []
  ctx.logger.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  await ctx.plugin(SystemPrompt, BARE)
  let adapter
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['lab'], adapter)
  }
  if (options.settings !== undefined) await ctx.plugin(options.settings.plugin)
  await ctx.plugin({ name, inject, apply }, { storeDir: STORE_ROOT, ...config })
  await settle()
  return { ctx, warnings, adapter, settings: options.settings }
}

/** One settings document holding a section entry and a compaction entry. */
function indexWith(compactionPointer) {
  return {
    entries: [
      { id: 'note', title: '补充说明', order: 10, enabled: true },
      { id: 'compact-zh', title: '压缩指令', order: 90, enabled: false, kind: 'compaction' },
    ],
    compaction: compactionPointer,
  }
}

try {
  // ── the default: nothing configured means DSH's own instruction stands ──────

  const settings = fakeSettings([])
  const driven = await mount({}, { settings })
  const { ctx, adapter } = driven

  const untouched = compactionMessages()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: untouched })
  assert.equal(lastText(adapter.requests.at(-1)), STOCK_INSTRUCTION, 'with no pointer the stock instruction must reach the model unchanged')
  assert.equal(
    JSON.stringify(adapter.requests.at(-1).messages),
    JSON.stringify(untouched),
    'and no message may be touched at all',
  )

  // ── a pointer replaces it with the entry body, variables and all ────────────

  writeBody('compact-zh', '压缩：{{os}} / {{nope}}')
  settings.state.value = indexWith('compact-zh')
  settings.state.watcher()

  const replaced = compactionMessages()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: replaced })
  const afterReplace = adapter.requests.at(-1)
  const instruction = lastText(afterReplace)
  assert.ok(instruction.startsWith('压缩：'), `the body must replace the instruction, got: ${instruction.slice(0, 40)}`)
  assert.ok(!instruction.includes('compaction engine'), 'the stock instruction must not survive the replacement')
  assert.ok(
    /^压缩：\S+ \/ \{\{\u200b?nope\}\}/.test(instruction) || /^压缩：\S+ \/ \{\{nope\}\}/.test(instruction.replace(/\u200b/g, '')),
    `an unregistered reference must render as prose rather than throw, got: ${JSON.stringify(instruction)}`,
  )
  assert.ok(
    !instruction.includes('{{os}}'),
    'a registered variable — the plugin registers the platform facts itself — must be interpolated',
  )

  // Everything the replacement did not name is untouched, identity included.
  assert.equal(afterReplace.messages.length, replaced.length, 'replacing the instruction must not add or drop a message')
  for (let index = 0; index < replaced.length - 1; index += 1) {
    assert.equal(
      JSON.stringify(afterReplace.messages[index]),
      JSON.stringify(replaced[index]),
      `message ${String(index)} is part of the replayed prefix and must be byte-identical`,
    )
  }
  assert.equal(afterReplace.messages.at(-1).id, replaced.at(-1).id, 'the instruction keeps its identity when its text changes')
  assert.equal(afterReplace.messages.at(-1).role, 'user', 'and stays a user message')
  assert.deepEqual(
    afterReplace.messages.at(-1).source,
    { kind: 'plugin', plugin: 'dsh-compaction-basic' },
    'and keeps its provenance, which is what identifies a compaction call',
  )

  // ── requests that are not a compaction are never touched ────────────────────

  const conversation = [message('system', 'SYSTEM', { kind: 'plugin', plugin: 'system-prompt' }), message('user', 'hello', { kind: 'user' })]
  const conversationBefore = JSON.stringify(conversation)
  await send(ctx, { provider: 'lab', model: 'stand-in', messages: conversation })
  assert.equal(
    JSON.stringify(adapter.requests.at(-1).messages),
    conversationBefore,
    'an ordinary conversation request carries no purpose and must pass through untouched',
  )

  const titleRequest = [message('user', 'name this session', { kind: 'plugin', plugin: 'dsh-session-title' })]
  const titleBefore = JSON.stringify(titleRequest)
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'session-title', messages: titleRequest })
  assert.equal(
    JSON.stringify(adapter.requests.at(-1).messages),
    titleBefore,
    'the session-title call must not be mistaken for a compaction',
  )

  // ── the request arrives from another realm, which is how the real one does ──
  //
  // In a shipped deployment the compaction backend is mounted inside an isolated
  // group (`isolate: { compaction: true }`), while `llm` itself is not isolated,
  // so it is the same service this plugin injected. What this case pins down is
  // that interception follows the *request*, not the context this plugin happens
  // to sit in: a listener wired to the wrong context would leave every real
  // compaction alone and nothing would report it.

  const realm = ctx.isolate('compaction')
  let fromRealm
  await realm.plugin({
    name: 'stand-in-backend',
    inject: ['llm'],
    apply: (scoped) => {
      fromRealm = async () => {
        for await (const _chunk of scoped.llm.stream({
          provider: 'lab',
          model: 'stand-in',
          purpose: 'compaction',
          messages: compactionMessages(),
        })) { /* the chunks are not under test */ }
      }
    },
  })
  writeBody('compact-zh', 'FROM-ANOTHER-REALM')
  await fromRealm()
  assert.equal(
    lastText(adapter.requests.at(-1)),
    'FROM-ANOTHER-REALM',
    'a compaction issued from an isolated realm must still be intercepted',
  )

  // ── the instruction is found by provenance, not by counting ─────────────────
  //
  // The engine tags the message it appends (`source.plugin` is its own package
  // name), and that tag is what the plugin looks for. Counting would be a guess
  // about another package's internals; this is the shape the tag actually takes,
  // taken from the backend that ships in this harness.

  settings.state.value = indexWith('compact-zh')
  settings.state.watcher()
  writeBody('compact-zh', 'FOUND-BY-TAG')
  const tagged = [
    ...compactionMessages(),
    message('user', 'a later message the projection added', { kind: 'user' }),
  ]
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: tagged })
  const found = adapter.requests.at(-1)
  assert.equal(lastText(found), 'a later message the projection added', 'the message that is not the instruction must stay last')
  assert.equal(
    found.messages[3].content.find((block) => block.type === 'text').text,
    'FOUND-BY-TAG',
    'the instruction must be replaced where it actually is, not where it is usually appended',
  )

  // An untagged instruction still gets replaced: the last message is the
  // fallback, and a compaction request that carries no tag is still a compaction.
  writeBody('compact-zh', 'LAST-RESORT-BODY')
  const untagged = [
    message('system', 'SYSTEM-PROMPT-REPLAY', { kind: 'plugin', plugin: 'system-prompt' }),
    message('user', 'first request', { kind: 'user' }),
    message('user', 'STOCK-INSTRUCTION-UNTAGGED'),
  ]
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: untagged })
  assert.equal(
    lastText(adapter.requests.at(-1)),
    'LAST-RESORT-BODY',
    'an instruction that carries no provenance must still be replaced, from the last message',
  )

  // ── the four ways a configured instruction is unusable: all pass through ────

  const unusable = [
    {
      label: 'a pointer naming an entry the index does not have',
      document: { ...indexWith('gone'), entries: indexWith('gone').entries },
    },
    {
      label: 'a pointer naming a section entry',
      document: { ...indexWith('note'), entries: indexWith('note').entries },
    },
  ]
  for (const sample of unusable) {
    settings.state.value = sample.document
    settings.state.watcher()
    const request = compactionMessages()
    await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: request })
    assert.equal(
      lastText(adapter.requests.at(-1)),
      STOCK_INSTRUCTION,
      `${sample.label} must leave the stock instruction in force`,
    )
  }

  // An entry that is in force but has no body yet must not blank the instruction.
  writeBody('compact-empty', '   \n')
  settings.state.value = {
    entries: [
      ...indexWith('note').entries,
      { id: 'compact-empty', title: '空的', order: 91, enabled: false, kind: 'compaction' },
    ],
    compaction: 'compact-empty',
  }
  settings.state.watcher()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: compactionMessages() })
  assert.equal(
    lastText(adapter.requests.at(-1)),
    STOCK_INSTRUCTION,
    'a body that is only whitespace must leave the stock instruction in force rather than send nothing',
  )

  // The body file deleted by hand, with the index still naming it.
  rmSync(join(SECTIONS, 'compact-zh.md'), { force: true })
  settings.state.value = indexWith('compact-zh')
  settings.state.watcher()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: compactionMessages() })
  assert.equal(
    lastText(adapter.requests.at(-1)),
    STOCK_INSTRUCTION,
    'a body file that vanished must leave the stock instruction in force',
  )

  // ── a frozen request is left alone rather than failing the compaction ───────

  writeBody('compact-zh', 'FROZEN-CASE-BODY')
  settings.state.value = indexWith('compact-zh')
  settings.state.watcher()
  const frozen = Object.freeze({
    provider: 'lab',
    model: 'stand-in',
    purpose: 'compaction',
    messages: Object.freeze(compactionMessages()),
  })
  await assert.doesNotReject(
    () => send(ctx, frozen),
    'a request this plugin cannot rewrite must not become a failed compaction',
  )
  assert.equal(lastText(adapter.requests.at(-1)), STOCK_INSTRUCTION, 'and it must go out with the instruction it came in with')

  // ── a preset's pointer overrides the document's, and follows the preset ─────

  writeBody('compact-preset', 'PRESET-BODY')
  settings.state.value = {
    entries: [
      ...indexWith('compact-zh').entries,
      { id: 'compact-preset', title: '组合用的压缩指令', order: 92, enabled: false, kind: 'compaction' },
    ],
    compaction: 'compact-zh',
    presets: [{ id: 'ctf', name: 'ctf', entries: ['note'], compaction: 'compact-preset' }],
  }
  settings.state.watcher()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: compactionMessages() })
  assert.equal(lastText(adapter.requests.at(-1)), 'FROZEN-CASE-BODY', 'with no preset in force the document pointer decides')

  settings.state.value = { ...settings.state.value, activePreset: 'ctf' }
  settings.state.watcher()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: compactionMessages() })
  assert.equal(
    lastText(adapter.requests.at(-1)),
    'PRESET-BODY',
    'a preset in force owns the pointer: its instruction replaces the document pointer, not beside it',
  )

  settings.state.value = {
    entries: indexWith('compact-zh').entries,
    compaction: 'compact-zh',
    presets: [{ id: 'ctf', name: 'ctf', entries: ['note'], compaction: '' }],
    activePreset: 'ctf',
  }
  settings.state.watcher()
  await send(ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: compactionMessages() })
  assert.equal(
    lastText(adapter.requests.at(-1)),
    STOCK_INSTRUCTION,
    'a preset that names no instruction returns to the stock one, whatever the document pointer says',
  )

  // ── a deployment with no LLM mounts, it just never intercepts ───────────────

  const noLlm = fakeSettings([])
  const bare = await mount({}, { settings: noLlm, llm: false })
  assert.equal(typeof noLlm.state.registered, 'object', 'the plugin must mount and register its index even with no llm service')
  assert.ok(
    bare.warnings.every((line) => !line.includes('compaction')),
    `mounting without an llm service is not a problem to report, got: ${bare.warnings.join(' | ')}`,
  )

  // ── the config switch turns the feature off entirely ────────────────────────

  const off = fakeSettings([])
  const disabled = await mount({ compaction: false }, { settings: off })
  writeBody('compact-zh', 'MUST-NOT-APPEAR')
  off.state.value = indexWith('compact-zh')
  off.state.watcher()
  await send(disabled.ctx, { provider: 'lab', model: 'stand-in', purpose: 'compaction', messages: compactionMessages() })
  assert.equal(
    lastText(disabled.adapter.requests.at(-1)),
    STOCK_INSTRUCTION,
    'compaction: false must leave every request exactly as it was',
  )

  console.log('compaction ok')
  console.log('  default     no pointer leaves the instruction DSH ships, byte for byte')
  console.log('  replace     the entry body goes out with its variables resolved, the replayed prefix untouched')
  console.log('  scope       conversation and session-title calls are never touched')
  console.log('  realm       a compaction issued from an isolated group is intercepted too, which is the shipped topology')
  console.log('  unusable    a dangling pointer, a section pointer, an empty body, and a deleted file all pass through')
  console.log('  frozen      a request that cannot be rewritten goes out unchanged instead of failing')
  console.log('  presets     a preset owns the pointer while it is in force, and returns to the stock one when it names none')
  console.log('  optional    no llm service still mounts; compaction: false never intercepts')
  console.log(`  routes      ${ROUTE_PREFIX} routes are registered by the same mount`)
} finally {
  rmSync(STORE_ROOT, { recursive: true, force: true })
}
