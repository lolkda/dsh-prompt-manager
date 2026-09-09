# dsh-ctf-prompt

把一段 CTF / 竞赛模式的 agent 契约作为 **system prompt section** 注入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

提示词正文放在 [contract.md](contract.md)，插件在挂载时读取它，所以改文案不用动代码。

## 为什么用插件而不是 AGENTS.md

DSH 里两种注入方式落在不同的通道：

| 方式 | 落点 | 声明优先级 |
|---|---|---|
| `ctx.systemPrompt.section()`（本插件） | system prompt 正文 | 高 |
| `AGENTS.md` / `CLAUDE.md` | 对话里的 user 角色 `<system-reminder>` | DSH 明确声明「不覆盖 system 指令」 |

插件注册的 section 会和 harness identity、persona、工具指引拼成同一段 system prompt，因此权威性和它们完全等同。需要「必须遵守」的契约时用这个；描述性的项目知识仍然放 `AGENTS.md` 更合适。

## 安装

### 方式 A：按相对路径挂载（不用发布、不用装包）

把仓库放到 profile 目录下，例如：

```bash
git clone https://github.com/lolkda/dsh-ctf-prompt "$DSH_HOME/profiles/web/vendor/dsh-ctf-prompt"
cd "$DSH_HOME/profiles/web/vendor/dsh-ctf-prompt" && npm install   # 需要构建时
```

`lib/` 已随仓库提交，所以不装依赖也能直接挂载；只有改过 `src/` 才需要重新 `npm run build`。

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: ctf-prompt
      name: './vendor/dsh-ctf-prompt/lib/index.js'
      config:
        order: 10
```

loader 用 `new URL(name, ctx.baseUrl)` 解析前导 `./`，而 `ctx.baseUrl` 就是 profile 目录，所以这个路径指向 `$DSH_HOME/profiles/web/vendor/dsh-ctf-prompt/lib/index.js`。

### 方式 B：按包名挂载

```bash
cd "$DSH_HOME/profiles/web"
pnpm add github:lolkda/dsh-ctf-prompt
```

```yaml
- insert:
    - id: ctf-prompt
      name: 'dsh-ctf-prompt'
      config:
        order: 10
```

## 配置

| 字段 | 默认值 | 说明 |
|---|---|---|
| `order` | `10` | section 排序号。`0` 是 persona，`500` 是 plan-mode，`1000+` 是各工具的使用指引，所以 `10` 落在 persona 之后、plan-mode 之前 |
| `sectionName` | `user:ctf-contract` | 注册名。同一层里重名会直接抛错；agent 预设注册同名可以影子覆盖它 |
| `text` | 空 | 直接给一段文本，替代 `contract.md` |
| `contractPath` | 空 | 换成另一个 markdown 文件的绝对路径 |
| `complete` | `false` | 设为 `true` 时这一段会**取代整个 system prompt**（同时只能有一个生效），其余 section 全部消失 |
| `environment` | `true` | 注册下面那组环境变量。契约里用不到、或别的行已占用这些名字时设为 `false` |
| `variables` | 空 | 额外的 `{{名字}}` 变量，键值对形式。名字要满足 `[a-z][a-z0-9_]*`，不能和已注册的重名 |
| `environmentLine` | `false` | 设为 `true` 时，自动在契约前加一行运行环境事实，不用改 `contract.md` |

## 变量

section 文本在每次组装时做 `{{变量}}` 插值，所以提示词里可以写实时事实。DSH 自己注册了 `{{model}}`、`{{cwd}}`、`{{provider}}`；本插件另外注册：

| 变量 | 本机实测值 | 来源 |
|---|---|---|
| `{{os}}` | `Windows` | 友好平台名（`win32` → Windows，`darwin` → macOS，`linux` → Linux） |
| `{{os_release}}` | `10.0.19045` | `os.release()`：Windows 构建号 / Linux 内核版本 / macOS Darwin 版本 |
| `{{platform}}` | `win32` | `process.platform` |
| `{{arch}}` | `x64` | `process.arch` |

用法一：直接写进 `contract.md`，比如在开头加一行

```markdown
Runtime environment: {{os}} ({{platform}}, {{arch}}).
```

用法二：一行都不改，靠配置自动加

```yaml
config:
  environmentLine: true   # 渲染成 "Runtime environment: Windows (win32, x64), OS release 10.0.19045."
```

用法三：补自己的变量（例如把 shell 也说清楚）

```yaml
config:
  variables:
    shell: 'PowerShell 7 (pwsh)'
```

```markdown
Shell: {{shell}}.
```

**插值是严格的**：引用未注册的变量、或注册了但 provider 返回 `undefined`，`assemble()` 直接抛错，不会渲染成空串，而且**没有转义语法**（想输出字面 `{{` 目前做不到）。所以给 `contract.md` 加 `{{...}}` 之前，先确认对应变量已经注册。

## 验证

挂载后新开一个会话，看开场是否出现 `## CTF Core Contract`。也可以确认这一行确实被组合进了配置：

```bash
dsh --profile web --dump-config
```

仓库自带一个 smoke test，它把插件挂进真实的 `SystemPrompt` 注册表并跑一次 `assemble()`，断言 section 落在 persona 之后、契约文本进入渲染结果、四个环境变量能正常插值、未注册变量会抛错：

```bash
DSH_PACKAGES="$DSH_HOME/profiles/node_modules/@deepseek-ai" node test/smoke.mjs
```

它按「本文件 → 当前目录的 `node_modules` → `DSH_PACKAGES`」三级解析 DSH 包，所以在 profile 目录下直接 `node /path/to/dsh-ctf-prompt/test/smoke.mjs` 也能跑。

## 注意

- **契约里可以写 `{{变量}}`**，但引用的名字必须已注册。smoke test 会用默认配置把契约完整渲染一遍，未注册的引用会让它直接失败。
- **`sectionName` 不能和已注册的重名**（例如 `deployment:persona`、`harness:identity`、`app:web-surface`），否则挂载即失败。变量名同理。
- **改 `cordis.patch.yml` 会热加载**（该 profile 是 `patchReload: live`）；新增 `.js` 文件后建议重启 profile。
- **KV cache**：section 文本或顺序一变，缓存前缀从该点失效。契约文本稳定时开销只有一次。

## 结构

```
contract.md                提示词正文（唯一需要改的文件）
src/index.ts               插件源码（TypeScript）
lib/index.js               构建产物，loader 实际加载的文件
lib/types/index.d.ts       构建产出的类型声明
test/smoke.mjs             冒烟测试（跑的是构建产物）
examples/cordis.patch.yml  可直接抄进 profile 的 patch 行
tsconfig.json              构建与类型检查配置
```

## 开发

源码是 TypeScript，`lib/` 由 `tsc` 生成：

```bash
npm install          # 装 typescript 与 DSH 类型包；prepare 会自动构建一次
npm run build        # src/index.ts -> lib/index.js + lib/types/index.d.ts
npm run typecheck    # tsc --noEmit
npm test             # 先构建，再把插件挂进真实 SystemPrompt 注册表跑一次 assemble()
```

`lib/` 是提交进仓库的，所以克隆下来就能按相对路径挂载，不需要本地工具链。改完源码记得 `npm run build` 并一起提交。

运行时产物只 import `node:fs` / `node:url` 两个内置模块，不依赖任何 DSH 包；DSH 的两个包只是 devDependencies，用来取 `Context` 与 `PromptSection` 的类型。构建产物里的类型声明来自 `lib/types/index.d.ts`，`package.json` 的 `exports` 里已经配好 types 条件。

## License

MIT
