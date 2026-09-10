/**
 * The prompt index: entry identity and the settings schema that carries one
 * section per entry.
 *
 * An entry's markdown body lives in one file per entry under the store
 * directory; everything else about it — title, order, whether it is injected —
 * lives in the `prompt-manager` settings namespace this module describes. Keeping
 * the index in the settings document means the browser gets reads, writes,
 * revision fencing, and the "user overrode this" flag from the shared settings
 * transport, while the bodies stay plain `.md` files a person can edit directly.
 *
 * No entry ships with the plugin: a fresh install starts empty, and prose arrives
 * either from the settings page or from a subscribed repository.
 *
 * @module dsh-prompt-manager/entries
 */
/** Order handed to the first entry a person adds; later additions sort after it. */
export declare const USER_ORDER_START = 30;
/** At most this many entries may be active at once. */
export declare const MAX_ENTRIES = 50;
/** Ref a source starts on when the settings page names none. */
export declare const DEFAULT_SOURCE_REF = "main";
/** Largest accepted body, in bytes. */
export declare const MAX_BODY_BYTES: number;
/** Largest accepted title, in characters. */
export declare const MAX_TITLE_LENGTH = 120;
/** Largest accepted id, in characters. */
export declare const MAX_ID_LENGTH = 64;
/**
 * Entry id grammar. The id becomes a file name and a prompt-section name
 * suffix, so it stays lowercase, hyphenated, and path-safe by construction.
 */
export declare const ENTRY_ID_PATTERN: RegExp;
/** One prompt entry as carried by the settings index. */
export interface PromptEntry {
    /** Stable identity: file name, section-name suffix, and settings key. */
    id: string;
    /** Human label shown in the settings page. */
    title: string;
    /** Section placement. The prompt concatenates sections in ascending order. */
    order: number;
    /** Whether this entry contributes its body to the system prompt. */
    enabled: boolean;
    /**
     * Subscription source this entry came from, when it came from one. Present
     * means the body is read-only and follows upstream; absent means a local entry
     * somebody wrote here.
     */
    source?: string;
}
/** One entry resolved against the store and any source. */
export interface ResolvedBody {
    /** The body that would reach the prompt. */
    text: string;
    /** Where that body came from. */
    source: 'user' | 'subscribed' | 'empty';
}
/** The slice of a schemastery schema node this plugin constructs. */
export interface SchemaNode {
    /** Value used when neither the user layer nor the base layer supplies one. */
    default(value: unknown): SchemaNode;
    /** Mark the field as mandatory. */
    required(value?: boolean): SchemaNode;
}
/** The slice of the schemastery factory this plugin calls. */
export interface SchemaFactory {
    /** One object node from a shape of named schema nodes. */
    object(shape: Record<string, SchemaNode>): SchemaNode;
    /** One array node whose elements all match `inner`. */
    array(inner: SchemaNode): SchemaNode;
    /** A string node. */
    string(): SchemaNode;
    /** A number node. */
    number(): SchemaNode;
    /** A boolean node. */
    boolean(): SchemaNode;
}
/** Whether a value is a usable entry id. */
export declare function isEntryId(value: unknown): value is string;
/**
 * Turn a human title into an unused entry id.
 *
 * Only ASCII letters and digits survive, so a title written entirely in a
 * non-Latin script falls back to the `entry` stem. That is deliberate: the id
 * is an internal handle (file name and section-name suffix), never user copy.
 *
 * @param title - the label a person typed.
 * @param taken - ids already in use.
 * @returns a lowercase, hyphenated, unused id.
 */
export declare function entryIdFor(title: string, taken: Iterable<string>): string;
/**
 * Narrow one resolved settings value into an index. A hand-edited document can
 * hold anything, so unusable entries are dropped rather than thrown: the worst
 * case is a prompt with fewer sections, never a session that cannot assemble.
 *
 * @param raw - the resolved `prompt-manager` namespace value.
 * @returns the usable entries, deduplicated by id and capped at {@link MAX_ENTRIES}.
 */
export declare function parseEntries(raw: unknown): PromptEntry[];
/**
 * Build the `prompt-manager` namespace schema.
 *
 * @param factory - the schemastery factory loaded at mount.
 * @returns a schema carrying the entry index, the subscriptions, and the
 * outbound settings the engine reads.
 */
export declare function buildIndexSchema(factory: SchemaFactory): unknown;
//# sourceMappingURL=entries.d.ts.map