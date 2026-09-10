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
import type { Context } from '@deepseek-ai/cordis';
import { type ProbeSpec, type ProbeTexts } from './probe.js';
export { MAX_BODY_BYTES, MAX_ENTRIES } from './entries.js';
export { PromptStore } from './store.js';
export { ROUTE_PREFIX } from './routes.js';
export { MAX_PROBES } from './probe.js';
/** Cordis plugin name. */
export declare const name = "prompt-manager";
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
     */
    probes?: Record<string, ProbeSpec>;
    /** Replace the placeholder texts a probe contributes when it yields no version. */
    probeTexts?: Partial<ProbeTexts>;
    /** Total time the pass may spend, in milliseconds. Defaults to 8000. */
    probeBudgetMs?: number;
    /**
     * Directory holding one markdown file per entry, under a `sections/`
     * subdirectory. Defaults to `$DSH_HOME/prompt-manager`, where `$DSH_HOME` is the
     * environment value when set and `~/.dsh` otherwise.
     */
    storeDir?: string;
}
/**
 * Facts about the running process, as prompt-variable values.
 * @returns one value per environment variable this plugin registers.
 */
export declare function environmentFacts(): EnvironmentFacts;
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