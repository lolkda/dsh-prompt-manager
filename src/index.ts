/**
 * Inject a CTF / competition agent contract as a DeepSeek Harness system-prompt
 * section.
 *
 * The prose lives in `contract.md` at the package root and is read at mount
 * time, so the text can be edited without touching code. `order` defaults to
 * 10, which lands the section right after the deployment persona (order 0) and
 * before plan-mode policy (500) and the per-tool guidance sections (1000+).
 *
 * The section text is interpolated against prompt variables at each assembly.
 * The harness registers `{{model}}`, `{{cwd}}`, and `{{provider}}`; this plugin
 * adds `{{os}}`, `{{os_release}}`, `{{platform}}`, and `{{arch}}`, plus any
 * `variables` given in config.
 *
 * @module dsh-ctf-prompt
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: this package's declarations augment
// `Context` with `systemPrompt`, and an augmentation only applies when its
// module is part of the program. Erased at emit, so there is no runtime import.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { readFileSync } from 'node:fs'
import { release } from 'node:os'
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

/** Valid prompt-variable names, mirroring the registry's own rule. */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/** Friendly names for the platforms this harness realistically runs on. */
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
  freebsd: 'FreeBSD',
  openbsd: 'OpenBSD',
  netbsd: 'NetBSD',
  sunos: 'Solaris',
  aix: 'AIX',
}

/** Facts about the process running the harness, exposed as prompt variables. */
export interface EnvironmentFacts {
  /** Friendly platform name, e.g. `Windows`. */
  os: string
  /** `os.release()`: Windows build, Linux kernel, or macOS Darwin version. */
  os_release: string
  /** Raw `process.platform`, e.g. `win32`. */
  platform: string
  /** Raw `process.arch`, e.g. `x64`. */
  arch: string
}

/** Plugin config: how the contract section and its variables are registered. */
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
  /**
   * Register {@link environmentFacts} as prompt variables. Defaults to `true`;
   * set `false` when the contract never references them, or when another row
   * already owns those names.
   */
  environment?: boolean
  /**
   * Extra `{{name}}` variables with fixed values. Names must match
   * `[a-z][a-z0-9_]*` and must not repeat a registered name.
   */
  variables?: Record<string, string>
  /**
   * Prepend a one-line runtime-environment paragraph to the section text, so
   * the model learns the platform without editing `contract.md`. Defaults to
   * `false`.
   */
  environmentLine?: boolean
}

/** Bundled contract text, resolved relative to the built module in `lib/`. */
const BUNDLED_CONTRACT = new URL('../contract.md', import.meta.url)

/** Friendly platform name for the running process. */
function platformName(): string {
  return PLATFORM_NAMES[process.platform] ?? process.platform
}

/**
 * Facts about the running process, as prompt-variable values.
 * @returns one value per environment variable this plugin registers.
 */
export function environmentFacts(): EnvironmentFacts {
  return {
    os: platformName(),
    os_release: release(),
    platform: process.platform,
    arch: process.arch,
  }
}

/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export function readContract(): string {
  return readFileSync(fileURLToPath(BUNDLED_CONTRACT), 'utf8')
}

/**
 * Register the contract section and its prompt variables.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for placement, name, text, and variables.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const order = config.order ?? DEFAULT_ORDER
  if (!Number.isFinite(order)) throw new TypeError(`ctf-prompt: order must be a finite number (got ${String(order)})`)

  const sectionName = config.sectionName ?? DEFAULT_SECTION_NAME
  if (sectionName.length === 0) throw new TypeError('ctf-prompt: sectionName must be a non-empty string')

  const facts = environmentFacts()
  if (config.environment ?? true) {
    for (const [variable, value] of Object.entries(facts)) {
      ctx.effect(() => ctx.systemPrompt.variable(variable, () => value), `ctf-prompt.variable(${variable})`)
    }
  }
  for (const [variable, value] of Object.entries(config.variables ?? {})) {
    if (!VARIABLE_NAME.test(variable)) {
      throw new Error(`ctf-prompt: invalid variable name ${JSON.stringify(variable)} (must match ${String(VARIABLE_NAME)})`)
    }
    ctx.effect(() => ctx.systemPrompt.variable(variable, () => value), `ctf-prompt.variable(${variable})`)
  }

  let text = config.text
  if (text === undefined) {
    text = config.contractPath === undefined ? readContract() : readFileSync(config.contractPath, 'utf8')
  }
  if (config.environmentLine === true) {
    text = `Runtime environment: ${facts.os} (${facts.platform}, ${facts.arch}), OS release ${facts.os_release}.\n\n${text}`
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: sectionName,
    order,
    text,
    ...(config.complete === true ? { complete: true } : {}),
  }), 'ctf-prompt.section()')
}
