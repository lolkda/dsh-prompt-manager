import { createRequire } from 'node:module';
import { homedir, hostname, release, userInfo } from 'node:os';
import { join } from 'node:path';
import { activePresetOf, BUILTIN_PROMPTS, buildIndexSchema, builtinEntries, entryIdFor, MAX_ENTRIES, parseEntries, parsePresets, readBuiltinBody, } from './entries.js';
import { installPromptRoutes } from './routes.js';
import { sanitizeReferences } from './guard.js';
import { buildPack, planImport, writePackBodies, } from './pack.js';
import { PromptStore } from './store.js';
import { normalizeMirror, parseSources } from './source.js';
import { Subscriptions } from './subscriptions.js';
import { DEFAULT_PROBES, DEFAULT_PROBE_TEXTS, MAX_PROBES, normalizeProbes, runProbes, } from './probe.js';
import { cleanDrafts, normalizeScriptOverrides, PromptScripts, SCRIPTS_DIR_NAME, } from './scripts.js';
export { MAX_BODY_BYTES, MAX_ENTRIES, MAX_PRESETS } from './entries.js';
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
 * What a machine fact falls back to when the process cannot report it.
 *
 * A registered variable must never resolve to the empty string — the registry
 * throws on an undefined value, and one throwing section fails the assembly, so
 * every model step of the profile would fail. The wording matches the probe
 * placeholders a missing tool gets.
 */
const UNKNOWN_FACT = '(unknown)';
/**
 * Facts about the running process, as prompt-variable values.
 *
 * Every one of these is a process-level fact, fixed for as long as the profile
 * runs. Deliberately absent: the *session's* working directory and the model in
 * use. The registry's `AssembleContext` carries only a scope key and a signal,
 * so those are not reachable from a variable provider — and publishing the host
 * process's `process.cwd()` under the name `cwd` would invite exactly the wrong
 * reading, since a session's workspace can be a different directory.
 *
 * @returns one value per environment variable this plugin registers.
 */
export function environmentFacts() {
    return {
        os: platformName(),
        os_release: release(),
        platform: process.platform,
        arch: process.arch,
        home: factOrUnknown(() => homedir()),
        dsh_home: resolveHarnessHome(),
        user: factOrUnknown(() => userInfo().username),
        host: factOrUnknown(() => hostname()),
    };
}
/**
 * Read one machine fact, substituting {@link UNKNOWN_FACT} for anything the
 * platform declines to answer — `os.userInfo()` throws on a system with no
 * account, and an empty return value is just as unusable.
 *
 * @param read - the fact to read.
 * @returns the value, or the placeholder.
 */
function factOrUnknown(read) {
    try {
        const value = read().trim();
        return value.length > 0 ? value : UNKNOWN_FACT;
    }
    catch {
        return UNKNOWN_FACT;
    }
}
/**
 * The harness home directory: `$DSH_HOME` when it names one, `~/.dsh` otherwise.
 *
 * The one place this is decided, so the `{{dsh_home}}` variable and the store
 * directory can never disagree about where the harness keeps its files.
 *
 * @returns an absolute path.
 */
export function resolveHarnessHome() {
    const home = process.env['DSH_HOME']?.trim();
    return home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh');
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
    return join(resolveHarnessHome(), STORE_DIR_NAME);
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
 * This package's own version, read at most once.
 *
 * Read through `createRequire` because `package.json` sits beside `lib/` rather
 * than inside the emitted program, and a deployment that ships only the built
 * files must still be able to write a pack — an empty version in the header is
 * a cosmetic loss, not a failure.
 *
 * @returns the version, or an empty string when it cannot be read.
 */
function ownVersion() {
    if (ownVersionCache !== undefined)
        return ownVersionCache;
    let version = '';
    try {
        const loaded = createRequire(import.meta.url)('../package.json');
        const candidate = loaded.version;
        if (typeof candidate === 'string')
            version = candidate;
    }
    catch {
        version = '';
    }
    ownVersionCache = version;
    return version;
}
/** Cache for {@link ownVersion}. */
let ownVersionCache;
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
     * How to unregister each variable's provider.
     *
     * Kept so a variable can be dropped when nothing references it any more — the
     * disposer Cordis handed back when the provider was registered.
     */
    const variableDisposers = new Map();
    /**
     * Whether any entry currently references one variable.
     *
     * Filled in once the index exists; the engine asks during mount, before the
     * per-entry bodies have been read, so the default answers "no reference" —
     * which at that point is true, because nothing has been declared yet.
     */
    let isReferenced = () => false;
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
            const dispose = ctx.effect(() => ctx.systemPrompt.variable(variable, () => variables.get(variable)?.value ?? texts.missing), `prompt-manager.variable(${variable})`);
            variableDisposers.set(variable, dispose);
        }
        catch (error) {
            variables.delete(variable);
            warn(ctx, `cannot register the prompt variable ${variable}, so entries referencing it will not assemble: ${messageOf(error)}`);
            return 'conflict';
        }
        return 'declared';
    }
    /**
     * Let go of one variable this plugin registered.
     *
     * Unregistering the provider as well as dropping the record, because a
     * registered name with no value is worse than no name at all: the reference
     * would resolve to the placeholder text instead of being reported as the
     * unresolvable one it has become.
     *
     * @param variable - the `{{name}}` to drop.
     * @param detail - the script that declared it; another owner's name is kept.
     */
    function forgetVariable(variable, detail) {
        const record = variables.get(variable);
        if (record === undefined)
            return;
        if (record.source !== 'script' || record.detail !== detail)
            return;
        variables.delete(variable);
        const dispose = variableDisposers.get(variable);
        variableDisposers.delete(variable);
        if (dispose !== undefined)
            dispose();
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
        referenced: (variable) => isReferenced(variable),
        forget: (variable, detail) => { forgetVariable(variable, detail); },
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
        presets: [],
        activePreset: '',
        sources: [],
        mirror: '',
        proxy: { kind: 'none', url: '' },
    };
    /**
     * The preset in force, or `undefined` when the entries' own switches decide.
     *
     * Read per assembly like everything else here: activation is a settings write,
     * so both the switch itself and a later edit of the preset land on the next
     * model step with no re-registration — section text is a callback, and neither
     * a preset's name nor its membership is part of a section's identity.
     */
    let activePreset;
    /** Whether the "no such preset" report has already been made for this mount. */
    let presetReported = false;
    /** The last set of missing preset members reported, so it is said once. */
    let danglingReported = '';
    /** Where each subscribed entry's body lives; refreshed when settings commit. */
    let locations = new Map();
    /** How the engine writes the index back; present only with a settings service. */
    let writeEntries;
    /**
     * How an import lands the index and the preset list, in one settings write.
     *
     * Separate from {@link writeEntries} because an import has to place both
     * fields together: a preset whose members were written while its entries were
     * not is an index somebody has to repair by hand, whereas the reverse — bodies
     * on disk that the index does not name — is repaired by importing again, since
     * the ids come back the same.
     */
    let writeIndex;
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
    /** The configured presets, narrowed from the settings document. */
    function presetsInForce() {
        return parsePresets(field('presets'));
    }
    /**
     * Adopt the preset `activePreset` names.
     *
     * A name that resolves to nothing — the preset was deleted, or a hand-edited
     * document misspells it — falls back to the entries' own switches rather than
     * freezing the prompt on whatever was active. That is a state somebody has to
     * be able to see, so it is reported once instead of failing anything.
     *
     * @param document - the resolved settings document.
     */
    function setActivePreset(document) {
        const wanted = activePresetOf(typeof document === 'object' && document !== null && !Array.isArray(document)
            ? document['activePreset']
            : undefined);
        const presets = presetsInForce();
        activePreset = wanted.length === 0 ? undefined : presets.find((preset) => preset.id === wanted);
        if (wanted.length === 0 || activePreset !== undefined || presetReported)
            return;
        presetReported = true;
        warn(ctx, `组合 ${wanted} 不存在（可能已被删除）：本次挂载回到每条自己的开关`);
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
    /**
     * Build the pack for one preset: its members, each carrying either its body or
     * the source that owns it.
     *
     * That split is the whole point of the format. A local or built-in body is
     * copied into the pack, because nothing else could reproduce it. A subscribed
     * body is *named* rather than copied, because it belongs to a source the
     * importing machine can configure for itself — copying it would silently
     * divorce the entry from upstream. A member the index no longer has cannot be
     * carried at all and is reported instead of quietly left out.
     *
     * @param presetId - the preset to export.
     * @returns the pack, or `undefined` when no such preset exists here.
     */
    function packFor(presetId) {
        const preset = presetsInForce().find((candidate) => candidate.id === presetId);
        if (preset === undefined)
            return undefined;
        const sources = sourcesInForce();
        const members = [];
        const missing = [];
        const carried = new Set();
        for (const id of preset.entries) {
            if (carried.has(id))
                continue;
            const entry = byId.get(id);
            if (entry === undefined) {
                missing.push(id);
                continue;
            }
            carried.add(id);
            const owner = entry.source !== undefined && entry.source.length > 0
                ? entry.source
                : locations.get(id)?.slug;
            if (owner !== undefined) {
                const source = sources.find((candidate) => candidate.id === owner);
                const ref = { slug: owner };
                if (source !== undefined) {
                    ref.repo = source.repo;
                    ref.ref = source.ref;
                }
                const file = locations.get(id)?.path;
                if (file !== undefined)
                    ref.file = file;
                members.push({ id, title: entry.title, order: entry.order, enabled: entry.enabled, source: ref });
                continue;
            }
            const resolved = describe(id);
            members.push({
                id,
                title: entry.title,
                order: entry.order,
                enabled: entry.enabled,
                body: resolved.text,
                origin: resolved.source === 'builtin' ? 'builtin' : 'local',
            });
        }
        return buildPack({ preset, members, missing, pluginVersion: ownVersion() });
    }
    /**
     * Carry out an import: write the bodies the pack brought, then merge its
     * entries and its preset into the index in a single settings write.
     *
     * Everything refusable is refused before a file is written, and a failure
     * while writing takes back the files this import created, so a refused pack
     * leaves the machine exactly as it was. The index lands last on purpose: a
     * crash in between leaves body files nothing points at, which importing the
     * same pack again repairs, while the opposite order would leave index records
     * whose bodies never existed.
     *
     * @param pack - a pack that already passed {@link parsePack}.
     * @returns what it did, or why it did nothing.
     */
    async function importPack(pack) {
        if (writeIndex === undefined) {
            return { ok: false, code: 'bad-format', message: '导入需要 settings 服务来写索引，当前部署没有挂载它' };
        }
        const planned = planImport(pack, {
            entryIds: takenIds(),
            presetIds: presetsInForce().map((preset) => preset.id),
        });
        if (!planned.ok)
            return planned;
        const { plan } = planned;
        writePackBodies(plan.entries, {
            write: (id, body) => {
                // `absent` rather than `any`: an id this import believes is free must not
                // silently replace a body somebody put there a moment ago.
                store.write(id, body, { kind: 'absent' });
            },
            remove: (id) => {
                try {
                    store.remove(id);
                }
                catch (error) {
                    warn(ctx, `${id} 的正文回滚失败：${messageOf(error)}`);
                }
            },
        });
        const added = plan.entries.map((entry) => {
            const record = {
                id: entry.id,
                title: entry.title,
                order: entry.order,
                enabled: entry.enabled,
            };
            if (entry.source !== undefined)
                record.source = entry.source;
            return record;
        });
        await writeIndex({ entries: [...active, ...added], presets: [...presetsInForce(), plan.preset] });
        const report = {
            entries: plan.entries.map((entry) => {
                const created = {
                    id: entry.id,
                    title: entry.title,
                };
                if (entry.renamedFrom !== undefined)
                    created.renamedFrom = entry.renamedFrom;
                return created;
            }),
            preset: plan.preset,
            renamed: plan.renamed,
            noBody: plan.noBody,
            sourceDropped: plan.sourceDropped,
            missingMembers: plan.missingMembers,
            unregistered: unregisteredReferences(plan.entries.flatMap((entry) => entry.body ?? [])),
        };
        return { ok: true, report };
    }
    /**
     * Variable names the given bodies reference that this plugin does not supply.
     *
     * A report, never a refusal: another row may register a name, and a name that
     * is merely unregistered today is a variable somebody is still about to write.
     * The reference guard is what keeps such a body from failing an assembly.
     *
     * @param bodies - the text that arrived in a pack.
     * @returns the distinct names, in the order they first appear.
     */
    function unregisteredReferences(bodies) {
        const found = [];
        for (const body of bodies) {
            for (const match of body.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)) {
                const reference = match[1];
                if (reference === undefined || variables.has(reference))
                    continue;
                if (!found.includes(reference))
                    found.push(reference);
            }
        }
        return found;
    }
    /**
     * The text one entry contributes right now, or `''` when it contributes none.
     *
     * An active preset answers "is this entry on" by itself, so switching one is a
     * single settings write with no bookkeeping: every entry keeps the `enabled`
     * value a person gave it, for the times when no preset is in force.
     *
     * @param id - entry id.
     * @returns the interpolatable body, or the empty string.
     */
    function render(id) {
        const entry = byId.get(id);
        if (entry === undefined)
            return '';
        const on = activePreset === undefined ? entry.enabled : activePreset.entries.includes(entry.id);
        return on ? describe(id).text : '';
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
        reportDanglingMembers();
    }
    /**
     * Report a preset that names entries this machine does not have.
     *
     * This is the failure nobody notices by itself: the preset still switches, the
     * remaining members still inject, and the missing ones simply stop appearing —
     * the usual cause being an upstream rename, or a source whose subscription has
     * not been applied yet. Reporting is keyed on the *set* of missing ids so a
     * change to which entries are missing is reported again, while a preset left
     * broken for a week says so once.
     */
    function reportDanglingMembers() {
        const missing = activePreset === undefined
            ? []
            : activePreset.entries.filter((id) => !byId.has(id));
        const signature = `${activePreset?.id ?? ''}:${missing.join(',')}`;
        if (missing.length === 0 || signature === danglingReported)
            return;
        danglingReported = signature;
        warn(ctx, `组合 ${activePreset?.id ?? ''} 里有 ${String(missing.length)} 条不在索引里：${missing.join('、')}`
            + '（订阅没拉回来，或上游改了文件名）。这些条目这一轮不注入。');
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
    // From here on the index exists, so the script engine can ask whether a
    // variable is still referenced before it lets one go.
    isReferenced = (variable) => referencesIn().has(variable);
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
        presetIds: () => presetsInForce().map((preset) => preset.id),
        warn: (message) => warn(ctx, message),
        subscriptions,
        scripts,
        variables: () => variableViews(),
        packFor,
        importPack,
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
                        presets: [],
                        activePreset: '',
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
            writeIndex = async (patch) => {
                await scope.update({ entries: patch.entries, presets: patch.presets });
            };
            const sync = () => {
                resolved = scope.get();
                setActivePreset(resolved);
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
    setActivePreset(resolved);
    locations = subscriptions.refreshLocations();
    reconcile(active);
}
//# sourceMappingURL=index.js.map