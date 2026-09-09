import { readFileSync } from 'node:fs';
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
/** Bundled contract text, resolved relative to the built module in `lib/`. */
const BUNDLED_CONTRACT = new URL('../contract.md', import.meta.url);
/**
 * Read the bundled contract text.
 * @returns the exact UTF-8 contract prose.
 */
export function readContract() {
    return readFileSync(fileURLToPath(BUNDLED_CONTRACT), 'utf8');
}
/**
 * Register the contract as one system-prompt section.
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for placement, name, and text.
 */
export function apply(ctx, config = {}) {
    const order = config.order ?? DEFAULT_ORDER;
    if (!Number.isFinite(order))
        throw new TypeError(`ctf-prompt: order must be a finite number (got ${String(order)})`);
    const sectionName = config.sectionName ?? DEFAULT_SECTION_NAME;
    if (sectionName.length === 0)
        throw new TypeError('ctf-prompt: sectionName must be a non-empty string');
    let text = config.text;
    if (text === undefined) {
        text = config.contractPath === undefined ? readContract() : readFileSync(config.contractPath, 'utf8');
    }
    ctx.effect(() => ctx.systemPrompt.section({
        name: sectionName,
        order,
        text,
        ...(config.complete === true ? { complete: true } : {}),
    }), 'ctf-prompt.section()');
}
//# sourceMappingURL=index.js.map