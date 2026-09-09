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
/** Plugin config: how the contract section is registered. */
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
}
/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export declare function readContract(): string;
/**
 * Register the contract as one system-prompt section.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for placement, name, and text.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map