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
  { id: 'beta', title: '第二条', order: 20, enabled: false },
  { id: 'note', title: '补充说明', order: 40, enabled: true },
]

/** Subscriptions the Host reports for the sources page. */
const SUBSCRIPTIONS = [
  { id: 'o-r', repo: 'o/r', ref: 'main', mirror: 'https://gh-proxy.example', enabled: true, files: 2, pending: 0 },
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

/** `window` stub the bundle reads for the kebab menu's confirmations. */
const windowStub = { __ModuleLoader__: { load: () => {} }, confirm: () => true }

/** Settings writes the section attempted. */
const writes = []
/** Requests the section sent. */
const requests = []

/** The fake settings scope the section binds. Its methods use `this`, exactly
 * like the real SettingsScopeController, so an unbound method reference fails
 * the test instead of a browser. */
const scope = {
  state: {
    status: 'ready',
    writable: true,
    mode: 'host',
    revision: 3,
    value: { entries: ENTRIES },
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
    writes.push({ field, value })
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
  const window = { ...windowStub, __ModuleLoader__: { load: (entry) => { captured = entry } } }
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
      requests.push({ url, method, body: init?.body })
      if (url.endsWith('/id')) return { ok: true, status: 200, json: async () => ({ id: 'new-note' }) }
      if (url.endsWith('/status')) {
        return { ok: true, status: 200, json: async () => ({ dir: '/tmp/prompt-manager/sections', writable: true, ids: [] }) }
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

/** The first button whose flattened children contain a label. */
function button(tree, label) {
  return inspect(tree, 'stub-button').nodes.find((node) => [].concat(node.children ?? []).flat(Infinity).includes(label))
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

assert.deepEqual(injections, ['settings.section'], 'the section must be contributed to settings.section')
assert.equal(registrations.length, 1, 'exactly one settings section must be registered')
const { meta, component } = registrations[0]
assert.equal(meta.name, 'settings.section', 'the registration must name its slot')
assert.equal(meta.id, 'prompt-manager', 'the section id must be the namespace')
assert.equal(meta.order, 60, 'the section must sit after the shipped settings sections')
assert.equal(meta.label(), '提示词', 'the navigation label must be the Chinese one')

// ── the list page ─────────────────────────────────────────────────────────────

let tree = renderer.mount(component, { scope })
await renderer.settle()
tree = renderer.tree

let listing = inspect(tree)
for (const entry of ENTRIES) assert.ok(listing.text.includes(entry.title), `the list must show ${entry.title}`)
assert.ok(listing.text.includes('新增提示词'), 'the list must offer an add control')
assert.ok(listing.text.includes('下一个模型步骤生效'), 'the list must say when a change takes effect')
assert.ok(listing.text.includes('/tmp/prompt-manager/sections'), 'the list must show where the bodies live')

const controls = inspect(tree, 'stub-button').nodes.map((node) => [].concat(node.children ?? []).flat(Infinity).join(''))
assert.ok(controls.some((label) => label.startsWith('来源（')), 'the list must link to the sources page')
const tabs = inspect(tree).text
assert.ok(tabs.includes('全部') && tabs.includes('本地') && tabs.includes('订阅'), 'the list must offer the three layers')

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

const sourcesButton = inspect(renderer.tree, 'stub-button').nodes.find((node) => {
  const label = [].concat(node.children ?? []).flat(Infinity).join('')
  return label.startsWith('来源（')
})
sourcesButton.props.onClick()
await renderer.settle()
const sourcesPage = inspect(renderer.tree)
assert.ok(sourcesPage.text.includes('订阅来源'), 'the sources page must say what it is')
assert.ok(sourcesPage.text.includes('o/r@main'), 'a configured source is listed')
assert.ok(sourcesPage.text.includes('prompt-manager.json'), 'the page must explain the manifest requirement')

const repoField = inspect(renderer.tree, 'input').nodes.find((node) => node.props.placeholder === 'lolkda/dsh-prompt-manager')
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
assert.ok(subscribedRow.includes('订阅 src-a'), 'a subscribed row names its source')
assert.ok(subscribedRow.includes('订阅'), 'a subscribed row carries the badge')

const rowButton = inspect(renderer.tree, 'button').nodes.find((node) => textOf(node).includes('订阅来的'))
rowButton.props.onClick()
await renderer.settle()
const subscribedEditor = inspect(renderer.tree)
assert.ok(subscribedEditor.text.includes('来自订阅，只读'), 'the editor says the body is read-only')
assert.equal(inspect(renderer.tree, 'textarea').nodes[0].props.readOnly, true, 'a subscribed body is not editable')
assert.ok(subscribedEditor.text.includes('订阅条目的正文来自上游'), 'the editor explains why')

const forkButton = button(renderer.tree, 'fork 成本地条目')
assert.ok(forkButton !== undefined, 'a subscribed entry offers a fork')
const writesBefore = writes.length
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

console.log('client ok')
console.log('  bundle      factory id dsh-prompt-manager, materialized and driven against stub modules')
console.log(`  section     settings.section id=prompt-manager order=${String(meta.order)}`)
console.log(`  list        ${String(ENTRIES.length)} rows, switches, kebab menus, add control`)
console.log('  views       row menu -> editor page -> save -> back to the list')
console.log('  subscribe   sources page, add/fork, read-only subscribed bodies')
