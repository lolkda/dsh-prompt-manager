/**
 * Preset packs: one preset, the bodies of its local members, and enough
 * provenance to say where the bodies that are *not* in the pack come from.
 *
 * A pack is plain JSON a person can read, diff, mail, and keep. It carries no
 * code: scripts stay on the machine that wrote them, and a pack cannot ask for
 * one. Everything in this module is pure — building, validating, and planning an
 * import are all functions of their arguments — so the rules a pack has to pass
 * are testable without an HTTP request, a store, or a settings namespace.
 *
 * The split of responsibility is deliberate:
 *
 * - {@link buildPack} turns already-resolved members into a pack. Reading bodies
 *   and subscription origins is the host's job, because only it knows them.
 * - {@link parsePack} decides whether a foreign file is a pack this build can
 *   use at all, and refuses by naming the entry that is wrong.
 * - {@link planImport} works out which ids the entries will take on this machine
 *   and rewrites the preset's membership to match, without touching anything.
 *
 * @module prompt-manager/pack
 */
import {
  entryIdFor,
  freeId,
  isEntryId,
  MAX_BODY_BYTES,
  MAX_ENTRIES,
  MAX_TITLE_LENGTH,
  type PromptPreset,
} from './entries.js'
import { malformedReferences } from './guard.js'

/** Marker every pack carries, so a foreign JSON file is refused by name. */
export const PACK_FORMAT = 'dsh-prompt-manager-pack'

/** Pack schema this build writes, and the only one it reads. */
export const PACK_VERSION = 1

/**
 * Largest pack accepted on import, in bytes.
 *
 * A pack can carry up to {@link MAX_ENTRIES} bodies of {@link MAX_BODY_BYTES}
 * each, so the route's ordinary JSON limit — sized for one body — is far too
 * small here. This is the ceiling that replaces it, and it is also the largest
 * body the route will read at all.
 */
export const MAX_PACK_BYTES = 4 * 1024 * 1024

/** At most this many entries one pack may declare. Mirrors the index's own cap. */
export const MAX_PACK_ENTRIES = MAX_ENTRIES

/** Where a subscribed entry's body comes from, as recorded in a pack. */
export interface PackSourceRef {
  /** Source slug the entry is subscribed to, e.g. `lolkda-dsh-prompt-pack`. */
  slug: string
  /** `owner/repo`, when the exporting machine still had that source configured. */
  repo?: string | undefined
  /** The ref in force there, e.g. `main`. */
  ref?: string | undefined
  /** Path inside the source's workspace, e.g. `ctf.md`. */
  file?: string | undefined
}

/** Where an exported body came from. */
export type PackOrigin = 'local' | 'builtin'

/** One entry inside a pack. */
export interface PackEntry {
  /** Id it had on the exporting machine; not necessarily free on this one. */
  id: string
  /** Human label, used to allocate a new id when this one is taken. */
  title: string
  /** Section placement, carried over as written. */
  order: number
  /** The entry's own switch, carried over as written. */
  enabled: boolean
  /** Body text. Absent for a subscribed entry, whose body belongs to a source. */
  body?: string | undefined
  /** Which layer supplied {@link PackEntry.body}. Absent for a subscription. */
  origin?: PackOrigin | undefined
  /** Present instead of a body when the entry is a subscription. */
  source?: PackSourceRef | undefined
}

/** The preset a pack carries. */
export interface PackPreset {
  /** Id it had on the exporting machine; not necessarily free on this one. */
  id: string
  /** Display name; kept verbatim on import even when the id has to change. */
  name: string
  /** Member ids, referring to {@link PromptPack.entries}. */
  entries: string[]
}

/** A pack this build understands. */
export interface PromptPack {
  /** Always {@link PACK_FORMAT}. */
  format: string
  /** Always {@link PACK_VERSION}. */
  version: number
  /** When the exporting machine wrote it, for a human reading the file. */
  exportedAt: string
  /** What wrote it, for a human reading the file. */
  generator: { plugin: string; pluginVersion: string }
  /** The preset being moved. */
  preset: PackPreset
  /** Its members, in the order the exporting index held them. */
  entries: PackEntry[]
  /** Members the preset named that no longer existed when the pack was written. */
  missing: string[]
}

/** Why a pack was refused. */
export interface PackRefusal {
  ok: false
  /** Stable code the browser can branch on. */
  code: PackRefusalCode
  /** Message written for the person reading the page. */
  message: string
}

/** The refusal codes a pack can be turned down with. */
export type PackRefusalCode =
  | 'bad-format'
  | 'bad-version'
  | 'bad-preset'
  | 'bad-entry'
  | 'bad-reference'
  | 'too-large'
  | 'too-many-entries'

/** One member of a preset, resolved for export. */
export interface PackMember {
  /** Entry id. */
  id: string
  /** Human label. */
  title: string
  /** Section placement. */
  order: number
  /** The entry's own switch. */
  enabled: boolean
  /** Resolved body, when this machine has one. */
  body?: string | undefined
  /** Which layer supplied the body. */
  origin?: PackOrigin | undefined
  /** Subscription origin, when the body belongs to a source. */
  source?: PackSourceRef | undefined
}

/** Everything {@link buildPack} needs, all of it already resolved. */
export interface PackExportInput {
  /** The preset being exported. */
  preset: PromptPreset
  /** Its resolvable members, in the order the pack should carry them. */
  members: PackMember[]
  /** Member ids the preset names that this machine cannot resolve. */
  missing?: string[] | undefined
  /** This plugin's version, recorded in the pack's header. */
  pluginVersion: string
  /** Clock, for tests; defaults to now. */
  now?: Date | undefined
}

/** One entry an import would create. */
export interface PackImportEntry {
  /** The id it will take on this machine. */
  id: string
  /** Human label. */
  title: string
  /** Section placement. */
  order: number
  /** Whether it contributes while no preset is in force. */
  enabled: boolean
  /** Body to write, absent for an entry whose text a source supplies. */
  body?: string | undefined
  /** Which layer the body came from. */
  origin?: PackOrigin | undefined
  /** Source slug to record in the index, when the entry is a subscription. */
  source?: string | undefined
  /** The id this entry had on the exporting machine, when it had to change. */
  renamedFrom?: string | undefined
}

/** What an import would do, ready to be checked and then carried out. */
export interface PackImportPlan {
  /** Entries to create, in pack order. */
  entries: PackImportEntry[]
  /** The preset to create, with membership pointing at the ids above. */
  preset: PromptPreset
  /** Every id that had to change, for the report. */
  renamed: Array<{ from: string; to: string }>
  /** Titles whose bodies this machine will not have until a source is set up. */
  noBody: string[]
  /**
   * Titles that arrived as subscriptions but had to give up their id, and with
   * it the ability to read their body from the source. They are imported as
   * ordinary empty entries, and this is how the page says so.
   */
  sourceDropped: string[]
  /** Preset members the pack itself could not carry (already gone at export). */
  missingMembers: string[]
}

/** The result of planning an import. */
export type PackImportResult = { ok: true; plan: PackImportPlan } | PackRefusal

/** What an import did, in the words the page reports it with. */
export interface PackImportReport {
  /** Entries created, in pack order. */
  entries: Array<{ id: string; title: string; renamedFrom?: string | undefined }>
  /** The preset created, with membership already pointing at the ids above. */
  preset: PromptPreset
  /** Every id that changed, so the page can say which entry is which. */
  renamed: Array<{ from: string; to: string }>
  /** Titles whose body the pack does not carry, because a source supplies it. */
  noBody: string[]
  /** Titles that arrived as subscriptions but could not keep their id. */
  sourceDropped: string[]
  /** Preset members the pack itself could not carry. */
  missingMembers: string[]
  /**
   * Variable names the imported bodies reference that *this* plugin does not
   * supply. Not proof of a broken prompt: another row may register them, and the
   * reference guard renders whatever is left as prose and says so in the log.
   */
  unregistered: string[]
}

/** The result of carrying out an import. */
export type PackApplyResult = { ok: true; report: PackImportReport } | PackRefusal

/** The result of reading a pack. */
export type PackParseResult = { ok: true; pack: PromptPack } | PackRefusal

/**
 * Assemble a pack from members whose bodies the host has already resolved.
 *
 * Refuses nothing: a member with no body is exactly what a subscribed entry
 * looks like, and its provenance is what makes the pack usable somewhere else.
 *
 * @param input - the preset, its resolved members, and the version recording it.
 * @returns the pack, ready to be serialized.
 */
export function buildPack(input: PackExportInput): PromptPack {
  const members: PackEntry[] = input.members.map((member) => {
    const carried: PackEntry = {
      id: member.id,
      title: member.title,
      order: member.order,
      enabled: member.enabled,
    }
    if (member.body !== undefined) {
      carried.body = member.body
      if (member.origin !== undefined) carried.origin = member.origin
      return carried
    }
    if (member.source !== undefined) carried.source = member.source
    return carried
  })
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    generator: { plugin: 'dsh-prompt-manager', pluginVersion: input.pluginVersion },
    preset: {
      id: input.preset.id,
      name: input.preset.name,
      entries: [...input.preset.entries],
    },
    entries: members,
    missing: [...(input.missing ?? [])],
  }
}

/** Where an import's body files go. */
export interface PackBodySink {
  /**
   * Create one body file.
   *
   * Must refuse to replace a file that already exists: an id the planner
   * believes is free may have been taken by somebody else in the meantime, and
   * silently overwriting their body is the one outcome worse than failing.
   */
  write(id: string, body: string): void
  /**
   * Remove one body file this call created.
   *
   * Expected to swallow its own failures — there is nothing useful to do about
   * one at this point, and the original error is the one worth reporting.
   */
  remove(id: string): void
}

/**
 * Write the bodies an import carries, and take back whatever was written if one
 * of them fails.
 *
 * An import that gets half-way leaves an index nobody has updated yet and a pile
 * of files nothing points at, which is why the files go down first and the index
 * last: a failure here removes exactly what this call created, so the machine
 * ends up as it was, and importing the same pack again starts clean.
 *
 * @param entries - the planned entries, in pack order.
 * @param sink - where the bodies go.
 * @throws the sink's own error, after the rollback.
 */
export function writePackBodies(entries: readonly PackImportEntry[], sink: PackBodySink): void {
  const written: string[] = []
  try {
    for (const entry of entries) {
      if (entry.body === undefined) continue
      sink.write(entry.id, entry.body)
      written.push(entry.id)
    }
  } catch (error) {
    for (const id of written) sink.remove(id)
    throw error
  }
}

/**
 * Read a pack from an untrusted value.
 *
 * Strict about what cannot be recovered and forgiving about what can: a title is
 * required because a missing id is derived from it, while an unusable id, a
 * missing order, or an absent `enabled` are all things the importer decides
 * again anyway. A body that no assembly could render is refused here rather than
 * written into the index, because an index entry that cannot assemble fails
 * every model step until somebody edits it.
 *
 * @param raw - the parsed JSON value.
 * @returns the pack, or the first reason it is unusable.
 */
export function parsePack(raw: unknown): PackParseResult {
  const root = asRecord(raw)
  if (root === undefined) return refuse('bad-format', '包必须是一个 JSON 对象')
  if (root['format'] !== PACK_FORMAT) {
    return refuse('bad-format', `这不是一个 ${PACK_FORMAT} 包（format = ${JSON.stringify(root['format'])}）`)
  }
  if (root['version'] !== PACK_VERSION) {
    return refuse('bad-version', `包的版本是 ${JSON.stringify(root['version'])}，这个版本只认 ${String(PACK_VERSION)}`)
  }

  const presetRaw = asRecord(root['preset'])
  if (presetRaw === undefined) return refuse('bad-preset', '包里的 preset 必须是一个对象')
  const presetName = textOf(presetRaw['name']) ?? textOf(presetRaw['id'])
  if (presetName === undefined) return refuse('bad-preset', 'preset 需要一个 name')
  const membersRaw = presetRaw['entries']
  if (!Array.isArray(membersRaw)) return refuse('bad-preset', 'preset.entries 必须是字符串数组')
  const memberIds = membersRaw.filter((member): member is string => typeof member === 'string')

  const listRaw = root['entries']
  if (!Array.isArray(listRaw)) return refuse('bad-entry', 'entries 必须是一个数组')
  if (listRaw.length > MAX_PACK_ENTRIES) {
    return refuse('too-many-entries', `包里有 ${String(listRaw.length)} 条，上限是 ${String(MAX_PACK_ENTRIES)}`)
  }

  const entries: PackEntry[] = []
  for (const [index, item] of listRaw.entries()) {
    const position = index + 1
    const record = asRecord(item)
    if (record === undefined) return refuse('bad-entry', `第 ${String(position)} 条不是一个对象`)
    const title = textOf(record['title'])
    if (title === undefined) return refuse('bad-entry', `第 ${String(position)} 条没有可用的 title`)
    const orderRaw = record['order']
    const entry: PackEntry = {
      id: textOf(record['id']) ?? '',
      title: title.slice(0, MAX_TITLE_LENGTH),
      order: typeof orderRaw === 'number' && Number.isFinite(orderRaw) ? orderRaw : 0,
      enabled: record['enabled'] === true,
    }
    const bodyRaw = record['body']
    if (typeof bodyRaw === 'string') {
      const size = Buffer.byteLength(bodyRaw, 'utf8')
      if (size > MAX_BODY_BYTES) {
        return refuse('too-large', `「${entry.title}」的正文有 ${String(size)} 字节，上限是 ${String(MAX_BODY_BYTES)}`)
      }
      const broken = malformedReferences(bodyRaw)
      if (broken.length > 0) {
        return refuse(
          'bad-reference',
          `「${entry.title}」的正文里有注册表解析不了的引用：${broken.join(' ')}（这种正文一进索引，每个模型步骤都会失败）`,
        )
      }
      entry.body = bodyRaw
      const origin = record['origin']
      if (origin === 'local' || origin === 'builtin') entry.origin = origin
    } else {
      const source = parseSourceRef(record['source'])
      if (source !== undefined) entry.source = source
    }
    entries.push(entry)
  }

  const missingRaw = root['missing']
  const missing = Array.isArray(missingRaw)
    ? missingRaw.filter((id): id is string => typeof id === 'string')
    : []

  return {
    ok: true,
    pack: {
      format: PACK_FORMAT,
      version: PACK_VERSION,
      exportedAt: textOf(root['exportedAt']) ?? '',
      generator: readGenerator(root['generator']),
      preset: { id: textOf(presetRaw['id']) ?? '', name: presetName.slice(0, MAX_TITLE_LENGTH), entries: memberIds },
      entries,
      missing,
    },
  }
}

/**
 * Decide which ids an imported pack will take here, and what its preset will say.
 *
 * A taken id is not an error and not an overwrite: the entry gets a fresh id
 * derived from its title, the preset's membership follows it, and the pack's
 * display name is kept. Importing the same pack twice therefore produces two
 * distinct sets rather than quietly rewriting the first one. Members the pack
 * itself could not carry are kept in the preset as they were — the same rule the
 * index uses for a subscription that may come back — and reported separately.
 *
 * @param pack - a pack that already passed {@link parsePack}.
 * @param taken - ids already in use here: the index, the stored bodies, the
 * built-ins, and the configured presets.
 * @returns the plan, or why the pack does not fit on this machine.
 */
export function planImport(
  pack: PromptPack,
  taken: { entryIds: Iterable<string>; presetIds: Iterable<string> },
): PackImportResult {
  const used = new Set(taken.entryIds)
  const room = MAX_ENTRIES - used.size
  if (pack.entries.length > room) {
    return refuse(
      'too-many-entries',
      `这台机器还能再放 ${String(Math.max(room, 0))} 条，这个包有 ${String(pack.entries.length)} 条（上限 ${String(MAX_ENTRIES)}）`,
    )
  }

  const renamed: Array<{ from: string; to: string }> = []
  const noBody: string[] = []
  const sourceDropped: string[] = []
  const entries = pack.entries.map((entry): PackImportEntry => {
    const wanted = isEntryId(entry.id) ? freeId(entry.id, used) : entryIdFor(entry.title, used)
    used.add(wanted)
    const kept = wanted === entry.id
    if (!kept) renamed.push({ from: entry.id, to: wanted })
    if (entry.body === undefined) noBody.push(entry.title)
    const planned: PackImportEntry = {
      id: wanted,
      title: entry.title,
      order: entry.order,
      enabled: entry.enabled,
    }
    if (entry.body !== undefined) planned.body = entry.body
    if (entry.origin !== undefined) planned.origin = entry.origin
    // A subscription's body is found upstream *by id*, so an entry that had to
    // be renamed can never read its file: recording the source anyway would
    // present an entry as read-only-upstream while it can only ever render
    // empty — and read-only means the person cannot even paste the body in.
    if (entry.source !== undefined) {
      if (kept) planned.source = entry.source.slug
      else sourceDropped.push(entry.title)
    }
    if (!kept) planned.renamedFrom = entry.id
    return planned
  })

  const presetUsed = new Set(taken.presetIds)
  const presetId = isEntryId(pack.preset.id) && !presetUsed.has(pack.preset.id)
    ? pack.preset.id
    : entryIdFor(pack.preset.name, presetUsed)
  const moved = new Map(renamed.map(({ from, to }) => [from, to]))
  const carried = new Set(pack.entries.map((entry) => entry.id))
  const missingMembers = pack.preset.entries.filter((id) => !carried.has(id))

  return {
    ok: true,
    plan: {
      entries,
      preset: {
        id: presetId,
        name: pack.preset.name,
        entries: pack.preset.entries.map((id) => moved.get(id) ?? id),
      },
      renamed,
      noBody,
      sourceDropped,
      missingMembers,
    },
  }
}

/** Build one refusal. */
function refuse(code: PackRefusalCode, message: string): PackRefusal {
  return { ok: false, code, message }
}

/** Narrow a value to a plain object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a non-empty trimmed string. */
function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Read a subscription reference, keeping only what it actually carries. */
function parseSourceRef(value: unknown): PackSourceRef | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const slug = textOf(record['slug'])
  if (slug === undefined) return undefined
  const ref: PackSourceRef = { slug }
  const repo = textOf(record['repo'])
  if (repo !== undefined) ref.repo = repo
  const branch = textOf(record['ref'])
  if (branch !== undefined) ref.ref = branch
  const file = textOf(record['file'])
  if (file !== undefined) ref.file = file
  return ref
}

/** Read the optional header a pack's writer left for a human. */
function readGenerator(value: unknown): { plugin: string; pluginVersion: string } {
  const record = asRecord(value)
  return {
    plugin: textOf(record?.['plugin']) ?? '',
    pluginVersion: textOf(record?.['pluginVersion']) ?? '',
  }
}
