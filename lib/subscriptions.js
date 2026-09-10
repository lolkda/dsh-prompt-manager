/**
 * The subscription engine: the one thing the HTTP routes call, the one thing the
 * settings page reads, and the source of truth for the bodies of subscribed
 * entries.
 *
 * It owns no global state of its own. Sources come from the resolved settings
 * document, proxy and mirror come from the same place, and the index it rewrites
 * is handed back to the plugin through {@link SubscriptionHost.setEntries}, so
 * the plugin stays the only writer of its own namespace.
 *
 * @module dsh-prompt-manager/subscriptions
 */
import { createFetcher } from './net.js';
import { stemOf } from './source.js';
import { applyChanges, checkSource, CheckError, revertChanges, SourceWorkspace, titleFor, } from './sync.js';
/** The subscription engine. */
export class Subscriptions {
    host;
    /**
     * @param host - the plugin side of the engine.
     */
    constructor(host) {
        this.host = host;
    }
    /**
     * The workspace of one source.
     * @param slug - source id.
     * @returns its file workspace.
     */
    workspace(slug) {
        return new SourceWorkspace(this.host.root(), slug);
    }
    /**
     * Where every subscribed entry's body lives.
     * @returns entry id → source and path, for the entries on disk.
     */
    locate() {
        const located = new Map();
        for (const source of this.host.sources()) {
            const state = this.workspace(source.id).readState();
            for (const [path, file] of Object.entries(state.files)) {
                located.set(file.id, { slug: source.id, path });
            }
        }
        return located;
    }
    /**
     * Read one subscribed entry's body.
     * @param id - entry id.
     * @returns the body, or `undefined` when it is not a subscribed entry.
     */
    readBody(id) {
        const location = this.locate().get(id);
        if (location === undefined)
            return undefined;
        return this.workspace(location.slug).read('current', location.path);
    }
    /**
     * The configured sources with their on-disk situation.
     * @returns one summary per source.
     */
    list() {
        return this.host.sources().map((source) => {
            const workspace = this.workspace(source.id);
            const state = workspace.readState();
            const plan = workspace.readPlan();
            const summary = {
                id: source.id,
                repo: source.repo,
                ref: source.ref,
                mirror: this.effectiveMirror(source),
                enabled: source.enabled,
                files: Object.keys(state.files).length,
                pending: plan === undefined ? 0 : plan.changes.length,
            };
            if (state.appliedAt !== undefined)
                summary.appliedAt = state.appliedAt;
            if (state.headSha !== undefined)
                summary.headSha = state.headSha;
            return summary;
        });
    }
    /**
     * Check one source against its upstream and stage whatever changed.
     * @param slug - source id.
     * @returns the check outcome, tagged with its source.
     * @throws {CheckError} when the source is unknown or the check cannot conclude.
     */
    async check(slug) {
        const source = this.source(slug);
        const outcome = await checkSource({
            source,
            workspace: this.workspace(slug),
            fetcher: createFetcher({ proxy: this.host.proxy(), mirror: this.effectiveMirror(source) }),
        });
        return { ...outcome, slug };
    }
    /**
     * Apply what a check staged.
     * @param slug - source id.
     * @param files - paths to apply; all staged changes when omitted.
     * @returns what landed and the index that resulted.
     * @throws {CheckError} when nothing is staged for this source.
     */
    async apply(slug, files) {
        const source = this.source(slug);
        const workspace = this.workspace(slug);
        const plan = workspace.readPlan();
        if (plan === undefined)
            throw new CheckError('nothing-staged', `${slug} 还没有检查结果，先点「检查更新」`);
        const state = workspace.readState();
        const next = applyChanges({
            workspace,
            state,
            plan,
            source,
            ...(files === undefined ? {} : { selected: files }),
            nowIso: new Date().toISOString(),
        });
        workspace.writeState(next.state);
        workspace.clearStaging();
        const entries = await this.syncEntries();
        return { slug, applied: next.applied, entries };
    }
    /**
     * Put back the version the last apply replaced.
     * @param slug - source id.
     * @returns the paths that moved back and the index that resulted.
     */
    async revert(slug) {
        this.source(slug);
        const workspace = this.workspace(slug);
        const next = revertChanges({ workspace, state: workspace.readState() });
        workspace.writeState(next.state);
        workspace.clearStaging();
        const entries = await this.syncEntries();
        return { slug, reverted: next.reverted, entries };
    }
    /**
     * Forget one source: its files and its entries.
     * @param slug - source id.
     * @returns the index that resulted.
     */
    async remove(slug) {
        this.workspace(slug).remove();
        const entries = await this.syncEntries();
        return { slug, entries };
    }
    /**
     * Rebuild the index's subscribed half from every source's state.
     *
     * Local entries are carried through untouched. A subscribed entry keeps the
     * title, placement, and switch a person gave it; an entry seen for the first
     * time arrives disabled, because remote prose must not reach the prompt before
     * someone turns it on.
     *
     * @returns the index now in force.
     */
    async syncEntries() {
        const current = this.host.entries();
        const previous = new Map(current.filter((entry) => entry.source !== undefined).map((entry) => [entry.id, entry]));
        const locals = current.filter((entry) => entry.source === undefined);
        const subscribed = [];
        let order = this.host.nextOrder();
        for (const source of this.host.sources()) {
            const state = this.workspace(source.id).readState();
            for (const [path, file] of Object.entries(state.files)) {
                const known = previous.get(file.id);
                // `file` here is the state record, so the manifest path is `path`.
                const title = known?.title ?? file.title ?? titleFor(source, { file: path });
                const placement = known?.order ?? file.order ?? order;
                if (known === undefined && file.order === undefined)
                    order += 10;
                subscribed.push({
                    id: file.id,
                    title: title.length > 0 ? title : stemOf(path),
                    order: placement,
                    enabled: known?.enabled ?? false,
                    source: source.id,
                });
            }
        }
        const next = [...locals, ...subscribed];
        if (JSON.stringify(next) !== JSON.stringify(current))
            await this.host.setEntries(next);
        return next;
    }
    /**
     * The mirror actually used for one source.
     * @param source - the source.
     * @returns its own mirror, or the global one.
     */
    effectiveMirror(source) {
        return source.mirror.length > 0 ? source.mirror : this.host.mirror();
    }
    /**
     * Look one source up.
     * @param slug - source id.
     * @returns the source.
     * @throws {CheckError} when no such source is configured.
     */
    source(slug) {
        const found = this.host.sources().find((candidate) => candidate.id === slug);
        if (found === undefined)
            throw new CheckError('unknown-source', `没有这个订阅源：${slug}`);
        return found;
    }
}
//# sourceMappingURL=subscriptions.js.map