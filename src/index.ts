/**
 * Inject a CTF / competition agent contract as a DeepSeek Harness system-prompt
 * section.
 *
 * The prose lives in `contract.md` at the package root and is read at mount
 * time, so the text can be edited without touching code. `order` defaults to
 * 10, which lands the section right after the deployment persona (order 0) and
 * before plan-mode policy (500) and the per-tool guidance sections (1000+).
 *
 * @module dsh-ctf-prompt
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: this package's declarations augment
// `Context` with `systemPrompt`, and an augmentation only applies when its
// module is part of the program. Erased at emit, so there is no runtime import.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name. */
export const name = 'ctf-prompt'

/** The prompt registry this row contributes to. */
export const inject: string[] = ['systemPrompt']

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

/** Plugin config: how the contract section is registered. */
export interface Config {
  /**
   * Section placement. Sections are concatenated in ascending order, so a value
   * below 500 keeps the contract ahead of plan-mode policy. Defaults to
   * {@link DEFAULT_ORDER}.
   */
  order?: number
  /**
   * Registered section name. Must not collide with a section already registered
   * in the same layer; an agent scope can shadow it by name. Defaults to
   * {@link DEFAULT_SECTION_NAME}.
   */
  sectionName?: string
  /** Inline prose, replacing the bundled `contract.md`. */
  text?: string
  /** Absolute path to another markdown file, replacing the bundled `contract.md`. */
  contractPath?: string
  /**
   * Treat this section as the complete system prompt, suppressing every other
   * section. At most one effective complete section may exist per assembly.
   */
  complete?: boolean
}

/** Bundled contract text, resolved relative to the built module in `lib/`. */
const BUNDLED_CONTRACT = new URL('../contract.md', import.meta.url)

/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export function readContract(): string {
  return readFileSync(fileURLToPath(BUNDLED_CONTRACT), 'utf8')
}

/**
 * Register the contract as one system-prompt section.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for placement, name, and text.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const order = config.order ?? DEFAULT_ORDER
  if (!Number.isFinite(order)) throw new TypeError(`ctf-prompt: order must be a finite number (got ${String(order)})`)

  const sectionName = config.sectionName ?? DEFAULT_SECTION_NAME
  if (sectionName.length === 0) throw new TypeError('ctf-prompt: sectionName must be a non-empty string')

  let text = config.text
  if (text === undefined) {
    text = config.contractPath === undefined ? readContract() : readFileSync(config.contractPath, 'utf8')
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: sectionName,
    order,
    text,
    ...(config.complete === true ? { complete: true } : {}),
  }), 'ctf-prompt.section()')
}
