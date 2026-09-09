#!/usr/bin/env node
/**
 * Smoke test: mount this plugin into a real SystemPrompt registry and assert
 * that the contract section lands in the assembled system prompt, in the
 * intended position.
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

import { DEFAULT_ORDER, DEFAULT_SECTION_NAME, apply, inject, name, readContract } from '../lib/index.js'

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
 * Mount the plugin into a fresh SystemPrompt registry.
 * @param config - plugin config.
 * @param promptConfig - SystemPrompt service config.
 * @returns the rendered system prompt and the assembly.
 */
async function assembleWith(config, promptConfig) {
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: SystemPrompt, renderPrompt } = await load('@deepseek-ai/dsh-system-prompt')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, promptConfig)
  await ctx.plugin({ name, inject, apply }, config)
  const assembly = await ctx.systemPrompt.assemble({})
  return { assembly, prompt: renderPrompt(assembly) }
}

const contract = readContract()
assert.ok(contract.length > 0, 'contract.md must not be empty')
assert.ok(!contract.includes('{{'), 'contract.md must not contain a {{ variable reference: assembly would throw')

const marker = contract.split('\n').find((line) => line.startsWith('## '))
assert.ok(marker !== undefined, 'contract.md must contain at least one "## " heading')

const { assembly, prompt } = await assembleWith({ order: DEFAULT_ORDER }, { persona: 'TEST-PERSONA' })
const names = assembly.sections.map((section) => section.name)

assert.ok(names.includes(DEFAULT_SECTION_NAME), `expected section ${DEFAULT_SECTION_NAME} in ${names.join(', ')}`)
assert.ok(names.indexOf('deployment:persona') < names.indexOf(DEFAULT_SECTION_NAME), 'contract must come after the persona')
assert.ok(prompt.includes(marker), `assembled prompt must contain ${marker}`)
assert.ok(prompt.includes('TEST-PERSONA'), 'assembled prompt must keep the persona section')

const overridden = await assembleWith(
  { order: 42, sectionName: 'user:custom', text: 'ONLY-THIS-TEXT' },
  { includeHarnessIdentity: false, includeRuntimeContext: false },
)
assert.equal(overridden.prompt, 'ONLY-THIS-TEXT', 'text/sectionName overrides must replace the bundled contract')

console.log('smoke ok')
console.log(`  contract    ${contract.length} chars, ${contract.split('\n').length} lines, no {{ references`)
console.log(`  sections    ${names.join(' -> ')}`)
console.log(`  prompt      ${prompt.length} chars, contains ${JSON.stringify(marker)}`)
console.log('  overrides   sectionName/text respected')
