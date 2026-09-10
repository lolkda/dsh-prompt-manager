/**
 * Manage DeepSeek Harness system-prompt sections from the Web GUI.
 *
 * The prompt is a list of entries. Each entry's index record — title, order,
 * enabled — lives in the `prompt-manager` settings namespace, and its markdown
 * body lives in one file under the store directory, so a person can edit the
 * prose either in the settings page or in an editor. The plugin ships no entries
 * of its own: a fresh install starts empty, and prose arrives from the settings
 * page or from a subscribed repository.
 *
 * Section text is resolved per assembly, so enabling, disabling, adding, or
 * rewriting an entry takes effect on the next model step — no restart. Only the
 * browser half of this plugin is snapshotted at profile startup.
 *
 * The section text is interpolated against prompt variables at each assembly.
 * This plugin registers `{{os}}`, `{{os_release}}`, `{{platform}}`, and
 * `{{arch}}`, plus any fixed `variables` given in config, plus one variable per
 * `probes` entry — a command whose output is measured once at mount, because a
 * provider is evaluated synchronously on every assembly and must not spawn a
 * process. Any other row may register variables as well; a name this plugin
 * cannot take is reported and skipped rather than failing the mount.
 *
 * @module dsh-prompt-manager
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: the declaration augments `Context` with the
// `systemPrompt` service this plugin contributes to, and an augmentation only
// applies when its module is part of the program. Erased at emit, so there is no
// runtime import.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createRequire } from 'node:module'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import {
  buildIndexSchema,
  entryIdFor,
  parseEntries,
  type PromptEntry,
  type ResolvedBody,
  type SchemaFactory,
} from './entries.js'
import { installPromptRoutes } from './routes.js'
import { PromptStore } from './store.js'
import { normalizeMirror, parseSources, type PromptSource } from './source.js'
import { Subscriptions, type SubscriptionLocation } from './subscriptions.js'
import type { ProxyConfig } from './net.js'
import {
  DEFAULT_PROBE_TEXTS,
  MAX_PROBES,
  normalizeProbes,
  runProbes,
  type ProbeSpec,
  type ProbeTexts,
} from './probe.js'

export { MAX_BODY_BYTES, MAX_ENTRIES } from './entries.js'
export { PromptStore } from './store.js'
export { ROUTE_PREFIX } from './routes.js'
export { MAX_PROBES } from './probe.js'

/** Cordis plugin name. */
export const name = 'prompt-manager'

/** The prompt registry this row contributes to. */
export const inject: string[] = ['systemPrompt']

/** Section-name prefix of every entry this plugin registers. */
export const USER_SECTION_PREFIX = 'user:prompt-manager:'

/** Settings namespace carrying the entry index. */
export const SETTINGS_NAMESPACE = 'prompt-manager'

/** Directory name appended to the resolved Harness home holding the bodies. */
export const STORE_DIR_NAME = 'prompt-manager'

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

/** Plugin config: the prompt variables it registers and where bodies are stored. */
export interface Config {
  /**
   * Register {@link environmentFacts} as prompt variables. Defaults to `true`;
   * set `false` when no entry references them, or when another row already owns
   * those names.
   */
  environment?: boolean
  /**
   * Extra `{{name}}` variables with fixed values. Names must match
   * `[a-z][a-z0-9_]*` and must not repeat a registered name.
   */
  variables?: Record<string, string>
  /**
   * Commands to run once when this plugin mounts, one prompt variable each. The
   * value is the first non-empty output line, narrowed by the probe's `pattern`
   * when it has one; a tool that is absent, silent, or too slow contributes a
   * placeholder from {@link Config.probeTexts} instead. Nothing here runs again
   * until the row remounts, so a newly installed tool shows up after a
   * composition change or a restart, not on its own.
   */
  probes?: Record<string, ProbeSpec>
  /** Replace the placeholder texts a probe contributes when it yields no version. */
  probeTexts?: Partial<ProbeTexts>
  /** Total time the pass may spend, in milliseconds. Defaults to 8000. */
  probeBudgetMs?: number
  /**
   * Directory holding one markdown file per entry, under a `sections/`
   * subdirectory. Defaults to `$DSH_HOME/prompt-manager`, where `$DSH_HOME` is the
   * environment value when set and `~/.dsh` otherwise.
   */
  storeDir?: string
}

/** The `settings` service slice this plugin registers its index with. */
interface SettingsFace {
  register(namespace: string, schema: unknown, options?: { base?: unknown }): {
    /** The resolved index, deep-frozen. */
    get(): unknown
    /** Merge a patch into the user layer and persist it. */
    update(patch: Record<string, unknown>): Promise<unknown>
    /** Observe committed changes; returns the disposer. */
    watch(callback: () => void): () => void
  }
}

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
 * Resolve the directory holding the entry bodies and the settings files.
 * @param config - plugin config; `storeDir` wins when it names a directory.
 * @returns an absolute path, without the `sections` leaf.
 */
export function resolveStoreDir(config: Config = {}): string {
  const configured = config.storeDir?.trim()
  if (configured !== undefined && configured.length > 0) return configured
  const home = process.env['DSH_HOME']?.trim()
  const root = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(root, STORE_DIR_NAME)
}

/**
 * Load the schemastery factory a settings namespace needs.
 *
 * Read through `createRequire` rather than a static import: a deployment
 * without the settings capability also has no schemastery, and this plugin must
 * still mount there with its composed configuration.
 *
 * @returns the schema factory, or `undefined` when it cannot be resolved.
 */
function loadSchemaFactory(): SchemaFactory | undefined {
  try {
    const loaded: unknown = createRequire(import.meta.url)('@deepseek-ai/schemastery')
    const candidate: unknown = typeof loaded === 'function'
      ? loaded
      : (loaded as { default?: unknown } | null)?.default
    if (typeof candidate !== 'function') return undefined
    const factory = candidate as unknown as Partial<SchemaFactory>
    if (typeof factory.object !== 'function' || typeof factory.array !== 'function') return undefined
    return factory as SchemaFactory
  } catch {
    return undefined
  }
}

/**
 * Report a non-fatal problem without ever breaking the mount.
 * @param ctx - plugin context owning the logger.
 * @param message - the detail to report.
 */
function warn(ctx: Context, message: string): void {
  try {
    ctx.logger?.warn(`prompt-manager: ${message}`)
  } catch {
    /* logging must never be the reason a session cannot assemble a prompt */
  }
}

/**
 * Message text of an unknown thrown value.
 * @param error - the caught value.
 * @returns a human-facing message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register the prompt sections, their variables, the settings index, and the
 * body-file route.
 *
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for variables and storage.
 */
export function apply(ctx: Context, config: Config = {}): void {
  /** Values this row registered, as the status route reports them. */
  const variableValues: Record<string, string> = {}

  /**
   * Register one prompt variable, and remember its value for the status route.
   *
   * A name another row already owns is reported and skipped: the registry
   * refuses duplicates, and one contested name must not cost the whole mount.
   *
   * @param variable - the `{{name}}` to register; already validated by callers.
   * @param value - the value every assembly will see.
   */
  function registerVariable(variable: string, value: string): void {
    try {
      ctx.effect(() => ctx.systemPrompt.variable(variable, () => value), `prompt-manager.variable(${variable})`)
      variableValues[variable] = value
    } catch (error) {
      warn(ctx, `cannot register the prompt variable ${variable}, so entries referencing it will not assemble: ${messageOf(error)}`)
    }
  }

  const facts = environmentFacts()
  if (config.environment ?? true) {
    for (const [variable, value] of Object.entries(facts)) registerVariable(variable, value)
  }
  for (const [variable, value] of Object.entries(config.variables ?? {})) {
    if (!VARIABLE_NAME.test(variable)) {
      throw new Error(`prompt-manager: invalid variable name ${JSON.stringify(variable)} (must match ${String(VARIABLE_NAME)})`)
    }
    registerVariable(variable, value)
  }

  // A malformed probe is a composition mistake, so it fails the mount loudly
  // rather than leaving a `{{name}}` that no assembly can resolve. Whether a
  // probed tool exists, stays silent, or hangs is a value, not an error.
  const probed = normalizeProbes(config.probes)
  if (probed.problems.length > 0) throw new Error(`prompt-manager: ${probed.problems.join('; ')}`)
  const probeNames = Object.keys(probed.specs)
  if (probeNames.length > MAX_PROBES) {
    throw new Error(`prompt-manager: at most ${String(MAX_PROBES)} probes are allowed, got ${String(probeNames.length)}`)
  }
  if (probeNames.length > 0) {
    const report = runProbes(probed.specs, {
      texts: { ...DEFAULT_PROBE_TEXTS, ...config.probeTexts },
      budgetMs: config.probeBudgetMs,
    })
    for (const outcome of report.outcomes) registerVariable(outcome.name, outcome.value)
  }

  const store = new PromptStore(join(resolveStoreDir(config), 'sections'))

  /** The index in force. */
  const active: PromptEntry[] = []
  /** Live lookup for section text callbacks. */
  const byId = new Map<string, PromptEntry>()
  /** Registered sections, keyed by entry id. */
  const sections = new Map<string, { disposer: () => void; name: string; order: number }>()
  /** The resolved settings document, as the engine reads it. */
  let resolved: unknown = {
    entries: [],
    sources: [],
    mirror: '',
    proxy: { kind: 'none', url: '' },
  }
  /** Where each subscribed entry's body lives; refreshed when settings commit. */
  let locations = new Map<string, SubscriptionLocation>()
  /** How the engine writes the index back; present only with a settings service. */
  let writeEntries: ((entries: PromptEntry[]) => Promise<void>) | undefined

  function field(name: string): unknown {
    return typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)
      ? (resolved as Record<string, unknown>)[name]
      : undefined
  }

  function sourcesInForce(): PromptSource[] {
    return parseSources(field('sources'))
  }

  function proxyInForce(): ProxyConfig {
    const raw = field('proxy')
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'none', url: '' }
    const record = raw as Record<string, unknown>
    return {
      kind: typeof record['kind'] === 'string' ? record['kind'] : 'none',
      url: typeof record['url'] === 'string' ? record['url'] : '',
    }
  }

  function mirrorInForce(): string {
    return normalizeMirror(field('mirror')) ?? ''
  }

  /** The next free placement for an entry the engine adds. */
  function nextOrder(): number {
    let highest = 0
    for (const entry of active) if (entry.order > highest) highest = entry.order
    return highest + 10
  }

  const subscriptions = new Subscriptions({
    sources: sourcesInForce,
    proxy: proxyInForce,
    mirror: mirrorInForce,
    root: () => resolveStoreDir(config),
    entries: () => active,
    setEntries: async (next) => {
      if (writeEntries === undefined) throw new Error('订阅需要 settings 服务，当前部署没有挂载它')
      await writeEntries(next)
    },
    nextOrder,
    warn: (message) => warn(ctx, message),
  })

  /**
   * The body that would reach the prompt for one entry. A subscribed entry reads
   * its snapshot first — its body is upstream's, not this machine's — then the
   * local body file. Read per assembly, so an edited or freshly applied file
   * lands on the next model step.
   */
  function describe(id: string): ResolvedBody {
    if (locations.has(id)) {
      const subscribed = subscriptions.readBody(id)
      return subscribed === undefined
        ? { text: '', source: 'empty' }
        : { text: subscribed, source: 'subscribed' }
    }
    try {
      const stored = store.read(id)
      if (stored !== undefined) return { text: stored.body, source: 'user' }
    } catch (error) {
      warn(ctx, messageOf(error))
    }
    return { text: '', source: 'empty' }
  }

  /** Every entry registers under the plugin's own prefix. */
  function sectionNameFor(entry: PromptEntry): string {
    return `${USER_SECTION_PREFIX}${entry.id}`
  }

  /** The text one entry contributes right now, or `''` when it contributes none. */
  function render(id: string): string {
    const entry = byId.get(id)
    if (entry === undefined || !entry.enabled) return ''
    return describe(id).text
  }

  /**
   * Bring the registered sections in line with the index. An entry whose name
   * or placement moved is re-registered, because both are fixed when the
   * section is declared; adding, removing, enabling, and disabling need no
   * other bookkeeping because section text is resolved per assembly.
   */
  function reconcile(entries: readonly PromptEntry[]): void {
    byId.clear()
    for (const entry of entries) byId.set(entry.id, entry)
    for (const [id, registered] of [...sections]) {
      const entry = byId.get(id)
      if (entry !== undefined && registered.name === sectionNameFor(entry) && registered.order === entry.order) continue
      registered.disposer()
      sections.delete(id)
    }
    for (const entry of entries) {
      if (sections.has(entry.id)) continue
      const section = sectionNameFor(entry)
      const entryOrder = entry.order
      const disposer = ctx.effect(() => ctx.systemPrompt.section({
        name: section,
        order: entryOrder,
        text: () => render(entry.id),
      }), `prompt-manager.section(${section})`)
      sections.set(entry.id, { disposer, name: section, order: entryOrder })
    }
  }

  /** Ids a new entry may not take: the index, plus every stored body. */
  function takenIds(): string[] {
    return [...new Set([...active.map((entry) => entry.id), ...store.ids()])]
  }

  installPromptRoutes(ctx, {
    store,
    describe,
    idFor: (title) => entryIdFor(title, takenIds()),
    warn: (message) => warn(ctx, message),
    subscriptions,
    variables: () => variableValues,
  })

  const factory = loadSchemaFactory()
  if (factory === undefined) {
    warn(ctx, 'schemastery is unavailable, so prompt entries cannot be edited from Settings')
  } else {
    ctx.inject(['settings'], (scoped) => {
      const settings = (scoped as unknown as { settings?: SettingsFace }).settings
      if (settings === undefined) return
      let scope: ReturnType<SettingsFace['register']>
      try {
        scope = settings.register(SETTINGS_NAMESPACE, buildIndexSchema(factory), {
          base: {
            entries: [],
            sources: [],
            mirror: '',
            proxy: { kind: 'none', url: '' },
          },
        })
      } catch (error) {
        warn(ctx, `cannot register the ${SETTINGS_NAMESPACE} settings namespace: ${messageOf(error)}`)
        return
      }
      writeEntries = async (next) => {
        await scope.update({ entries: next })
      }
      const sync = (): void => {
        resolved = scope.get()
        const entries = parseEntries(resolved)
        active.length = 0
        active.push(...entries)
        locations = subscriptions.locate()
        reconcile(active)
      }
      sync()
      ctx.effect(() => scope.watch(sync), 'prompt-manager: settings watcher')
    })
  }

  locations = subscriptions.locate()
  reconcile(active)
}
