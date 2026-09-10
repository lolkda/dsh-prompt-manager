/**
 * The browser-facing half of the prompt store: one prefix route carrying the
 * body files the settings page edits.
 *
 * Bodies cannot ride the settings transport, because they are markdown files a
 * person also edits directly. This route is therefore the only write path from
 * the page, and it is fenced twice: loopback peers only, and same-origin
 * requests only for anything that mutates. A stale editor is refused with 409
 * through the hash the page read, so two open drafts cannot silently overwrite
 * each other.
 *
 * @module dsh-prompt-manager/routes
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedBody } from './entries.js';
import { PromptStore } from './store.js';
import type { Subscriptions } from './subscriptions.js';
/** The single prefix every route below lives under. */
export declare const ROUTE_PREFIX = "/prompt-manager";
/** What the route needs from the plugin that owns the index. */
export interface PromptRouteHost {
    /** Body files. */
    store: PromptStore;
    /** Effective body for one entry, whichever layer supplies it. */
    describe(id: string): ResolvedBody;
    /** Allocate an unused entry id for a new title. */
    idFor(title: string): string;
    /** Report a non-fatal problem. */
    warn(message: string): void;
    /** The subscription engine, for the source routes. */
    subscriptions: Subscriptions;
    /**
     * The prompt variables this row registered, with the values in force. Probes
     * run once at mount, so this is how a deployment checks what they measured
     * without making a model step.
     */
    variables(): Record<string, string>;
}
/**
 * Register the prompt-store route.
 *
 * A composition without a web server (the TUI and SDK profiles) simply gets no
 * route; the settings page then reports the store as unreachable.
 *
 * @param ctx - the plugin context whose `webServer` service is injected.
 * @param host - body resolution, id allocation, and logging.
 */
export declare function installPromptRoutes(ctx: Context, host: PromptRouteHost): void;
//# sourceMappingURL=routes.d.ts.map