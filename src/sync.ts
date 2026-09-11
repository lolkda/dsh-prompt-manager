/**
 * One source's files on disk, and the three operations the settings page drives:
 * check what changed upstream, apply it, undo the last apply.
 *
 * The layout is a three-slot rotation, so nothing is ever half-updated:
 * `staging/` holds what a check downloaded, `current/` is what the prompt reads,
 * and `previous/` keeps the version the last apply replaced so one click can put
 * it back. `state.json` carries the bookkeeping: which commit is in force, which
 * entry each file became, and the hashes and validators that make the next check
 * cheap.
 *
 * @module dsh-prompt-manager/sync
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { bodyHash } from './store.js'
import { looksLikeHtml, type Fetcher } from './net.js'
import {
  entryIdFor,
  headAtomUrl,
  isMovableRef,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  parseHeadSha,
  parseManifest,
  rawUrl,
  stemOf,
  type ManifestPrompt,
  type PromptSource,
} from './source.js'

/** One file's bookkeeping inside a source. */
export interface SourceFileState {
  /** Local entry id this file became. */
  id: string
  /** Display title the manifest asked for, when it asked for one. */
  title?: string
  /** Placement the manifest asked for, when it asked for one. */
  order?: number
  /** Whether the manifest wanted it enabled; the importer overrides on import. */
  enabled: boolean
  /** sha1 of the body in force. */
  sha1: string
  /** `etag` the upstream sent for that body. */
  etag?: string
}

/** A source's bookkeeping, persisted beside its files. */
export interface SourceState {
  /** Ref the snapshot was taken from. */
  ref: string
  /** Commit in force, when the ref could be resolved to one. */
  headSha?: string
  /** Commit the last apply replaced, for revert. */
  headShaPrevious?: string
  /** sha1 of the manifest in force. */
  manifestSha1?: string
  /** When the last apply ran, ISO-8601. */
  appliedAt?: string
  /** One record per body file in force, keyed by repository path. */
  files: Record<string, SourceFileState>
  /**
   * The last apply's undo ledger: the record each touched path had before, or
   * `null` when the path had no file at all. This is what makes revert exact —
   * a removed file comes back with the title, placement, and switch it had.
   */
  undo?: Record<string, SourceFileState | null>
}

/** One file the upstream check found a difference in. */
export interface PlannedChange {
  /** Repository-relative path. */
  path: string
  /** Local entry id. */
  id: string
  /** Display title from the manifest, when present. */
  title?: string
  /** Placement from the manifest, when present. */
  order?: number
  /** Which way the file moved. */
  kind: 'added' | 'changed' | 'removed'
  /** Lines the new body has and the old one did not. */
  added: number
  /** Lines the old body had and the new one does not. */
  removed: number
}

/** What a check concluded. */
export interface CheckOutcome {
  /** Whether upstream already matches what is in force. */
  upToDate: boolean
  /** Commit the ref resolves to, when it could be resolved. */
  headSha?: string
  /** Files that differ, newest manifest order first. */
  changes: PlannedChange[]
  /** Prompts the manifest declared, in order. */
  prompts: ManifestPrompt[]
  /** Non-fatal problems worth showing: an unreachable feed, a skipped file. */
  warnings: string[]
}

/** What a check left staged, for a later apply to pick up. */
export interface StagedPlan {
  /** Commit the check resolved. */
  headSha?: string
  /** sha1 of the manifest the check read. */
  manifestSha1: string
  /** Prompts the manifest declared. */
  prompts: ManifestPrompt[]
  /** Files the check staged. */
  changes: PlannedChange[]
  /** `etag` per staged path, the validator the next check sends. */
  etags: Record<string, string>
}

/** A check that could not conclude. */
export class CheckError extends Error {
  /** Machine-readable reason. */
  readonly reason: 'manifest' | 'network' | 'mirror' | 'too-large' | 'unknown-source' | 'nothing-staged' | 'disabled'

  /**
   * @param reason - machine-readable reason.
   * @param message - human-facing detail.
   */
  constructor(reason: CheckError['reason'], message: string) {
    super(message)
    this.name = 'CheckError'
    this.reason = reason
  }
}

/** The files of one source, confined to one directory. */
export class SourceWorkspace {
  /** Source slug. */
  readonly slug: string
  /** `<root>/sources/<slug>`. */
  readonly dir: string

  /**
   * @param root - the plugin's storage root, e.g. `$DSH_HOME/prompt-manager`.
   * @param slug - the source id.
   */
  constructor(root: string, slug: string) {
    this.slug = slug
    this.dir = resolve(root, 'sources', slug)
  }

  /** Directory holding the version in force. */
  get currentDir(): string {
    return join(this.dir, 'current')
  }

  /** Directory holding the version the last apply replaced. */
  get previousDir(): string {
    return join(this.dir, 'previous')
  }

  /** Directory holding what a check downloaded but nobody applied yet. */
  get stagingDir(): string {
    return join(this.dir, 'staging')
  }

  /** Path of the bookkeeping file. */
  get statePath(): string {
    return join(this.dir, 'state.json')
  }

  /**
   * Absolute path of one body file inside one slot.
   * @param slot - which slot.
   * @param path - repository-relative manifest path.
   * @returns the absolute path; a traversal attempt resolves to `undefined`.
   */
  slotPath(slot: 'current' | 'previous' | 'staging', path: string): string | undefined {
    const base = slot === 'current' ? this.currentDir : slot === 'previous' ? this.previousDir : this.stagingDir
    const file = resolve(base, path)
    const prefix = `${resolve(base)}${process.platform === 'win32' ? '\\' : '/'}`
    return file.startsWith(prefix) ? file : undefined
  }

  /** Whether this source has any files on disk. */
  exists(): boolean {
    return existsSync(this.dir)
  }

  /**
   * Read the bookkeeping, defaulting to an empty state.
   * @returns the state; an unreadable or malformed file reads as empty.
   */
  readState(): SourceState {
    if (!existsSync(this.statePath)) return { ref: '', files: {} }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return { ref: '', files: {} }
      const record = parsed as Record<string, unknown>
      const files = typeof record['files'] === 'object' && record['files'] !== null && !Array.isArray(record['files'])
        ? record['files'] as Record<string, SourceFileState>
        : {}
      const state: SourceState = { ref: typeof record['ref'] === 'string' ? record['ref'] : '', files }
      if (typeof record['headSha'] === 'string') state.headSha = record['headSha']
      if (typeof record['headShaPrevious'] === 'string') state.headShaPrevious = record['headShaPrevious']
      if (typeof record['manifestSha1'] === 'string') state.manifestSha1 = record['manifestSha1']
      if (typeof record['appliedAt'] === 'string') state.appliedAt = record['appliedAt']
      if (typeof record['undo'] === 'object' && record['undo'] !== null && !Array.isArray(record['undo'])) {
        state.undo = record['undo'] as Record<string, SourceFileState | null>
      }
      return state
    } catch {
      return { ref: '', files: {} }
    }
  }

  /**
   * Persist the bookkeeping.
   * @param state - the state to write.
   */
  writeState(state: SourceState): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  /** Read one body from a slot. */
  read(slot: 'current' | 'previous' | 'staging', path: string): string | undefined {
    const file = this.slotPath(slot, path)
    if (file === undefined || !existsSync(file)) return undefined
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return undefined
    }
  }

  /** Paths present in a slot, relative to that slot. */
  list(slot: 'current' | 'previous' | 'staging'): string[] {
    const base = slot === 'current' ? this.currentDir : slot === 'previous' ? this.previousDir : this.stagingDir
    if (!existsSync(base)) return []
    const found: string[] = []
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) walk(join(dir, entry.name), relative)
        else if (entry.name.endsWith('.md')) found.push(relative)
      }
    }
    walk(base, '')
    return found.sort()
  }

  /** Write one body into the staging slot. */
  stage(path: string, text: string): void {
    const file = this.slotPath('staging', path)
    if (file === undefined) throw new CheckError('manifest', `refusing to stage outside the source: ${path}`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  }

  /** Empty the staging slot. */
  clearStaging(): void {
    rmSync(this.stagingDir, { recursive: true, force: true })
  }

  /**
   * Record what a check staged, so an apply can run without repeating the
   * network round trip.
   * @param plan - the staged plan.
   */
  writePlan(plan: StagedPlan): void {
    mkdirSync(this.stagingDir, { recursive: true })
    writeFileSync(join(this.stagingDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  }

  /**
   * Read the staged plan.
   * @returns the plan, or `undefined` when nothing is staged.
   */
  readPlan(): StagedPlan | undefined {
    const file = join(this.stagingDir, 'plan.json')
    if (!existsSync(file)) return undefined
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const record = parsed as Record<string, unknown>
      if (!Array.isArray(record['changes']) || !Array.isArray(record['prompts'])) return undefined
      const plan: StagedPlan = {
        changes: record['changes'] as PlannedChange[],
        prompts: record['prompts'] as ManifestPrompt[],
        manifestSha1: typeof record['manifestSha1'] === 'string' ? record['manifestSha1'] : '',
        etags: typeof record['etags'] === 'object' && record['etags'] !== null && !Array.isArray(record['etags'])
          ? record['etags'] as Record<string, string>
          : {},
      }
      if (typeof record['headSha'] === 'string') plan.headSha = record['headSha']
      return plan
    } catch {
      return undefined
    }
  }

  /** Remove the whole source directory. */
  remove(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

/**
 * Line counts of what a change adds and removes, by longest common
 * subsequence over lines. The dynamic table is skipped for pathologically large
 * pairs, where the answer degrades to "roughly how many lines differ" rather
 * than stalling the request.
 *
 * @param before - the body in force, or `''` for a new file.
 * @param after - the checked body.
 * @returns added and removed line counts.
 */
export function diffCounts(before: string, after: string): { added: number; removed: number } {
  const left = before.length === 0 ? [] : before.split('\n')
  const right = after.length === 0 ? [] : after.split('\n')
  let head = 0
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1
  let tail = 0
  while (
    tail < left.length - head
    && tail < right.length - head
    && left[left.length - 1 - tail] === right[right.length - 1 - tail]
  ) tail += 1
  const a = left.slice(head, left.length - tail)
  const b = right.slice(head, right.length - tail)
  if (a.length === 0 && b.length === 0) return { added: 0, removed: 0 }
  if (a.length === 0) return { added: b.length, removed: 0 }
  if (b.length === 0) return { added: 0, removed: a.length }
  const common = a.length * b.length > 250_000 ? Math.min(a.length, b.length) : lcsLength(a, b)
  return { added: b.length - common, removed: a.length - common }
}

/**
 * Longest common subsequence length over two line arrays.
 * @param a - first sequence.
 * @param b - second sequence.
 * @returns the length of the longest common subsequence.
 */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? (previous[j - 1] ?? 0) + 1
        : Math.max(previous[j] ?? 0, current[j - 1] ?? 0)
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/**
 * Check one source against its upstream and stage whatever changed.
 *
 * @param input - source, workspace, and the fetcher carrying the proxy and mirror.
 * @returns what changed, or that nothing did.
 * @throws {CheckError} when the check cannot conclude.
 */
export async function checkSource(input: {
  source: PromptSource
  workspace: SourceWorkspace
  fetcher: Fetcher
}): Promise<CheckOutcome> {
  const { source, workspace, fetcher } = input
  const state = workspace.readState()
  const warnings: string[] = []

  let headSha: string | undefined
  if (isMovableRef(source.ref)) {
    try {
      const feed = await fetcher.get(headAtomUrl(source.repo, source.ref), { timeoutMs: 8000 })
      if (feed.status === 200) headSha = parseHeadSha(feed.text)
      if (headSha === undefined) warnings.push('commits 源里没有读出 commit sha，改用逐文件比对')
    } catch (error) {
      warnings.push(`commit 探测失败，改用逐文件比对：${error instanceof Error ? error.message : String(error)}`)
    }
    if (headSha !== undefined && headSha === state.headSha) {
      return { upToDate: true, headSha, changes: [], prompts: [], warnings }
    }
  }

  const manifestResponse = await fetchOrThrow(fetcher, rawUrl(source.repo, source.ref, MANIFEST_FILE))
  if (manifestResponse.status === 404) {
    throw new CheckError('manifest', `仓库里没有 ${MANIFEST_FILE}（在 ${source.repo}@${source.ref} 的根目录）`)
  }
  const manifestSha1 = bodyHash(manifestResponse.text)
  let prompts: ManifestPrompt[]
  try {
    prompts = parseManifest(JSON.parse(manifestResponse.text) as unknown)
  } catch (error) {
    throw new CheckError('manifest', error instanceof Error ? error.message : String(error))
  }

  workspace.clearStaging()
  const changes: PlannedChange[] = []
  const etags: Record<string, string> = {}
  const wanted = new Set(prompts.map((prompt) => prompt.file))

  for (const prompt of prompts) {
    const known = state.files[prompt.file]
    // A conditional request is only worth sending when the copy it would
    // validate is on disk. With the body file gone — deleted by hand, or lost
    // between two applies — a 304 would answer with no content at all, and
    // staging that empty answer would silently blank the entry for good. So the
    // validator is dropped and the file is fetched in full instead.
    const local = workspace.read('current', prompt.file)
    const response = await fetchOrThrow(
      fetcher,
      rawUrl(source.repo, source.ref, prompt.file),
      local === undefined ? undefined : known?.etag,
    )
    const id = entryIdFor(source.id, prompt.file)
    if (response.status === 304) continue
    if (response.status === 404) {
      warnings.push(`${prompt.file} 在远端不存在，已跳过`)
      continue
    }
    const sha1 = bodyHash(response.text)
    if (known !== undefined && known.sha1 === sha1) continue
    if (Buffer.byteLength(response.text, 'utf8') > MAX_FILE_BYTES) {
      warnings.push(`${prompt.file} 超过 ${String(MAX_FILE_BYTES)} 字节，已跳过`)
      continue
    }
    workspace.stage(prompt.file, response.text)
    if (response.etag !== undefined) etags[prompt.file] = response.etag
    const counts = diffCounts(local ?? '', response.text)
    const change: PlannedChange = {
      path: prompt.file,
      id,
      kind: known === undefined ? 'added' : 'changed',
      added: counts.added,
      removed: counts.removed,
    }
    if (prompt.title !== undefined) change.title = prompt.title
    if (prompt.order !== undefined) change.order = prompt.order
    changes.push(change)
  }

  for (const path of Object.keys(state.files)) {
    if (wanted.has(path)) continue
    const body = workspace.read('current', path) ?? ''
    changes.push({
      path,
      id: state.files[path]?.id ?? entryIdFor(source.id, path),
      kind: 'removed',
      added: 0,
      removed: body.length === 0 ? 0 : body.split('\n').length,
    })
  }

  const plan: StagedPlan = { changes, prompts, manifestSha1, etags }
  if (headSha !== undefined) plan.headSha = headSha
  workspace.writePlan(plan)

  const outcome: CheckOutcome = { upToDate: changes.length === 0, changes, prompts, warnings }
  if (headSha !== undefined) outcome.headSha = headSha
  return outcome
}

/**
 * Fetch one URL and refuse obvious non-content answers.
 * @param fetcher - the fetcher to use.
 * @param url - absolute upstream URL.
 * @param etag - stored validator, when the caller has one.
 * @returns the response.
 * @throws {CheckError} on network failure, an HTML answer, or a server error.
 */
async function fetchOrThrow(
  fetcher: Fetcher,
  url: string,
  etag?: string,
): Promise<{ status: number; text: string; etag: string | undefined }> {
  let response
  try {
    response = await fetcher.get(url, etag === undefined ? {} : { etag })
  } catch (error) {
    throw new CheckError('network', error instanceof Error ? error.message : String(error))
  }
  if (response.status === 200 && looksLikeHtml(response)) {
    throw new CheckError('mirror', `${url} 返回了 HTML 页面，镜像没有正确代理这个文件`)
  }
  if (response.status !== 200 && response.status !== 304 && response.status !== 404) {
    throw new CheckError('network', `${url} 返回 ${String(response.status)}`)
  }
  return { status: response.status, text: response.text, etag: response.etag }
}

/**
 * Apply staged changes into the version in force.
 *
 * @param input - workspace, current state, the staged plan, the source, and the
 * paths the caller selected (all of them when omitted).
 * @returns the new state and the changes that landed.
 */
export function applyChanges(input: {
  workspace: SourceWorkspace
  state: SourceState
  plan: StagedPlan
  source: PromptSource
  selected?: readonly string[]
  nowIso: string
}): { state: SourceState; applied: PlannedChange[] } {
  const { workspace, state, plan, source } = input
  const selected = input.selected === undefined ? undefined : new Set(input.selected)
  const applied: PlannedChange[] = []
  const files: Record<string, SourceFileState> = { ...state.files }
  const undo: Record<string, SourceFileState | null> = {}

  for (const change of plan.changes) {
    if (selected !== undefined && !selected.has(change.path)) continue
    const current = workspace.slotPath('current', change.path)
    const previous = workspace.slotPath('previous', change.path)
    const staged = workspace.slotPath('staging', change.path)
    if (current === undefined || previous === undefined) continue
    undo[change.path] = files[change.path] ?? null
    if (change.kind === 'removed') {
      if (existsSync(current)) {
        mkdirSync(dirname(previous), { recursive: true })
        copyFileSync(current, previous)
        rmSync(current, { force: true })
      }
      delete files[change.path]
      applied.push(change)
      continue
    }
    if (staged === undefined || !existsSync(staged)) continue
    if (existsSync(current)) {
      mkdirSync(dirname(previous), { recursive: true })
      copyFileSync(current, previous)
    }
    mkdirSync(dirname(current), { recursive: true })
    copyFileSync(staged, current)
    const prompt = plan.prompts.find((candidate) => candidate.file === change.path)
    const next: SourceFileState = {
      id: change.id,
      enabled: prompt?.enabled ?? true,
      sha1: bodyHash(readFileSync(current, 'utf8')),
    }
    const title = prompt?.title ?? undefined
    if (title !== undefined) next.title = title
    const order = prompt?.order ?? undefined
    if (order !== undefined) next.order = order
    const etag = plan.etags[change.path]
    if (etag !== undefined) next.etag = etag
    files[change.path] = next
    applied.push(change)
  }

  const next: SourceState = {
    ref: source.ref,
    files,
    appliedAt: input.nowIso,
    manifestSha1: plan.manifestSha1,
    undo,
  }
  if (plan.headSha !== undefined) next.headSha = plan.headSha
  else if (state.headSha !== undefined) next.headSha = state.headSha
  if (state.headSha !== undefined) next.headShaPrevious = state.headSha
  return { state: next, applied }
}

/**
 * Put the version the last apply replaced back in force, guided by the apply's
 * undo ledger so a restored file also gets its title, placement, and switch back.
 *
 * @param input - workspace and current state.
 * @returns the restored state and the paths that moved back.
 */
export function revertChanges(input: {
  workspace: SourceWorkspace
  state: SourceState
}): { state: SourceState; reverted: string[] } {
  const { workspace, state } = input
  const reverted: string[] = []
  const files: Record<string, SourceFileState> = { ...state.files }

  for (const [path, record] of Object.entries(state.undo ?? {})) {
    const current = workspace.slotPath('current', path)
    const previous = workspace.slotPath('previous', path)
    if (current === undefined || previous === undefined) continue
    if (record === null) {
      rmSync(current, { force: true })
      delete files[path]
      reverted.push(path)
      continue
    }
    if (!existsSync(previous)) continue
    mkdirSync(dirname(current), { recursive: true })
    copyFileSync(previous, current)
    rmSync(previous, { force: true })
    files[path] = record
    reverted.push(path)
  }

  const next: SourceState = { ref: state.ref, files }
  if (state.headShaPrevious !== undefined) next.headSha = state.headShaPrevious
  const manifestSha1 = state.manifestSha1 ?? undefined
  if (manifestSha1 !== undefined) next.manifestSha1 = manifestSha1
  return { state: next, reverted }
}

/**
 * The entry title a manifest file should get on import.
 * @param source - owning source.
 * @param prompt - the manifest entry.
 * @returns a non-empty display title.
 */
export function titleFor(source: PromptSource, prompt: ManifestPrompt): string {
  if (prompt.title !== undefined && prompt.title.length > 0) return prompt.title
  if (prompt.id !== undefined && prompt.id.length > 0) return prompt.id
  return stemOf(prompt.file)
}
