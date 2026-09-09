#!/usr/bin/env node
/**
 * Smoke test: mount this plugin into a real SystemPrompt registry and assert
 * that the contract section lands in the assembled system prompt, in the
 * intended position, with its variables resolved and its FastCtx routing
 * section gated on tool visibility.
 *
 * The DeepSeek Harness packages are resolved in three steps: from this file,
 * from the current working directory's `node_modules`, then from the
 * `DSH_PACKAGES` directory holding `@deepseek-ai/*`. So either run it inside a
 * directory that can see the packages, or set `DSH_PACKAGES`, e.g.
 * `DSH_PACKAGES=C:/Users/me/.dsh/profiles/node_modules/@deepseek-ai node test/smoke.mjs`.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_ORDER,
  DEFAULT_SECTION_NAME,
  FASTCTX_MISSING_TEXT,
  FASTCTX_SECTION_NAME,
  apply,
  environmentFacts,
  inject,
  name,
  readContract,
  readFastctx,
} from '../lib/index.js'

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

/**
 * A stand-in `tools` service that reports exactly the named tools as visible.
 * @param visible - tool names the fake registry resolves.
 * @returns a Cordis plugin providing `tools`.
 */
function fakeTools(visible) {
  return {
    name: 'fake-tools',
    apply: (ctx) => {
      ctx.provide('tools', {
        get: (toolName) => visible.includes(toolName) ? { name: toolName } : undefined,
      })
    },
  }
}

/**
 * Mount the plugin into a fresh SystemPrompt registry.
 * @param config - plugin config.
 * @param promptConfig - SystemPrompt service config.
 * @param plugins - extra plugins to mount before this one.
 * @returns the rendered system prompt and the assembly.
 */
async function assembleWith(config, promptConfig, plugins = []) {
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: SystemPrompt, renderPrompt } = await load('@deepseek-ai/dsh-system-prompt')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, promptConfig)
  for (const plugin of plugins) await ctx.plugin(plugin)
  await ctx.plugin({ name, inject, apply }, config)
  const assembly = await ctx.systemPrompt.assemble({})
  return { assembly, prompt: renderPrompt(assembly) }
}

/** SystemPrompt config that isolates the sections under test. */
const BARE = { includeHarnessIdentity: false, includeRuntimeContext: false }

/** Plugin config that keeps the conditional FastCtx section out of the way. */
const NO_FASTCTX = { fastctx: false }

// ── the bundled prose ───────────────────────────────────────────────────────

const contract = readContract()
assert.ok(contract.length > 0, 'contract.md must not be empty')
const references = [...contract.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1])
const marker = contract.split('\n').find((line) => line.startsWith('## '))
assert.ok(marker !== undefined, 'contract.md must contain at least one "## " heading')

const routing = readFastctx()
const routingMarker = routing.split('\n').find((line) => line.startsWith('## '))
assert.ok(routingMarker !== undefined, 'fastctx.md must contain at least one "## " heading')
assert.ok(!contract.includes(routingMarker), 'the routing prose must live in fastctx.md, not contract.md')

// ── registration and placement ──────────────────────────────────────────────

const { assembly, prompt } = await assembleWith({ order: DEFAULT_ORDER }, { persona: 'TEST-PERSONA' })
const names = assembly.sections.map((section) => section.name)

assert.ok(names.includes(DEFAULT_SECTION_NAME), `expected section ${DEFAULT_SECTION_NAME} in ${names.join(', ')}`)
assert.ok(names.indexOf('deployment:persona') < names.indexOf(DEFAULT_SECTION_NAME), 'contract must come after the persona')
assert.ok(prompt.includes(marker), `assembled prompt must contain ${marker}`)
assert.ok(prompt.includes('TEST-PERSONA'), 'assembled prompt must keep the persona section')

const overridden = await assembleWith(
  { ...NO_FASTCTX, order: 42, sectionName: 'user:custom', text: 'ONLY-THIS-TEXT' },
  BARE,
)
assert.equal(overridden.prompt, 'ONLY-THIS-TEXT', 'text/sectionName overrides must replace the bundled contract')

// ── environment variables ───────────────────────────────────────────────────

const facts = environmentFacts()
assert.equal(facts.platform, process.platform, 'platform fact must mirror process.platform')
assert.equal(facts.arch, process.arch, 'arch fact must mirror process.arch')

const environment = await assembleWith(
  { text: 'os={{os}} platform={{platform}} arch={{arch}} release={{os_release}}' },
  BARE,
)
assert.ok(environment.prompt.startsWith(`os=${facts.os} platform=`), `unexpected environment line: ${environment.prompt}`)
assert.ok(environment.prompt.includes(`platform=${process.platform}`), 'platform variable must resolve')
assert.ok(environment.prompt.includes(`arch=${process.arch}`), 'arch variable must resolve')
assert.ok(environment.prompt.includes(`release=${facts.os_release}`), 'os_release variable must resolve')

const custom = await assembleWith({ ...NO_FASTCTX, text: 'shell={{shell}}', variables: { shell: 'powershell' } }, BARE)
assert.equal(custom.prompt, 'shell=powershell', 'config variables must register and resolve')

const withLine = await assembleWith({ ...NO_FASTCTX, text: 'BODY', environmentLine: true }, BARE)
assert.ok(withLine.prompt.startsWith('Runtime environment: '), 'environmentLine must prepend the fact line')
assert.ok(withLine.prompt.endsWith('BODY'), 'environmentLine must keep the section body')

await assert.rejects(
  assembleWith({ ...NO_FASTCTX, text: '{{nope}}' }, BARE),
  /unknown prompt variable/,
  'an unregistered reference must fail loudly rather than render empty',
)
await assert.rejects(
  assembleWith({ ...NO_FASTCTX, text: '{{os}}', environment: false }, BARE),
  /unknown prompt variable/,
  'environment:false must leave the built-in variables unregistered',
)

// ── conditional FastCtx routing ─────────────────────────────────────────────

const available = await assembleWith({}, BARE, [fakeTools(['mcp__fastctx__inspect_local_file'])])
assert.ok(available.assembly.sections.some((section) => section.name === FASTCTX_SECTION_NAME), 'routing section must register')
assert.ok(available.prompt.includes(routingMarker), 'routing prose must be delivered when the probe tool is visible')
assert.ok(!available.prompt.includes(FASTCTX_MISSING_TEXT), 'missing text must not appear when FastCtx is available')
assert.ok(
  available.prompt.indexOf(marker) < available.prompt.indexOf(routingMarker),
  'routing prose must follow the contract',
)

const unavailable = await assembleWith({}, BARE, [fakeTools([])])
assert.ok(unavailable.prompt.includes(FASTCTX_MISSING_TEXT), 'missing text must appear when the probe is absent')
assert.ok(!unavailable.prompt.includes(routingMarker), 'routing prose must not appear when FastCtx is unavailable')

const noToolsService = await assembleWith({}, BARE)
assert.ok(noToolsService.prompt.includes(FASTCTX_MISSING_TEXT), 'a deployment without dsh-tools must degrade, not throw')

const fastctxOff = await assembleWith(NO_FASTCTX, BARE)
assert.ok(!fastctxOff.assembly.sections.some((section) => section.name === FASTCTX_SECTION_NAME), 'fastctx:false must register no routing section')
assert.ok(!fastctxOff.prompt.includes(FASTCTX_MISSING_TEXT), 'fastctx:false must not leak the fallback line')

// ── config validation ───────────────────────────────────────────────────────

const fakeCtx = {
  effect: (execute) => {
    execute()
    return () => {}
  },
  systemPrompt: {
    section: () => () => {},
    variable: () => () => {},
  },
}
assert.throws(() => apply(fakeCtx, { ...NO_FASTCTX, variables: { 'Bad-Name': 'x' } }), /invalid variable name/)

console.log('smoke ok')
console.log(`  contract    ${contract.length} chars, ${contract.split('\n').length} lines, ${references.length} variable reference(s)`)
console.log(`  fastctx     ${routing.length} chars, gated on mcp__fastctx__inspect_local_file`)
console.log(`  sections    ${names.join(' -> ')}`)
console.log(`  prompt      ${prompt.length} chars, contains ${JSON.stringify(marker)}`)
console.log('  overrides   sectionName/text respected')
console.log(`  variables   os=${facts.os} platform=${facts.platform} arch=${facts.arch} release=${facts.os_release}`)
console.log('  gating      visible -> prose, absent -> fallback, no tools service -> fallback, fastctx:false -> neither')
