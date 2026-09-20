/**
 * Manage DeepSeek Harness system-prompt sections from the Web GUI.
 *
 * The prompt is a list of entries. Each entry's index record — title, order,
 * enabled — lives in the `prompt-manager` settings namespace, and its markdown
 * body is resolved from the first source that has one: a subscription snapshot,
 * a file under the store directory, or the body this package ships. A fresh
 * install therefore starts with the built-in machine-environment prompt, and
 * anything a person writes or subscribes replaces it.
 *
 * Section text is resolved per assembly, so enabling, disabling, adding, or
 * rewriting an entry takes effect on the next model step — no restart. The host
 * module itself is loaded once at profile startup, so changing `lib/` needs a
 * restart; the browser bundle does not, because `dsh-client-hmr` re-hashes it and
 * pushes the new revision to open pages.
 *
 * The section text is interpolated against prompt variables at each assembly.
 * This plugin registers `{{os}}`, `{{os_release}}`, `{{platform}}`, `{{arch}}`,
 * `{{home}}`, `{{dsh_home}}`, `{{user}}`, and `{{host}}`, plus any fixed
 * `variables` given in config, plus one variable per `probes` entry — a command
 * whose output is measured once at mount, because a provider is evaluated
 * synchronously on every assembly and must not spawn a process. Any other row
 * may register variables as well; a name this plugin cannot take is reported and
 * skipped rather than failing the mount.
 *
 * Which sections reach the prompt is decided per assembly: the session's chosen
 * preset answers it while one is in force, and each entry's own `enabled` flag
 * answers it otherwise. Compression is a separate manual session choice; a
 * preset switch never changes it.
 *
 * @module @lolkda/dsh-prompt-manager
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ProbeSpec, type ProbeTexts } from './probe.js';
import { type ScriptOverride } from './scripts.js';
export { MAX_BODY_BYTES, MAX_ENTRIES, MAX_PRESETS } from './entries.js';
export { PromptStore } from './store.js';
export { ROUTE_PREFIX } from './routes.js';
export { MAX_PROBES } from './probe.js';
export { BUILTIN_PROMPTS } from './entries.js';
export { MAX_SCRIPTS, MAX_SCRIPT_BYTES, SCRIPTS_DIR_NAME } from './scripts.js';
/** Cordis plugin name. Distinct from the bare `prompt-manager` an unrelated package uses. */
export declare const name = "dsh-prompt-manager";
/** The prompt registry this row contributes to. */
export declare const inject: string[];
/** Section-name prefix of every entry this plugin registers. */
export declare const USER_SECTION_PREFIX = "user:prompt-manager:";
/** Settings namespace carrying the entry index. */
export declare const SETTINGS_NAMESPACE = "prompt-manager";
/** Directory name appended to the resolved Harness home holding the bodies. */
export declare const STORE_DIR_NAME = "prompt-manager";
/** Facts about the process running the harness, exposed as prompt variables. */
export interface EnvironmentFacts {
    /** Friendly platform name, e.g. `Windows`. */
    os: string;
    /** `os.release()`: Windows build, Linux kernel, or macOS Darwin version. */
    os_release: string;
    /** Raw `process.platform`, e.g. `win32`. */
    platform: string;
    /** Raw `process.arch`, e.g. `x64`. */
    arch: string;
    /** `os.homedir()`: the user's home directory. */
    home: string;
    /** The resolved harness home: `$DSH_HOME`, or `~/.dsh` when it is unset. */
    dsh_home: string;
    /** `os.userInfo().username`: the account the harness runs as. */
    user: string;
    /** `os.hostname()`: the machine's name. */
    host: string;
}
/** Plugin config: the prompt variables it registers and where bodies are stored. */
export interface Config {
    /**
     * Register {@link environmentFacts} as prompt variables. Defaults to `true`;
     * set `false` when no entry references them, or when another row already owns
     * those names.
     */
    environment?: boolean;
    /**
     * Extra `{{name}}` variables with fixed values. Names must match
     * `[a-z][a-z0-9_]*` and must not repeat a registered name.
     */
    variables?: Record<string, string>;
    /**
     * Commands to run once when this plugin mounts, one prompt variable each. The
     * value is the first non-empty output line, narrowed by the probe's `pattern`
     * when it has one; a tool that is absent, silent, or too slow contributes a
     * placeholder from {@link Config.probeTexts} instead. Nothing here runs again
     * until the row remounts, so a newly installed tool shows up after a
     * composition change or a restart, not on its own.
     *
     * These override {@link DEFAULT_PROBES} by name.
     */
    probes?: Record<string, ProbeSpec>;
    /**
     * Run the package's own {@link DEFAULT_PROBES} alongside `probes`. Defaults to
     * `true`, which is what makes the built-in environment entry resolve without
     * any configuration. Set `false` only together with entries that reference none
     * of those variables.
     */
    probeDefaults?: boolean;
    /** Replace the placeholder texts a probe contributes when it yields no version. */
    probeTexts?: Partial<ProbeTexts>;
    /** Total time the pass may spend, in milliseconds. Defaults to 8000. */
    probeBudgetMs?: number;
    /**
     * Per-script execution overrides, keyed by script name. A script is a file a
     * person wrote under the store's `scripts/` directory whose standard output is
     * a JSON object of prompt variables; this only changes how one is run —
     * interpreter, arguments, timeout. A script that needs no change runs under
     * `node`, in three seconds, with its own path as the only argument.
     */
    scripts?: Record<string, ScriptOverride>;
    /**
     * Directory holding one markdown file per entry, under a `sections/`
     * subdirectory, and one script per file under `scripts/`. Defaults to
     * `$DSH_HOME/prompt-manager`, where `$DSH_HOME` is the environment value when
     * set and `~/.dsh` otherwise.
     */
    storeDir?: string;
    /**
     * Replace the instruction a context compaction sends to its summarizer with
     * the body of the entry the index puts in force. Defaults to `true`; set
     * `false` when another row owns that seam, or to keep this plugin strictly to
     * the system prompt.
     *
     * The default changes nothing: with no entry in force — which is every
     * deployment that never made one — every compaction call goes out exactly as
     * the engine built it.
     */
    compaction?: boolean;
}
/** Where one prompt variable's value came from. */
export type VariableSource = 'environment' | 'config' | 'probe' | 'script';
/** One prompt variable, as the settings page sees it. */
export interface VariableView {
    /** The `{{name}}` reference. */
    name: string;
    /** The value every assembly currently sees. */
    value: string;
    /** Which layer supplied it. */
    source: VariableSource;
    /** Owning script name, for a script variable. */
    detail?: string | undefined;
    /** When the value was last written. */
    updatedAt?: string | undefined;
    /** Titles of the prompt entries whose bodies reference this variable. */
    referencedBy: string[];
}
/**
 * Facts about the running process, as prompt-variable values.
 *
 * Every one of these is a process-level fact, fixed for as long as the profile
 * runs. Deliberately absent: the *session's* working directory and the model in
 * use. The registry's `AssembleContext` carries only a scope key and a signal,
 * so those are not reachable from a variable provider — and publishing the host
 * process's `process.cwd()` under the name `cwd` would invite exactly the wrong
 * reading, since a session's workspace can be a different directory.
 *
 * @returns one value per environment variable this plugin registers.
 */
export declare function environmentFacts(): EnvironmentFacts;
/**
 * The harness home directory: `$DSH_HOME` when it names one, `~/.dsh` otherwise.
 *
 * The one place this is decided, so the `{{dsh_home}}` variable and the store
 * directory can never disagree about where the harness keeps its files.
 *
 * @returns an absolute path.
 */
export declare function resolveHarnessHome(): string;
/**
 * Resolve the directory holding the entry bodies and the settings files.
 * @param config - plugin config; `storeDir` wins when it names a directory.
 * @returns an absolute path, without the `sections` leaf.
 */
export declare function resolveStoreDir(config?: Config): string;
/**
 * Register the prompt sections, their variables, the settings index, and the
 * body-file route.
 *
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for variables and storage.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map