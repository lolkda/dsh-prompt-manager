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
 * Register the contract section and its prompt variables.
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
}
//# sourceMappingURL=index.js.map