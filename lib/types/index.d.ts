/**
 * Inject a CTF / competition agent contract as a DeepSeek Harness system-prompt
 * section.
 *
 * The prose lives in `contract.md` and `fastctx.md` at the package root and is
 * read at mount time, so the text can be edited without touching code. `order`
 * defaults to 10, which lands the contract right after the deployment persona
 * (order 0) and before plan-mode policy (500) and the per-tool guidance
 * sections (1000+).
 *
 * The section text is interpolated against prompt variables at each assembly.
 * The harness registers `{{model}}`, `{{cwd}}`, and `{{provider}}`; this plugin
 * adds `{{os}}`, `{{os_release}}`, `{{platform}}`, and `{{arch}}`, plus any
 * `variables` given in config.
 *
 * The FastCtx routing prose is a second section whose text is resolved per
 * assembly: it is delivered only while the configured FastCtx tools are visible
 * to the agent, and replaced by a short fallback line otherwise.
 *
 * @module dsh-ctf-prompt
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "ctf-prompt";
/** The prompt registry this row contributes to. */
export declare const inject: string[];
/**
 * Default section name. Registered in the global layer, so every agent sees it
 * unless that agent's scope registers the same name.
 */
export declare const DEFAULT_SECTION_NAME = "user:ctf-contract";
/**
 * Default placement. 10 sits after the deployment persona (order 0) and before
 * plan-mode policy (500) and the per-tool guidance sections (1000+).
 */
export declare const DEFAULT_ORDER = 10;
/** Section name for the conditional FastCtx routing prose. */
export declare const FASTCTX_SECTION_NAME = "user:fastctx-routing";
/** Placement for the FastCtx routing section, just after the contract. */
export declare const FASTCTX_ORDER = 20;
/**
 * Tools whose visibility proves the FastCtx MCP server connected. One probe is
 * enough; a deployment that names the server differently overrides this list.
 */
export declare const DEFAULT_FASTCTX_TOOLS: string[];
/**
 * Delivered in place of the routing prose when FastCtx is unavailable, so the
 * model does not chase tools that are not there.
 */
export declare const FASTCTX_MISSING_TEXT = "The FastCtx MCP server is not available in this session, so its tools cannot be called. Fall back to the harness's own read, grep, glob, and pwsh tools for local file and shell work.";
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
/** Plugin config: how the contract section and its variables are registered. */
export interface Config {
    /**
     * Section placement. Sections are concatenated in ascending order, so a value
     * below 500 keeps the contract ahead of plan-mode policy. Defaults to
     * {@link DEFAULT_ORDER}.
     */
    order?: number;
    /**
     * Registered section name. Must not collide with a section already registered
     * in the same layer; an agent scope can shadow it by name. Defaults to
     * {@link DEFAULT_SECTION_NAME}.
     */
    sectionName?: string;
    /** Inline prose, replacing the bundled `contract.md`. */
    text?: string;
    /** Absolute path to another markdown file, replacing the bundled `contract.md`. */
    contractPath?: string;
    /**
     * Treat this section as the complete system prompt, suppressing every other
     * section. At most one effective complete section may exist per assembly.
     */
    complete?: boolean;
    /**
     * Register {@link environmentFacts} as prompt variables. Defaults to `true`;
     * set `false` when the contract never references them, or when another row
     * already owns those names.
     */
    environment?: boolean;
    /**
     * Extra `{{name}}` variables with fixed values. Names must match
     * `[a-z][a-z0-9_]*` and must not repeat a registered name.
     */
    variables?: Record<string, string>;
    /**
     * Prepend a one-line runtime-environment paragraph to the section text, so
     * the model learns the platform without editing `contract.md`. Defaults to
     * `false`.
     */
    environmentLine?: boolean;
    /**
     * Register the FastCtx routing section. Its text is delivered only while the
     * `fastctxTools` probes resolve, and replaced by `fastctxMissingText`
     * otherwise. Defaults to `true`.
     */
    fastctx?: boolean;
    /**
     * Tool names whose visibility means FastCtx is available. Defaults to
     * {@link DEFAULT_FASTCTX_TOOLS}.
     */
    fastctxTools?: string[];
    /**
     * Text delivered instead of the routing prose when FastCtx is unavailable.
     * Defaults to {@link FASTCTX_MISSING_TEXT}.
     */
    fastctxMissingText?: string;
}
/**
 * Facts about the running process, as prompt-variable values.
 * @returns one value per environment variable this plugin registers.
 */
export declare function environmentFacts(): EnvironmentFacts;
/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export declare function readContract(): string;
/**
 * Read the bundled FastCtx routing prose.
 * @returns the exact UTF-8 routing prose.
 */
export declare function readFastctx(): string;
/**
 * Register the contract section, its variables, and the conditional FastCtx
 * routing section.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for placement, name, text, and variables.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map