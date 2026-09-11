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
 * The same namespace carries the presets: named selections that decide injection
 * on their own while one of them is active, so a single `activePreset` write
 * swaps the whole set without touching any entry.
 *
 * Entry bodies live either as plain `.md` files a person can edit directly, or
 * as one markdown file shipped with this package: a fresh install starts with
 * the built-in machine-environment prompt, and anything a person writes or
 * subscribes overrides it.
 *
 * @module dsh-prompt-manager/entries
 */
/** Order handed to the first entry a person adds; later additions sort after it. */
export declare const USER_ORDER_START = 30;
/** At most this many entries may be active at once. */
export declare const MAX_ENTRIES = 50;
/** At most this many presets may be configured. */
export declare const MAX_PRESETS = 20;
/** At most this many entries one preset may select. */
export declare const MAX_PRESET_ENTRIES = 50;
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
/**
 * One named selection of entries, applied to the whole deployment.
 *
 * A preset is a complete answer to "which entries reach the prompt right now":
 * while one is active it decides injection by itself, and every entry's own
 * `enabled` flag is left untouched for the times when none is. Placement is not
 * part of it — sections still stand in each entry's own `order` — so switching a
 * preset costs one settings write and no re-registration.
 */
export interface PromptPreset {
    /** Stable identity, same grammar as an entry id. */
    id: string;
    /** Label shown in the composer chip and on the settings page. */
    name: string;
    /** Ids of the entries this preset injects. */
    entries: string[];
}
/** One entry resolved against the store, a subscription, or the package. */
export interface ResolvedBody {
    /** The body that would reach the prompt. */
    text: string;
    /** Where that body came from. */
    source: 'user' | 'subscribed' | 'builtin' | 'empty';
}
/** One prompt body this package ships, so a fresh install is not empty. */
export interface BuiltinPrompt {
    /** Entry id a user override or a subscription with the same id replaces. */
    id: string;
    /** Title the base layer gives the entry. */
    title: string;
    /** Placement the base layer gives the entry. */
    order: number;
    /** The packaged markdown, resolved relative to the built module in `lib/`. */
    file: URL;
}
/** The prompts this package ships. */
export declare const BUILTIN_PROMPTS: readonly BuiltinPrompt[];
/**
 * The base layer's entries: one per {@link BUILTIN_PROMPTS} entry, enabled.
 *
 * They behave like any other entry — the page lists them, a write overrides
 * them, a toggle disables them — so the built-in prose is a starting point
 * rather than something the deployment cannot reach.
 *
 * @returns fresh entry records, safe to hand to a settings base layer.
 */
export declare function builtinEntries(): PromptEntry[];
/**
 * The packaged body for one entry id.
 * @param id - entry id to look up.
 * @returns the exact UTF-8 markdown, or `undefined` when the package ships none
 * for that id, or the packaged file cannot be read.
 */
export declare function readBuiltinBody(id: string): string | undefined;
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
 * Narrow a resolved settings value into the preset list. Like {@link parseEntries},
 * a hand-edited document can hold anything, so unusable presets are dropped
 * rather than thrown: the worst case is a smaller list, never an assembly that
 * cannot be built.
 *
 * @param raw - the resolved `presets` field.
 * @returns the usable presets, deduplicated by id and capped at {@link MAX_PRESETS}.
 */
export declare function parsePresets(raw: unknown): PromptPreset[];
/**
 * The id of the preset in force.
 * @param raw - the resolved `activePreset` field.
 * @returns the configured id, or `''` when the deployment runs without a preset.
 */
export declare function activePresetOf(raw: unknown): string;
/**
 * Build the `prompt-manager` namespace schema.
 *
 * @param factory - the schemastery factory loaded at mount.
 * @returns a schema carrying the entry index, the subscriptions, and the
 * outbound settings the engine reads.
 */
export declare function buildIndexSchema(factory: SchemaFactory): unknown;
//# sourceMappingURL=entries.d.ts.map