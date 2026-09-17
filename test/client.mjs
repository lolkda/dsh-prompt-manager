#!/usr/bin/env node
/**
 * Client-bundle test: the browser half is served as a lazy-CJS factory, so it
 * can be materialized in Node against stub modules and driven before it ever
 * reaches a browser.
 *
 * The React stub is a small stateful renderer — hook slots, dependency
 * comparison for `useMemo`/`useCallback`/`useEffect`, and a microtask re-render
 * — so the section's two views can be exercised end to end: the list, entering
 * the editor page from a row's menu, saving, and returning.
 *
 * Coverage: bundle identity and plugin shape, the section registration, the
 * list rows and their kebab menus, the injection switch writing the index, the
 * editor page's save path, and the subscription pages.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ROUTE_PREFIX } from '../lib/routes.js'

/** The built browser bundle under test. */
const BUNDLE = fileURLToPath(new URL('../client/client.js', import.meta.url))

/**
 * Route prefix the Host serves this plugin under.
 *
 * The bundle carries its own copy of this constant, so taking the expected
 * request URLs from the Host's is what keeps the two halves from drifting apart
 * unnoticed — a prefix change on one side fails here.
 */
const ROUTE = ROUTE_PREFIX

/** This package's own name. The client factory id must equal it. */
const PACKAGE_NAME = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).name

/** Index the fake settings scope serves. */
const ENTRIES = [
  { id: 'alpha', title: '第一条', order: 10, enabled: true },
  // The settings schema resolves a missing source to an empty string, so a
  // local entry reaches the page like this — and must not read as subscribed.
  { id: 'beta', title: '第二条', order: 20, enabled: false, source: '' },
  { id: 'note', title: '补充说明', order: 40, enabled: true },
  // A compaction entry: it never becomes a system prompt section, so it carries
  // no meaningful `enabled` flag and only the entry-level pointer can make it
  // live. `kind` is the whole difference from a section entry. Its title is
  // deliberately not the badge's text, so a page that echoed one for the other
  // would be caught.
  { id: 'compact-zh', title: '压缩指令（中文版）', order: 90, enabled: false, kind: 'compaction' },
]

/** The section entries — the ones the injection switches and the member list are about. */
const SECTION_ENTRIES = ENTRIES.filter((entry) => entry.kind !== 'compaction')

/** Subscriptions the Host reports for the sources page. */
const SUBSCRIPTIONS = [
  { id: 'o-r', repo: 'o/r', ref: 'main', mirror: 'https://gh-proxy.example', enabled: true, files: 2, pending: 0 },
]

/** Presets the Host reports for the presets page and the composer chip. */
const PRESETS = [
  { id: 'ctf', name: 'CTF 作业', entries: ['alpha', 'beta'], compaction: 'compact-zh' },
  { id: 'plain', name: '日常', entries: [], compaction: '' },
]

/** The pack the export route answers with, as text. */
const PACK_JSON = {
  format: 'dsh-prompt-manager-pack',
  version: 1,
  exportedAt: '2026-09-12T00:00:00.000Z',
  generator: { plugin: '@lolkda/dsh-prompt-manager', pluginVersion: '9.9.9' },
  preset: { id: 'ctf', name: 'CTF 作业', entries: ['alpha'] },
  entries: [{ id: 'alpha', title: '第一条', order: 10, enabled: true, origin: 'local', body: '# First Entry\n\nbody' }],
  missing: [],
}

/** What the import route reports back, naming everything it could not do. */
const IMPORT_REPORT = {
  entries: [{ id: 'alpha', title: '第一条' }, { id: 'fresh', title: '新条目' }],
  preset: { id: 'ctf-2', name: 'CTF 作业', entries: ['alpha', 'fresh'] },
  renamed: [{ from: 'alpha', to: 'alpha-2' }, { from: 'beta', to: 'beta-2' }, { from: 'gamma', to: 'gamma-2' }, { from: 'delta', to: 'delta-2' }],
  noBody: ['订阅来的'],
  sourceDropped: ['契约'],
  missingMembers: ['gone-entry'],
  unregistered: ['oops'],
}

/** Minimal element factory shared by every stub. */
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children }
}

/** Name of the stub element a switch renders as. */
const SWITCH = 'stub-switch'
/** Name of the stub element the markdown preview renders as. */
const MARKDOWN = 'stub-markdown'
/** Name of the stub element the kebab menu renders as. */
const MENU = 'stub-menu'

/**
 * A `React.memo`-shaped component: an object carrying `$$typeof`, not a
 * function. The shell's real `MarkdownText` is a memo, and a bundle that only
 * accepts callables silently degrades to plain text — so the stub mirrors that
 * shape and the walker below unwraps it the way React does.
 */
function memo(render) {
  return { $$typeof: Symbol.for('react.memo'), type: render }
}

/** UI primitives stub: every control reports itself as a recognisable node. */
const primitivesStub = {
  Switch: (props) => ({ type: SWITCH, props, children: [] }),
  MarkdownText: memo((props) => ({ type: MARKDOWN, props, children: [] })),
  Button: (props) => ({ type: 'stub-button', props, children: props.children ?? [] }),
  Menu: (props) => ({ type: MENU, props, children: [] }),
  IconEllipsisOutline16: (props) => ({ type: 'stub-icon', props: props ?? {}, children: [] }),
  IconEditOutline16: (props) => ({ type: 'stub-icon', props: props ?? {}, children: [] }),
  IconTrashOutline16: (props) => ({ type: 'stub-icon', props: props ?? {}, children: [] }),
  IconCheckOutline16: (props) => ({ type: 'stub-icon', props: props ?? {}, children: [] }),
  IconCloseOutline16: (props) => ({ type: 'stub-icon', props: props ?? {}, children: [] }),
}

/** `document` stub good enough for style injection. */
/** Files the page asked the browser to download, in order. */
const downloads = []

/**
 * The stylesheet the page injected, as text.
 *
 * This suite drives a tree of React elements, so nothing here lays out and no
 * case can measure a box. The one property of the sheet a case can still hold to
 * is the shape its rules give — which is exactly what the add row's stability
 * rests on, so it is worth pinning rather than leaving to the eye.
 */
const injectedCss = []

const documentStub = {
  querySelector: () => null,
  createElement: (tag) => {
    if (tag === 'a') {
      return {
        dataset: {},
        textContent: '',
        href: '',
        download: '',
        click() { downloads.push({ name: this.download, href: this.href }) },
        remove() {},
      }
    }
    const node = { dataset: {}, appendChild() {}, remove() {} }
    Object.defineProperty(node, 'textContent', {
      get: () => '',
      set: (value) => { injectedCss.push(String(value)) },
    })
    return node
  },
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
}

/**
 * `window` stub the bundle reads for the kebab menu's confirmations. The bundle
 * receives this very object, so a case below can change `confirm` mid-run.
 */
const windowStub = { __ModuleLoader__: { load: () => {} }, confirm: () => true }

/** The variables the Host reports; saving a script adds one. */
let VARIABLES = [
  { name: 'os', value: 'Windows', source: 'environment', updatedAt: '2026-09-11T00:00:00.000Z', referencedBy: ['第一条'] },
  { name: 'toolchain_rust', value: 'rustc 1.80.0', source: 'script', detail: 'toolchain', updatedAt: '2026-09-11T00:00:00.000Z', referencedBy: [] },
]

/** The scripts the Host reports; saving a script adds one. */
let SCRIPTS = [{
  name: 'toolchain',
  sha1: 'a'.repeat(40),
  variables: ['toolchain_rust'],
  ranAt: '2026-09-11T00:00:00.000Z',
  exitCode: 0,
  ms: 62,
  pending: false,
}]

/** One run report, as the Host hands it back for a draft. */
const RUN_REPORT = {
  name: 'fresh',
  ok: true,
  exitCode: 0,
  ms: 12,
  variables: { fresh: 'ok' },
  truncated: [],
  problems: [],
  warnings: [],
  stdout: '{"fresh":"ok"}',
  stderr: '',
}

/** Settings writes the section attempted. */
const writes = []
/** Requests the section sent. */
const requests = []
/**
 * One counter shared by both recorders, so the test can assert the order of a
 * request against the order of a settings write (`seq`).
 */
let step = 0

/**
 * What `GET /status` reports; a case below lowers the cap to exercise the add
 * refusal. `compaction` is the optional field the Host adds only while the
 * feature is on: a case below removes it to exercise the disabled reading.
 */
let STATUS = {
  dir: '/tmp/prompt-manager/sections',
  writable: true,
  ids: [],
  maxEntries: 50,
  compaction: { matches: 2, replacements: 1, lastReplacedAt: '2026-09-12T03:00:00.000Z', characters: 1234 },
}

/** The fake settings scope the section binds. Its methods use `this`, exactly
 * like the real SettingsScopeController, so an unbound method reference fails
 * the test instead of a browser. */
const scope = {
  state: {
    status: 'ready',
    writable: true,
    mode: 'host',
    revision: 3,
    value: { entries: ENTRIES, presets: [], activePreset: '', compaction: '' },
    // The composition base layer, empty because the plugin ships no entries.
    base: { entries: [] },
    user: {},
  },
  getSnapshot() {
    return this.state
  },
  subscribe(listener) {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
  },
  set(field, value) {
    writes.push({ field, value, seq: step++ })
    // The real transport resolves and then republishes the document, so the
    // snapshot a later read sees contains what was just written.
    this.state = { ...this.state, value: { ...this.state.value, [field]: value } }
    return Promise.resolve()
  },
  unset() {
    return Promise.resolve()
  },
  mutate() {
    return Promise.resolve()
  },
}

/**
 * Whether an element type is a mountable component: a plain function, or a
 * `memo`/`forwardRef` object carrying `$$typeof`.
 */
function isComponent(type) {
  if (typeof type === 'function') return true
  return typeof type === 'object' && type !== null && typeof type.$$typeof === 'symbol'
}

/**
 * Walk an element tree, visiting every node and expanding function and memo
 * components (which is what drives the hooks).
 * @param node - element, child array, or text.
 * @param visit - called once per node.
 */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ type: '#text', props: {}, children: [node] })
    return
  }
  visit(node)
  if (isComponent(node.type)) {
    if (typeof node.type === 'function' && node.type.prototype !== undefined && node.type.prototype.isReactComponent) {
      walk(node.children, visit)
      return
    }
    const render = typeof node.type === 'function' ? node.type : node.type.type
    walk(render({ ...node.props, children: node.children }), visit)
    return
  }
  walk(node.children, visit)
}

/**
 * A stateful React stub: hook slots in call order, dependency comparison, and a
 * microtask re-render, enough to drive the section's view switching.
 * @returns the React module to hand the bundle, plus render helpers.
 */
function createRenderer() {
  const slots = []
  let cursor = 0
  let pendingEffects = []
  let scheduled = false
  let component = null
  let props = null
  let tree = null

  function sameDeps(previous, deps) {
    if (previous === undefined || previous.deps === undefined || deps === undefined) return false
    if (previous.deps.length !== deps.length) return false
    return deps.every((dep, index) => Object.is(dep, previous.deps[index]))
  }

  /**
   * Expand every function component in an element tree, so later inspection
   * walks a materialized tree instead of re-invoking components (which would
   * disturb the hook slots).
   */
  function expand(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node === 'string' || typeof node === 'number') return node
    if (isComponent(node.type)) {
      if (typeof node.type === 'function' && node.type.prototype !== undefined && node.type.prototype.isReactComponent !== undefined) {
        return { type: node.type, props: node.props, children: expand(node.children) }
      }
      const render = typeof node.type === 'function' ? node.type : node.type.type
      return expand(render({ ...node.props, children: node.children }))
    }
    return { type: node.type, props: node.props, children: expand(node.children) }
  }

  function render() {
    cursor = 0
    pendingEffects = []
    tree = expand(component(props))
    const effects = pendingEffects
    pendingEffects = []
    for (const effect of effects) effect()
    return tree
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      render()
    })
  }

  const React = {
    createElement,
    useState(initial) {
      const index = cursor++
      const slot = slots[index] ?? (slots[index] = { value: typeof initial === 'function' ? initial() : initial })
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        schedule()
      }]
    },
    useMemo(factory, deps) {
      const index = cursor++
      const previous = slots[index]
      if (!sameDeps(previous, deps)) slots[index] = { deps, value: factory() }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const previous = slots[index]
      if (!sameDeps(previous, deps)) slots[index] = { deps, value: callback }
      return slots[index].value
    },
    useEffect(callback, deps) {
      const index = cursor++
      const previous = slots[index]
      slots[index] = { deps }
      if (!sameDeps(previous, deps)) pendingEffects.push(callback)
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor += 1
      return getSnapshot()
    },
    Component: class Component {
      constructor(componentProps) {
        this.props = componentProps ?? {}
        this.state = {}
      }

      setState(next) {
        this.state = { ...this.state, ...next }
      }
    },
  }
  React.Component.prototype.isReactComponent = {}

  return {
    React,
    /** Render once and hand back the tree. */
    mount(target, initialProps) {
      component = target
      props = initialProps
      return render()
    },
    /** Let the asynchronous work an interaction started settle, then re-render. */
    async settle() {
      for (let tick = 0; tick < 6; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
      return tree
    },
    get tree() {
      return tree
    },
  }
}

/**
 * Load and materialize the bundle against the stubs.
 * @param React - the React module the bundle should receive.
 * @returns the materialized exports plus the registration it performed.
 */
function materialize(React) {
  const source = readFileSync(BUNDLE, 'utf8')
  let captured
  const window = windowStub
  window.__ModuleLoader__ = { load: (entry) => { captured = entry } }
  const requireStub = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`the bundle must not require ${specifier}`)
  }
  // eslint-disable-next-line no-new-func -- the bundle is a classic script, not a module
  new Function('window', 'document', 'fetch', source)(
    window,
    documentStub,
    async (url, init) => {
      const method = init?.method ?? 'GET'
      requests.push({ url, method, body: init?.body, seq: step++ })
      if (url.endsWith('/preset/id')) return { ok: true, status: 200, json: async () => ({ id: 'new-preset' }) }
      if (url.endsWith('/id')) return { ok: true, status: 200, json: async () => ({ id: 'new-note' }) }
      if (url.endsWith('/pack/import') && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ...IMPORT_REPORT }) }
      }
      if (url.includes('/pack/export') && method === 'GET') {
        // `plain` stands in for any refusal the Host may answer with.
        if (url.includes('preset=plain')) {
          return { ok: false, status: 404, text: async () => JSON.stringify({ error: '没有这个组合：plain', code: 'unknown-preset' }) }
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(PACK_JSON) }
      }
      if (url.endsWith('/status')) {
        return { ok: true, status: 200, json: async () => ({ ...STATUS }) }
      }
      if (url.endsWith('/sources') && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ sources: SUBSCRIPTIONS }) }
      }
      if (url.endsWith('/sources') && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'o-r' }) }
      }
      if (url.endsWith('/check')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            slug: 'o-r',
            upToDate: false,
            headSha: 'a'.repeat(40),
            changes: [
              { path: 'prompts/a.md', id: 'o-r-a', kind: 'changed', added: 2, removed: 1 },
              // A rename reaches the page as two rows that are one move.
              { path: 'prompts/ctf.md', id: 'o-r-contract', kind: 'added', added: 4, removed: 0, renamedFrom: 'prompts/contract.md' },
              { path: 'prompts/contract.md', id: 'o-r-contract', kind: 'removed', added: 0, removed: 4, renamedTo: 'prompts/ctf.md' },
            ],
            prompts: [],
            warnings: [],
          }),
        }
      }
      if (url.endsWith('/apply')) return { ok: true, status: 200, json: async () => ({ slug: 'o-r', applied: [], entries: [] }) }
      if (url.endsWith('/variables') && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ dir: '/tmp/prompt-manager/scripts', variables: VARIABLES, scripts: SCRIPTS }) }
      }
      if (url.endsWith('/variables/run')) {
        return { ok: true, status: 200, json: async () => ({ ...RUN_REPORT, name: JSON.parse(init.body).name ?? 'draft' }) }
      }
      if (url.endsWith('/variables/refresh')) {
        return { ok: true, status: 200, json: async () => ({ reports: [{ ...RUN_REPORT, name: 'toolchain' }] }) }
      }
      if (url.includes('/script/') && method === 'GET') {
        const name = decodeURIComponent(url.slice(url.indexOf('/script/') + '/script/'.length))
        return { ok: true, status: 200, json: async () => ({ name, source: 'console.log(JSON.stringify({ fresh: "ok" }))', sha1: 'a'.repeat(40) }) }
      }
      if (url.includes('/script/') && method === 'PUT') {
        const name = decodeURIComponent(url.slice(url.indexOf('/script/') + '/script/'.length))
        const payload = JSON.parse(init.body)
        // A real save registers the variables it produced, so the refetch shows them.
        VARIABLES = [...VARIABLES, {
          name: 'fresh',
          value: 'ok',
          source: 'script',
          detail: name,
          updatedAt: '2026-09-11T01:00:00.000Z',
          referencedBy: [],
        }]
        SCRIPTS = [...SCRIPTS, {
          name,
          sha1: 'b'.repeat(40),
          variables: ['fresh'],
          ranAt: '2026-09-11T01:00:00.000Z',
          exitCode: 0,
          ms: 12,
          pending: false,
        }]
        return {
          ok: true,
          status: 200,
          json: async () => ({ name, sha1: 'b'.repeat(40), variables: { fresh: 'ok' }, report: { ...RUN_REPORT, name }, saved: payload.source }),
        }
      }
      if (url.includes('/script/') && method === 'DELETE') {
        const name = decodeURIComponent(url.slice(url.indexOf('/script/') + '/script/'.length))
        SCRIPTS = SCRIPTS.filter((script) => script.name !== name)
        return { ok: true, status: 200, json: async () => ({ name, removed: true }) }
      }
      if (method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({ id: 'alpha', body: 'SAVED', source: 'user', sha1: 's1', fileSha1: 'f1' }) }
      }
      if (url.includes('src-a-a')) {
        return { ok: true, status: 200, json: async () => ({ id: 'src-a-a', body: 'SUBSCRIBED BODY', source: 'subscribed', sha1: 'ss', fileSha1: null }) }
      }
      return { ok: true, status: 200, json: async () => ({ id: 'alpha', body: '# First Entry\n\nbody', source: 'user', sha1: 's', fileSha1: null }) }
    },
  )
  assert.ok(captured !== undefined, 'the bundle must register a factory with the module loader')
  assert.equal(captured.id, PACKAGE_NAME, 'the factory id must be the package name')

  const exports = captured.factory(requireStub)
  assert.equal(exports.name, 'dsh-prompt-manager', 'the client plugin must expose its cordis name')
  assert.ok(exports.inject.includes('slots'), 'the client plugin must inject the slot service')
  assert.ok(exports.inject.includes('settingsScope'), 'the client plugin must inject the settings scope service')
  assert.equal(typeof exports.apply, 'function', 'the client plugin must expose apply')

  const registrations = []
  const injections = []
  const ctx = {
    settingsScope: {
      bind: (spec) => {
        assert.equal(spec.namespace, 'prompt-manager', 'the section must bind the prompt-manager namespace')
        return scope
      },
    },
    slots: {
      inject: (key, callback) => {
        injections.push(key)
        callback()
        return () => {}
      },
      register: (meta, component) => {
        registrations.push({ meta, component })
        return () => {}
      },
    },
    effect: (execute) => {
      const disposer = execute()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  exports.apply(ctx)
  return { registrations, injections }
}

/** Flatten an element tree into its texts and the nodes of one type. */
function inspect(tree, type) {
  const texts = []
  const nodes = []
  walk(tree, (node) => {
    if (node.type === '#text') texts.push(String(node.children[0]))
    if (type !== undefined && node.type === type) nodes.push(node)
  })
  return { texts, text: texts.join(' '), nodes }
}

/** The menu item with one id. */
const item = (menu, id) => menu.props.items.find((candidate) => candidate.id === id)

/**
 * The first button whose flattened children contain a label. The section draws
 * its own buttons — the shell's own settings pages do the same, because the
 * `Button` primitive is the larger dialog-sized control — so these are plain
 * elements, found by the text they render.
 */
function button(tree, label) {
  return inspect(tree, 'button').nodes.find((node) => textOf(node).includes(label))
}

/** Every text node under one element, joined — for buttons whose children are elements. */
function textOf(node) {
  const parts = []
  walk(node, (child) => {
    if (child.type === '#text') parts.push(String(child.children[0]))
  })
  return parts.join(' ')
}

const renderer = createRenderer()
const { registrations, injections } = materialize(renderer.React)

// ── registration ──────────────────────────────────────────────────────────────

assert.deepEqual(
  injections,
  ['settings.section', 'conversation.input.right'],
  'the bundle must contribute the settings section and both composer controls',
)
assert.equal(registrations.length, 3, 'exactly one settings section and two composer controls must be registered')
const { meta, component } = registrations[0]
assert.equal(meta.name, 'settings.section', 'the registration must name its slot')
assert.equal(meta.id, 'prompt-manager', 'the section id must be the namespace')
assert.equal(meta.order, 60, 'the section must sit after the shipped settings sections')
assert.equal(meta.label(), '提示词', 'the navigation label must be the Chinese one')
const { meta: chipMeta } = registrations[1]
assert.equal(chipMeta.name, 'conversation.input.right', 'the preset chip must sit in the composer tool row')
assert.equal(chipMeta.id, 'prompt-manager', 'the chip id must be the namespace')
assert.equal(chipMeta.order, 10, 'and come first of the two that share that row')
const { meta: compactionChipMeta } = registrations[2]
assert.equal(compactionChipMeta.name, 'conversation.input.right', 'the compaction chip rides the same row')
assert.equal(compactionChipMeta.id, 'prompt-manager-compaction', 'under an id of its own, since a slot lists both')
assert.equal(compactionChipMeta.order, 11, 'right after the preset chip it sits beside')

// ── the list page ─────────────────────────────────────────────────────────────

let tree = renderer.mount(component, { scope })
await renderer.settle()
tree = renderer.tree

let listing = inspect(tree)
for (const entry of ENTRIES) assert.ok(listing.text.includes(entry.title), `the list must show ${entry.title}`)
assert.ok(listing.text.includes('新增提示词'), 'the list must offer an add control')
assert.ok(listing.text.includes('下一个模型步骤生效'), 'the list must say when a change takes effect')
assert.ok(listing.text.includes('/tmp/prompt-manager/sections'), 'the list must show where the bodies live')

// The plugin's own repository: this page is somebody's work, and the one place
// they can point at it is here.
const repoLink = inspect(tree, 'a').nodes.find(
  (node) => node.props.href === 'https://github.com/lolkda/dsh-prompt-manager',
)
assert.ok(repoLink !== undefined, 'the section must link to its own repository')
assert.equal(textOf(repoLink), 'lolkda/dsh-prompt-manager', 'the link text is the repository path')
assert.equal(repoLink.props.target, '_blank', 'and opens away from the settings panel')
assert.ok(
  inspect(tree).text.includes('拜托动个小手点颗星星吧'),
  'the ask for a star sits beside the link, not inside it',
)

const controls = inspect(tree, 'button').nodes.map((node) => textOf(node))
assert.ok(controls.some((label) => label.includes('来源（')), 'the list must link to the sources page')
const tabs = inspect(tree).text
assert.ok(tabs.includes('全部') && tabs.includes('本地') && tabs.includes('订阅'), 'the list must offer the three layers')

// `source: ''` is what a local entry looks like after the schema resolves it.
// Badging by presence rather than by value once marked every entry subscribed.
// The two badges are different claims — "this body comes from upstream" versus
// "this entry is the compaction instruction" — so each is counted by the class
// that names it rather than by the shared `__badge`.
const subscribedBadges = (tree) => inspect(tree, 'span').nodes.filter((node) => {
  const className = String(node.props.className ?? '')
  return className.includes('__badge') && !className.includes('--compaction')
})
const compactionBadges = (tree) => inspect(tree, 'span').nodes
  .filter((node) => String(node.props.className ?? '').includes('__badge--compaction'))
assert.equal(subscribedBadges(renderer.tree).length, 0, 'a local entry must not carry the subscribed badge')

const tabButton = (label) => inspect(renderer.tree, 'button').nodes.find((node) => textOf(node) === label)
tabButton('本地').props.onClick()
await renderer.settle()
const localLayer = inspect(renderer.tree).text
for (const entry of ENTRIES) assert.ok(localLayer.includes(entry.title), `the local layer must keep ${entry.title}`)

tabButton('订阅').props.onClick()
await renderer.settle()
assert.ok(inspect(renderer.tree).text.includes('还没有订阅来的提示词'), 'the subscribed layer must be empty when nothing is subscribed')
tabButton('全部').props.onClick()
await renderer.settle()

const switches = inspect(tree, SWITCH).nodes
assert.equal(
  switches.length,
  ENTRIES.length,
  'every entry must carry one switch, the compaction entry included',
)
assert.equal(switches[0].props.checked, true, 'the first switch must mirror the index')
assert.equal(switches[1].props.checked, false, 'a disabled entry must render an unchecked switch')

// The switch is the control that says whether an entry is injected, so the row's meta
// line does not say it again: "订阅 <repo> · 已关闭" stated one fact twice, and the copy
// the reader is actually looking at is the toggle beside it.
const cardFor = (title) => inspect(renderer.tree, 'div').nodes.find((node) => String(node.props.className ?? '') === 'dsh-prompt-manager__card' && textOf(node).includes(title))
const disabledRow = cardFor('第二条')
assert.ok(disabledRow !== undefined, 'the disabled entry must be listed like every other one')
assert.ok(textOf(disabledRow).includes('本地'), 'its meta line still names where the body comes from')
assert.equal(
  textOf(disabledRow).includes('已关闭'),
  false,
  'and it does not restate the switch, which already shows the off position',
)

const menus = inspect(tree, MENU).nodes
assert.equal(menus.length, ENTRIES.length, 'every entry must carry a kebab menu')
assert.deepEqual(menus[0].props.items.map((candidate) => candidate.label), ['编辑', '删除'], 'the menu must carry the row actions')
assert.equal(item(menus[0], 'delete').disabled, false, 'every entry must be deletable')
assert.equal(item(menus[0], 'restore'), undefined, 'the restore action must be gone')
assert.equal(menus[0].props.portal, true, 'the menu must render through a portal so the panel cannot clip it')

// ── the switch writes the index ───────────────────────────────────────────────

switches[0].props.onChange()
assert.equal(writes.length, 1, 'toggling must write the index once')
assert.equal(writes[0].field, 'entries', 'the write must replace the entries array')
assert.equal(writes[0].value.find((entry) => entry.id === 'alpha').enabled, false, 'the toggled entry must be disabled')
assert.equal(writes[0].value.find((entry) => entry.id === 'note').enabled, true, 'other entries must be untouched')

// ── entering the editor page ──────────────────────────────────────────────────

menus[0].props.onSelect('edit')
await renderer.settle()
const editor = inspect(renderer.tree)

assert.ok(editor.text.includes('编辑「第一条」'), 'the editor page must title the entry it edits')
assert.ok(editor.text.includes('返回'), 'the editor page must offer a way back')
assert.ok(editor.text.includes('Markdown 正文'), 'the editor page must label the body field')
assert.ok(editor.text.includes('预览'), 'the editor page must label the preview')
assert.ok(editor.text.includes('已保存'), 'a freshly opened entry has nothing to save')
assert.ok(!editor.text.includes('新增提示词'), 'the editor page must replace the list, not sit beside it')
assert.equal(inspect(renderer.tree, MARKDOWN).nodes.length, 1, 'the preview must render through the shell renderer')
assert.ok(
  requests.some((request) => request.method === 'GET' && request.url === `${ROUTE}/body/alpha`),
  'entering the editor must read the body from the Host route',
)

const textarea = inspect(renderer.tree, 'textarea').nodes[0]
assert.equal(textarea.props.value, '# First Entry\n\nbody', 'the editor must show the loaded body')
textarea.props.onChange({ target: { value: 'EDITED BODY' } })
await renderer.settle()

const saveButton = button(renderer.tree, '保存修改')
assert.ok(saveButton !== undefined, 'an edited body must enable saving')

// ── saving from the editor page ───────────────────────────────────────────────

saveButton.props.onClick()
await renderer.settle()
assert.ok(
  requests.some((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/alpha`
    && JSON.parse(request.body).body === 'EDITED BODY'),
  'saving must write the body through the Host route',
)
assert.equal(writes.length, 1, 'saving a body whose title and order are unchanged must not rewrite the index')
assert.ok(inspect(renderer.tree).text.includes('已保存，下一个模型步骤生效。'), 'saving must report itself')

// ── returning to the list ─────────────────────────────────────────────────────

button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
const backToList = inspect(renderer.tree)
assert.ok(backToList.text.includes('新增提示词'), 'returning must show the list again')
assert.ok(!backToList.text.includes('Markdown 正文'), 'returning must leave the editor page')

// ── the sources page ──────────────────────────────────────────────────────────

const sourcesButton = inspect(renderer.tree, 'button').nodes.find((node) => {
  const label = textOf(node)
  return label.includes('来源（')
})
sourcesButton.props.onClick()
await renderer.settle()
const sourcesPage = inspect(renderer.tree)
assert.ok(sourcesPage.text.includes('订阅来源'), 'the sources page must say what it is')
assert.ok(sourcesPage.text.includes('o/r@main'), 'a configured source is listed')
assert.ok(sourcesPage.text.includes('prompt-manager.json'), 'the page must explain the manifest requirement')

// The note and the controls share one row. They used to be separate rows of the card's
// column, and the head — identity, stats and all three buttons in one wrapping row — did
// not fit the settings panel: the buttons broke onto a line of their own and the note was
// left alone on a third, which read as an orphan.
const sourceCard = inspect(renderer.tree, 'div').nodes.find(
  (node) => String(node.props.className ?? '') === 'dsh-prompt-manager__source',
)
assert.ok(sourceCard !== undefined, 'a configured source must render as a card')
const cardRow = (className) => inspect(sourceCard, 'div').nodes.find(
  (node) => String(node.props.className ?? '') === className,
)
const sourceHeadRow = cardRow('dsh-prompt-manager__sourceHead')
const sourceFootRow = cardRow('dsh-prompt-manager__sourceFoot')
assert.ok(sourceHeadRow !== undefined, 'the card opens with a row that says what the source is')
assert.ok(sourceFootRow !== undefined, 'and a second row that pairs the note with the controls')
assert.ok(textOf(sourceHeadRow).includes('o/r@main'), 'the first row names the source and its ref')
assert.ok(textOf(sourceFootRow).includes('远端'), 'the second row carries the note about the remote')
assert.ok(
  inspect(sourceFootRow, 'button').nodes.some((node) => textOf(node) === '检查更新'),
  'and the controls sit on that row, rather than on one of their own',
)
assert.equal(inspect(sourceHeadRow, 'button').nodes.length, 0, 'so no control is left behind above them')

const repoField = inspect(renderer.tree, 'input').nodes.find((node) => node.props.placeholder === 'owner/repo')
repoField.props.onChange({ target: { value: 'o/r' } })
await renderer.settle()
const addSource = button(renderer.tree, '添加来源')
addSource.props.onClick()
await renderer.settle()
assert.ok(
  requests.some((request) => request.method === 'POST' && request.url === `${ROUTE}/sources`),
  'adding a source asks the Host for a slug',
)
assert.ok(
  writes.some((write) => write.field === 'sources' && write.value.some((source) => source.id === 'o-r')),
  'the new source is written into settings',
)
assert.ok(
  requests.some((request) => request.method === 'POST' && request.url === `${ROUTE}/sources/o-r/check`),
  'a fresh source is checked straight away',
)
assert.ok(inspect(renderer.tree).text.includes('prompts/a.md'), 'the change list names the file that moved')
assert.ok(inspect(renderer.tree).text.includes('+2'), 'and how much moved')
assert.ok(
  inspect(renderer.tree).text.includes('由 prompts/contract.md 改名'),
  'a rename is named as one, so it does not read as a deletion plus an unrelated new prompt',
)

// ── a subscribed entry is read-only, with a way out ───────────────────────────

// Back to the list first: the section keeps whichever view was open.
button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()

scope.state = {
  ...scope.state,
  value: {
    entries: [...ENTRIES, { id: 'src-a-a', title: '订阅来的', order: 60, enabled: true, source: 'src-a' }],
    sources: [{ id: 'src-a', repo: 'o/r', ref: 'main', mirror: '', enabled: true }],
  },
}
renderer.mount(component, { scope })
await renderer.settle()
const subscribedRow = inspect(renderer.tree).text
assert.ok(subscribedRow.includes('o/r'), 'a subscribed row shows the repository its body comes from')
assert.equal(subscribedBadges(renderer.tree).length, 1, 'exactly the subscribed row carries the badge')

// The repository is the row's one real link: it is the address a person wants
// when they go looking at what upstream actually says.
const sourceLinks = inspect(renderer.tree, 'a').nodes
  .filter((node) => String(node.props.href).includes('github.com/o/r'))
assert.equal(sourceLinks.length, 1, 'exactly the subscribed row links out')
assert.equal(textOf(sourceLinks[0]), 'o/r', 'the link text is the repository itself')
assert.equal(sourceLinks[0].props.href, 'https://github.com/o/r', 'the link points at the configured repository')
assert.equal(sourceLinks[0].props.target, '_blank', 'and opens away from the settings panel')
assert.ok(String(sourceLinks[0].props.title).includes('o/r@main'), 'the tooltip carries the ref in force')
assert.ok(subscribedRow.includes('订阅 '), 'and the row still says the body is subscribed')

const rowButton = inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('订阅来的'))
rowButton.props.onClick()
await renderer.settle()
const subscribedEditor = inspect(renderer.tree)
assert.ok(subscribedEditor.text.includes('来自订阅，只读'), 'the editor says the body is read-only')
assert.equal(inspect(renderer.tree, 'textarea').nodes[0].props.readOnly, true, 'a subscribed body is not editable')
assert.ok(subscribedEditor.text.includes('订阅条目的正文来自上游'), 'the editor explains why')
assert.ok(
  !inspect(renderer.tree, 'a').nodes.some((node) => node.props.href === 'https://github.com/o/r'),
  'and the link belongs to the list row, not to the editor page',
)

const forkButton = button(renderer.tree, 'fork 成本地条目')
assert.ok(forkButton !== undefined, 'a subscribed entry offers a fork')
const writesBefore = writes.length
const requestsBefore = requests.length
forkButton.props.onClick()
await renderer.settle()
assert.ok(
  requests.some((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/new-note`
    && JSON.parse(request.body).body === 'SUBSCRIBED BODY'),
  'forking copies the subscribed body into a local file',
)
assert.ok(
  writes.slice(writesBefore).some((write) => write.field === 'entries'
    && write.value.some((entry) => entry.id === 'new-note' && entry.source === undefined)),
  'and adds a local entry with no source',
)
assert.equal(
  JSON.parse(requests.slice(requestsBefore).find((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/new-note`).body).fileSha1,
  null,
  'the fork writes the body under the "no file yet" fence',
)

// The fork already wrote the file, so the editor must now hold that write's own
// hash. Holding `null` made the next save look like a create, and the store
// refused it — a forked entry could not be saved until it was reopened.
const fencedSave = requests.slice(requestsBefore)
  .filter((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/new-note`)
assert.equal(fencedSave.length, 1, 'the fork writes the body exactly once')

const forkedField = inspect(renderer.tree, 'textarea').nodes[0]
forkedField.props.onChange({ target: { value: 'SUBSCRIBED BODY, EDITED' } })
await renderer.settle()
const orderField = inspect(renderer.tree, 'input').nodes.find((node) => node.props.value === '60')
orderField.props.onChange({ target: { value: '65' } })
await renderer.settle()
const entriesBeforeSave = writes.length
button(renderer.tree, '保存修改').props.onClick()
await renderer.settle()
const edits = requests.filter((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/new-note`)
const savedEdit = edits.at(-1)
assert.equal(
  JSON.parse(savedEdit.body).fileSha1,
  'f1',
  'saving a forked entry must fence against the hash the fork produced, not against "no file"',
)
const entryWrites = writes.slice(entriesBeforeSave).filter((write) => write.field === 'entries')
assert.equal(entryWrites.length, 1, 'changing the placement must write the index once')
for (const write of entryWrites) {
  const ids = write.value.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length, 'no index write may repeat an entry id')
  const forked = write.value.filter((entry) => entry.id === 'new-note')
  assert.equal(forked.length, 1, 'and the forked entry must appear exactly once')
  assert.equal(forked[0].order, 65, 'with the placement the editor was given')
  assert.equal(forked[0].enabled, false, 'and still switched off, which is how a fork arrives')
}

// An empty or half-typed placement box must keep the last usable number rather
// than write something the index schema then refuses.
orderField.props.onChange({ target: { value: '-' } })
await renderer.settle()
assert.equal(
  inspect(renderer.tree, 'input').nodes.find((node) => node.props.value === '65') !== undefined,
  true,
  'an unusable placement must leave the previous number in place',
)

// ── the variables page: a script from template to live variable ───────────────

button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()

const variablesButton = inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('变量（'))
assert.ok(variablesButton !== undefined, 'the list must link to the variables page')
assert.ok(textOf(variablesButton).includes('变量（2）'), `and count what is registered, got ${textOf(variablesButton)}`)
variablesButton.props.onClick()
await renderer.settle()

const variablesPage = inspect(renderer.tree)
assert.ok(variablesPage.text.includes('提示词变量'), 'the variables page must say what it is')
assert.ok(variablesPage.text.includes('{{os}}'), 'a registered variable is listed by its reference')
assert.ok(variablesPage.text.includes('系统'), 'with the layer that supplied it')
assert.ok(variablesPage.text.includes('toolchain'), 'and the scripts beside the variables')
assert.ok(variablesPage.text.includes('{{toolchain_rust}}'), 'including what each script supplies')

// A new script starts from a template that runs as it stands, and the page is
// explicit that a test run registers nothing.
button(renderer.tree, '新建脚本').props.onClick()
await renderer.settle()
const newScriptPage = inspect(renderer.tree)
assert.ok(newScriptPage.text.includes('新建脚本'), 'the new-script page titles itself')
assert.ok(newScriptPage.text.includes('运行一次（测试）'), 'and offers a test run')
assert.ok(newScriptPage.text.includes('不写正式文件、不注册变量'), 'and says a test run has no side effects')
const template = inspect(renderer.tree, 'textarea').nodes[0]
assert.ok(template.props.value.includes('JSON.stringify'), 'the template prints a JSON object')
assert.ok(template.props.onChange !== undefined, 'and is editable')

// The template's keys must be names the plugin does not already provide: one
// that claims `node` or `git` is refused on save as a conflict, and one that
// claims an arbitrary tool leaves a `(not installed)` variable behind on every
// machine that lacks that tool — which is a variable nobody asked for and, once
// the script is deleted, one that used to outlive it.
const templateKeys = [...template.props.value.matchAll(/^ {2}([a-z][a-z0-9_]*):/gm)].map((match) => match[1])
const claimed = new Set(['pwsh', 'bash', 'git', 'node', 'python', 'os', 'os_release', 'platform', 'arch'])
assert.equal(templateKeys.length, 1, `the template must register exactly one variable, got ${templateKeys.join(', ')}`)
for (const key of templateKeys) {
  assert.equal(claimed.has(key), false, `the template must not claim ${key}, which the plugin already provides`)
}
assert.equal(/rust/.test(template.props.value), false, 'and it must not probe a tool the machine is unlikely to have')

// `--grow` fills the width of a `__fields` row; put straight into the column
// surface it fills the height instead, which leaves a blank gap above the body.
const scriptFieldRows = inspect(renderer.tree, 'div').nodes
  .filter((node) => String(node.props.className ?? '') === 'dsh-prompt-manager__fields')
assert.equal(scriptFieldRows.length, 1, 'the script name must sit in a fields row, not straight in the surface')

const nameField = inspect(renderer.tree, 'input').nodes.find((node) => node.props.placeholder === 'toolchain')
nameField.props.onChange({ target: { value: 'fresh' } })
await renderer.settle()
inspect(renderer.tree, 'textarea').nodes[0].props.onChange({ target: { value: 'console.log(JSON.stringify({ fresh: "ok" }))' } })
await renderer.settle()

const runsBefore = requests.filter((request) => request.url === `${ROUTE}/variables/run`).length
const settingsWritesBeforeRun = writes.length
button(renderer.tree, '运行一次（测试）').props.onClick()
await renderer.settle()
const testRun = requests.filter((request) => request.url === `${ROUTE}/variables/run`).at(-1)
assert.equal(requests.filter((request) => request.url === `${ROUTE}/variables/run`).length, runsBefore + 1, 'a test run goes to the Host')
assert.deepEqual(
  JSON.parse(testRun.body),
  { name: 'fresh', source: 'console.log(JSON.stringify({ fresh: "ok" }))' },
  'an unsaved script is sent as a source, which is the draft path: the Host runs it and registers nothing',
)
assert.equal(writes.length, settingsWritesBeforeRun, 'a test run must not touch settings')
assert.ok(inspect(renderer.tree).text.includes('这次会提供 1 个变量'), 'and the page reports what it would supply')

button(renderer.tree, '保存并启用').props.onClick()
await renderer.settle()
assert.ok(
  requests.some((request) => request.method === 'PUT' && request.url === `${ROUTE}/script/fresh`),
  'saving writes the script through the Host',
)
const savedPage = inspect(renderer.tree)
assert.ok(savedPage.text.includes('已保存并启用'), 'and says the script is live')
assert.ok(savedPage.text.includes('{{fresh}}'), 'naming the variables it registered')
assert.ok(savedPage.text.includes('下一个模型步骤生效'), 'and when they take effect')

// The saved script is still tested as text, never as the live file: a test run
// must not move the values the prompt is rendering right now.
button(renderer.tree, '运行一次（测试）').props.onClick()
await renderer.settle()
assert.deepEqual(
  JSON.parse(requests.filter((request) => request.url === `${ROUTE}/variables/run`).at(-1).body),
  { name: 'fresh', source: 'console.log(JSON.stringify({ fresh: "ok" }))' },
  'even a saved script is tested from the editor copy, so a test run never registers',
)

// ── the body editor knows which variables exist ────────────────────────────────

button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('第一条')).props.onClick()
await renderer.settle()

const chipLabels = inspect(renderer.tree, 'button').nodes.map((node) => textOf(node))
assert.ok(chipLabels.includes('{{fresh}}'), `the body editor lists what can be referenced, got ${chipLabels.join(' ')}`)
const chip = inspect(renderer.tree, 'button').nodes.find((node) => textOf(node) === '{{fresh}}')
chip.props.onClick()
await renderer.settle()
assert.ok(
  inspect(renderer.tree, 'textarea').nodes[0].props.value.includes('{{fresh}}'),
  'clicking a chip puts the reference into the body',
)

inspect(renderer.tree, 'textarea').nodes[0].props.onChange({ target: { value: 'x={{neverregistered}} y={{never-registered}}' } })
await renderer.settle()
const flagged = inspect(renderer.tree).text
assert.ok(flagged.includes('这些变量还没有注册'), 'a reference with no registered variable is flagged')
assert.ok(flagged.includes('{{neverregistered}}'), 'and the warning names it, before assembly can fail on it')
assert.ok(flagged.includes('这些引用的写法不对'), 'a reference that is not a variable name at all is flagged too')
assert.ok(flagged.includes('{{never-registered}}'), 'with the offending text quoted back')

// The variables page offers the reference and nothing else: inserting belongs to
// the editor, the one place where the body being changed is on screen.
button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('变量（')).props.onClick()
await renderer.settle()
const variableButtons = inspect(renderer.tree, 'button').nodes.map((node) => textOf(node))
assert.ok(
  variableButtons.every((label) => !label.includes('插入')),
  `the variables page must not offer to insert into a body it does not show, got: ${variableButtons.join(' | ')}`,
)
assert.equal(variableButtons.filter((label) => label === '复制引用').length, VARIABLES.length, 'every row still copies its reference')
assert.equal(inspect(renderer.tree, 'textarea').nodes.length, 0, 'and the page shows no body field of its own')

// ── a dirty draft is not dropped without a word ───────────────────────────────

button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('变量（')).props.onClick()
await renderer.settle()
button(renderer.tree, '新建脚本').props.onClick()
await renderer.settle()
inspect(renderer.tree, 'textarea').nodes[0].props.onChange({ target: { value: 'console.log("{}")' } })
await renderer.settle()
windowStub.confirm = () => false
button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
assert.ok(
  inspect(renderer.tree, 'textarea').nodes[0].props.value.includes('console.log("{}")'),
  'declining the confirmation must keep the script draft exactly as it was typed',
)
windowStub.confirm = () => true
button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
assert.ok(inspect(renderer.tree).text.includes('提示词变量'), 'accepting it must leave the script editor')

// ── the entry cap is refused where a person can see why ───────────────────────

// The page learns the cap from `/status`, so a fresh mount is how a deployment
// whose index is already at the cap reaches it.
// The page learns the cap from `/status` when it mounts, so a deployment whose
// index is already at the cap is what a fresh mount shows.
STATUS = { ...STATUS, maxEntries: ENTRIES.length }
const cappedRenderer = createRenderer()
const cappedSection = materialize(cappedRenderer.React).registrations[0].component
cappedRenderer.mount(cappedSection, { scope })
await cappedRenderer.settle()
const addsBefore = requests.filter((request) => request.url === `${ROUTE}/id`).length
button(cappedRenderer.tree, '新增提示词').props.onClick()
await cappedRenderer.settle()
assert.equal(
  requests.filter((request) => request.url === `${ROUTE}/id`).length,
  addsBefore,
  'at the cap, no id may be allocated for an entry the registry would never inject',
)
assert.ok(inspect(cappedRenderer.tree).text.includes('最多'), 'and the page says why the add was refused')
STATUS = { ...STATUS, maxEntries: 50 }

// ── a body file is deleted before the index drops it ──────────────────────────

const removesBefore = writes.length
inspect(cappedRenderer.tree, MENU).nodes[0].props.onSelect('delete')
await cappedRenderer.settle()
const deletedFile = requests.filter((request) => request.method === 'DELETE' && request.url.includes('/body/')).at(-1)
const droppedEntry = writes.slice(removesBefore).find((write) => write.field === 'entries')
assert.ok(deletedFile !== undefined, 'deleting a row must delete its body file')
assert.ok(droppedEntry !== undefined, 'and drop it from the index')
assert.ok(
  deletedFile.seq < droppedEntry.seq,
  'the file must go first: a delete that fails has to leave the entry there to retry',
)
assert.equal(droppedEntry.value.some((entry) => entry.id === 'alpha'), false, 'and the dropped id is the one that was deleted')

// ── the composer chip ─────────────────────────────────────────────────────────

// The chip is a second surface of the same bundle and the same namespace, driven
// through a renderer of its own because it is a component of its own: two
// components cannot share one hook-slot table.
const chipRenderer = createRenderer()
const chipRegistration = materialize(chipRenderer.React).registrations
  .find((registration) => registration.meta.name === 'conversation.input.right')
assert.ok(chipRegistration !== undefined, 'the bundle must offer the preset chip to the composer tool row')

/** The chip's own label — which rides the anchor the menu is attached to. */
const chipMenuNode = () => inspect(chipRenderer.tree, MENU).nodes[0]
const chipText = () => textOf(chipMenuNode().props.anchor)
const chipMenu = () => chipMenuNode()

scope.state = { ...scope.state, value: { ...scope.state.value, presets: PRESETS, activePreset: '' } }
chipRenderer.mount(chipRegistration.component, { scope })
await chipRenderer.settle()
assert.ok(chipText().includes('提示词 · 按开关'), 'with no preset the chip must say the switches decide')
assert.deepEqual(
  chipMenu().props.items.map((entry) => entry.id),
  ['', 'ctf', 'plain'],
  'the menu must offer no-preset plus every preset',
)
assert.ok(item(chipMenu(), '').label.includes('（当前）'), 'the no-preset entry must be marked as the one in force')
assert.ok(item(chipMenu(), 'ctf').label.includes('CTF 作业'), 'a preset entry must carry its name')
assert.ok(item(chipMenu(), 'ctf').label.includes('2 条'), 'and how many entries it selects')

// A switch is one settings write, and nothing else: the Host reads the field on
// the next assembly, so the chip must not have to coordinate anything.
const chipWritesBefore = writes.length
chipMenu().props.onSelect('ctf')
await chipRenderer.settle()
const activated = writes.slice(chipWritesBefore).find((write) => write.field === 'activePreset')
assert.ok(activated !== undefined, 'choosing a preset must write activePreset')
assert.equal(activated.value, 'ctf', 'and write the id that was chosen')
assert.equal(writes.slice(chipWritesBefore).length, 1, 'a switch must not touch any other settings field')

// The chip reads the namespace it writes, so it follows the change by itself.
chipRenderer.mount(chipRegistration.component, { scope })
await chipRenderer.settle()
assert.ok(chipText().includes('CTF 作业'), 'the chip must show the preset now in force')
assert.ok(item(chipMenu(), 'ctf').label.includes('（当前）'), 'and mark it in the menu')

// A page whose settings channel is process-local can show the choice but not make one.
scope.state = { ...scope.state, mode: 'memory', writable: false }
chipRenderer.mount(chipRegistration.component, { scope })
await chipRenderer.settle()
assert.equal(item(chipMenu(), 'ctf').disabled, true, 'a memory-mode page must refuse to switch a preset')
scope.state = { ...scope.state, mode: 'host', writable: true }

// A deployment with no presets still renders: the chip says where to make one.
scope.state = { ...scope.state, value: { ...scope.state.value, presets: [], activePreset: '' } }
chipRenderer.mount(chipRegistration.component, { scope })
await chipRenderer.settle()
assert.ok(
  chipMenu().props.items[0].label.includes('还没有组合'),
  'with no presets the chip must point at the settings page',
)
assert.equal(chipMenu().props.items[0].disabled, true, 'and that hint must not be selectable')

// ── the compaction chip ───────────────────────────────────────────────────────

// The second control in that row: the preset chip answers "which sections this
// conversation works with", this one answers "which compaction instruction". A
// component of its own, so it is driven through a renderer of its own — two
// components cannot share one hook-slot table.
const compactionChipRenderer = createRenderer()
const compactionChipRegistration = materialize(compactionChipRenderer.React).registrations
  .find((registration) => registration.meta.id === 'prompt-manager-compaction')
assert.ok(compactionChipRegistration !== undefined, 'the composer row must also carry the compaction chip')

const compactionChipMenu = () => inspect(compactionChipRenderer.tree, MENU).nodes[0]
const compactionChipText = () => textOf(compactionChipMenu().props.anchor)

scope.state = {
  ...scope.state,
  mode: 'host',
  writable: true,
  value: { ...scope.state.value, entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' },
}
compactionChipRenderer.mount(compactionChipRegistration.component, { scope })
await compactionChipRenderer.settle()
assert.ok(
  compactionChipText().includes('DSH'),
  `with no pointer aimed anywhere the chip must say the built-in instruction is what runs, got ${compactionChipText()}`,
)

// Only the compaction entries belong in this menu. Offering a section would promise
// to make it the compaction instruction, which is a different thing — and offering
// the whole index would bury the two entries this control is actually about.
assert.deepEqual(
  compactionChipMenu().props.items.map((entry) => entry.id),
  ['', 'compact-zh'],
  'the menu must offer the built-in instruction plus every compaction entry',
)
assert.ok(item(compactionChipMenu(), 'compact-zh').label.includes('压缩指令（中文版）'), 'naming the entry it offers')
assert.ok(item(compactionChipMenu(), '').label.includes('（当前）'), 'and marking what is in force right now')

const compactionWritesBefore = writes.length
compactionChipMenu().props.onSelect('compact-zh')
await compactionChipRenderer.settle()
const aimedByChip = writes.slice(compactionWritesBefore).find((write) => write.field === 'compaction')
assert.ok(aimedByChip !== undefined, 'choosing an entry must write the compaction pointer')
assert.equal(aimedByChip.value, 'compact-zh', 'with the id that was chosen')
assert.equal(writes.slice(compactionWritesBefore).length, 1, 'and it must not touch any other settings field')

compactionChipRenderer.mount(compactionChipRegistration.component, { scope })
await compactionChipRenderer.settle()
assert.ok(compactionChipText().includes('压缩指令（中文版）'), 'the chip follows the namespace it writes, like the preset chip')

// A combo answers the pointer by itself, so the chip must write the field that
// actually decides — the combo's own — instead of one nothing reads. This is the
// one way it differs from the settings row, which refuses while a combo is in force:
// a composer control that dies whenever a combo is on would be dead most of the time.
scope.state = { ...scope.state, value: { ...scope.state.value, activePreset: 'ctf', compaction: '' } }
compactionChipRenderer.mount(compactionChipRegistration.component, { scope })
await compactionChipRenderer.settle()
assert.ok(compactionChipText().includes('压缩指令（中文版）'), 'the chip shows what the combo put in force')

const throughComboBefore = writes.length
compactionChipMenu().props.onSelect('')
await compactionChipRenderer.settle()
const chipComboWrites = writes.slice(throughComboBefore)
assert.equal(
  chipComboWrites.filter((write) => write.field === 'compaction').length,
  0,
  'while a combo is in force the root pointer is not what decides, so writing it would change nothing',
)
const presetWrite = chipComboWrites.find((write) => write.field === 'presets')
assert.ok(presetWrite !== undefined, 'choosing must write the combo that answers instead')
assert.deepEqual(
  presetWrite.value.map((preset) => ({
    id: preset.id, name: preset.name, entries: preset.entries, compaction: preset.compaction,
  })),
  [
    { id: 'ctf', name: 'CTF 作业', entries: ['alpha', 'beta'], compaction: '' },
    { id: 'plain', name: '日常', entries: [], compaction: '' },
  ],
  'clearing the chosen combo and rewriting no other record',
)

// A page whose settings channel is process-local can show the choice but not make one —
// the same refusal the preset chip makes, because it is the same kind of write.
scope.state = { ...scope.state, mode: 'memory', writable: false }
compactionChipRenderer.mount(compactionChipRegistration.component, { scope })
await compactionChipRenderer.settle()
assert.equal(
  item(compactionChipMenu(), 'compact-zh').disabled,
  true,
  'a memory-mode page must refuse to switch the compaction instruction',
)
scope.state = { ...scope.state, mode: 'host', writable: true }

// A deployment with no compaction entries still renders: the chip says where to make one.
scope.state = {
  ...scope.state,
  value: { ...scope.state.value, entries: SECTION_ENTRIES, presets: [], activePreset: '', compaction: '' },
}
compactionChipRenderer.mount(compactionChipRegistration.component, { scope })
await compactionChipRenderer.settle()
assert.deepEqual(compactionChipMenu().props.items.map((entry) => entry.id), ['no-entries'], 'with none there is one hint')
assert.equal(compactionChipMenu().props.items[0].disabled, true, 'and it is not selectable')

// ── the presets page ─────────────────────────────────────────────────────────

// The page is driven from a document this case states outright: earlier cases in
// this file wrote the entry index themselves (a fork added one, a delete dropped
// one), and a preset case should not inherit their arithmetic.
scope.state = {
  ...scope.state,
  value: { ...scope.state.value, entries: ENTRIES, presets: PRESETS, activePreset: 'ctf' },
}
const presetRenderer = createRenderer()
const presetSection = materialize(presetRenderer.React).registrations[0].component
const presetText = () => inspect(presetRenderer.tree).text

/** The kebab menu of one row, found by the action label its anchor carries. */
const rowMenuFor = (tree, label) => inspect(tree, MENU).nodes
  .find((node) => String(node.props.anchor?.props?.['aria-label'] ?? '').includes(label))

presetRenderer.mount(presetSection, { scope })
await presetRenderer.settle()

// A preset in force changes what the switches mean, and the page has to say so —
// otherwise a row's switch looks broken rather than out of the loop.
assert.ok(presetText().includes('当前组合「CTF 作业」生效中'), 'the list must say a preset is in force')
assert.ok(presetText().includes('单条开关只在「不用组合」时生效'), 'and what that does to the switches')
assert.ok(presetText().includes('组合：注入'), 'a row the preset carries must say it is injected')
assert.ok(presetText().includes('组合：不注入'), 'and a row it does not must say it is not')

const presetsLink = button(presetRenderer.tree, '组合（2）')
assert.ok(presetsLink !== undefined, 'the list must link to the presets page')
presetsLink.props.onClick()
await presetRenderer.settle()
assert.ok(presetText().includes('CTF 作业') && presetText().includes('日常'), 'the page must list every preset')
assert.ok(presetText().includes('当前'), 'and badge the one in force')
assert.ok(presetText().includes('没有选中任何条目'), 'an empty preset must be described as selecting nothing')

// A new preset gets its id from the Host — only the Host knows which one is free —
// and the list is written whole, the way the entry index is.
button(presetRenderer.tree, '新建组合').props.onClick()
await presetRenderer.settle()
const presetNameField = inspect(presetRenderer.tree, 'input').nodes
  .find((node) => String(node.props.placeholder ?? '').includes('CTF 作业'))
assert.ok(presetNameField !== undefined, 'the editor must offer a name field')
presetNameField.props.onChange({ target: { value: '交付检查' } })
await presetRenderer.settle()

const memberBoxes = inspect(presetRenderer.tree, 'input').nodes.filter((node) => node.props.type === 'checkbox')
assert.equal(
  memberBoxes.length,
  SECTION_ENTRIES.length,
  'every section entry must be offered as a member of the combo, and a compaction entry must not — it is selected by its own control',
)
memberBoxes[0].props.onChange()
await presetRenderer.settle()

const saveBefore = writes.length
button(presetRenderer.tree, '保存组合').props.onClick()
await presetRenderer.settle()
const allocation = requests.filter((request) => request.url.endsWith('/preset/id')).at(-1)
assert.ok(allocation !== undefined, 'saving a new preset must ask the Host for an id')
const stored = writes.slice(saveBefore).find((write) => write.field === 'presets')
assert.ok(stored !== undefined, 'and write the preset list')
assert.equal(stored.value.length, PRESETS.length + 1, 'the new preset must be appended to the list')
assert.equal(stored.value.at(-1).id, 'new-preset', 'under the id the Host allocated')
assert.equal(stored.value.at(-1).name, '交付检查', 'and the name that was typed')
assert.deepEqual(stored.value.at(-1).entries, [ENTRIES[0].id], 'with exactly the members that were ticked')
assert.ok(allocation.seq < stored.seq, 'the id has to exist before the list carrying it is written')

// Deleting the preset in force has to clear the selection with it, or every page
// would go on reporting a preset that is not there.
const deleteBefore = writes.length
rowMenuFor(presetRenderer.tree, 'CTF 作业').props.onSelect('delete')
await presetRenderer.settle()
const afterDelete = writes.slice(deleteBefore)
assert.ok(afterDelete.some((write) => write.field === 'presets'), 'deleting must rewrite the preset list')
const droppedSelection = afterDelete.find((write) => write.field === 'activePreset')
assert.ok(droppedSelection !== undefined, 'and drop the selection when the deleted preset was in force')
assert.equal(droppedSelection.value, '', 'by writing the empty preset id')

const activateBefore = writes.length
rowMenuFor(presetRenderer.tree, '日常').props.onSelect('activate')
await presetRenderer.settle()
const reactivated = writes.slice(activateBefore).find((write) => write.field === 'activePreset')
assert.ok(reactivated !== undefined && reactivated.value === 'plain', '设为当前 must write that preset id')

// 取消当前 is the same single write the composer chip makes.
const clearBefore = writes.length
rowMenuFor(presetRenderer.tree, '日常').props.onSelect('clear')
await presetRenderer.settle()
const cleared = writes.slice(clearBefore).find((write) => write.field === 'activePreset')
assert.ok(cleared !== undefined && cleared.value === '', '取消当前 must write the empty preset id')

// ── preset packs ────────────────────────────────────────────────────────────

scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '' } }
presetRenderer.mount(presetSection, { scope })
await presetRenderer.settle()

// Export asks the Host for the pack and hands the browser a file: the page never
// assembles a pack itself, because only the Host knows the bodies in force.
downloads.length = 0
const exportBefore = requests.length
rowMenuFor(presetRenderer.tree, 'CTF 作业').props.onSelect('export')
await presetRenderer.settle()
const exportRequest = requests.slice(exportBefore).find((request) => request.url.includes('/pack/export'))
assert.ok(exportRequest !== undefined, 'exporting must ask the Host for a pack')
assert.ok(exportRequest.url.includes('preset=ctf'), 'naming the preset being exported')
assert.equal(downloads.length, 1, 'and hand the browser exactly one file')
assert.equal(downloads[0].name, 'prompt-manager-pack-ctf.json', 'named after the preset')
assert.ok(String(downloads[0].href).startsWith('blob:'), 'as a blob the browser can save')
assert.ok(presetText().includes('已导出组合「CTF 作业」'), 'and the page says what it did')

// A refusal is shown, not swallowed: a download that silently does nothing is
// indistinguishable from a browser that ignored it.
downloads.length = 0
rowMenuFor(presetRenderer.tree, '日常').props.onSelect('export')
await presetRenderer.settle()
assert.equal(downloads.length, 0, 'nothing is offered for download when the Host refuses')
assert.ok(presetText().includes('没有这个组合：plain'), `the refusal must reach the page, got: ${presetText()}`)

const fileInput = inspect(presetRenderer.tree, 'input').nodes
  .find((node) => node.props.type === 'file')
assert.ok(fileInput !== undefined, 'the presets page must offer an import control')
assert.equal(fileInput.props.accept, '.json,application/json', 'accepting the one thing a pack is')

const importBefore = requests.length
fileInput.props.onChange({ target: { files: [{ name: 'pack.json', text: async () => JSON.stringify(PACK_JSON) }], value: 'pack.json' } })
await presetRenderer.settle()
const importRequest = requests.slice(importBefore).find((request) => request.url.endsWith('/pack/import'))
assert.ok(importRequest !== undefined, 'choosing a file must post it to the Host')
assert.equal(importRequest.method, 'POST', 'as a write')
assert.equal(JSON.parse(importRequest.body).preset.id, 'ctf', 'carrying the pack as it was read')

// The report names everything the import could not do, not just what it did.
const reported = presetText()
for (const expected of ['已导入 2 条', '组合「CTF 作业」', '4 条换了 id', 'alpha→alpha-2', '订阅来的', '契约', 'gone-entry', '{{oops}}', '不会自动启用']) {
  assert.ok(reported.includes(expected), `the report must mention ${expected}, got: ${reported}`)
}

// A file that is not JSON is refused before any request is made.
const jsonBefore = requests.length
fileInput.props.onChange({ target: { files: [{ name: 'notes.txt', text: async () => 'not json at all' }], value: 'notes.txt' } })
await presetRenderer.settle()
assert.equal(requests.length, jsonBefore, 'a file that is not JSON never reaches the Host')
assert.ok(presetText().includes('notes.txt 不是 JSON 文件'), 'and the page says which file it was')

// ── the compaction entry is a row of its own kind ─────────────────────────────

// The compaction instruction lives in the same index as every section, but it is
// not one: its `enabled` flag decides nothing, so its switch is bound to the pointer
// instead — and its state dot answers the same question the switch does, whether the
// compaction pointer is aimed at it right now.
scope.state = {
  ...scope.state,
  value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' },
}
const compactRenderer = createRenderer()
const compactSection = materialize(compactRenderer.React).registrations[0].component
/** Everything the compaction-page mount renders as text. */
const compactText = () => inspect(compactRenderer.tree).text
/** The one row whose text carries a title. */
const rowFor = (tree, title) => inspect(tree, 'div').nodes
  .find((node) => String(node.props.className ?? '') === 'dsh-prompt-manager__card' && textOf(node).includes(title))
/** The state dot of one row, as its class list. */
const dotClass = (tree, title) => {
  const row = rowFor(tree, title)
  const dot = inspect(row, 'span').nodes.find((node) => String(node.props.className ?? '').includes('__dot'))
  return String(dot.props.className)
}
/** The kebab menu of one row. */
const rowMenuOf = (row) => inspect(row, MENU).nodes[0]

compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()

assert.equal(compactionBadges(compactRenderer.tree).length, 1, 'the compaction entry carries a badge of its own')
assert.equal(textOf(compactionBadges(compactRenderer.tree)[0]), '压缩指令', 'and the badge says what that entry is')
assert.equal(subscribedBadges(compactRenderer.tree).length, 0, 'while no local row reads as subscribed')

// The switch count is about the sections, so the summary above the list counts
// the same thing: a compaction entry can be "on" in no sense a person would
// recognise, and counting it would make the fraction mean two different things.
assert.ok(
  compactText().includes(`已启用 ${String(SECTION_ENTRIES.filter((entry) => entry.enabled === true).length)}/${String(SECTION_ENTRIES.length)}`),
  `the enabled summary must count sections only, got: ${compactText()}`,
)

const compactRow = rowFor(compactRenderer.tree, '压缩指令')
assert.ok(compactRow !== undefined, 'the compaction entry must be listed like every other entry')
const compactSwitch = inspect(compactRow, SWITCH).nodes[0]
assert.ok(compactSwitch !== undefined, 'and it must offer a switch like every other row')
assert.equal(compactSwitch.props.checked, false, 'unchecked while no pointer is aimed at it')
assert.ok(dotClass(compactRenderer.tree, '压缩指令').includes('--idle'), 'with no pointer aimed at it the compaction row is not in force')
assert.ok(!dotClass(compactRenderer.tree, '第一条').includes('--idle'), 'while a switched-on section still reads as in force')

const compactMenu = rowMenuOf(compactRow)
assert.deepEqual(
  compactMenu.props.items.map((candidate) => candidate.label),
  ['编辑', '设为当前', '删除'],
  'the compaction row offers its pointer action beside the shared row actions',
)
// Every action in a row menu carries an icon, and this one did not: without it the
// pointer action read as a different kind of entry from the two beside it. The icon
// follows the label — a check to make this the instruction, a cross to hand the next
// compaction back to DSH.
assert.deepEqual(
  compactMenu.props.items.map((candidate) => candidate.icon && candidate.icon.type),
  [primitivesStub.IconEditOutline16, primitivesStub.IconCheckOutline16, primitivesStub.IconTrashOutline16],
  'every action must carry an icon, and 设为当前 the one that says what it does',
)
assert.equal(item(compactMenu, 'current').disabled, false, 'and it can be made current right away')
assert.deepEqual(
  rowMenuOf(rowFor(compactRenderer.tree, '第一条')).props.items.map((candidate) => candidate.label),
  ['编辑', '删除'],
  'a section row keeps exactly its two actions',
)

// Aiming the pointer is one settings write, the same shape the preset switch has.
const currentBefore = writes.length
compactMenu.props.onSelect('current')
await compactRenderer.settle()
const aimed = writes.slice(currentBefore).find((write) => write.field === 'compaction')
assert.ok(aimed !== undefined, '设为当前 must write the compaction pointer')
assert.equal(aimed.value, 'compact-zh', 'naming the entry that was chosen')
assert.equal(writes.slice(currentBefore).length, 1, 'and it must not touch any other settings field')

// The page reads the namespace it writes, so it follows the change by itself:
// the dot lights up and the same action becomes the way back to the built-in text.
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
assert.ok(!dotClass(compactRenderer.tree, '压缩指令').includes('--idle'), 'the entry the pointer names reads as in force')
const currentMenu = rowMenuOf(rowFor(compactRenderer.tree, '压缩指令'))
assert.equal(item(currentMenu, 'current').label, '取消当前', 'and the action turns into the way out of it')
assert.equal(
  item(currentMenu, 'current').icon.type,
  primitivesStub.IconCloseOutline16,
  'with the icon that matches the label it turned into',
)
const pointerClearBefore = writes.length
currentMenu.props.onSelect('current')
await compactRenderer.settle()
const released = writes.slice(pointerClearBefore).find((write) => write.field === 'compaction')
assert.ok(released !== undefined, '取消当前 must write the compaction pointer')
assert.equal(released.value, '', 'as the empty pointer, which means the built-in instruction')

// The row's own switch does the same thing, so the control a person reaches for first is
// the one every other row has. It is bound to the pointer rather than to `enabled` —
// which decides nothing here, because `reconcile()` never gives a compaction entry a
// system-prompt section — so "on" means "this is the one DSH's instruction is replaced
// with", and it holds for exactly one entry at a time.
const switchAimBefore = writes.length
inspect(rowFor(compactRenderer.tree, '压缩指令'), SWITCH).nodes[0].props.onChange()
await compactRenderer.settle()
const aimedBySwitch = writes.slice(switchAimBefore).find((write) => write.field === 'compaction')
assert.ok(aimedBySwitch !== undefined, 'flipping the row switch on must write the compaction pointer')
assert.equal(aimedBySwitch.value, 'compact-zh', 'naming the entry the switch belongs to')
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const aimedRowSwitch = inspect(rowFor(compactRenderer.tree, '压缩指令'), SWITCH).nodes[0]
assert.equal(aimedRowSwitch.props.checked, true, 'and the switch then reads on, straight from the namespace')
const switchClearBefore = writes.length
aimedRowSwitch.props.onChange()
await compactRenderer.settle()
const releasedBySwitch = writes.slice(switchClearBefore).find((write) => write.field === 'compaction')
assert.ok(releasedBySwitch !== undefined, 'flipping it back off releases the pointer')
assert.equal(releasedBySwitch.value, '', 'as the empty pointer, which means the built-in instruction')

// A preset in force answers the pointer by itself — the same rule the sections
// follow, so the row cannot claim a compaction instruction the prompt is not using.
scope.state = { ...scope.state, value: { ...scope.state.value, activePreset: 'ctf' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
assert.ok(
  !dotClass(compactRenderer.tree, '压缩指令').includes('--idle'),
  'a preset that names a compaction entry puts it in force over an empty root pointer',
)
// The root pointer is not what decides while a preset is on, so the row must not
// offer to write it: an action that silently changes nothing is worse than none.
// The switch and the … menu item are the same action, so both refuse together.
assert.ok(compactText().includes('组合：生效'), 'the row says the combo is what put it in force')
assert.equal(
  item(rowMenuOf(rowFor(compactRenderer.tree, '压缩指令')), 'current').disabled,
  true,
  'and the pointer action is refused while the combo answers that question',
)
assert.equal(
  inspect(rowFor(compactRenderer.tree, '压缩指令'), SWITCH).nodes[0].props.disabled,
  true,
  'the row switch refuses with it, so neither control writes a field nothing reads',
)
assert.equal(
  inspect(rowFor(compactRenderer.tree, '压缩指令'), SWITCH).nodes[0].props.checked,
  true,
  'while still reading the state the combo put it in',
)

// And the preset wins even when it points at the built-in instruction: falling
// back to the root field here would contradict what the Host does.
scope.state = {
  ...scope.state,
  value: { ...scope.state.value, compaction: 'compact-zh', activePreset: 'plain' },
}
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
assert.ok(
  dotClass(compactRenderer.tree, '压缩指令').includes('--idle'),
  'a preset pointing at the built-in instruction wins over the root pointer',
)
assert.ok(compactText().includes('组合：不生效'), 'and the row says so in the combo\'s own words')
scope.state = { ...scope.state, value: { ...scope.state.value, compaction: '', activePreset: '' } }

// ── adding a compaction instruction ───────────────────────────────────────────

// The renderer keeps its hook slots across mounts, so a case that ends inside the
// editor leaves the next one there: this is the way back to the list.
const toList = async () => {
  const leave = button(compactRenderer.tree, '← 返回')
  if (leave !== undefined) leave.props.onClick()
  await compactRenderer.settle()
}

// A new compaction instruction is a draft, exactly like a new section: an id is
// taken and the editor opens on it, but nothing reaches the index until the person
// saves. The entry does have to exist before the pointer can name it, so those two
// writes happen together at save time — which is also what keeps "never mind" from
// leaving a blank instruction in the list for the pointer to aim at.
const addCompactWrites = writes.length
const addCompactRequests = requests.length
const addCompactButton = button(compactRenderer.tree, '新增压缩指令')
assert.ok(addCompactButton !== undefined, 'the list must offer a compaction instruction beside the section one')
addCompactButton.props.onClick()
await compactRenderer.settle()

const compactAllocation = requests.slice(addCompactRequests).find((request) => request.url === `${ROUTE}/id`)
assert.ok(compactAllocation !== undefined, 'a new compaction instruction takes an id from the Host')
assert.equal(JSON.parse(compactAllocation.body).title, '压缩指令', 'allocated for the title the person is about to see')
assert.equal(writes.length, addCompactWrites, 'and nothing is written to the index before that draft is saved')

// The editor opens on it holding an empty body: the instruction this replaces is
// DSH's own text and is not readable from here, so the page does not invent a
// starting point that would go stale behind it. An empty body is also inert —
// the pointer keeps falling back to DSH's instruction until one is written.
assert.ok(compactText().includes('编辑「压缩指令」'), 'and the editor opens on the draft the id was taken for')
const freshBody = inspect(compactRenderer.tree, 'textarea').nodes[0]
assert.equal(
  freshBody.props.value,
  '',
  'a new compaction instruction starts empty rather than from a template this page made up',
)

// The pointer may only ever name an entry that exists, so the one control that aims
// it has to refuse while the entry is still only a draft on this page.
const draftAim = button(compactRenderer.tree, '设为当前')
assert.ok(draftAim !== undefined, 'the editor still offers the control that puts an instruction in force')
assert.equal(draftAim.props.disabled, true, 'and it refuses while the entry is only a draft on this page')

// Backing out is the whole point of a draft: it must leave the index and the pointer
// exactly as they were, and say which draft it is throwing away.
const discards = []
windowStub.confirm = (message) => { discards.push(message); return true }
const discardWrites = writes.length
button(compactRenderer.tree, '← 返回').props.onClick()
await compactRenderer.settle()
assert.deepEqual(discards, ['放弃这条新压缩指令？'], 'a new instruction asks before it is dropped, naming what it is')
assert.equal(writes.length, discardWrites, 'and dropping it writes nothing at all')
assert.equal(compactionBadges(compactRenderer.tree).length, 1, 'so no blank instruction is left behind in the list')
windowStub.confirm = () => true

// Saving is what makes it real, in the one order that works: the body lands, then
// the record the pointer may name, then the pointer itself.
scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const saveRequests = requests.length
const saveWrites = writes.length
button(compactRenderer.tree, '新增压缩指令').props.onClick()
await compactRenderer.settle()
button(compactRenderer.tree, '保存修改').props.onClick()
await compactRenderer.settle()

const savedBody = requests.slice(saveRequests)
  .find((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/new-note`)
assert.ok(savedBody !== undefined, 'saving writes the body to the id the Host allocated')
assert.equal(
  JSON.parse(savedBody.body).body,
  '',
  'and the body it writes is the empty one the draft started with, not a filled-in template',
)
const savedWrites = writes.slice(saveWrites)
const savedIndex = savedWrites.find((write) => write.field === 'entries')
const savedPointer = savedWrites.find((write) => write.field === 'compaction')
assert.ok(savedIndex !== undefined, 'and then the index gains the record the pointer can name')
const freshEntry = savedIndex.value.find((entry) => entry.id === 'new-note')
assert.equal(freshEntry.kind, 'compaction', 'marked as a compaction instruction')
assert.equal(freshEntry.enabled, false, 'and keeps the switch a section would have, switched off')
assert.ok(freshEntry.order > 90, 'placed after the entries that already exist')
assert.ok(savedPointer !== undefined, 'and the pointer is aimed at it in the same breath')
assert.equal(savedPointer.value, 'new-note', 'naming the id the Host allocated')
assert.ok(
  savedBody.seq < savedIndex.seq && savedIndex.seq < savedPointer.seq,
  'the body exists first, then the index entry, then the pointer that names it',
)
assert.ok(compactText().includes('已保存，下一次压缩生效。'), 'and the page says when that lands')
assert.ok(!compactText().includes('尚未保存'), 'so the editor is no longer holding a draft')
await toList()

// A combo answers which instruction is in force, so aiming the document's own
// pointer from here would be a write that decides nothing now and everything later:
// the entry is still created, and the combo page is where it becomes current.
scope.state = {
  ...scope.state,
  value: { entries: ENTRIES, presets: PRESETS, activePreset: 'ctf', compaction: '' },
}
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const comboWrites = writes.length
button(compactRenderer.tree, '新增压缩指令').props.onClick()
await compactRenderer.settle()
button(compactRenderer.tree, '保存修改').props.onClick()
await compactRenderer.settle()
const underCombo = writes.slice(comboWrites)
assert.ok(
  underCombo.some((write) => write.field === 'entries'
    && write.value.some((entry) => entry.id === 'new-note' && entry.kind === 'compaction')),
  'the instruction is created whether or not a combo is in force',
)
assert.equal(
  underCombo.some((write) => write.field === 'compaction'),
  false,
  'but the document pointer stays where it is while a combo decides',
)
assert.ok(compactText().includes('这条还不会生效'), 'and the page says so instead of promising the next compaction')
await toList()

// Turning that draft into a section follows the same rule — nothing is written
// before the save — and the flip must not mark it as saved, or the page would leave
// the person holding a draft with the save button already reading "已保存".
scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const flipWrites = writes.length
button(compactRenderer.tree, '新增压缩指令').props.onClick()
await compactRenderer.settle()
button(compactRenderer.tree, '转为普通段落').props.onClick()
await compactRenderer.settle()
assert.equal(writes.length, flipWrites, 'flipping an unsaved draft writes nothing either')
const afterFlip = button(compactRenderer.tree, '保存修改')
assert.ok(afterFlip !== undefined, 'and the draft it left behind still offers to be saved')
assert.equal(afterFlip.props.disabled, false, 'because the flip did not mark a draft nobody wrote as saved')
afterFlip.props.onClick()
await compactRenderer.settle()
const sectionWrites = writes.slice(flipWrites)
const sectionEntry = sectionWrites.find((write) => write.field === 'entries')
  .value.find((entry) => entry.id === 'new-note')
assert.equal('kind' in sectionEntry, false, 'saving then writes it as the section it has become')
assert.equal(sectionEntry.enabled, true, 'switched on, the way a new section is')
assert.equal(
  sectionWrites.some((write) => write.field === 'compaction'),
  false,
  'and no pointer is aimed at a section, which could never answer it',
)
scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()

// Compaction entries occupy the same 50-entry cap the sections do, so the refusal
// has to happen here too — and it has to happen before an id is taken. The cap
// arrives with `/status`, so this case needs a mount of its own to see it.
button(compactRenderer.tree, '← 返回').props.onClick()
await compactRenderer.settle()
STATUS = { ...STATUS, maxEntries: ENTRIES.length }
const capRenderer = createRenderer()
const capSection = materialize(capRenderer.React).registrations[0].component
capRenderer.mount(capSection, { scope })
await capRenderer.settle()
const capBefore = requests.filter((request) => request.url === `${ROUTE}/id`).length
const cappedAdd = button(capRenderer.tree, '新增压缩指令')
assert.ok(cappedAdd !== undefined, 'the refusal is exercised through the same control')
cappedAdd.props.onClick()
await capRenderer.settle()
assert.equal(
  requests.filter((request) => request.url === `${ROUTE}/id`).length,
  capBefore,
  'at the cap no id may be allocated for a compaction entry either',
)
assert.ok(inspect(capRenderer.tree).text.includes('最多'), 'and the page says why the add was refused')
STATUS = { ...STATUS, maxEntries: 50 }

// Back to the fixture index for the cases below.
scope.state = { ...scope.state, value: { ...scope.state.value, entries: ENTRIES, compaction: '' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()

// ── the compaction editor ─────────────────────────────────────────────────────

/** The control that opens one row's editor, exactly as a person would click it. */
const openRow = (tree, title) => inspect(rowFor(tree, title), 'button').nodes
  .find((node) => String(node.props.className ?? '').includes('__cardMain'))

scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
openRow(compactRenderer.tree, '压缩指令').props.onClick()
await compactRenderer.settle()

// The editor has to say what this body is for and when an edit lands: a section
// takes effect at the next model step, and this one does not.
assert.ok(compactText().includes('下一次压缩'), 'the editor says a compaction instruction lands at the next compaction')
assert.ok(compactText().includes('system prompt'), 'and says it is not one of the system prompt sections')
assert.equal(inspect(compactRenderer.tree, 'textarea').nodes.length, 1, 'while the body field is the same field a section uses')

// Aiming it from the editor is the same single write the row menu makes.
const aimButton = button(compactRenderer.tree, '设为当前')
assert.ok(aimButton !== undefined, 'the editor offers to put this instruction in force')
const aimBefore = writes.length
aimButton.props.onClick()
await compactRenderer.settle()
const aimedFromEditor = writes.slice(aimBefore).find((write) => write.field === 'compaction')
assert.ok(aimedFromEditor !== undefined, '设为当前 writes the compaction pointer')
assert.equal(aimedFromEditor.value, 'compact-zh', 'naming the entry being edited')
assert.ok(compactText().includes('下一次压缩'), 'and the report says when that takes effect')

// It is one control doing both, so the same place is the way back out.
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const releaseButton = button(compactRenderer.tree, '取消当前')
assert.ok(releaseButton !== undefined, 'once in force the same control offers the way out')
const releaseBefore = writes.length
releaseButton.props.onClick()
await compactRenderer.settle()
const releasedFromEditor = writes.slice(releaseBefore).find((write) => write.field === 'compaction')
assert.ok(releasedFromEditor !== undefined && releasedFromEditor.value === '', '取消当前 writes the empty pointer')

// Saving a compaction body reports the timing that is true of it.
const compactBody = inspect(compactRenderer.tree, 'textarea').nodes[0]
compactBody.props.onChange({ target: { value: 'EDITED COMPACTION' } })
await compactRenderer.settle()
button(compactRenderer.tree, '保存修改').props.onClick()
await compactRenderer.settle()
assert.ok(
  requests.some((request) => request.method === 'PUT' && request.url === `${ROUTE}/body/compact-zh`
    && JSON.parse(request.body).body === 'EDITED COMPACTION'),
  'saving writes the compaction body through the same Host route a section uses',
)
assert.ok(compactText().includes('已保存，下一次压缩生效。'), 'and says when it lands, not "next step"')

// An entry can change kind: the same body can become a section, and turning it
// back must take the field away rather than write `kind: 'section'` — a section
// entry carries no `kind` key at all, and a phantom one would follow it forever.
scope.state = { ...scope.state, value: { ...scope.state.value, compaction: 'compact-zh' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const toSection = button(compactRenderer.tree, '转为普通段落')
assert.ok(toSection !== undefined, 'the editor offers to turn a compaction instruction back into a section')
const kindBefore = writes.length
toSection.props.onClick()
await compactRenderer.settle()
const kindWrites = writes.slice(kindBefore)
const kindIndex = kindWrites.find((write) => write.field === 'entries')
assert.ok(kindIndex !== undefined, 'changing kind rewrites the index')
const demoted = kindIndex.value.find((entry) => entry.id === 'compact-zh')
assert.equal('kind' in demoted, false, 'and a section entry must carry no kind key at all')
assert.equal(demoted.title, '压缩指令（中文版）', 'the rest of the record is carried over untouched')
assert.equal(demoted.enabled, false, 'including the switch it already had')
assert.ok(
  kindWrites.some((write) => write.field === 'compaction' && write.value === ''),
  'and the pointer is released in the same step, since it may only name a compaction entry',
)

// Deleting the instruction the pointer names has to let it go in the same breath, for
// the same reason the kind flip does: the pointer may only ever name a compaction
// entry, and a dangling one makes the Host fall back to the built-in instruction and
// complain in its log at every compaction.
scope.state = {
  ...scope.state,
  value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: 'compact-zh' },
}
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
// The kind flip above happened inside the editor, so the list has to come back
// before a row menu exists to click.
await toList()
const dropBefore = writes.length
rowMenuOf(rowFor(compactRenderer.tree, '压缩指令')).props.onSelect('delete')
await compactRenderer.settle()
const dropWrites = writes.slice(dropBefore)
const dropIndex = dropWrites.find((write) => write.field === 'entries')
assert.ok(dropIndex !== undefined, 'deleting the instruction takes it out of the index')
assert.equal(
  dropIndex.value.some((entry) => entry.id === 'compact-zh'),
  false,
  'and it is the instruction that went',
)
assert.ok(
  dropWrites.some((write) => write.field === 'compaction' && write.value === ''),
  'while the pointer that named it is released in the same step',
)

// A combo's own pointer is the combo page's to fix, and the document's field must not
// be written in its place: that would silently drop a root pointer aimed elsewhere.
scope.state = {
  ...scope.state,
  value: { entries: ENTRIES, presets: PRESETS, activePreset: 'ctf', compaction: 'beta' },
}
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const comboDropBefore = writes.length
rowMenuOf(rowFor(compactRenderer.tree, '压缩指令')).props.onSelect('delete')
await compactRenderer.settle()
assert.equal(
  writes.slice(comboDropBefore).some((write) => write.field === 'compaction'),
  false,
  'deleting an entry a combo names leaves the document pointer alone',
)

// The same rule for the other release: demoting an entry a combo names must not write
// the document pointer either, for the very same reason.
scope.state = {
  ...scope.state,
  value: { entries: ENTRIES, presets: PRESETS, activePreset: 'ctf', compaction: 'beta' },
}
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
openRow(compactRenderer.tree, '压缩指令').props.onClick()
await compactRenderer.settle()
const comboFlipBefore = writes.length
button(compactRenderer.tree, '转为普通段落').props.onClick()
await compactRenderer.settle()
const comboFlipWrites = writes.slice(comboFlipBefore)
assert.ok(
  comboFlipWrites.some((write) => write.field === 'entries'),
  'the kind flip still rewrites the index',
)
assert.equal(
  comboFlipWrites.some((write) => write.field === 'compaction'),
  false,
  'but not the document pointer that a combo is overriding',
)

// And back the other way, which must mark it again.
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
const toCompaction = button(compactRenderer.tree, '转为压缩指令')
assert.ok(toCompaction !== undefined, 'a section can be turned into a compaction instruction from its editor')
const backBefore = writes.length
toCompaction.props.onClick()
await compactRenderer.settle()
const promoted = writes.slice(backBefore).find((write) => write.field === 'entries')
assert.ok(promoted !== undefined, 'which again rewrites the index')
assert.equal(promoted.value.find((entry) => entry.id === 'compact-zh').kind, 'compaction', 'marking it as one')

// Back to the fixture index and the list for the cases below.
scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' } }
compactRenderer.mount(compactSection, { scope })
await compactRenderer.settle()
button(compactRenderer.tree, '← 返回').props.onClick()
await compactRenderer.settle()

// ── a combo picks the compaction instruction too ──────────────────────────────

// A combo answers both halves of the question — which sections inject, and which
// compaction instruction is used — so a card has to show both, and the editor has
// to be able to change either without disturbing the other combos.
scope.state = { ...scope.state, value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: '' } }
const comboRenderer = createRenderer()
const comboSection = materialize(comboRenderer.React).registrations[0].component
comboRenderer.mount(comboSection, { scope })
await comboRenderer.settle()
button(comboRenderer.tree, `组合（${String(PRESETS.length)}）`).props.onClick()
await comboRenderer.settle()

assert.ok(
  textOf(rowFor(comboRenderer.tree, 'CTF 作业')).includes('压缩指令：压缩指令（中文版）'),
  'a combo card says which compaction instruction it would use',
)
const emptyComboCard = rowFor(comboRenderer.tree, '日常')
assert.ok(
  textOf(emptyComboCard).includes('压缩指令：DSH 自带'),
  'and an empty choice reads as the instruction DSH ships, not as a blank',
)
assert.ok(
  textOf(emptyComboCard).includes('没有选中任何条目'),
  'while the note about a combo that selects no sections is still there',
)

// The editor of one combo: the same checklist, plus one control for the other half.
openRow(comboRenderer.tree, 'CTF 作业').props.onClick()
await comboRenderer.settle()
const comboSelect = inspect(comboRenderer.tree, 'select').nodes[0]
assert.ok(comboSelect !== undefined, 'the combo editor offers a control for the compaction instruction')
assert.deepEqual(
  inspect(comboSelect, 'option').nodes.map((option) => textOf(option)),
  ['DSH 自带', '压缩指令（中文版）'],
  'whose choices are the built-in instruction and every compaction entry',
)
assert.equal(comboSelect.props.value, 'compact-zh', 'showing the one this combo already names')

// Editing one combo must not clear another combo's choice: the whole preset list
// is rewritten on save, so every record the page did not touch has to travel
// through it exactly as it arrived.
scope.state = {
  ...scope.state,
  value: {
    ...scope.state.value,
    presets: [
      { id: 'ctf', name: 'CTF 作业', entries: ['alpha', 'beta'], compaction: 'compact-zh' },
      { id: 'plain', name: '日常', entries: [], compaction: 'compact-zh' },
    ],
  },
}
comboRenderer.mount(comboSection, { scope })
await comboRenderer.settle()
const stageBefore = writes.length
inspect(comboRenderer.tree, 'select').nodes[0].props.onChange({ target: { value: '' } })
await comboRenderer.settle()
assert.equal(writes.length, stageBefore, 'the control stages the choice; 保存组合 is what writes it')
button(comboRenderer.tree, '保存组合').props.onClick()
await comboRenderer.settle()
const savedPresets = writes.slice(stageBefore).find((write) => write.field === 'presets')
assert.ok(savedPresets !== undefined, 'saving a combo writes the whole preset list')
assert.equal(
  savedPresets.value.find((preset) => preset.id === 'ctf').compaction,
  '',
  'with the instruction this combo now names',
)
assert.equal(
  savedPresets.value.find((preset) => preset.id === 'plain').compaction,
  'compact-zh',
  'and the combo nobody touched keeps the instruction it had',
)
assert.equal(
  savedPresets.value.find((preset) => preset.id === 'ctf').entries.length,
  2,
  'with its members untouched as well',
)

// Saving lands back on the list, which is where the new choice has to be visible.
assert.ok(
  textOf(rowFor(comboRenderer.tree, 'CTF 作业')).includes('压缩指令：DSH 自带'),
  'and the card follows the change by itself',
)

// A preset may name an instruction that is gone — a hand-edited document, or a
// body somebody removed. Saying so beats a blank control that reads as "DSH 自带".
scope.state = {
  ...scope.state,
  value: {
    ...scope.state.value,
    presets: [{ id: 'ctf', name: 'CTF 作业', entries: ['alpha'], compaction: 'gone' }],
  },
}
comboRenderer.mount(comboSection, { scope })
await comboRenderer.settle()
openRow(comboRenderer.tree, 'CTF 作业').props.onClick()
await comboRenderer.settle()
assert.ok(
  inspect(inspect(comboRenderer.tree, 'select').nodes[0], 'option').nodes
    .some((option) => textOf(option).includes('gone')),
  'a choice that names nothing is shown as such rather than silently as the built-in text',
)

// ── what the Host reports about compaction ────────────────────────────────────

/** The list page as it renders against whatever `/status` and settings say now. */
const mountListText = async () => {
  const next = createRenderer()
  next.mount(materialize(next.React).registrations[0].component, { scope })
  await next.settle()
  return inspect(next.tree).text
}

// Counts and the last time come from the Host, and the page is the only place a
// person can see whether their instruction is actually being used — "matches" is
// how often compaction ran, "replacements" how often the text was theirs.
scope.state = {
  ...scope.state,
  value: { entries: ENTRIES, presets: PRESETS, activePreset: '', compaction: 'compact-zh' },
}
const replacedText = await mountListText()
assert.ok(
  replacedText.includes('压缩指令：压缩指令（中文版）'),
  `the status line names the instruction in force, got: ${replacedText}`,
)
assert.ok(replacedText.includes('已替换 1 次'), 'and how often it has replaced the built-in text')
assert.ok(
  replacedText.includes(`最近 ${new Date(STATUS.compaction.lastReplacedAt).toLocaleString()}`),
  'reported in local time, the way every other timestamp on this page is',
)

// With the feature switched off the Host omits the field entirely, and the page
// has to say that rather than show a zero it made up.
const heldCompaction = STATUS.compaction
delete STATUS.compaction
const offText = await mountListText()
assert.ok(
  offText.includes('压缩指令：已关闭（配置项 compaction: false）'),
  `a Host that reports no compaction at all reads as the feature being off, got: ${offText}`,
)
assert.ok(!offText.includes('已替换'), 'and no count is invented for it')

// A compaction that ran while the pointer was not aimed at the user's text is
// worth saying exactly: it is the difference between "not working" and "not used yet".
STATUS = { ...STATUS, compaction: { matches: 3, replacements: 0, lastReplacedAt: '', characters: 0 } }
const seenText = await mountListText()
assert.ok(
  seenText.includes('已见到 3 次压缩，尚未替换'),
  `a run that did not replace anything is reported honestly, got: ${seenText}`,
)

// And the ordinary first-run state, with the built-in instruction in force.
STATUS = { ...STATUS, compaction: { matches: 0, replacements: 0, lastReplacedAt: '', characters: 0 } }
scope.state = { ...scope.state, value: { ...scope.state.value, compaction: '' } }
const idleText = await mountListText()
assert.ok(idleText.includes('压缩指令：DSH 自带'), 'with nothing pointed at, the line says which text is used instead')
assert.ok(idleText.includes('还没有遇到压缩'), 'and that no compaction has happened yet')
STATUS = { ...STATUS, compaction: heldCompaction }

// ── the add row must not re-flow when the panel's width shifts ────────────────
// A wrapping row of minimum-width controls has a column count that follows the
// available width. The three-across threshold of the shape this used to have
// (3 x 180px + 2 x 10px = 560px) sat within a few pixels of this panel's own
// width, so the very same page offered three controls on one line in one visit
// and two in the next. A fixed track count cannot do that, whatever the shell
// does with its scrollbar.
const addRowRules = [...new Set(injectedCss
  .flatMap((css) => [...css.matchAll(/\.dsh-prompt-manager__addRow\{([^}]*)\}/g)])
  .map((match) => match[1]))]
assert.equal(addRowRules.length, 1, `the sheet must style the add row exactly once, got ${String(addRowRules.length)}`)
assert.ok(addRowRules[0].includes('display:grid'), 'the add row is a grid, so the sheet decides what fits on a line')
assert.equal(
  addRowRules[0].includes('flex-wrap'),
  false,
  'and never a wrapping row, whose line breaks would follow the panel width',
)
const addButtonRules = [...new Set(injectedCss
  .flatMap((css) => [...css.matchAll(/\.dsh-prompt-manager__addButton\{([^}]*)\}/g)])
  .map((match) => match[1]))]
assert.equal(addButtonRules.length, 1, `the sheet must style the add control exactly once, got ${String(addButtonRules.length)}`)
assert.equal(
  addButtonRules[0].includes('min-width'),
  false,
  'and it carries no minimum width for a wrap threshold to key off',
)

console.log('client ok')
console.log(`  bundle      factory id ${PACKAGE_NAME}, materialized and driven against stub modules`)
console.log(`  section     settings.section id=prompt-manager order=${String(meta.order)}`)
console.log(`  chip        ${chipMeta.name} id=prompt-manager, switches the preset with one settings write`)
console.log(`  list        ${String(ENTRIES.length)} rows, switches, kebab menus, the plugin's own repo link, add control refused at the cap`)
console.log('  views       row menu -> editor page -> save -> back to the list')
console.log('  compaction  a row of its own kind: badge, no switch, the pointer action, and a combo overriding it')
console.log('  kind        a draft that starts empty, written only on save, aimed, flipped to a section, dropped with its pointer')
console.log('  combos      a combo picks one compaction instruction, and saving it leaves the other combos alone')
console.log('  report      replacements and matches told apart, local time, and the feature switched off')
console.log('  presets     list, editor, member checklist, id from the Host, delete clears the selection')
console.log('  packs       export downloads what the Host built, import reports every id it had to change')
console.log('  fence       a forked draft carries the hash the fork wrote, so the next save is accepted')
console.log('  order       a body file is deleted before the index drops it, and a draft is not dropped silently')
console.log('  subscribe   sources page, add/fork, read-only subscribed bodies, a row that links to its repository')
console.log('  variables   list with provenance, copy-reference, new script from template, no insert into another body')
console.log('  scripts     save and enable, test run stays a draft, the editor inserts a reference at the caret')
console.log('  addrow      a fixed two-column grid, so the controls cannot re-flow when the panel width shifts')
