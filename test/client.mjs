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

/** The built browser bundle under test. */
const BUNDLE = fileURLToPath(new URL('../client/client.js', import.meta.url))

/** Index the fake settings scope serves. */
const ENTRIES = [
  { id: 'alpha', title: '第一条', order: 10, enabled: true },
  // The settings schema resolves a missing source to an empty string, so a
  // local entry reaches the page like this — and must not read as subscribed.
  { id: 'beta', title: '第二条', order: 20, enabled: false, source: '' },
  { id: 'note', title: '补充说明', order: 40, enabled: true },
]

/** Subscriptions the Host reports for the sources page. */
const SUBSCRIPTIONS = [
  { id: 'o-r', repo: 'o/r', ref: 'main', mirror: 'https://gh-proxy.example', enabled: true, files: 2, pending: 0 },
]

/** Presets the Host reports for the presets page and the composer chip. */
const PRESETS = [
  { id: 'ctf', name: 'CTF 作业', entries: ['alpha', 'beta'] },
  { id: 'plain', name: '日常', entries: [] },
]

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
}

/** `document` stub good enough for style injection. */
const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild: () => {} },
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

/** What `GET /status` reports; a case below lowers the cap to exercise the add refusal. */
let STATUS = { dir: '/tmp/prompt-manager/sections', writable: true, ids: [], maxEntries: 50 }

/** The fake settings scope the section binds. Its methods use `this`, exactly
 * like the real SettingsScopeController, so an unbound method reference fails
 * the test instead of a browser. */
const scope = {
  state: {
    status: 'ready',
    writable: true,
    mode: 'host',
    revision: 3,
    value: { entries: ENTRIES, presets: [], activePreset: '' },
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
            changes: [{ path: 'prompts/a.md', id: 'o-r-a', kind: 'changed', added: 2, removed: 1 }],
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
  assert.equal(captured.id, 'dsh-prompt-manager', 'the factory id must be the package name')

  const exports = captured.factory(requireStub)
  assert.equal(exports.name, 'prompt-manager', 'the client plugin must expose its cordis name')
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
  'the bundle must contribute the settings section and the composer chip',
)
assert.equal(registrations.length, 2, 'exactly one settings section and one composer chip must be registered')
const { meta, component } = registrations[0]
assert.equal(meta.name, 'settings.section', 'the registration must name its slot')
assert.equal(meta.id, 'prompt-manager', 'the section id must be the namespace')
assert.equal(meta.order, 60, 'the section must sit after the shipped settings sections')
assert.equal(meta.label(), '提示词', 'the navigation label must be the Chinese one')
const { meta: chipMeta } = registrations[1]
assert.equal(chipMeta.name, 'conversation.input.right', 'the chip must sit in the composer tool row')
assert.equal(chipMeta.id, 'prompt-manager', 'the chip id must be the namespace')

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

const controls = inspect(tree, 'button').nodes.map((node) => textOf(node))
assert.ok(controls.some((label) => label.includes('来源（')), 'the list must link to the sources page')
const tabs = inspect(tree).text
assert.ok(tabs.includes('全部') && tabs.includes('本地') && tabs.includes('订阅'), 'the list must offer the three layers')

// `source: ''` is what a local entry looks like after the schema resolves it.
// Badging by presence rather than by value once marked every entry subscribed.
const badges = () => inspect(renderer.tree, 'span').nodes
  .filter((node) => String(node.props.className ?? '').includes('__badge'))
assert.equal(badges().length, 0, 'a local entry must not carry the subscribed badge')

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
assert.equal(switches.length, ENTRIES.length, 'every entry must carry one switch')
assert.equal(switches[0].props.checked, true, 'the first switch must mirror the index')
assert.equal(switches[1].props.checked, false, 'a disabled entry must render an unchecked switch')

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
  requests.some((request) => request.method === 'GET' && request.url === '/prompt-manager/body/alpha'),
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
  requests.some((request) => request.method === 'PUT' && request.url === '/prompt-manager/body/alpha'
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

const repoField = inspect(renderer.tree, 'input').nodes.find((node) => node.props.placeholder === 'owner/repo')
repoField.props.onChange({ target: { value: 'o/r' } })
await renderer.settle()
const addSource = button(renderer.tree, '添加来源')
addSource.props.onClick()
await renderer.settle()
assert.ok(
  requests.some((request) => request.method === 'POST' && request.url === '/prompt-manager/sources'),
  'adding a source asks the Host for a slug',
)
assert.ok(
  writes.some((write) => write.field === 'sources' && write.value.some((source) => source.id === 'o-r')),
  'the new source is written into settings',
)
assert.ok(
  requests.some((request) => request.method === 'POST' && request.url === '/prompt-manager/sources/o-r/check'),
  'a fresh source is checked straight away',
)
assert.ok(inspect(renderer.tree).text.includes('prompts/a.md'), 'the change list names the file that moved')
assert.ok(inspect(renderer.tree).text.includes('+2'), 'and how much moved')

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
assert.equal(badges().length, 1, 'exactly the subscribed row carries the badge')

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
  requests.some((request) => request.method === 'PUT' && request.url === '/prompt-manager/body/new-note'
    && JSON.parse(request.body).body === 'SUBSCRIBED BODY'),
  'forking copies the subscribed body into a local file',
)
assert.ok(
  writes.slice(writesBefore).some((write) => write.field === 'entries'
    && write.value.some((entry) => entry.id === 'new-note' && entry.source === undefined)),
  'and adds a local entry with no source',
)
assert.equal(
  JSON.parse(requests.slice(requestsBefore).find((request) => request.method === 'PUT' && request.url === '/prompt-manager/body/new-note').body).fileSha1,
  null,
  'the fork writes the body under the "no file yet" fence',
)

// The fork already wrote the file, so the editor must now hold that write's own
// hash. Holding `null` made the next save look like a create, and the store
// refused it — a forked entry could not be saved until it was reopened.
const fencedSave = requests.slice(requestsBefore)
  .filter((request) => request.method === 'PUT' && request.url === '/prompt-manager/body/new-note')
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
const edits = requests.filter((request) => request.method === 'PUT' && request.url === '/prompt-manager/body/new-note')
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

const runsBefore = requests.filter((request) => request.url === '/prompt-manager/variables/run').length
const settingsWritesBeforeRun = writes.length
button(renderer.tree, '运行一次（测试）').props.onClick()
await renderer.settle()
const testRun = requests.filter((request) => request.url === '/prompt-manager/variables/run').at(-1)
assert.equal(requests.filter((request) => request.url === '/prompt-manager/variables/run').length, runsBefore + 1, 'a test run goes to the Host')
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
  requests.some((request) => request.method === 'PUT' && request.url === '/prompt-manager/script/fresh'),
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
  JSON.parse(requests.filter((request) => request.url === '/prompt-manager/variables/run').at(-1).body),
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

// The insert button only exists while an entry's editor is open behind this
// page, and it names the body it would edit.
button(renderer.tree, '← 返回').props.onClick()
await renderer.settle()
inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('变量（')).props.onClick()
await renderer.settle()
const insertLabels = inspect(renderer.tree, 'button').nodes.map((node) => textOf(node))
assert.ok(
  insertLabels.includes('插入到「第一条」'),
  'the insert button names the entry whose body it edits',
)

// Inserting must open that body: this page has no textarea and no save button,
// so an insertion that stayed here would be edited out of sight and then lost
// when the entry was next opened.
const inserters = inspect(renderer.tree, 'button').nodes.filter((node) => textOf(node).includes('插入到'))
// The stub reports os, toolchain_rust, then fresh, so the third control is the
// one that inserts {{fresh}}.
const bodyBeforeInsert = inspect(renderer.tree, 'textarea').nodes.length
inserters[2].props.onClick()
await renderer.settle()
assert.equal(bodyBeforeInsert, 0, 'the variables page shows no body field of its own')
assert.ok(inspect(renderer.tree).text.includes('Markdown 正文'), 'inserting must show the body it changed')
assert.ok(
  inspect(renderer.tree, 'textarea').nodes[0].props.value.includes('{{fresh}}'),
  'with the reference in it, ready to save',
)

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
const addsBefore = requests.filter((request) => request.url === '/prompt-manager/id').length
button(cappedRenderer.tree, '新增提示词').props.onClick()
await cappedRenderer.settle()
assert.equal(
  requests.filter((request) => request.url === '/prompt-manager/id').length,
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
assert.equal(memberBoxes.length, ENTRIES.length, 'every entry must be offered as a member of the combo')
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

console.log('client ok')
console.log('  bundle      factory id dsh-prompt-manager, materialized and driven against stub modules')
console.log(`  section     settings.section id=prompt-manager order=${String(meta.order)}`)
console.log(`  chip        ${chipMeta.name} id=prompt-manager, switches the preset with one settings write`)
console.log(`  list        ${String(ENTRIES.length)} rows, switches, kebab menus, the plugin's own repo link, add control refused at the cap`)
console.log('  views       row menu -> editor page -> save -> back to the list')
console.log('  presets     list, editor, member checklist, id from the Host, delete clears the selection')
console.log('  fence       a forked draft carries the hash the fork wrote, so the next save is accepted')
console.log('  order       a body file is deleted before the index drops it, and a draft is not dropped silently')
console.log('  subscribe   sources page, add/fork, read-only subscribed bodies, a row that links to its repository')
console.log('  variables   list with provenance, new script from template, test run registers nothing')
console.log('  scripts     save and enable, test run stays a draft, insert opens the body it changed')
