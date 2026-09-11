import { createRequire } from 'node:module';
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PROMPTS, buildIndexSchema, builtinEntries, entryIdFor, MAX_ENTRIES, parseEntries, readBuiltinBody, } from './entries.js';
import { installPromptRoutes } from './routes.js';
import { sanitizeReferences } from './guard.js';
import { PromptStore } from './store.js';
import { normalizeMirror, parseSources } from './source.js';
import { Subscriptions } from './subscriptions.js';
import { DEFAULT_PROBES, DEFAULT_PROBE_TEXTS, MAX_PROBES, normalizeProbes, runProbes, } from './probe.js';
import { cleanDrafts, normalizeScriptOverrides, PromptScripts, SCRIPTS_DIR_NAME, } from './scripts.js';
export { MAX_BODY_BYTES, MAX_ENTRIES } from './entries.js';
export { PromptStore } from './store.js';
export { ROUTE_PREFIX } from './routes.js';
export { MAX_PROBES } from './probe.js';
export { BUILTIN_PROMPTS } from './entries.js';
export { MAX_SCRIPTS, MAX_SCRIPT_BYTES, SCRIPTS_DIR_NAME } from './scripts.js';
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
    /** Placeholder texts, shared by probes and scripts. */
    const texts = { ...DEFAULT_PROBE_TEXTS, ...config.probeTexts };
    /**
     * The variables in force, keyed by reference name.
     *
     * The provider handed to the registry reads this map instead of a captured
     * value, so refreshing a value costs one assignment here and nothing at the
     * registry. That is what lets a script's output change without a restart, and
     * it is also what guarantees every `{{name}}` resolves to a non-empty string
     * for as long as it is registered.
     */
    const variables = new Map();
    /**
     * Scripts currently on disk.
     *
     * A variable keeps its name and value after the script that supplied it is
     * deleted — a missing value would fail assembly — but a name whose script is
     * gone for good is adoptable, so renaming a script does not leave its old
     * variables owned by a file that no longer exists. Filled in once the engine
     * exists; nothing declared before that can be a script variable.
     */
    let onDiskScripts = () => [];
    /**
     * Offer one prompt variable, registering its provider the first time.
     *
     * A name another source already owns is refused rather than overwritten: the
     * registry throws on a duplicate, and one contested name must not cost the
     * whole mount.
     *
     * @param variable - the `{{name}}` to serve; validated by the caller.
     * @param value - the value assemblies will see; never empty.
     * @param source - which layer the value came from.
     * @param detail - owning script name, for a script variable.
     * @returns `assigned` when this source already owned the name, `declared` when
     * it was free, `conflict` when something else owns it.
     */
    function declareVariable(variable, value, source, detail) {
        const existing = variables.get(variable);
        if (existing !== undefined) {
            const sameOwner = existing.source === source && existing.detail === detail;
            const adoptable = !sameOwner
                && existing.source === 'script'
                && source === 'script'
                && existing.detail !== undefined
                && !onDiskScripts().includes(existing.detail);
            if (!sameOwner && !adoptable)
                return 'conflict';
            existing.value = value;
            existing.source = source;
            existing.detail = detail;
            existing.updatedAt = new Date().toISOString();
            return 'assigned';
        }
        variables.set(variable, { value, source, detail, updatedAt: new Date().toISOString() });
        try {
            ctx.effect(() => ctx.systemPrompt.variable(variable, () => variables.get(variable)?.value ?? texts.missing), `prompt-manager.variable(${variable})`);
        }
        catch (error) {
            variables.delete(variable);
            warn(ctx, `cannot register the prompt variable ${variable}, so entries referencing it will not assemble: ${messageOf(error)}`);
            return 'conflict';
        }
        return 'declared';
    }
    /**
     * The layer a variable's value came from, in the words the log reader needs.
     * @param record - the variable record in force.
     * @returns a short label naming the owner.
     */
    function ownerLabel(record) {
        if (record.source === 'script')
            return `脚本 ${record.detail ?? '?'}`;
        if (record.source === 'config')
            return 'config.variables';
        if (record.source === 'probe')
            return '探测';
        return '环境变量';
    }
    /**
     * Offer one prompt variable, reporting a name this plugin already handed out.
     *
     * A name taken by another row is reported where the registry refuses it, so
     * only the conflict this plugin resolves by itself needs a voice here — and it
     * needs one: the losing layer is otherwise dropped in silence, and a person
     * reading `{{os}}` in an entry would have no way to learn why their
     * `variables` entry never took effect.
     *
     * @param variable - the `{{name}}` to serve; validated by the caller.
     * @param value - the value assemblies will see.
     * @param source - which layer the value came from.
     */
    function declareOrReport(variable, value, source) {
        if (declareVariable(variable, value, source) !== 'conflict')
            return;
        const owner = variables.get(variable);
        if (owner === undefined)
            return;
        warn(ctx, `${variable} 已经由${ownerLabel(owner)}提供（当前值 ${JSON.stringify(owner.value)}），本次 ${ownerLabel({ source })} 提供的值被忽略`);
    }
    const facts = environmentFacts();
    if (config.environment ?? true) {
        for (const [variable, value] of Object.entries(facts))
            declareOrReport(variable, value, 'environment');
    }
    for (const [variable, value] of Object.entries(config.variables ?? {})) {
        if (!VARIABLE_NAME.test(variable)) {
            throw new Error(`prompt-manager: invalid variable name ${JSON.stringify(variable)} (must match ${String(VARIABLE_NAME)})`);
        }
        declareOrReport(variable, value, 'config');
    }
    // A malformed probe is a composition mistake, so it fails the mount loudly
    // rather than leaving a `{{name}}` that no assembly can resolve. Whether a
    // probed tool exists, stays silent, or hangs is a value, not an error.
    const probed = normalizeProbes(config.probes);
    if (probed.problems.length > 0)
        throw new Error(`prompt-manager: ${probed.problems.join('; ')}`);
    const specs = {
        ...((config.probeDefaults ?? true) ? DEFAULT_PROBES : {}),
        ...probed.specs,
    };
    const probeNames = Object.keys(specs);
    if (probeNames.length > MAX_PROBES) {
        throw new Error(`prompt-manager: at most ${String(MAX_PROBES)} probes are allowed, got ${String(probeNames.length)}`);
    }
    if (probeNames.length > 0) {
        const report = runProbes(specs, { texts, budgetMs: config.probeBudgetMs });
        for (const outcome of report.outcomes)
            declareOrReport(outcome.name, outcome.value, 'probe');
    }
    const store = new PromptStore(join(resolveStoreDir(config), 'sections'));
    // Script overrides are composition config, so a malformed one fails the mount
    // for the same reason a malformed probe does: it is the deployment's mistake,
    // and leaving it silent would leave a script nobody can run.
    const scriptOverrides = normalizeScriptOverrides(config.scripts);
    if (scriptOverrides.problems.length > 0)
        throw new Error(`prompt-manager: ${scriptOverrides.problems.join('; ')}`);
    /**
     * The user-script engine. It owns the files and the runs; every value it
     * produces passes through {@link declareVariable}, so the plugin stays the
     * only writer of its own variable registry.
     */
    const scripts = new PromptScripts({
        dir: () => join(resolveStoreDir(config), SCRIPTS_DIR_NAME),
        overrides: () => scriptOverrides.overrides,
        texts: () => texts,
        declare: (variable, value, detail) => declareVariable(variable, value, 'script', detail),
        owner: (variable) => {
            const record = variables.get(variable);
            if (record === undefined)
                return undefined;
            if (record.source !== 'script')
                return record.source;
            const detail = record.detail ?? 'script';
            // A name left behind by a script that no longer exists is free again.
            return onDiskScripts().includes(detail) ? detail : undefined;
        },
        warn: (message) => warn(ctx, message),
    });
    onDiskScripts = () => scripts.names();
    ctx.effect(() => () => { scripts.dispose(); }, 'prompt-manager: script engine');
    // The cached values are read synchronously, so a profile start serves what it
    // saw last without executing anything; only scripts whose file changed while
    // the profile was down are re-run, behind the mount.
    cleanDrafts(scripts.dir);
    const pendingScripts = scripts.mountDeclare();
    if (pendingScripts.length > 0) {
        void scripts.refresh(pendingScripts).catch((error) => {
            warn(ctx, `a script refresh failed: ${messageOf(error)}`);
        });
    }
    /**
     * The index in force. Seeded with the built-in entries so a deployment without
     * a settings service still gets them; the settings sync below replaces this
     * with the resolved document as soon as one is available.
     */
    const active = builtinEntries();
    /** Live lookup for section text callbacks. */
    const byId = new Map();
    /** Registered sections, keyed by entry id. */
    const sections = new Map();
    /** The resolved settings document, as the engine reads it. */
    let resolved = {
        entries: builtinEntries(),
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
     * its snapshot first — its body is upstream's, not this machine's — then a body
     * written here, then the body this package ships for that id. Read per
     * assembly, so an edited or freshly applied file lands on the next model step.
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
        const builtin = readBuiltinBody(id);
        if (builtin !== undefined)
            return { text: builtin, source: 'builtin' };
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
    /** References already reported, so one bad body cannot flood the log. */
    const reportedReferences = new Set();
    // The text this plugin serves is interpolated by the registry, strictly: a
    // reference it cannot resolve, or one whose shape is not a variable name,
    // makes that assembly throw — and one throwing section fails the whole
    // assembly, so every model step of the profile would fail until somebody
    // edited the body back. A body can also be hand-edited in `sections/`, where
    // no page gets to warn first. This hook therefore checks the text this plugin
    // owns against the assembly's own variable table and escapes whatever the
    // registry would refuse, leaving every resolvable reference alone.
    ctx.effect(() => ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
        const out = await next();
        const sections = out.sections.map((section) => {
            if (!section.name.startsWith(USER_SECTION_PREFIX))
                return section;
            const guarded = sanitizeReferences(section.text, out.variables ?? {});
            if (guarded.escaped.length === 0)
                return section;
            for (const reference of guarded.escaped) {
                const key = `${section.name}\u0000${reference}`;
                if (reportedReferences.has(key))
                    continue;
                reportedReferences.add(key);
                warn(ctx, `${section.name} 的正文引用了 ${JSON.stringify(reference)}：注册表解析不了它，已按字面量渲染（改掉这处引用，或让某个来源注册这个名字）`);
            }
            if (reportedReferences.size > 512)
                reportedReferences.clear();
            return { ...section, text: guarded.text };
        });
        return { ...out, sections };
    }), 'prompt-manager: reference guard');
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
    /** Ids a new entry may not take: the index, every stored body, and the built-ins. */
    function takenIds() {
        return [...new Set([
                ...active.map((entry) => entry.id),
                ...store.ids(),
                ...BUILTIN_PROMPTS.map((prompt) => prompt.id),
            ])];
    }
    /**
     * Which entry titles reference each variable.
     *
     * A reference to a name that is no longer registered makes assembly throw, so
     * the page needs this in front of a delete rather than in the log afterwards.
     *
     * @returns variable name → titles of the entries that reference it.
     */
    function referencesIn() {
        const reference = /\{\{([a-z][a-z0-9_]*)\}\}/g;
        const found = new Map();
        for (const entry of active) {
            let body;
            try {
                body = describe(entry.id).text;
            }
            catch {
                continue;
            }
            for (const match of body.matchAll(reference)) {
                const name = match[1];
                if (name === undefined)
                    continue;
                const titles = found.get(name) ?? [];
                if (!titles.includes(entry.title))
                    titles.push(entry.title);
                found.set(name, titles);
            }
        }
        return found;
    }
    /**
     * The variables in force, each with what references it.
     * @returns one view per variable, sorted by name.
     */
    function variableViews() {
        const references = referencesIn();
        return [...variables.entries()]
            .map(([name, record]) => ({
            name,
            value: record.value,
            source: record.source,
            detail: record.detail,
            updatedAt: record.updatedAt,
            referencedBy: references.get(name) ?? [],
        }))
            .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    }
    installPromptRoutes(ctx, {
        store,
        describe,
        idFor: (title) => entryIdFor(title, takenIds()),
        warn: (message) => warn(ctx, message),
        subscriptions,
        scripts,
        variables: () => variableViews(),
    });
    /** Whether the cap has already been reported for this mount. */
    let truncationReported = false;
    /**
     * Report an index the entry cap shortened.
     *
     * At most {@link MAX_ENTRIES} sections may be active, so entries past the cap
     * never reach the prompt. The settings page reads the document rather than the
     * narrowed index, so it would still list them — saying so once is the
     * difference between a silent no-op and something a person can act on.
     *
     * @param document - the resolved settings document.
     * @param kept - how many entries survived narrowing.
     */
    function reportTruncation(document, kept) {
        if (truncationReported)
            return;
        const raw = typeof document === 'object' && document !== null && !Array.isArray(document)
            ? document['entries']
            : undefined;
        if (!Array.isArray(raw) || raw.length <= kept)
            return;
        truncationReported = true;
        warn(ctx, `索引里有 ${String(raw.length)} 条条目，上限是 ${String(MAX_ENTRIES)} 条：只有前 ${String(kept)} 条会进入提示词（设置页仍然列出全部）`);
    }
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
                        entries: builtinEntries(),
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
                reportTruncation(resolved, entries.length);
                active.length = 0;
                active.push(...entries);
                locations = subscriptions.refreshLocations();
                reconcile(active);
            };
            sync();
            ctx.effect(() => scope.watch(sync), 'prompt-manager: settings watcher');
        });
    }
    locations = subscriptions.refreshLocations();
    reconcile(active);
}
//# sourceMappingURL=index.js.map