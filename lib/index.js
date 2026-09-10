import { createRequire } from 'node:module';
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import { buildIndexSchema, entryIdFor, parseEntries, } from './entries.js';
import { installPromptRoutes } from './routes.js';
import { PromptStore } from './store.js';
import { normalizeMirror, parseSources } from './source.js';
import { Subscriptions } from './subscriptions.js';
import { DEFAULT_PROBE_TEXTS, MAX_PROBES, normalizeProbes, runProbes, } from './probe.js';
export { MAX_BODY_BYTES, MAX_ENTRIES } from './entries.js';
export { PromptStore } from './store.js';
export { ROUTE_PREFIX } from './routes.js';
export { MAX_PROBES } from './probe.js';
/** Cordis plugin name. */
export const name = 'prompt-manager';
/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt'];
/** Section-name prefix of every entry this plugin registers. */
export const USER_SECTION_PREFIX = 'user:prompt-manager:';
/** Settings namespace carrying the entry index. */
export const SETTINGS_NAMESPACE = 'prompt-manager';
/** Directory name appended to the resolved Harness home holding the bodies. */
export const STORE_DIR_NAME = 'prompt-manager';
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
 * Resolve the directory holding the entry bodies and the settings files.
 * @param config - plugin config; `storeDir` wins when it names a directory.
 * @returns an absolute path, without the `sections` leaf.
 */
export function resolveStoreDir(config = {}) {
    const configured = config.storeDir?.trim();
    if (configured !== undefined && configured.length > 0)
        return configured;
    const home = process.env['DSH_HOME']?.trim();
    const root = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh');
    return join(root, STORE_DIR_NAME);
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
function loadSchemaFactory() {
    try {
        const loaded = createRequire(import.meta.url)('@deepseek-ai/schemastery');
        const candidate = typeof loaded === 'function'
            ? loaded
            : loaded?.default;
        if (typeof candidate !== 'function')
            return undefined;
        const factory = candidate;
        if (typeof factory.object !== 'function' || typeof factory.array !== 'function')
            return undefined;
        return factory;
    }
    catch {
        return undefined;
    }
}
/**
 * Report a non-fatal problem without ever breaking the mount.
 * @param ctx - plugin context owning the logger.
 * @param message - the detail to report.
 */
function warn(ctx, message) {
    try {
        ctx.logger?.warn(`prompt-manager: ${message}`);
    }
    catch {
        /* logging must never be the reason a session cannot assemble a prompt */
    }
}
/**
 * Message text of an unknown thrown value.
 * @param error - the caught value.
 * @returns a human-facing message.
 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Register the prompt sections, their variables, the settings index, and the
 * body-file route.
 *
 * @param ctx - Cordis context carrying the `systemPrompt` service.
 * @param config - optional overrides for variables and storage.
 */
export function apply(ctx, config = {}) {
    /** Values this row registered, as the status route reports them. */
    const variableValues = {};
    /**
     * Register one prompt variable, and remember its value for the status route.
     *
     * A name another row already owns is reported and skipped: the registry
     * refuses duplicates, and one contested name must not cost the whole mount.
     *
     * @param variable - the `{{name}}` to register; already validated by callers.
     * @param value - the value every assembly will see.
     */
    function registerVariable(variable, value) {
        try {
            ctx.effect(() => ctx.systemPrompt.variable(variable, () => value), `prompt-manager.variable(${variable})`);
            variableValues[variable] = value;
        }
        catch (error) {
            warn(ctx, `cannot register the prompt variable ${variable}, so entries referencing it will not assemble: ${messageOf(error)}`);
        }
    }
    const facts = environmentFacts();
    if (config.environment ?? true) {
        for (const [variable, value] of Object.entries(facts))
            registerVariable(variable, value);
    }
    for (const [variable, value] of Object.entries(config.variables ?? {})) {
        if (!VARIABLE_NAME.test(variable)) {
            throw new Error(`prompt-manager: invalid variable name ${JSON.stringify(variable)} (must match ${String(VARIABLE_NAME)})`);
        }
        registerVariable(variable, value);
    }
    // A malformed probe is a composition mistake, so it fails the mount loudly
    // rather than leaving a `{{name}}` that no assembly can resolve. Whether a
    // probed tool exists, stays silent, or hangs is a value, not an error.
    const probed = normalizeProbes(config.probes);
    if (probed.problems.length > 0)
        throw new Error(`prompt-manager: ${probed.problems.join('; ')}`);
    const probeNames = Object.keys(probed.specs);
    if (probeNames.length > MAX_PROBES) {
        throw new Error(`prompt-manager: at most ${String(MAX_PROBES)} probes are allowed, got ${String(probeNames.length)}`);
    }
    if (probeNames.length > 0) {
        const report = runProbes(probed.specs, {
            texts: { ...DEFAULT_PROBE_TEXTS, ...config.probeTexts },
            budgetMs: config.probeBudgetMs,
        });
        for (const outcome of report.outcomes)
            registerVariable(outcome.name, outcome.value);
    }
    const store = new PromptStore(join(resolveStoreDir(config), 'sections'));
    /** The index in force. */
    const active = [];
    /** Live lookup for section text callbacks. */
    const byId = new Map();
    /** Registered sections, keyed by entry id. */
    const sections = new Map();
    /** The resolved settings document, as the engine reads it. */
    let resolved = {
        entries: [],
        sources: [],
        mirror: '',
        proxy: { kind: 'none', url: '' },
    };
    /** Where each subscribed entry's body lives; refreshed when settings commit. */
    let locations = new Map();
    /** How the engine writes the index back; present only with a settings service. */
    let writeEntries;
    function field(name) {
        return typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)
            ? resolved[name]
            : undefined;
    }
    function sourcesInForce() {
        return parseSources(field('sources'));
    }
    function proxyInForce() {
        const raw = field('proxy');
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return { kind: 'none', url: '' };
        const record = raw;
        return {
            kind: typeof record['kind'] === 'string' ? record['kind'] : 'none',
            url: typeof record['url'] === 'string' ? record['url'] : '',
        };
    }
    function mirrorInForce() {
        return normalizeMirror(field('mirror')) ?? '';
    }
    /** The next free placement for an entry the engine adds. */
    function nextOrder() {
        let highest = 0;
        for (const entry of active)
            if (entry.order > highest)
                highest = entry.order;
        return highest + 10;
    }
    const subscriptions = new Subscriptions({
        sources: sourcesInForce,
        proxy: proxyInForce,
        mirror: mirrorInForce,
        root: () => resolveStoreDir(config),
        entries: () => active,
        setEntries: async (next) => {
            if (writeEntries === undefined)
                throw new Error('订阅需要 settings 服务，当前部署没有挂载它');
            await writeEntries(next);
        },
        nextOrder,
        warn: (message) => warn(ctx, message),
    });
    /**
     * The body that would reach the prompt for one entry. A subscribed entry reads
     * its snapshot first — its body is upstream's, not this machine's — then the
     * local body file. Read per assembly, so an edited or freshly applied file
     * lands on the next model step.
     */
    function describe(id) {
        if (locations.has(id)) {
            const subscribed = subscriptions.readBody(id);
            return subscribed === undefined
                ? { text: '', source: 'empty' }
                : { text: subscribed, source: 'subscribed' };
        }
        try {
            const stored = store.read(id);
            if (stored !== undefined)
                return { text: stored.body, source: 'user' };
        }
        catch (error) {
            warn(ctx, messageOf(error));
        }
        return { text: '', source: 'empty' };
    }
    /** Every entry registers under the plugin's own prefix. */
    function sectionNameFor(entry) {
        return `${USER_SECTION_PREFIX}${entry.id}`;
    }
    /** The text one entry contributes right now, or `''` when it contributes none. */
    function render(id) {
        const entry = byId.get(id);
        if (entry === undefined || !entry.enabled)
            return '';
        return describe(id).text;
    }
    /**
     * Bring the registered sections in line with the index. An entry whose name
     * or placement moved is re-registered, because both are fixed when the
     * section is declared; adding, removing, enabling, and disabling need no
     * other bookkeeping because section text is resolved per assembly.
     */
    function reconcile(entries) {
        byId.clear();
        for (const entry of entries)
            byId.set(entry.id, entry);
        for (const [id, registered] of [...sections]) {
            const entry = byId.get(id);
            if (entry !== undefined && registered.name === sectionNameFor(entry) && registered.order === entry.order)
                continue;
            registered.disposer();
            sections.delete(id);
        }
        for (const entry of entries) {
            if (sections.has(entry.id))
                continue;
            const section = sectionNameFor(entry);
            const entryOrder = entry.order;
            const disposer = ctx.effect(() => ctx.systemPrompt.section({
                name: section,
                order: entryOrder,
                text: () => render(entry.id),
            }), `prompt-manager.section(${section})`);
            sections.set(entry.id, { disposer, name: section, order: entryOrder });
        }
    }
    /** Ids a new entry may not take: the index, plus every stored body. */
    function takenIds() {
        return [...new Set([...active.map((entry) => entry.id), ...store.ids()])];
    }
    installPromptRoutes(ctx, {
        store,
        describe,
        idFor: (title) => entryIdFor(title, takenIds()),
        warn: (message) => warn(ctx, message),
        subscriptions,
        variables: () => variableValues,
    });
    const factory = loadSchemaFactory();
    if (factory === undefined) {
        warn(ctx, 'schemastery is unavailable, so prompt entries cannot be edited from Settings');
    }
    else {
        ctx.inject(['settings'], (scoped) => {
            const settings = scoped.settings;
            if (settings === undefined)
                return;
            let scope;
            try {
                scope = settings.register(SETTINGS_NAMESPACE, buildIndexSchema(factory), {
                    base: {
                        entries: [],
                        sources: [],
                        mirror: '',
                        proxy: { kind: 'none', url: '' },
                    },
                });
            }
            catch (error) {
                warn(ctx, `cannot register the ${SETTINGS_NAMESPACE} settings namespace: ${messageOf(error)}`);
                return;
            }
            writeEntries = async (next) => {
                await scope.update({ entries: next });
            };
            const sync = () => {
                resolved = scope.get();
                const entries = parseEntries(resolved);
                active.length = 0;
                active.push(...entries);
                locations = subscriptions.locate();
                reconcile(active);
            };
            sync();
            ctx.effect(() => scope.watch(sync), 'prompt-manager: settings watcher');
        });
    }
    locations = subscriptions.locate();
    reconcile(active);
}
//# sourceMappingURL=index.js.map