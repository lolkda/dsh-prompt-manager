import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
/** Cordis plugin name. */
export const name = 'ctf-prompt';
/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt'];
/**
 * Default section name. Registered in the global layer, so every agent sees it
 * unless that agent's scope registers the same name.
 */
export const DEFAULT_SECTION_NAME = 'user:ctf-contract';
/**
 * Default placement. 10 sits after the deployment persona (order 0) and before
 * plan-mode policy (500) and the per-tool guidance sections (1000+).
 */
export const DEFAULT_ORDER = 10;
/** Section name for the conditional FastCtx routing prose. */
export const FASTCTX_SECTION_NAME = 'user:fastctx-routing';
/** Placement for the FastCtx routing section, just after the contract. */
export const FASTCTX_ORDER = 20;
/**
 * Tools whose visibility proves the FastCtx MCP server connected. One probe is
 * enough; a deployment that names the server differently overrides this list.
 */
export const DEFAULT_FASTCTX_TOOLS = ['mcp__fastctx__inspect_local_file'];
/**
 * Delivered in place of the routing prose when FastCtx is unavailable, so the
 * model does not chase tools that are not there.
 */
export const FASTCTX_MISSING_TEXT = "The FastCtx MCP server is not available in this session, so its tools cannot be called. Fall back to the harness's own read, grep, glob, and pwsh tools for local file and shell work.";
/** Valid prompt-variable names, mirroring the registry's own rule. */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
/** Friendly names for the platforms this harness realistically runs on. */
const PLATFORM_NAMES = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
    freebsd: 'FreeBSD',
    openbsd: 'OpenBSD',
    netbsd: 'NetBSD',
    sunos: 'Solaris',
    aix: 'AIX',
};
/** Bundled contract text, resolved relative to the built module in `lib/`. */
const BUNDLED_CONTRACT = new URL('../contract.md', import.meta.url);
/** Bundled FastCtx routing prose, resolved relative to the built module in `lib/`. */
const BUNDLED_FASTCTX = new URL('../fastctx.md', import.meta.url);
/** Friendly platform name for the running process. */
function platformName() {
    return PLATFORM_NAMES[process.platform] ?? process.platform;
}
/**
 * Facts about the running process, as prompt-variable values.
 * @returns one value per environment variable this plugin registers.
 */
export function environmentFacts() {
    return {
        os: platformName(),
        os_release: release(),
        platform: process.platform,
        arch: process.arch,
    };
}
/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export function readContract() {
    return readFileSync(fileURLToPath(BUNDLED_CONTRACT), 'utf8');
}
/**
 * Read the bundled FastCtx routing prose.
 * @returns the exact UTF-8 routing prose.
 */
export function readFastctx() {
    return readFileSync(fileURLToPath(BUNDLED_FASTCTX), 'utf8');
}
/**
 * Whether any probe tool is visible to a scope. A missing registry reads as
 * unavailable, so a deployment without `dsh-tools` degrades instead of failing.
 * @param ctx - Cordis context whose `tools` service is consulted.
 * @param probes - tool names to look up.
 * @param scope - the agent whose visibility applies, or `undefined` for the global view.
 * @returns `true` when at least one probe resolves to a definition.
 */
function probesVisible(ctx, probes, scope) {
    const tools = ctx.get('tools');
    if (tools === undefined)
        return false;
    return probes.some((probe) => tools.get(probe, scope) !== undefined);
}
/**
 * Register the contract section, its variables, and the conditional FastCtx
 * routing section.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for placement, name, text, and variables.
 */
export function apply(ctx, config = {}) {
    const order = config.order ?? DEFAULT_ORDER;
    if (!Number.isFinite(order))
        throw new TypeError(`ctf-prompt: order must be a finite number (got ${String(order)})`);
    const sectionName = config.sectionName ?? DEFAULT_SECTION_NAME;
    if (sectionName.length === 0)
        throw new TypeError('ctf-prompt: sectionName must be a non-empty string');
    const facts = environmentFacts();
    if (config.environment ?? true) {
        for (const [variable, value] of Object.entries(facts)) {
            ctx.effect(() => ctx.systemPrompt.variable(variable, () => value), `ctf-prompt.variable(${variable})`);
        }
    }
    for (const [variable, value] of Object.entries(config.variables ?? {})) {
        if (!VARIABLE_NAME.test(variable)) {
            throw new Error(`ctf-prompt: invalid variable name ${JSON.stringify(variable)} (must match ${String(VARIABLE_NAME)})`);
        }
        ctx.effect(() => ctx.systemPrompt.variable(variable, () => value), `ctf-prompt.variable(${variable})`);
    }
    let text = config.text;
    if (text === undefined) {
        text = config.contractPath === undefined ? readContract() : readFileSync(config.contractPath, 'utf8');
    }
    if (config.environmentLine === true) {
        text = `Runtime environment: ${facts.os} (${facts.platform}, ${facts.arch}), OS release ${facts.os_release}.\n\n${text}`;
    }
    ctx.effect(() => ctx.systemPrompt.section({
        name: sectionName,
        order,
        text,
        ...(config.complete === true ? { complete: true } : {}),
    }), 'ctf-prompt.section()');
    if (config.fastctx ?? true) {
        const probes = config.fastctxTools ?? DEFAULT_FASTCTX_TOOLS;
        const routing = readFastctx();
        const missing = config.fastctxMissingText ?? FASTCTX_MISSING_TEXT;
        ctx.effect(() => ctx.systemPrompt.section({
            name: FASTCTX_SECTION_NAME,
            order: FASTCTX_ORDER,
            text: (context) => probesVisible(ctx, probes, context.scope) ? routing : missing,
        }), 'ctf-prompt.section(fastctx)');
    }
}
//# sourceMappingURL=index.js.map