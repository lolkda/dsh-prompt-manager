/**
 * Inject a CTF / competition agent contract as a DeepSeek Harness system-prompt
 * section.
 *
 * The prose lives in `contract.md` next to this package and is read at mount
 * time, so the text can be edited without touching code. `order` defaults to
 * 10, which lands the section right after the deployment persona (order 0) and
 * before plan-mode policy (500) and the per-tool guidance sections (1000+).
 *
 * @module dsh-ctf-prompt
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name. */
export const name = 'ctf-prompt'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/**
 * Default section name. Registered in the global layer, so every agent sees it
 * unless that agent's scope registers the same name.
 */
export const DEFAULT_SECTION_NAME = 'user:ctf-contract'

/**
 * Default placement. 10 sits after the deployment persona (order 0) and before
 * plan-mode policy (500) and the per-tool guidance sections (1000+).
 */
export const DEFAULT_ORDER = 10

/** Bundled contract text, resolved relative to this module. */
const BUNDLED_CONTRACT = new URL('../contract.md', import.meta.url)

/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export function readContract() {
  return readFileSync(fileURLToPath(BUNDLED_CONTRACT), 'utf8')
}

/**
 * Register the contract as one system-prompt section.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides.
 */
export function apply(ctx, config) {
  const options = config ?? {}

  const order = options.order ?? DEFAULT_ORDER
  if (!Number.isFinite(order)) throw new TypeError(`ctf-prompt: order must be a finite number (got ${String(order)})`)

  const sectionName = options.sectionName ?? DEFAULT_SECTION_NAME
  if (typeof sectionName !== 'string' || sectionName.length === 0) throw new TypeError('ctf-prompt: sectionName must be a non-empty string')

  let text = options.text
  if (text === undefined) {
    text = options.contractPath === undefined ? readContract() : readFileSync(options.contractPath, 'utf8')
  }
  if (typeof text !== 'string') throw new TypeError('ctf-prompt: text must be a string')

  ctx.effect(() => ctx.systemPrompt.section({
    name: sectionName,
    order,
    text,
    ...(options.complete === true ? { complete: true } : {}),
  }), 'ctf-prompt.section()')
}
