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
 * Everything else the page edits — the entry index, the presets, the
 * subscriptions, the outbound settings — is a settings field, and this route
 * only fills the gaps that transport leaves: an id nobody holds, a body file, a
 * script on disk, a source's upstream check.
 *
 * @module dsh-prompt-manager/routes
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedBody } from './entries.js';
import { PromptStore } from './store.js';
import { type PromptScripts } from './scripts.js';
import type { Subscriptions } from './subscriptions.js';
import type { VariableView } from './index.js';
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
    /**
     * Ids the configured presets already hold.
     *
     * The page writes the preset list over the settings transport like it writes
     * the entry index, so the only thing it cannot work out by itself is which id
     * is still free for a new one.
     */
    presetIds(): string[];
    /** Report a non-fatal problem. */
    warn(message: string): void;
    /** The subscription engine, for the source routes. */
    subscriptions: Subscriptions;
    /** The user-script engine, for the variable and script routes. */
    scripts: PromptScripts;
    /**
     * The prompt variables in force, with their provenance and the entries that
     * reference them. Probes and cached script runs are read once at mount, so
     * this is how a deployment checks what is actually being interpolated without
     * making a model step.
     */
    variables(): VariableView[];
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