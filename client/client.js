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
        // A refused save carries the run that refused it, so the editor can show
        // what the script actually printed rather than only that it was refused.
        error.report = data && typeof data === 'object' ? data.report : undefined
        throw error
      }
      return data
    }

    /** Where a variable's value came from, in the page's own words. */
    const SOURCE_LABELS = { environment: '系统', config: '配置', probe: '探测', script: '脚本' }

    /** Valid variable names, mirroring the registry's own rule. */
    const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

    /**
     * The source a brand-new script starts from.
     *
     * It runs as it stands — printing a JSON object whose keys become variable
     * names — so the first thing a person sees is a working example rather than
     * an empty box and a paragraph explaining what to type.
     */
    /**
     * The source a new script starts from.
     *
     * It runs as it stands, and its one key is deliberately not a name the
     * plugin already provides (`pwsh` / `bash` / `git` / `node` / `python` and
     * the four environment facts): a template that claims one of those would be
     * refused on save, and one that claims an arbitrary tool would leave a
     * `(not installed)` variable behind on every machine that lacks it.
     */
    const SCRIPT_TEMPLATE = [
      '// 打印一个 JSON 对象：键就是提示词里能用的变量名 {{名字}}。',
      '// 这个脚本跑在一个独立子进程里，超时、报错都不会影响 DSH 本身。',
      'const { execSync } = require("node:child_process")',
      '',
      'const firstLine = (command) => {',
      '  try {',
      '    return execSync(command, { encoding: "utf8" }).trim().split("\\n")[0]',
      '  } catch {',
      '    return "(not installed)"',
      '  }',
      '}',
      '',
      'console.log(JSON.stringify({',
      '  // 换成你要探测的东西，一行一个变量，例如：',
      '  //   toolchain_java: firstLine("java -version"),',
      '  node_version: process.version.replace(/^v/, ""),',
      '}))',
      '',
    ].join('\n')

    /**
     * Every `{{...}}` a body carries, as written.
     *
     * The inner text is returned whatever it holds, because the point of this
     * scan is to catch a reference that would fail assembly — and a name that is
     * not a valid variable name fails it just as hard as one that is not
     * registered.
     * @param text - markdown body.
     * @returns the reference texts, in order, without repeats.
     */
    function referencesIn(text) {
      const found = []
      const pattern = /\{\{([^{}]*)\}\}/g
      let match = pattern.exec(text)
      while (match !== null) {
        if (!found.includes(match[1])) found.push(match[1])
        match = pattern.exec(text)
      }
      return found
    }

    /**
     * A stored timestamp as the page shows it: local time, falling back to the
     * raw value when it cannot be parsed (an empty string means "never").
     * @param value - ISO-8601 text from the Host.
     * @returns the text to render.
     */
    function stamp(value) {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
    }

    /**
     * Whether a script source parses, checked here so the editor can say so
     * while somebody types. The Host re-checks before writing, and this is only
     * ever a hint: a browser without `new Function` simply reports nothing.
     * @param source - script text.
     * @returns the parser's complaint, or `null` when it parses.
     */
    function syntaxProblem(source) {
      try {
        // The compilation is what is wanted here, never the call.
        Function(source)
        return null
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        // A host that forbids eval refuses the compilation itself. That is not a
        // syntax error, so the editor says nothing rather than something wrong.
        if (error && (error.name === 'EvalError' || /Content Security Policy|unsafe-eval/i.test(message))) return null
        return message
      }
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
     * The paths a check staged, whatever shape the answer arrived in.
     *
     * A proxy that answers with something that is not the Host's JSON would
     * otherwise turn every consumer of the outcome into a `TypeError`, which the
     * page can only report as gibberish.
     * @param outcome - the check answer.
     * @returns the staged paths, or an empty list.
     */
    function changedPaths(outcome) {
      const changes = outcome && Array.isArray(outcome.changes) ? outcome.changes : []
      return changes
        .map((change) => (change !== null && typeof change === 'object' ? change.path : undefined))
        .filter((path) => typeof path === 'string')
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
     * What one script run produced, as the editor shows it.
     *
     * A test run is the same execution a save performs, so this is not a
     * simulation: it is the variables the script would supply, the exit code it
     * exited with, and everything that went wrong — which is exactly what a
     * person needs before deciding to save.
     * @param props - the run report, or null when nothing has been run.
     */
    function RunReport(props) {
      const report = props.report
      if (report === null || report === undefined) return null
      const names = report.variables === undefined || report.variables === null ? [] : Object.keys(report.variables)
      return h('div', { className: 'dsh-prompt-manager__changes' }, [
        h('span', {
          key: 'head',
          className: report.ok === true
            ? 'dsh-prompt-manager__status dsh-prompt-manager__status--ok'
            : 'dsh-prompt-manager__status dsh-prompt-manager__status--error',
        }, [
          report.ok === true ? `这次会提供 ${String(names.length)} 个变量` : '这次运行没有产出可用的变量',
          `退出码 ${report.exitCode === undefined ? '无' : String(report.exitCode)}`,
          `${String(report.ms)}ms`,
        ].join(' · ')),
        ...names.map((name) => h('div', { key: name, className: 'dsh-prompt-manager__change' }, [
          h('span', { key: 'token', className: 'dsh-prompt-manager__changePath' }, `{{${name}}}`),
          h('span', { key: 'value', className: 'dsh-prompt-manager__delta' }, report.variables[name]),
        ])),
        ...(report.problems ?? []).map((problem, index) => h('span', {
          key: `problem-${String(index)}`,
          className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error',
        }, problem)),
        ...(report.warnings ?? []).map((warning, index) => h('span', {
          key: `warning-${String(index)}`,
          className: 'dsh-prompt-manager__note',
        }, warning)),
        typeof report.stderr === 'string' && report.stderr.length > 0
          ? h('pre', { key: 'stderr', className: 'dsh-prompt-manager__previewRaw' }, report.stderr)
          : null,
      ])
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
      const [variableReport, setVariableReport] = React.useState(null)
      const [scriptDraft, setScriptDraft] = React.useState(null)
      const [scriptSaved, setScriptSaved] = React.useState(null)
      const [runReport, setRunReport] = React.useState(null)
      const [caret, setCaret] = React.useState(null)

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

      /** Read the variables in force and the scripts that supply them. */
      const refreshVariables = React.useCallback(() => {
        return request('GET', '/variables')
          .then((next) => { setVariableReport(next) })
          .catch((error) => {
            setVariableReport({ variables: [], scripts: [], error: error.message })
          })
      }, [])

      React.useEffect(() => {
        void refreshStore()
        void refreshSources()
        void refreshVariables()
      }, [refreshSources, refreshStore, refreshVariables])

      const writable = snapshot.writable !== false && (store === null || store.writable !== false)
      // A brand-new entry has no saved side yet and is therefore always dirty.
      const dirty = draft !== null && (saved === null
        || draft.title !== saved.title || draft.order !== saved.order || draft.body !== saved.body)
      // A subscribed body belongs to upstream: it is shown, never edited here.
      const subscribedDraft = draft !== null && draft.source === 'subscribed'
      // A built-in body ships with the plugin; editing and saving overrides it.
      const builtinDraft = draft !== null && draft.source === 'builtin'
      // The variables in force, and the scripts that supply them, as the Host
      // last reported them. The list is what a body may reference, so it is also
      // what the editor uses to catch a reference that would fail assembly.
      const variables = variableReport !== null && Array.isArray(variableReport.variables) ? variableReport.variables : []
      const scripts = variableReport !== null && Array.isArray(variableReport.scripts) ? variableReport.scripts : []
      const knownVariables = variables.map((variable) => variable.name)
      // A reference the prompt cannot resolve makes assembly throw, so the body
      // editor says so first: a name that is not registered, and a reference
      // whose shape is not a variable name at all.
      const referencedInDraft = draft === null ? [] : referencesIn(draft.body)
      const unknownInDraft = referencedInDraft.filter((name) => !knownVariables.includes(name) && VARIABLE_NAME.test(name))
      const malformedInDraft = referencedInDraft.filter((name) => !VARIABLE_NAME.test(name))

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
        // The registry keeps a bounded number of sections, so an entry past the
        // cap would save a body and then never reach the prompt. Refusing here is
        // the only place a person can be told why.
        const cap = store !== null && typeof store.maxEntries === 'number' ? store.maxEntries : null
        if (cap !== null && entries.length >= cap) {
          setStatus({ kind: 'error', text: `最多 ${String(cap)} 条提示词，先删掉一条，或关掉不用的条目（关掉的条目也占位置）。` })
          return
        }
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
      }, [entries, store])

      const save = React.useCallback(async () => {
        if (draft === null) return
        setBusy(true)
        try {
          const written = await request('PUT', `/body/${encodeURIComponent(draft.id)}`, {
            body: draft.body,
            fileSha1: draft.fileSha1,
          })
          // The body is on disk, so the fence the editor holds has to be the one
          // that write produced — a later save that reused the old hash would be
          // refused as stale, and the editor would be stuck on 409.
          const next = {
            ...draft,
            source: typeof written.source === 'string' ? written.source : draft.source,
            fileSha1: typeof written.fileSha1 === 'string' ? written.fileSha1 : null,
            isNew: false,
          }
          setDraft(next)
          setSaved(next)
          const nextEntries = draft.isNew
            ? [...entries, { id: draft.id, title: draft.title, order: draft.order, enabled: true }]
            : entries.map((entry) => entry.id === draft.id
              ? { ...entry, title: draft.title, order: draft.order }
              : entry)
          if (indexChanged(entries, nextEntries)) {
            try {
              await scope.set('entries', nextEntries)
            } catch (error) {
              // Half a save is worth saying precisely: the prose is stored, only
              // the index write failed, and pressing save again finishes it.
              setStatus({ kind: 'error', text: `正文已保存，但索引没写进去：${error.message}（再点一次「保存修改」即可）` })
              await refreshStore()
              return
            }
          }
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
          setPicked(changedPaths(outcome))
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
          const changes = Array.isArray(outcome.changes) ? outcome.changes : []
          setReport({ ...outcome, changes })
          setPicked(changedPaths(outcome))
          setStatus({
            kind: 'info',
            text: outcome.upToDate === true ? `「${slug}」已是最新。` : `「${slug}」有 ${String(changes.length)} 个文件可以更新。`,
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
          const applied = Array.isArray(outcome.applied) ? outcome.applied : []
          setStatus({ kind: 'info', text: `「${slug}」应用了 ${String(applied.length)} 个文件；新条目默认关闭，打开后才会注入。` })
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
          const reverted = Array.isArray(outcome.reverted) ? outcome.reverted : []
          setStatus({ kind: 'info', text: `「${slug}」还原了 ${String(reverted.length)} 个文件。` })
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
          // The Host drops the files and rebuilds the index; the settings writes
          // only record what it already did. Deleting first keeps a failure from
          // leaving the page showing a source the engine still has.
          const outcome = await request('DELETE', `/sources/${encodeURIComponent(slug)}`)
          await scope.set('entries', Array.isArray(outcome.entries)
            ? outcome.entries
            : entries.filter((entry) => entry.source !== slug))
          await scope.set('sources', configured.filter((source) => source.id !== slug))
          if (report !== null && report.slug === slug) setReport(null)
          await refreshSources()
          setStatus({ kind: 'info', text: `已删除来源「${slug}」。` })
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
          const title = `${draft.title}（本地）`
          // The index goes first. If the body write then fails, what is left is a
          // visible entry with an empty body — which this editor can fix — where
          // the other order would leave a body file no page can reach.
          await scope.set('entries', [...entries, { id: allocated.id, title, order: draft.order, enabled: false }])
          const forked = {
            id: allocated.id,
            title,
            order: draft.order,
            body: draft.body,
            source: 'empty',
            fileSha1: null,
            isNew: false,
          }
          setSelectedId(allocated.id)
          setDraft(forked)
          setSaved(null)
          const written = await request('PUT', `/body/${encodeURIComponent(allocated.id)}`, { body: draft.body, fileSha1: null })
          // The body file exists now, so the editor must fence against exactly
          // what the write produced: keeping `null` would make the next save look
          // like a create, and the store refuses to create over an existing file.
          const placed = {
            ...forked,
            source: typeof written.source === 'string' ? written.source : 'user',
            fileSha1: typeof written.fileSha1 === 'string' ? written.fileSha1 : null,
          }
          setDraft(placed)
          setSaved(placed)
          setStatus({ kind: 'info', text: `已 fork 成 ${allocated.id}，改完点保存；原订阅条目继续跟随更新。` })
          await refreshStore()
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [draft, entries, refreshStore, scope])

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
        setBusy(true)
        // The body file goes first: if that fails, nothing has changed and the
        // entry is still there to retry, rather than an index record pointing at
        // a file the page no longer shows.
        request('DELETE', `/body/${encodeURIComponent(entry.id)}`)
          .then(() => scope.set('entries', entries.filter((candidate) => candidate.id !== entry.id)))
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

      // ── variables and scripts ────────────────────────────────────────────────

      /** Copy one `{{name}}` so it can be pasted into a body. */
      const copyVariable = React.useCallback((name) => {
        const token = `{{${name}}}`
        const clipboard = typeof navigator === 'object' && navigator !== null ? navigator.clipboard : undefined
        if (clipboard !== undefined && clipboard !== null && typeof clipboard.writeText === 'function') {
          clipboard.writeText(token)
            .then(() => { setStatus({ kind: 'info', text: `已复制 ${token}` }) })
            .catch((error) => { setStatus({ kind: 'info', text: token }) })
          return
        }
        setStatus({ kind: 'info', text: token })
      }, [])

      /** Put one `{{name}}` into the body being edited, at the caret. */
      const insertVariable = React.useCallback((name) => {
        if (draft === null) return
        const token = `{{${name}}}`
        const at = typeof caret === 'number' && caret >= 0 && caret <= draft.body.length ? caret : draft.body.length
        setDraft({ ...draft, body: `${draft.body.slice(0, at)}${token}${draft.body.slice(at)}` })
        setCaret(at + token.length)
      }, [caret, draft])

      /**
       * Insert a reference and show the body it landed in.
       *
       * The variables page has no textarea and no save button, so inserting
       * without opening the editor would edit a draft nobody can see — and the
       * next time that entry is opened, the body is read again from the Host and
       * the insertion is silently gone.
       * @param name - the variable to reference.
       */
      const insertVariableHere = React.useCallback((name) => {
        if (draft === null) return
        insertVariable(name)
        setView('editor')
      }, [draft, insertVariable])

      /** Open a script in the editor: an existing one, or a fresh template. */
      const openScript = React.useCallback(async (name) => {
        setBusy(true)
        setRunReport(null)
        try {
          if (name === null) {
            const fresh = { name: '', source: SCRIPT_TEMPLATE, fileSha1: null, isNew: true }
            setScriptDraft(fresh)
            setScriptSaved(fresh)
          } else {
            const stored = await request('GET', `/script/${encodeURIComponent(name)}`)
            const opened = {
              name,
              source: typeof stored.source === 'string' ? stored.source : '',
              fileSha1: typeof stored.sha1 === 'string' ? stored.sha1 : null,
              isNew: false,
            }
            setScriptDraft(opened)
            setScriptSaved(opened)
          }
          setStatus(null)
          setView('script')
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [])

      /**
       * Run what the editor holds, without saving it.
       *
       * Always sent as a source, so the Host writes a throwaway copy, runs that,
       * and registers nothing — the same code, the same command and the same
       * directory a save would use, minus the side effects. Running the saved
       * file itself is the variables page's own 「运行一次」, which is also what
       * refreshes the values in force.
       */
      const testScript = React.useCallback(async () => {
        if (scriptDraft === null) return
        setBusy(true)
        try {
          const name = scriptDraft.name.trim()
          const report = await request('POST', '/variables/run', {
            name: name.length > 0 ? name : 'draft',
            source: scriptDraft.source,
          })
          setRunReport(report)
          setStatus(report.ok === true
            ? { kind: 'info', text: `这次会提供 ${String(Object.keys(report.variables ?? {}).length)} 个变量；保存后才会注册。` }
            : { kind: 'error', text: report.problems.join('；') })
        } catch (error) {
          setRunReport(error.report === undefined ? null : error.report)
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [scriptDraft])

      /** Save a script: the Host validates, runs, and only then writes it. */
      const saveScript = React.useCallback(async () => {
        if (scriptDraft === null) return
        const name = scriptDraft.name.trim()
        if (name.length === 0) {
          setStatus({ kind: 'error', text: '先给脚本起个名字（字母数字和连字符，就是文件名）。' })
          return
        }
        setBusy(true)
        try {
          const saved = await request('PUT', `/script/${encodeURIComponent(name)}`, {
            source: scriptDraft.source,
            fileSha1: scriptDraft.fileSha1,
          })
          const written = { ...scriptDraft, name, fileSha1: typeof saved.sha1 === 'string' ? saved.sha1 : null, isNew: false }
          setScriptDraft(written)
          setScriptSaved(written)
          setRunReport(saved.report === undefined ? null : saved.report)
          await refreshVariables()
          const supplied = Object.keys(saved.variables ?? {})
          setStatus({
            kind: 'info',
            text: supplied.length === 0
              ? '已保存；这条脚本没有提供任何变量。'
              : `已保存并启用：${supplied.map((variable) => `{{${variable}}}`).join(' ')}，下一个模型步骤生效。`,
          })
        } catch (error) {
          setRunReport(error.report === undefined ? null : error.report)
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [refreshVariables, scriptDraft])

      /** Measure every script again, and republish what they supply. */
      const refreshScripts = React.useCallback(async () => {
        setBusy(true)
        try {
          const outcome = await request('POST', '/variables/refresh')
          await refreshVariables()
          const reports = Array.isArray(outcome.reports) ? outcome.reports : []
          const failed = reports.filter((report) => report.ok !== true)
          setStatus(failed.length === 0
            ? { kind: 'info', text: `已重新测量 ${String(reports.length)} 条脚本。` }
            : {
              kind: 'error',
              text: `${String(failed.length)} 条脚本失败了：${failed.map((report) => `${report.name}（${report.problems.join('，')}）`).join('；')}`,
            })
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [refreshVariables])

      /**
       * Forget a script.
       *
       * The values it declared stay in force — a reference with no value fails
       * assembly — so the confirmation names the entries that would be left
       * holding the last measured value.
       */
      const removeScript = React.useCallback(async (name) => {
        const affected = variables.filter((variable) => variable.detail === name && variable.referencedBy.length > 0)
        const question = affected.length === 0
          ? `删除脚本「${name}」？它的文件会被移除。`
          : `删除脚本「${name}」？这些变量还在被提示词引用：${affected.map((variable) => `${variable.name}（${variable.referencedBy.join('、')}）`).join('；')}。删除后它们会继续用最后一次测到的值，重启 profile 后才真正消失。`
        if (!window.confirm(question)) return
        setBusy(true)
        try {
          await request('DELETE', `/script/${encodeURIComponent(name)}`)
          await refreshVariables()
          if (scriptDraft !== null && scriptDraft.name === name) {
            setScriptDraft(null)
            setScriptSaved(null)
            setView('variables')
          }
          setStatus({ kind: 'info', text: `已删除脚本「${name}」。它提供的变量留在最后一次的值上。` })
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [refreshVariables, scriptDraft, variables])

      /**
       * Run a saved script from the list, without opening the editor.
       *
       * The list has nowhere to show a full run report, so the outcome is
       * summarised here and the editor stays the place that shows the variables,
       * the exit code, and stderr in full.
       */
      const runScript = React.useCallback(async (name) => {
        setBusy(true)
        try {
          const report = await request('POST', '/variables/run', { name })
          await refreshVariables()
          const provided = Object.keys(report.variables ?? {}).length
          setStatus(report.ok === true
            ? {
              kind: 'info',
              text: `「${name}」提供了 ${String(provided)} 个变量${report.exitCode === undefined ? '' : `（退出码 ${String(report.exitCode)}）`}，用时 ${String(report.ms)}ms。`,
            }
            : { kind: 'error', text: report.problems.join('；') })
        } catch (error) {
          setStatus({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }, [refreshVariables])

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
                  onChange: (event) => {
                    // An empty box or a lone `-` parses to something unusable;
                    // keeping the previous number is kinder than writing a value
                    // the index schema then refuses.
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) return
                    setDraft({ ...draft, order: parsed })
                  },
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
              // The caret is where an inserted reference lands; a host that does
              // not report one simply gets the reference appended.
              onSelect: (event) => setCaret(event.target.selectionStart),
              onKeyUp: (event) => setCaret(event.target.selectionStart),
              onClick: (event) => setCaret(event.target.selectionStart),
            }),
          ]),
          h('div', { key: 'vars', className: 'dsh-prompt-manager__actions' }, [
            h('span', { key: 'label', className: 'dsh-prompt-manager__note' }, '可用变量（点一下插到光标处）：'),
            ...knownVariables.map((name) => h(Button, {
              key: name,
              disabled: busy || !writable,
              onClick: () => insertVariable(name),
            }, `{{${name}}}`)),
          ]),
          unknownInDraft.length === 0 ? null : h('span', {
            key: 'unknown',
            className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error',
          }, `这些变量还没有注册：${unknownInDraft.map((name) => `{{${name}}}`).join(' ')}（宿主会把它按字面量渲染并记一条警告；去「变量」页建一条脚本提供它，或把引用删掉）`),
          malformedInDraft.length === 0 ? null : h('span', {
            key: 'malformed',
            className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error',
          }, `这些引用的写法不对：${malformedInDraft.map((name) => `{{${name}}}`).join(' ')}（注册表解析不了这种写法，宿主会按字面量渲染，且保存会被拒绝；变量名只能是数字、下划线和小写字母，且以字母开头）`),
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

      // ── the script editor ───────────────────────────────────────────────────

      if (view === 'script' && scriptDraft !== null) {
        const syntax = syntaxProblem(scriptDraft.source)
        return h('div', { className: 'dsh-prompt-manager' }, [
          h('div', { key: 'head', className: 'dsh-prompt-manager__head' }, [
            h(Button, {
              key: 'back',
              variant: 'ghost',
              disabled: busy,
              onClick: () => {
                // Leaving drops the draft, so an edited one is confirmed first —
                // a half-written script is not recoverable from anywhere else.
                const dirtyScript = scriptDraft !== null
                  && (scriptSaved === null || scriptDraft.source !== scriptSaved.source || scriptDraft.name !== scriptSaved.name)
                if (dirtyScript && !window.confirm(scriptDraft.isNew ? '放弃这条新脚本？' : '放弃未保存的修改？')) return
                setScriptDraft(null)
                setScriptSaved(null)
                setRunReport(null)
                setView('variables')
              },
            }, '← 返回'),
            h('h2', { key: 'title', className: 'dsh-prompt-manager__headTitle' },
              scriptDraft.isNew ? '新建脚本' : `脚本「${scriptDraft.name}」`),
            h('span', { key: 'spacer', className: 'dsh-prompt-manager__headSpacer' }),
            h('span', { key: 'state', className: 'dsh-prompt-manager__note' },
              scriptDraft.fileSha1 === null ? '尚未保存' : '已保存'),
          ]),
          h('div', { key: 'form', className: 'dsh-prompt-manager__surface' }, [
            // `--grow` fills the width of a `__fields` row. Put straight into the
            // column `__surface` it fills the *height* instead, which is the blank
            // gap that used to sit under this input.
            h('div', { key: 'fields', className: 'dsh-prompt-manager__fields' }, [
              h('label', { key: 'name', className: 'dsh-prompt-manager__field dsh-prompt-manager__field--grow' }, [
                '脚本名（小写字母、数字、连字符；它就是文件名）',
                h('input', {
                  key: 'input',
                  value: scriptDraft.name,
                  placeholder: 'toolchain',
                  disabled: !writable || busy || !scriptDraft.isNew,
                  onChange: (event) => setScriptDraft({ ...scriptDraft, name: event.target.value }),
                }),
              ]),
            ]),
            h('div', { key: 'body', className: 'dsh-prompt-manager__pane' }, [
              h('span', { key: 'label', className: 'dsh-prompt-manager__paneLabel' },
                '脚本正文：打印一个 JSON 对象，键就是提示词里能用的变量名'),
              h('textarea', {
                key: 'textarea',
                value: scriptDraft.source,
                disabled: !writable || busy,
                spellCheck: false,
                onChange: (event) => setScriptDraft({ ...scriptDraft, source: event.target.value }),
              }),
            ]),
            syntax === null ? null : h('span', {
              key: 'syntax',
              className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error',
            }, `语法错误：${syntax}`),
            h('div', { key: 'actions', className: 'dsh-prompt-manager__actions' }, [
              h(Button, { key: 'run', disabled: !writable || busy || syntax !== null, onClick: () => { void testScript() } }, '运行一次（测试）'),
              h(Button, {
                key: 'save',
                variant: 'primary',
                disabled: !writable || busy || syntax !== null,
                onClick: () => { void saveScript() },
              }, '保存并启用'),
              scriptDraft.isNew
                ? null
                : h(Button, { key: 'remove', variant: 'danger', disabled: busy, onClick: () => { void removeScript(scriptDraft.name) } }, '删除脚本'),
            ]),
            h('span', { key: 'hint', className: 'dsh-prompt-manager__note' },
              '「运行一次」跑的是上面这个框里的内容：同一条命令、同一个目录，但写成临时文件跑完就删，不写正式文件、不注册变量，所以随便试都不会动到正在生效的值。保存会先跑一遍，跑不出可用输出就不会落盘。想验已经保存的文件本身，用变量页那一行的「运行一次」。'),
          ]),
          h(RunReport, { key: 'report', report: runReport }),
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

      // ── the variables page ──────────────────────────────────────────────────

      if (view === 'variables') {
        const variableRows = variables.map((variable) => h('div', {
          key: variable.name,
          className: 'dsh-prompt-manager__card',
        }, [
          h('div', { key: 'main', className: 'dsh-prompt-manager__cardMain', style: { cursor: 'default' } }, [
            h('span', { key: 'name', className: 'dsh-prompt-manager__title' }, `{{${variable.name}}}`),
            h('span', { key: 'value', className: 'dsh-prompt-manager__meta' }, variable.value),
            h('span', { key: 'refs', className: 'dsh-prompt-manager__meta' },
              variable.referencedBy.length === 0
                ? '还没有提示词引用它'
                : `被引用：${variable.referencedBy.join('、')}`),
          ]),
          h('div', { key: 'side', className: 'dsh-prompt-manager__cardSide' }, [
            h('span', { key: 'source', className: 'dsh-prompt-manager__badge' },
              SOURCE_LABELS[variable.source] === undefined ? variable.source : SOURCE_LABELS[variable.source]),
            variable.detail === undefined
              ? null
              : h('span', { key: 'detail', className: 'dsh-prompt-manager__meta' }, variable.detail),
            h(Button, { key: 'copy', disabled: busy, onClick: () => copyVariable(variable.name) }, '复制引用'),
            // The insert target is whichever entry's editor is open behind this
            // page, so the label names it: a button that silently edits an
            // invisible draft is worse than no button.
            draft === null
              ? null
              : h(Button, {
                key: 'insert',
                disabled: busy || !writable,
                onClick: () => { insertVariableHere(variable.name) },
              }, `插入到「${draft.title.length > 8 ? `${draft.title.slice(0, 8)}…` : draft.title}」`),
          ]),
        ]))

        const scriptCards = scripts.map((script) => h('div', {
          key: script.name,
          className: 'dsh-prompt-manager__source',
        }, [
          h('div', { key: 'head', className: 'dsh-prompt-manager__sourceHead' }, [
            h('span', {
              key: 'dot',
              className: script.error === undefined
                ? 'dsh-prompt-manager__dot'
                : 'dsh-prompt-manager__dot dsh-prompt-manager__dot--error',
              'aria-hidden': 'true',
            }),
            h('span', { key: 'name', className: 'dsh-prompt-manager__sourceRepo' }, script.name),
            h('span', { key: 'meta', className: 'dsh-prompt-manager__meta' }, [
              script.variables.length === 0 ? '还没有变量' : script.variables.map((name) => `{{${name}}}`).join(' '),
              script.ranAt === undefined ? '还没成功运行过' : `上次运行 ${stamp(script.ranAt)}`,
              script.pending === true ? '文件已改动，待重测' : '',
            ].filter((part) => part.length > 0).join(' · ')),
            h('span', { key: 'spacer', className: 'dsh-prompt-manager__headSpacer' }),
            h('div', { key: 'actions', className: 'dsh-prompt-manager__sourceActions' }, [
              h(Button, { key: 'run', disabled: busy, onClick: () => { void runScript(script.name) } }, '运行一次'),
              h(Button, { key: 'edit', disabled: busy, onClick: () => { void openScript(script.name) } }, '编辑'),
              h(Button, { key: 'remove', variant: 'danger', disabled: busy, onClick: () => { void removeScript(script.name) } }, '删除'),
            ]),
          ]),
          script.error === undefined
            ? null
            : h('span', { key: 'error', className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error' }, script.error),
        ]))

        return h('div', { className: 'dsh-prompt-manager' }, [
          h('div', { key: 'head', className: 'dsh-prompt-manager__head' }, [
            h(Button, {
              key: 'back',
              variant: 'ghost',
              disabled: busy,
              // Through the same guard the editor uses: a body edited from this
              // page (an inserted reference) must not vanish without a word.
              onClick: () => { back(); setRunReport(null) },
            }, '← 返回'),
            h('h2', { key: 'title', className: 'dsh-prompt-manager__headTitle' }, '提示词变量'),
            h('span', { key: 'spacer', className: 'dsh-prompt-manager__headSpacer' }),
            h(Button, { key: 'refresh', disabled: busy, onClick: () => { void refreshScripts() } }, '重新测量'),
          ]),
          h('p', { key: 'lede', className: 'dsh-prompt-manager__intro' },
            '变量是提示词里那段大括号引用的来源：系统事实由插件注册，脚本由你写。一条脚本打印一个 JSON，键就是变量名，所以一条脚本能提供多个变量；它跑在独立子进程里，超时或报错都伤不到 DSH 本身。'),
          variableReport !== null && typeof variableReport.error === 'string'
            ? h('p', { key: 'error', className: 'dsh-prompt-manager__status dsh-prompt-manager__status--error' }, variableReport.error)
            : null,
          variableRows.length === 0
            ? h('div', { key: 'empty', className: 'dsh-prompt-manager__empty' }, '还没有注册任何变量。')
            : h('div', { key: 'vars', className: 'dsh-prompt-manager__list' }, variableRows),
          h('div', { key: 'scripts', className: 'dsh-prompt-manager__block' }, [
            h('span', { key: 'label', className: 'dsh-prompt-manager__paneLabel' }, `脚本（${String(scripts.length)}）`),
            scripts.length === 0
              ? h('div', { key: 'none', className: 'dsh-prompt-manager__empty' }, '还没有脚本。点「新建脚本」会给你一个能直接跑的模板。')
              : h('div', { key: 'cards', className: 'dsh-prompt-manager__list' }, scriptCards),
            h('div', { key: 'addRow', className: 'dsh-prompt-manager__addRow' }, [
              h(AddButton, { key: 'add', disabled: !writable || busy, onClick: () => { void openScript(null) } }, '新建脚本'),
            ]),
          ]),
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
            h(AddButton, {
              key: 'variables',
              icon: 'IconEditOutline16',
              disabled: busy,
              onClick: () => { setView('variables'); setRunReport(null) },
            }, `变量（${String(knownVariables.length)}）`),
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
