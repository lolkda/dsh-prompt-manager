/**
 * Browser half of dsh-prompt-manager: the「提示词」settings section.
 *
 * The section has two views. The landing view lists the prompt entries: each row
 * is a title, an injection switch, and a kebab menu carrying that row's actions
 * (edit, delete). Choosing 编辑 opens the editor view — the whole section area
 * becomes the markdown editor and its preview, with a return control — so the
 * panel's narrow column is spent on one thing at a time.
 *
 * The index (title, order, enabled) rides the shared settings transport through
 * `ctx.settingsScope`; the bodies ride the plugin's own `/prompt-manager` route,
 * because they are markdown files on disk.
 *
 * Built in the client module system's lazy-CJS factory format by hand, so the
 * package needs no bundler: the factory only requests modules the shell's
 * platform table already carries (`react` and the UI primitives).
 *
 * Registered as `exports.name` / `exports.inject` / `exports.apply`, the same
 * shape every other client bundle exports.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-manager',
  factory: (require) => {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement

    /** Settings namespace carrying the entry index. Mirrors the Host constant. */
    const NAMESPACE = 'prompt-manager'

    /** Prefix of the Host route serving the body files. */
    const ROUTE = '/prompt-manager'

    /** Placement the section claims in the settings navigation. */
    const SECTION_ORDER = 60

    /** Style tag identity, so unload removes exactly this bundle's styles. */
    const STYLE_ID = 'dsh-prompt-manager/Section.css'

    // Every value below is copied from the shell's own settings pages — the
    // plugin page (heading/intro/tab row/card list) and the model page (row
    // card, chip, row buttons, dashed add buttons, status dot) — so this section
    // sits in the same visual language, and in the same theme, as the pages it
    // appears beside. Only aliases that exist in the shell's theme are used: an
    // unknown custom property would silently fall back and leave the element
    // unstyled.
    const CSS = `
.dsh-prompt-manager{max-width:760px;min-width:0;display:flex;flex-direction:column;gap:12px;padding-bottom:12px;color:var(--dsw-alias-label-primary)}
.dsh-prompt-manager__heading{margin:0;font-size:18px;font-weight:600}
.dsh-prompt-manager__intro{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-prompt-manager__note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-prompt-manager__status{margin:0;font-size:12px;line-height:1.5}
.dsh-prompt-manager__status--error{color:var(--dsw-alias-label-error)}
.dsh-prompt-manager__status--ok{color:var(--dsw-alias-state-success-primary)}
.dsh-prompt-manager__block{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsh-prompt-manager__head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.dsh-prompt-manager__headTitle{margin:0;font-size:18px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-prompt-manager__headSpacer{flex:1 1 auto}

/* the tab row: plain labels, the active one underlined, hairline underneath */
.dsh-prompt-manager__tabs{display:flex;align-items:flex-end;gap:22px;margin-top:2px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-prompt-manager__tab{position:relative;background:0 0;border:0;padding:7px 1px 9px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-prompt-manager__tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-prompt-manager__tab--active{color:var(--dsw-alias-label-primary)}
.dsh-prompt-manager__tab--active:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary)}

/* one card per entry, matching the model page's row card */
.dsh-prompt-manager__list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;min-width:0}
.dsh-prompt-manager__card{display:flex;align-items:center;gap:10px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;min-width:0}
.dsh-prompt-manager__cardMain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;margin:0;padding:0;background:0 0;border:0;text-align:left;color:inherit;font:inherit;cursor:pointer}
.dsh-prompt-manager__cardMain:disabled{cursor:default}
.dsh-prompt-manager__cardSide{display:inline-flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto}
.dsh-prompt-manager__title{font-size:14px;font-weight:500;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-prompt-manager__meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-prompt-manager__iconButton{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:14px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-prompt-manager__iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-prompt-manager__inlineMenu{display:flex;flex-direction:column;gap:2px;padding:6px;margin:0 0 6px 28px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px}
.dsh-prompt-manager__inlineMenu button{background:0 0;border:0;padding:6px 8px;border-radius:8px;text-align:left;color:inherit;font:inherit;font-size:13px;cursor:pointer}
.dsh-prompt-manager__inlineMenu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-prompt-manager__inlineMenu button:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}

/* chip and status dot, as on the model page */
.dsh-prompt-manager__badge{flex:0 0 auto;padding:1px 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-prompt-manager__dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-success-primary)}
.dsh-prompt-manager__dot--idle{background:var(--dsw-alias-label-quaternary)}
.dsh-prompt-manager__dot--pending{background:var(--dsw-alias-state-warn-primary)}
.dsh-prompt-manager__dot--error{background:var(--dsw-alias-state-error-primary)}

/* buttons: the shell's own settings pages hand-roll these three shapes */
.dsh-prompt-manager__button{box-sizing:border-box;height:28px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.dsh-prompt-manager__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-prompt-manager__button:disabled{color:var(--dsw-alias-label-quaternary);border-color:var(--dsw-alias-border-l4);cursor:default}
.dsh-prompt-manager__button--primary{height:32px;padding:0 14px;border-radius:16px;border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:13px}
.dsh-prompt-manager__button--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-prompt-manager__button--primary:disabled{background:var(--dsw-alias-button-primary-dimmed);color:var(--dsw-alias-label-quaternary)}
.dsh-prompt-manager__button--danger{color:var(--dsw-alias-state-error-primary)}
.dsh-prompt-manager__button--danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-prompt-manager__button--ghost{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-prompt-manager__addRow{display:flex;flex-wrap:wrap;gap:10px}
.dsh-prompt-manager__addButton{flex:1 1 0;min-width:180px;height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px dashed var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsh-prompt-manager__addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-prompt-manager__addButton:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}

/* surfaces and fields */
.dsh-prompt-manager__surface{display:flex;flex-direction:column;gap:14px;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-module-platform);min-width:0}
.dsh-prompt-manager__fields{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;min-width:0}
.dsh-prompt-manager__field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-prompt-manager__field--grow{flex:1 1 200px}
.dsh-prompt-manager__field--order{flex:0 0 96px}
.dsh-prompt-manager__field input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-prompt-manager__field input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dsh-prompt-manager__field input:disabled{color:var(--dsw-alias-label-quaternary)}
.dsh-prompt-manager__pane{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-prompt-manager__paneLabel{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-prompt-manager__pane textarea{box-sizing:border-box;width:100%;min-height:300px;resize:vertical;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:18px}
.dsh-prompt-manager__pane textarea:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dsh-prompt-manager__preview{box-sizing:border-box;width:100%;max-height:320px;overflow:auto;padding:12px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;overflow-wrap:anywhere}
.dsh-prompt-manager__preview pre{white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-prompt-manager__preview code{overflow-wrap:anywhere}
.dsh-prompt-manager__preview>*{max-width:100%}
.dsh-prompt-manager__previewRaw{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:18px}
.dsh-prompt-manager__actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dsh-prompt-manager__empty{margin:0;padding:12px;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}

/* one card per subscription source */
.dsh-prompt-manager__source{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;min-width:0}
.dsh-prompt-manager__sourceHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.dsh-prompt-manager__sourceRepo{font-size:14px;font-weight:500;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-prompt-manager__sourceActions{display:inline-flex;align-items:center;gap:4px;margin-left:auto}
.dsh-prompt-manager__changes{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform);min-width:0}
.dsh-prompt-manager__change{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;min-width:0}
.dsh-prompt-manager__changePath{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px}
.dsh-prompt-manager__delta{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}

/* the shell marks keyboard focus with a 2px business-colour ring; keep that */
.dsh-prompt-manager__tab:focus-visible,.dsh-prompt-manager__button:focus-visible,.dsh-prompt-manager__addButton:focus-visible,.dsh-prompt-manager__cardMain:focus-visible,.dsh-prompt-manager__iconButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
`.trim()

    /**
     * Request one Host route.
     * @param method - HTTP method.
     * @param path - path below {@link ROUTE}, leading slash included.
     * @param payload - JSON body to send, when the method takes one.
     * @returns the parsed JSON response.
     */
    async function request(method, path, payload) {
      const init = { method }
      if (payload !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(payload)
      }
      const response = await fetch(ROUTE + path, init)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = data && typeof data.error === 'string' ? data.error : `${method} ${path} failed (${response.status})`
        const error = new Error(detail)
        error.status = response.status
        throw error
      }
      return data
    }

    /** Read the entry index out of a settings snapshot. */
    function entriesOf(snapshot) {
      const value = snapshot && snapshot.value
      const list = value && Array.isArray(value.entries) ? value.entries : []
      return list.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    }

    /** Read the configured subscriptions out of a settings snapshot. */
    function sourcesOf(snapshot) {
      const value = snapshot && snapshot.value
      const list = value && Array.isArray(value.sources) ? value.sources : []
      return list.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    }

    /**
     * Whether an entry came from a subscription.
     *
     * Tested by value, not by presence: the settings schema resolves a missing
     * source to an empty string, so `'source' in entry` is true for every local
     * entry as well — which used to badge them all as subscribed.
     */
    function isSubscribed(entry) {
      return typeof entry.source === 'string' && entry.source.length > 0
    }

    /** The next free placement for an added entry. */
    function nextOrder(entries) {
      let highest = 0
      for (const entry of entries) if (typeof entry.order === 'number' && entry.order > highest) highest = entry.order
      return highest + 10
    }

    /** Whether two indexes differ in anything the Host stores. */
    function indexChanged(before, after) {
      if (before.length !== after.length) return true
      for (let index = 0; index < before.length; index += 1) {
        const left = before[index]
        const right = after[index]
        if (left.id !== right.id || left.title !== right.title || left.order !== right.order || left.enabled !== right.enabled) return true
      }
      return false
    }

    /** One shell icon, or nothing when that primitive is missing. */
    /**
     * Whether a primitives export can be rendered.
     *
     * React's `memo` and `forwardRef` return objects rather than functions — the
     * shell's `MarkdownText` is a `memo` — so a `typeof === 'function'` check
     * silently drops exactly the primitive a bundle most wants and degrades to
     * plain text. Anything React can mount is accepted here.
     */
    function isComponent(value) {
      if (typeof value === 'function') return true
      return typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol'
    }

    /** One shell icon, or nothing when that primitive is missing. */
    function icon(name) {
      const component = primitives[name]
      return isComponent(component) ? h(component, {}) : undefined
    }

    /** A switch control, falling back to a checkbox on a host without the primitive. */
    function Switch(props) {
      if (isComponent(primitives.Switch)) {
        return h(primitives.Switch, {
          checked: props.checked,
          label: props.label,
          disabled: props.disabled,
          onChange: props.onChange,
        })
      }
      return h('input', {
        type: 'checkbox',
        checked: props.checked,
        disabled: props.disabled,
        'aria-label': props.label,
        onChange: props.onChange,
      })
    }

    /**
     * One button, drawn in the shape the shell's own settings pages use: a
     * hairline outline by default, a filled primary, a borderless ghost, and a
     * danger label that turns red on hover. The shell's `Button` primitive is the
     * larger, dialog-sized control, which is why the settings pages hand-roll
     * these instead — this section follows them so it looks like a sibling page.
     * @param props - label, variant, disabled flag, and click handler.
     */
    function Button(props) {
      const variant = props.variant ?? 'secondary'
      return h('button', {
        type: 'button',
        className: `dsh-prompt-manager__button dsh-prompt-manager__button--${variant}`,
        disabled: props.disabled,
        onClick: props.onClick,
      }, props.children)
    }

    /**
     * One dashed "add something" control, the shape the shell puts under a list.
     * @param props - label, disabled flag, click handler, and an optional glyph.
     */
    function AddButton(props) {
      return h('button', {
        type: 'button',
        className: 'dsh-prompt-manager__addButton',
        disabled: props.disabled,
        onClick: props.onClick,
      }, [
        icon(props.icon ?? 'IconPlusOutline16') ?? h('span', { key: 'glyph' }, '＋'),
        h('span', { key: 'label' }, props.children),
      ])
    }

    /**
     * A kebab menu over the shell's `Menu`, with an inline list as the fallback
     * for a host that predates that primitive.
     * @param props - open state, items, selection handler, and accessibility label.
     */
    function RowMenu(props) {
      const anchor = h('button', {
        type: 'button',
        className: 'dsh-prompt-manager__iconButton',
        'aria-label': props.label,
        'aria-haspopup': 'menu',
        'aria-expanded': props.open,
        onClick: (event) => {
          event.stopPropagation()
          props.onToggle()
        },
      }, icon('IconEllipsisOutline16') ?? '⋯')

      if (isComponent(primitives.Menu)) {
        return h(primitives.Menu, {
          open: props.open,
          onClose: props.onClose,
          items: props.items,
          onSelect: props.onSelect,
          // Portal: the settings panel scrolls, and a menu rendered inside it
          // would be clipped by the panel's own overflow.
          portal: true,
          closeOnPointerLeave: true,
          anchor,
        })
      }
      if (!props.open) return anchor
      return h(React.Fragment, null, anchor, h('div', { className: 'dsh-prompt-manager__inlineMenu' },
        props.items.map((item) => h('button', {
          key: item.id,
          type: 'button',
          disabled: item.disabled === true,
          onClick: () => props.onSelect(item.id),
        }, item.label))))
    }

    /** Markdown preview over the shell's own renderer. */
    function Preview(props) {
      if (props.text.length === 0) return h('div', { className: 'dsh-prompt-manager__empty' }, '（空正文：该条目不会注入任何内容）')
      if (isComponent(primitives.MarkdownText)) {
        return h(primitives.MarkdownText, {
          text: props.text,
          streaming: false,
          labels: { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' },
        })
      }
      // Last resort on a host without the primitive: the raw source, clearly
      // marked as unrendered so it cannot be mistaken for a real preview.
      return h('pre', { className: 'dsh-prompt-manager__previewRaw' }, props.text)
    }

    /**
     * Render the settings section: the entry list, the editor page, or the
     * subscription sources.
     * @param props - composed slot props carrying the bound settings scope.
     * @returns the section element tree.
     */
    function PromptSection(props) {
      const scope = props.scope
      // The scope's methods read their own state off `this`, so they are bound
      // here instead of being handed to React as bare references.
      const subscribe = React.useCallback((listener) => scope.subscribe(listener), [scope])
      const getSnapshot = React.useCallback(() => scope.getSnapshot(), [scope])
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const entries = React.useMemo(() => entriesOf(snapshot), [snapshot])
      const configured = React.useMemo(() => sourcesOf(snapshot), [snapshot])
      const [view, setView] = React.useState('list')
      const [filter, setFilter] = React.useState('all')
      const [selectedId, setSelectedId] = React.useState(null)
      const [menuFor, setMenuFor] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [saved, setSaved] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [status, setStatus] = React.useState(null)
      const [store, setStore] = React.useState(null)
      const [sources, setSources] = React.useState([])
      const [report, setReport] = React.useState(null)
      const [picked, setPicked] = React.useState([])
      const [newRepo, setNewRepo] = React.useState('')
      const [newRef, setNewRef] = React.useState('main')
      const [newMirror, setNewMirror] = React.useState('')

      const refreshStore = React.useCallback(() => {
        return request('GET', '/status')
          .then((next) => { setStore(next) })
          .catch((error) => { setStore({ writable: false, dir: '', ids: [], error: error.message }) })
      }, [])

      const refreshSources = React.useCallback(() => {
        return request('GET', '/sources')
          .then((next) => { setSources(Array.isArray(next.sources) ? next.sources : []) })
          .catch((error) => { setStatus({ kind: 'error', text: error.message }) })
      }, [])

      React.useEffect(() => {
        void refreshStore()
        void refreshSources()
      }, [refreshSources, refreshStore])

      const writable = snapshot.writable !== false && (store === null || store.writable !== false)
      // A brand-new entry has no saved side yet and is therefore always dirty.
      const dirty = draft !== null && (saved === null
        || draft.title !== saved.title || draft.order !== saved.order || draft.body !== saved.body)
      // A subscribed body belongs to upstream: it is shown, never edited here.
      const subscribedDraft = draft !== null && draft.source === 'subscribed'
      // A built-in body ships with the plugin; editing and saving overrides it.
      const builtinDraft = draft !== null && draft.source === 'builtin'

      /** Load one entry's body and enter the editor page. */
      const open = React.useCallback(async (id) => {
        setBusy(true)
        setSelectedId(id)
        try {
          const body = await request('GET', `/body/${encodeURIComponent(id)}`)
          const known = entries.find((entry) => entry.id === id)
          const next = {
            id,
            title: known !== undefined ? known.title : id,
            order: known !== undefined && typeof known.order === 'number' ? known.order : nextOrder(entries),
            body: typeof body.body === 'string' ? body.body : '',
            source: body.source,
            fileSha1: typeof body.fileSha1 === 'string' ? body.fileSha1 : null,
            isNew: false,
          }
          setDraft(next)
          setSaved(next)
          setStatus(null)
          setView('editor')
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
          setDraft(null)
          setSaved(null)
        } finally {
          setBusy(false)
        }
      }, [entries])

      const select = React.useCallback((entry) => {
        if (entry.id === selectedId && view === 'editor') return
        void open(entry.id)
      }, [open, selectedId, view])

      /** Leave the editor page, keeping nothing unsaved. */
      const back = React.useCallback(() => {
        if (draft !== null && dirty && !window.confirm(draft.isNew ? '放弃这条新提示词？' : '放弃未保存的修改？')) return
        if (draft !== null && draft.isNew) {
          setDraft(null)
          setSaved(null)
          setSelectedId(null)
        } else {
          setDraft(saved)
        }
        setStatus(null)
        setView('list')
      }, [draft, dirty, saved])

      const add = React.useCallback(async () => {
        setBusy(true)
        try {
          const allocated = await request('POST', '/id', { title: '新提示词' })
          const next = {
            id: allocated.id,
            title: '新提示词',
            order: nextOrder(entries),
            body: '# 新提示词\n\n在这里写要注入的提示词正文。\n',
            source: 'empty',
            fileSha1: null,
            isNew: true,
          }
          setSelectedId(allocated.id)
          setDraft(next)
          setSaved(null)
          setStatus({ kind: 'info', text: `已分配 id ${allocated.id}，保存后才会出现在提示词里。` })
          setView('editor')
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [entries])

      const save = React.useCallback(async () => {
        if (draft === null) return
        setBusy(true)
        try {
          const written = await request('PUT', `/body/${encodeURIComponent(draft.id)}`, {
            body: draft.body,
            fileSha1: draft.fileSha1,
          })
          const nextEntries = draft.isNew
            ? [...entries, { id: draft.id, title: draft.title, order: draft.order, enabled: true }]
            : entries.map((entry) => entry.id === draft.id
              ? { ...entry, title: draft.title, order: draft.order }
              : entry)
          if (indexChanged(entries, nextEntries)) await scope.set('entries', nextEntries)
          const next = {
            ...draft,
            source: written.source,
            fileSha1: typeof written.fileSha1 === 'string' ? written.fileSha1 : null,
            isNew: false,
          }
          setDraft(next)
          setSaved(next)
          setStatus({ kind: 'info', text: '已保存，下一个模型步骤生效。' })
          await refreshStore()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [draft, entries, refreshStore, scope])

      // ── subscriptions ────────────────────────────────────────────────────────

      /** Add a source: the Host validates the three fields and allocates the slug. */
      const addSource = React.useCallback(async () => {
        const repo = newRepo.trim()
        if (repo.length === 0) {
          setStatus({ kind: 'error', text: '先填一个 owner/name。' })
          return
        }
        const ref = newRef.trim().length === 0 ? 'main' : newRef.trim()
        const mirror = newMirror.trim()
        setBusy(true)
        try {
          const allocated = await request('POST', '/sources', { repo, ref, mirror })
          // The Host echoes what it validated; prefer it, so the stored record is
          // exactly the one it accepted rather than this form's raw text.
          const next = [...configured, {
            id: allocated.id,
            repo: typeof allocated.repo === 'string' ? allocated.repo : repo,
            ref: typeof allocated.ref === 'string' ? allocated.ref : ref,
            mirror: typeof allocated.mirror === 'string' ? allocated.mirror : mirror,
            enabled: true,
          }]
          await scope.set('sources', next)
          setNewRepo('')
          setNewMirror('')
          setStatus({ kind: 'info', text: `已添加来源 ${allocated.id}，正在检查…` })
          const outcome = await request('POST', `/sources/${encodeURIComponent(allocated.id)}/check`)
          setReport(outcome)
          setPicked(outcome.changes.map((change) => change.path))
          await refreshSources()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [configured, newMirror, newRef, newRepo, refreshSources, scope])

      const checkSource = React.useCallback(async (slug) => {
        setBusy(true)
        try {
          const outcome = await request('POST', `/sources/${encodeURIComponent(slug)}/check`)
          setReport(outcome)
          setPicked(outcome.changes.map((change) => change.path))
          setStatus({
            kind: 'info',
            text: outcome.upToDate ? `「${slug}」已是最新。` : `「${slug}」有 ${String(outcome.changes.length)} 个文件可以更新。`,
          })
          await refreshSources()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [refreshSources])

      const applySource = React.useCallback(async (slug) => {
        setBusy(true)
        try {
          const outcome = await request('POST', `/sources/${encodeURIComponent(slug)}/apply`, { files: picked })
          setReport(null)
          setPicked([])
          setStatus({ kind: 'info', text: `「${slug}」应用了 ${String(outcome.applied.length)} 个文件；新条目默认关闭，打开后才会注入。` })
          await refreshSources()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [picked, refreshSources])

      const revertSource = React.useCallback(async (slug) => {
        if (!window.confirm(`把「${slug}」还原到上次应用之前的正文？`)) return
        setBusy(true)
        try {
          const outcome = await request('POST', `/sources/${encodeURIComponent(slug)}/revert`)
          setStatus({ kind: 'info', text: `「${slug}」还原了 ${String(outcome.reverted.length)} 个文件。` })
          await refreshSources()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [refreshSources])

      const removeSource = React.useCallback(async (slug) => {
        if (!window.confirm(`删除来源「${slug}」？它导入的条目会一起移除，本地条目不受影响。`)) return
        setBusy(true)
        try {
          await scope.set('entries', entries.filter((entry) => entry.source !== slug))
          await scope.set('sources', configured.filter((source) => source.id !== slug))
          await request('DELETE', `/sources/${encodeURIComponent(slug)}`)
          if (report !== null && report.slug === slug) setReport(null)
          setStatus({ kind: 'info', text: `已删除来源「${slug}」。` })
          await refreshSources()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [configured, entries, refreshSources, report, scope])

      /** Turn a subscribed entry into an editable local one, body and all. */
      const forkEntry = React.useCallback(async () => {
        if (draft === null) return
        setBusy(true)
        try {
          const allocated = await request('POST', '/id', { title: draft.title })
          const placed = {
            id: allocated.id,
            title: `${draft.title}（本地）`,
            order: draft.order,
            body: draft.body,
            source: 'empty',
            fileSha1: null,
            isNew: true,
          }
          await request('PUT', `/body/${encodeURIComponent(allocated.id)}`, { body: draft.body, fileSha1: null })
          await scope.set('entries', [...entries, {
            id: allocated.id,
            title: placed.title,
            order: placed.order,
            enabled: false,
          }])
          setSelectedId(allocated.id)
          setDraft(placed)
          setSaved(null)
          setStatus({ kind: 'info', text: `已 fork 成 ${allocated.id}，改完点保存；原订阅条目继续跟随更新。` })
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [draft, entries, scope])

      const toggle = React.useCallback((entry, enabled) => {
        const nextEntries = entries.map((candidate) => candidate.id === entry.id ? { ...candidate, enabled } : candidate)
        setBusy(true)
        Promise.resolve(scope.set('entries', nextEntries))
          .then(() => setStatus({ kind: 'info', text: enabled ? `已启用「${entry.title}」。` : `已关闭「${entry.title}」。` }))
          .catch((error) => setStatus({ kind: 'error', text: error.message }))
          .finally(() => setBusy(false))
      }, [entries, scope])

      const remove = React.useCallback((entry) => {
        if (!window.confirm(`删除「${entry.title}」？它的正文文件也会一起删除。`)) return
        const nextEntries = entries.filter((candidate) => candidate.id !== entry.id)
        setBusy(true)
        Promise.resolve(scope.set('entries', nextEntries))
          .then(() => request('DELETE', `/body/${encodeURIComponent(entry.id)}`))
          .then(async () => {
            if (selectedId === entry.id) {
              setDraft(null)
              setSaved(null)
              setSelectedId(null)
            }
            await refreshStore()
            setStatus({ kind: 'info', text: `已删除「${entry.title}」。` })
          })
          .catch((error) => setStatus({ kind: 'error', text: error.message }))
          .finally(() => setBusy(false))
      }, [entries, refreshStore, scope, selectedId])

      const statusLine = status === null ? null : h('p', {
        key: 'status',
        className: status.kind === 'error' ? 'dsh-prompt-manager__status dsh-prompt-manager__status--error' : 'dsh-prompt-manager__status',
        role: status.kind === 'error' ? 'alert' : 'status',
      }, status.text)

      // ── the editor page ─────────────────────────────────────────────────────

      if (view === 'editor' && draft !== null) {
        return h('div', { className: 'dsh-prompt-manager' }, [
          h('div', { key: 'head', className: 'dsh-prompt-manager__head' }, [
            h(Button, { key: 'back', variant: 'ghost', disabled: busy, onClick: back }, '← 返回'),
            h('h2', { key: 'title', className: 'dsh-prompt-manager__headTitle' }, `编辑「${draft.title}」`),
            h('span', { key: 'spacer', className: 'dsh-prompt-manager__headSpacer' }),
            h('span', { key: 'id', className: 'dsh-prompt-manager__note' }, [
              `id ${draft.id}`,
              draft.isNew ? '（尚未保存）' : '',
              subscribedDraft
                ? ' · 订阅正文，只读'
                : builtinDraft
                  ? ' · 插件内置正文，保存即覆盖'
                  : (draft.fileSha1 === null ? ' · 还没有正文文件' : ' · 已保存'),
            ].join('')),
          ]),
          h('div', { key: 'form', className: 'dsh-prompt-manager__surface' }, [
            h('div', { key: 'fields', className: 'dsh-prompt-manager__fields' }, [
              h('label', { key: 'title', className: 'dsh-prompt-manager__field dsh-prompt-manager__field--grow' }, [
                '标题',
                h('input', {
                  key: 'input',
                  value: draft.title,
                  disabled: !writable || busy,
                  onChange: (event) => setDraft({ ...draft, title: event.target.value }),
                }),
              ]),
              h('label', { key: 'order', className: 'dsh-prompt-manager__field dsh-prompt-manager__field--order' }, [
                '顺序',
                h('input', {
                  key: 'input',
                  type: 'number',
                  value: String(draft.order),
                  disabled: !writable || busy,
                  onChange: (event) => setDraft({ ...draft, order: Number(event.target.value) }),
                }),
              ]),
            ]),
          h('div', { key: 'body', className: 'dsh-prompt-manager__pane' }, [
            h('span', { key: 'label', className: 'dsh-prompt-manager__paneLabel' }, subscribedDraft
              ? 'Markdown 正文（来自订阅，只读）'
              : builtinDraft ? 'Markdown 正文（插件内置，保存即覆盖）' : 'Markdown 正文'),
            h('textarea', {
              key: 'textarea',
              value: draft.body,
              disabled: !writable || busy,
              readOnly: subscribedDraft,
              spellCheck: false,
              onChange: (event) => setDraft({ ...draft, body: event.target.value }),
            }),
          ]),
          h('div', { key: 'preview', className: 'dsh-prompt-manager__pane' }, [
            h('span', { key: 'label', className: 'dsh-prompt-manager__paneLabel' }, '预览'),
            h('div', { key: 'body', className: 'dsh-prompt-manager__preview' }, h(Preview, { text: draft.body })),
          ]),
          ]),
          h('div', { key: 'actions', className: 'dsh-prompt-manager__actions' }, [            h(Button, { key: 'save', variant: 'primary', disabled: !writable || busy || !dirty, onClick: save }, dirty ? '保存修改' : '已保存'),
            subscribedDraft
              ? h(Button, { key: 'fork', disabled: !writable || busy, onClick: () => { void forkEntry() } }, 'fork 成本地条目')
              : null,
            subscribedDraft
              ? h('span', { key: 'note', className: 'dsh-prompt-manager__note' }, '订阅条目的正文来自上游，只能通过「检查更新」改；想自己改就先 fork。')
              : builtinDraft
                ? h('span', { key: 'note', className: 'dsh-prompt-manager__note' }, '这条正文是插件内置的默认内容；保存后会写成本机的覆盖版本，插件升级也不会覆盖它。')
                : null,
          ]),
          statusLine,
        ])
      }

      // ── the sources page ────────────────────────────────────────────────────

      if (view === 'sources') {
        const cards = sources.map((source) => {
          const active = report !== null && report.slug === source.id
          const state = active && report.changes.length > 0
            ? 'pending'
            : active && report.warnings.length > 0 ? 'error' : 'ready'
          return h('div', { key: source.id, className: 'dsh-prompt-manager__source' }, [
            h('div', { key: 'head', className: 'dsh-prompt-manager__sourceHead' }, [
              h('span', {
                key: 'dot',
                className: state === 'ready'
                  ? 'dsh-prompt-manager__dot'
                  : `dsh-prompt-manager__dot dsh-prompt-manager__dot--${state}`,
                'aria-hidden': 'true',
              }),
              h('span', { key: 'repo', className: 'dsh-prompt-manager__sourceRepo' }, `${source.repo}@${source.ref}`),
              source.enabled === false
                ? h('span', { key: 'off', className: 'dsh-prompt-manager__badge' }, '已关闭')
                : null,
              h('span', { key: 'meta', className: 'dsh-prompt-manager__meta' }, [
                `${String(source.files)} 个文件`,
                source.appliedAt !== undefined ? `上次应用 ${source.appliedAt}` : '还没应用过',
              ].join(' · ')),
              h('span', { key: 'spacer', className: 'dsh-prompt-manager__headSpacer' }),
              h('div', { key: 'actions', className: 'dsh-prompt-manager__sourceActions' }, [
                h(Button, { key: 'check', disabled: busy, onClick: () => { void checkSource(source.id) } }, '检查更新'),
                h(Button, { key: 'revert', disabled: busy, onClick: () => { void revertSource(source.id) } }, '还原'),
                h(Button, { key: 'remove', variant: 'danger', disabled: busy, onClick: () => { void removeSource(source.id) } }, '删除来源'),
              ]),
            ]),
            h('span', { key: 'note', className: 'dsh-prompt-manager__note' }, [
              source.headSha !== undefined ? `远端 ${source.headSha.slice(0, 7)}` : '还没检查过远端',
              source.mirror.length > 0 ? `经 ${source.mirror}` : '直连',
            ].join(' · ')),
            active && report.changes.length > 0
              ? h('div', { key: 'changes', className: 'dsh-prompt-manager__changes' }, [
                ...report.changes.map((change) => h('label', { key: change.path, className: 'dsh-prompt-manager__change' }, [
                  h('input', {
                    key: 'pick',
                    type: 'checkbox',
                    checked: picked.includes(change.path),
                    onChange: () => setPicked(picked.includes(change.path)
                      ? picked.filter((candidate) => candidate !== change.path)
                      : [...picked, change.path]),
                  }),
                  h('span', { key: 'path', className: 'dsh-prompt-manager__changePath' },
                    `${change.kind === 'removed' ? '（删除）' : ''}${change.path}`),
                  h('span', { key: 'delta', className: 'dsh-prompt-manager__delta' }, `+${String(change.added)} / −${String(change.removed)}`),
                ])),
                h('div', { key: 'apply', className: 'dsh-prompt-manager__actions' }, [
                  h(Button, {
                    key: 'go',
                    variant: 'primary',
                    disabled: busy || picked.length === 0,
                    onClick: () => { void applySource(source.id) },
                  }, `应用（${String(picked.length)}）`),
                ]),
              ])
              : active
                ? h('span', { key: 'clean', className: 'dsh-prompt-manager__status dsh-prompt-manager__status--ok' }, '没有需要更新的内容。')
                : null,
            active && report.warnings.length > 0
              ? h('span', { key: 'warn', className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error' }, report.warnings.join('；'))
              : null,
          ])
        })

        return h('div', { className: 'dsh-prompt-manager' }, [
          h('div', { key: 'head', className: 'dsh-prompt-manager__head' }, [
            h(Button, { key: 'back', variant: 'ghost', disabled: busy, onClick: () => { setView('list'); setReport(null) } }, '← 返回'),
            h('h2', { key: 'title', className: 'dsh-prompt-manager__headTitle' }, '订阅来源'),
          ]),
          h('p', { key: 'lede', className: 'dsh-prompt-manager__intro' },
            '一个来源 = 一个 GitHub 仓库 + 一个 ref；仓库根要有 prompt-manager.json 清单。检查更新只把远端内容取到暂存区，点「应用」才覆盖本地，改动在下一个模型步骤生效。'),
          h('div', { key: 'add', className: 'dsh-prompt-manager__surface' }, [
            h('div', { key: 'fields', className: 'dsh-prompt-manager__fields' }, [
              h('label', { key: 'repo', className: 'dsh-prompt-manager__field dsh-prompt-manager__field--grow' }, [
                '仓库（owner/name）',
                h('input', {
                  key: 'input',
                  value: newRepo,
                  placeholder: 'owner/repo',
                  disabled: busy,
                  onChange: (event) => setNewRepo(event.target.value),
                }),
              ]),
              h('label', { key: 'ref', className: 'dsh-prompt-manager__field dsh-prompt-manager__field--order' }, [
                'ref',
                h('input', {
                  key: 'input',
                  value: newRef,
                  disabled: busy,
                  onChange: (event) => setNewRef(event.target.value),
                }),
              ]),
              h('label', { key: 'mirror', className: 'dsh-prompt-manager__field dsh-prompt-manager__field--grow' }, [
                '镜像（可留空）',
                h('input', {
                  key: 'input',
                  value: newMirror,
                  placeholder: 'https://gh-proxy.example',
                  disabled: busy,
                  onChange: (event) => setNewMirror(event.target.value),
                }),
              ]),
            ]),
            h('div', { key: 'actions', className: 'dsh-prompt-manager__actions' }, [
              h(Button, { key: 'go', variant: 'primary', disabled: !writable || busy, onClick: () => { void addSource() } }, '添加来源'),
            ]),
          ]),
          sources.length === 0
            ? h('div', { key: 'empty', className: 'dsh-prompt-manager__empty' }, '还没有订阅来源。')
            : h('div', { key: 'cards', className: 'dsh-prompt-manager__list' }, cards),
          statusLine,
        ])
      }

      // ── the list page ───────────────────────────────────────────────────────

      const visible = entries.filter((entry) => {
        if (filter === 'local') return !isSubscribed(entry)
        if (filter === 'subscribed') return isSubscribed(entry)
        return true
      })

      const rows = visible.map((entry) => h('div', {
        key: entry.id,
        className: 'dsh-prompt-manager__card',
      }, [
        h('button', {
          key: 'open',
          type: 'button',
          className: 'dsh-prompt-manager__cardMain',
          onClick: () => select(entry),
        }, [
          h('span', { key: 'title', className: 'dsh-prompt-manager__title' }, entry.title),
          h('span', { key: 'meta', className: 'dsh-prompt-manager__meta' }, [
            isSubscribed(entry) ? `订阅 ${entry.source}` : '本地',
            entry.enabled === true ? '' : '已关闭',
          ].filter((part) => part.length > 0).join(' · ')),
        ]),
        h('div', { key: 'side', className: 'dsh-prompt-manager__cardSide' }, [
          h('span', {
            key: 'dot',
            className: `dsh-prompt-manager__dot${entry.enabled === true ? '' : ' dsh-prompt-manager__dot--idle'}`,
            'aria-hidden': 'true',
          }),
          isSubscribed(entry) ? h('span', { key: 'badge', className: 'dsh-prompt-manager__badge' }, '订阅') : null,
          h(Switch, {
            key: 'switch',
            checked: entry.enabled === true,
            label: entry.title,
            disabled: !writable || busy,
            onChange: () => toggle(entry, entry.enabled !== true),
          }),
          h(RowMenu, {
            key: 'menu',
            open: menuFor === entry.id,
            label: `更多操作：${entry.title}`,
            items: [
              { id: 'edit', label: '编辑', icon: icon('IconEditOutline16') },
              { id: 'delete', label: '删除', icon: icon('IconTrashOutline16'), disabled: !writable },
            ],
            onToggle: () => setMenuFor(menuFor === entry.id ? null : entry.id),
            onClose: () => setMenuFor(null),
            onSelect: (id) => {
              setMenuFor(null)
              if (id === 'edit') select(entry)
              else if (id === 'delete') remove(entry)
            },
          }),
        ]),
      ]))

      const enabledCount = entries.filter((entry) => entry.enabled === true).length
      const ready = snapshot.status === 'ready'
      const note = snapshot.status === 'loading' || snapshot.status === null
        ? '正在读取设置…'
        : snapshot.status === 'unavailable'
          ? '设置命名空间不可用（非 loopback 页面或 Host 未挂载 settings）：本页只读。'
          : null

      return h('div', { className: 'dsh-prompt-manager' }, [
        h('h1', { key: 'heading', className: 'dsh-prompt-manager__heading' }, '提示词'),
        h('p', { key: 'lede', className: 'dsh-prompt-manager__intro' },
          '每条提示词都是一个独立的 system prompt section；开关、排序、正文改动在下一个模型步骤生效，不需要重启。'),
        h('p', { key: 'dir', className: 'dsh-prompt-manager__note' }, [
          `已启用 ${String(enabledCount)}/${String(entries.length)}`,
          store !== null && typeof store.dir === 'string' ? `正文目录：${store.dir}` : '',
        ].filter((part) => part.length > 0).join(' · ')),
        note === null ? null : h('p', { key: 'note', className: 'dsh-prompt-manager__note' }, note),
        store !== null && store.writable === false
          ? h('p', { key: 'unwritable', className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error' }, '正文目录不可写，编辑器已禁用；开关和排序仍然可用。')
          : null,
        h('div', { key: 'list', className: 'dsh-prompt-manager__block' }, [
          h('div', { key: 'tabs', className: 'dsh-prompt-manager__tabs' }, [
            ...[['all', '全部'], ['local', '本地'], ['subscribed', '订阅']].map(([id, label]) => h('button', {
              key: id,
              type: 'button',
              className: filter === id ? 'dsh-prompt-manager__tab dsh-prompt-manager__tab--active' : 'dsh-prompt-manager__tab',
              onClick: () => setFilter(id),
            }, label)),
          ]),
          visible.length === 0
            ? h('div', { key: 'empty', className: 'dsh-prompt-manager__empty' }, filter === 'subscribed' ? '还没有订阅来的提示词。' : '还没有提示词，点「新增提示词」加一条。')
            : h('div', { key: 'rows', className: 'dsh-prompt-manager__list' }, rows),
          h('div', { key: 'addRow', className: 'dsh-prompt-manager__addRow' }, [
            h(AddButton, { key: 'add', disabled: !writable || busy, onClick: add }, '新增提示词'),
            h(AddButton, {
              key: 'sources',
              icon: 'IconRefreshOutline16',
              disabled: busy,
              onClick: () => setView('sources'),
            }, `订阅来源（${String(sources.length)}）`),
          ]),
        ]),
        ready ? null : h('div', { key: 'waiting', className: 'dsh-prompt-manager__empty' }, '设置载入后这里会显示列表。'),
        statusLine,
        h('p', { key: 'foot', className: 'dsh-prompt-manager__note' }, [
          ready ? `settings revision ${String(snapshot.revision)}` : '',
          typeof snapshot.mode === 'string' ? ` · 持久化 ${snapshot.mode}` : '',
          ' · 正文写在磁盘文件中，索引写在 settings.yaml 里；订阅条目的正文只读，来源在「来源」页里手动检查更新。',
        ].join('')),
      ])
    }

    /** Keep one section failure from blanking the whole settings dialog. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error', role: 'alert' },
            `提示词页面出错：${String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}`)
        }
        return this.props.children
      }
    }

    /** Attach this bundle's stylesheet to the document. */
    function injectStyle() {
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
      if (existing !== null) return null
      const tag = document.createElement('style')
      tag.dataset.plugin = 'prompt-manager'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return tag
    }

    const name = 'prompt-manager'

    // `settingsScope` is a hard requirement: this section is nothing but the
    // index it serves, so a host without the settings domain mounts nothing
    // rather than rendering controls that cannot persist.
    const inject = ['slots', 'settingsScope']

    /**
     * Register the settings section.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
      ctx.effect(() => {
        const tag = injectStyle()
        return () => { if (tag !== null) tag.remove() }
      }, 'prompt-manager: section styles')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NAMESPACE,
        order: SECTION_ORDER,
        label: () => '提示词',
        inject: () => ({ scope }),
      }, (props) => h(Boundary, null, h(PromptSection, props))))
    }

    return { name, inject, apply }
  },
})
