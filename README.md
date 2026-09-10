# dsh-prompt-manager

把提示词作为 **system prompt section** 注入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH），并在 Web GUI 的 **设置 → 提示词** 里管理它们：开关、排序、新增、删除、改正文（markdown）。

提示词是一份**列表**，每条一个条目：

| 部分 | 存在哪 | 谁在改 |
|---|---|---|
| 索引（标题 / 顺序 / 开关） | `$DSH_HOME/settings.yaml` 的 `prompt-manager:` 段 | 设置页，或手改文件 |
| 正文（markdown） | `$DSH_HOME/prompt-manager/sections/<id>.md` | 设置页，或任意编辑器 |

插件**只内置一条**提示词：机器环境（系统 / shell / 工具链版本，值由变量在挂载时探测填充）。其余提示词自己写，或从可订阅的仓库拉（见下节）。一份现成的提示词包在 [lolkda/dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack)，里面是 CTF 作业契约和 FastCtx 工具路由两份。

## 从 1.x 升级（2.0.0）

2.0.0 把插件从「CTF 契约注入器」改名成通用的提示词管理器，插件名与仓库名一起从 `dsh-ctf-prompt` 换成了 `dsh-prompt-manager`（GitHub 上旧地址会 301 跳转），身份字符串也跟着换了：包名 / 插件名 `dsh-prompt-manager`、settings 命名空间 `prompt-manager`、正文目录 `$DSH_HOME/prompt-manager/sections`、section 名 `user:prompt-manager:*`（原来 `user:ctf-contract` / `user:fastctx-routing`）。升级要动三处：

1. 挂载行改成 `name: './vendor/dsh-prompt-manager/lib/index.js'`，vendor 目录跟着改名。
2. `settings.yaml` 里的 `ctf-prompt:` 段改名成 `prompt-manager:`，里面的 `entries` 不用动。
3. `$DSH_HOME/ctf-prompt/sections/*.md` 挪到 `$DSH_HOME/prompt-manager/sections/`。

三处不改也能跑，只是旧的开关和覆盖文件不会被读（等于退回组合里的默认值）。

同一次改名里，插件不再内置 `contract` / `fastctx` 两条种子条目：`contract.md` 与 `fastctx.md` 从仓库移出，变成 [dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack) 这份可订阅的包。老配置里 `entries` 还写着这两条 id 的话，删掉它们、换成订阅或自建条目即可（正文文件在 `sections/` 里的话照旧按 id 生效）。

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
git clone https://github.com/lolkda/dsh-prompt-manager "$DSH_HOME/profiles/web/vendor/dsh-prompt-manager"
```

`lib/` 与 `client/` 都已随仓库提交，所以不装依赖也能直接挂载；只有改过 `src/` 或 `client/` 才需要重新构建。

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: prompt-manager
      name: './vendor/dsh-prompt-manager/lib/index.js'
      config:
        environment: true
```

loader 用 `new URL(name, ctx.baseUrl)` 解析前导 `./`，而 `ctx.baseUrl` 就是 profile 目录，所以这个路径指向 `$DSH_HOME/profiles/web/vendor/dsh-prompt-manager/lib/index.js`。

### 方式 B：按包名挂载

```bash
cd "$DSH_HOME/profiles/web"
pnpm add github:lolkda/dsh-prompt-manager
```

```yaml
- insert:
    - id: prompt-manager
      name: 'dsh-prompt-manager'
      config:
        environment: true
```

## 设置页

打开 **设置 → 提示词**（侧栏位置由 `settings.section` 的 order 60 决定，排在 General / Models / Plugins / Agent presets / 市场之后）。

页面是三个视图（设置面板很窄，一次只做一件事）：

- **列表**：三个 tab（全部 / 本地 / 订阅）做分层；每条一行 = 标题 + 注入开关 + 右侧「⋯」菜单（编辑 / 删除）。订阅来的条目带「订阅」徽标、metadata 里写明来源。点标题或「编辑」进入编辑器页面。右上角是「新增提示词」和「来源」。没有任何条目时，列表提示去点「新增提示词」。
- **编辑器页面**：整个区域切成编辑器 —— 左上角「← 返回」，然后是标题、顺序、只读的 id 与正文状态、Markdown 正文 textarea、实时预览（用 shell 自带的 `MarkdownText` 渲染），底部「保存修改」。**订阅条目的正文只读**，另有「fork 成本地条目」把它复制成一条可编辑的本地条目。返回时会确认未保存修改；新增提示词也直接进这个页面。
- **来源页面**：订阅源的增删、检查更新、应用、还原，见下节。

生效时机：**下一个模型步骤**。`systemPrompt.assemble()` 每个 agent step 调用一次，section 文本每次现算，所以开关、排序、正文都在下一轮对话生效，**不需要重启**。唯一需要重启的是浏览器半边本身（见「注意」）。

持久化：只有 `http://127.0.0.1:...` 打开页面时索引才写进 `settings.yaml`；用局域网地址打开时 DSH 的设置通道退化为内存模式，页面会显示只读。

删除对任何条目都可用：删掉一条就是把它从索引里移除、连它的正文文件一起删掉。手改 `settings.yaml` 时要注意：settings 的分层合并对数组是「上层整体覆盖」，所以用户层写下的 `entries` 数组就是最终列表。

## 订阅 GitHub 仓库

一个**来源** = 一个仓库 + 一个 ref。在 **来源** 页面填 `owner/name`、ref（分支 / tag / commit）和可选的镜像，点「添加来源」；它接上就会检查一次，之后**只在你自己点「检查更新」时**才联网。

### 仓库要长什么样

仓库根目录必须有一份 `prompt-manager.json`（[dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack) 根目录那份就是示例）：

```json
{
  "prompts": [
    { "file": "contract.md", "title": "CTF 契约", "order": 10 },
    { "file": "fastctx.md", "title": "FastCtx 工具路由", "order": 20 }
  ]
}
```

`id` 缺省取文件名，`title` / `order` / `enabled` 都可以不写。没有这份清单就直接报错 —— 因为**列举目录要么走 GitHub Contents API（有配额，且未认证时 60/小时），要么解析整仓 tarball**，而"作者多写一个文件"比这两种代价都低。清单是远端内容，所以每个字段都会被校验：非法路径、`..`、非 `.md`、重复文件、超过 50 条都会被拒绝。

### 手动更新的四步

1. **检查更新** —— 分支先用 `github.com/<repo>/commits/<ref>.atom` 拿 head sha（**零 API 配额**）；sha 没变就直接说"已是最新"，不发文件请求。变了（或 ref 是 tag/commit）才逐个文件发条件请求（`If-None-Match`），304 复用本地。
2. **看变更** —— 每个文件一行：`prompts/a.md  +14 / −3`，带勾选框（默认全选）。远端删掉的文件标「（删除）」。
3. **应用** —— 旧正文进 `previous/`，暂存内容覆盖 `current/`，写回 `state.json`，然后补上新条目：**新条目默认关闭**，打开开关后才会注入。
4. **还原** —— 一次撤销：把上一次应用覆盖掉的文件放回去（记在 state 的 undo 账本里，所以被删的文件会连同标题/顺序/开关一起回来）。

订阅条目的正文只读（想改就 fork），标题、顺序、开关照旧可改；源被删掉时它的条目会一起移除。

### 通道

| 环节 | 走法 |
|---|---|
| 变化探测 | `https://github.com/<repo>/commits/<ref>.atom`（直连，不消耗 API 配额） |
| 取正文 | `<镜像>/https://raw.githubusercontent.com/...` 或 `{url}` 模板；带 `If-None-Match` |
| 代理 | `none` 用默认 fetch（**已经自动继承 DSH 启动器从环境变量装好的全局代理**）；`http` 用 undici `ProxyAgent`；`socks5` 用 undici 自带的 `Socks5ProxyAgent`（profile 树里已有，零新增依赖） |

镜像**只作用于 `raw.githubusercontent.com`**：`api.github.com`、`codeload.github.com` 一律直连，因为镜像的路由表不是插件能假设的（实测 `gh-proxy.lolkda.top` 正是只放行 `github.com` / `raw.githubusercontent.com` / `gist.*`，其余路径返回它自己的 404 页）。镜像返回 HTML 页面时会被识别出来并报错，绝不会把一张错误页当成提示词暂存下来。

代理和镜像是**全局一份**，写在 `settings.yaml` 的 `prompt-manager` 段里：

```yaml
prompt-manager:
  mirror: 'https://gh-proxy.example'      # 空 = 不过镜像
  proxy: { kind: socks5, url: 'socks5://127.0.0.1:1080' }
  sources:
    - id: lolkda-prompts                   # 从 owner/repo 派生，可手改
      repo: lolkda/prompts
      ref: main
      mirror: ''                           # 空 = 沿用全局
      enabled: true
```

### 文件布局

```
$DSH_HOME/prompt-manager/
  sections/<id>.md                        本地条目正文
  sources/<slug>/current/<file>.md        订阅正文快照（只读来源）
  sources/<slug>/previous/<file>.md       上一次应用替换掉的版本
  sources/<slug>/staging/<file>.md        检查下载完、还没应用的正文
  sources/<slug>/state.json               应用时间、head sha、逐文件 sha1/etag、undo 账本
```

## 配置

插件不带提示词，所以这里只剩它注册的变量和正文目录；排序、section 名、正文本身都是**每条自己的事**，写在索引里、在设置页里改（section 名固定为 `user:prompt-manager:<id>`）。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `environment` | `true` | 注册下面那组环境变量。没有条目用到、或别的行已占用这些名字时设为 `false` |
| `variables` | 空 | 额外的 `{{名字}}` 变量，固定值，键值对形式。名字要满足 `[a-z][a-z0-9_]*`，不能和已注册的重名 |
| `probes` | 空 | 挂载时跑一次的命令，每个命令注册一个变量（见下节）。名字规则同 `variables`，最多 64 项 |
| `probeDefaults` | `true` | 同时运行包内自带的探测默认值（`pwsh` / `bash` / `git` / `node` / `python`），内置条目靠它们解析变量。设为 `false` 只跑 `probes` 里写的 |
| `probeTexts` | 英文占位符 | 探测没拿到版本时用的文案，可覆盖 `missing` / `empty` / `timeout` / `skipped` |
| `probeBudgetMs` | `8000` | 整轮探测的时间上限，超出的探测直接记 `skipped` 文案，不再执行 |
| `storeDir` | `$DSH_HOME/prompt-manager` | 正文文件所在目录（插件在其中使用 `sections/` 子目录）。`$DSH_HOME` 取值规则：显式 `storeDir` > 非空 `$DSH_HOME` > `~/.dsh` |

## 内置条目

包里只有一条：`environment.md`（id `env`，标题「机器环境」，order 5）。正文是随包发布的 markdown 文件，索引放在 settings 的 **base 层**，所以新装起来打开设置页就能看到它、能拨开关、也能编辑。`id` 相同时的取值优先级：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 订阅快照 | 该 id 来自订阅源时，正文只读，跟随上游 |
| 2 | 本机正文文件 | `sections/env.md` 存在就用它 —— 在设置页保存正文即写到这儿 |
| 3 | 包内正文 | 上面都没有时的默认内容（设置页会标「插件内置正文，保存即覆盖」） |

两点要知道的：

- **关掉**在设置页把开关拨掉即可。**删掉**会往 user 层写一份不含该 id 的 `entries` 数组，base 层随之被整体遮蔽 —— 想恢复就在 `settings.yaml` 里删掉 `prompt-manager.entries` 这一项，或手写回一条 `{id: env, title: 机器环境, order: 5, enabled: true}`。
- 部署**没有 settings 服务**时也照样注入（此时索引就是内置条目本身），不会被静默丢掉。

内置正文引用的 `{{...}}` 由包内自带的探测默认值提供（下一节），所以开箱即可渲染。反过来，把 `probeDefaults` 关掉却留着这条条目，组装会因为未注册的变量直接抛错 —— 两者是一对。

## 探测：把工具版本变成变量

想写「这台机器上 Git 是几版、有没有 Rust」，手写会过期。`probes` 让插件在**挂载时**跑一遍命令，把结果注册成变量。包内已经带了一组默认探测（`pwsh` / `bash` / `git` / `node` / `python`，正是内置条目用到的那几个），下面的写法是覆盖或补充它们：

```yaml
config:
  probes:
    pwsh:   { command: pwsh,   args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] }
    git:    { command: git,    args: ['--version'], pattern: '([0-9]+\.[0-9]+\.[0-9]+)' }
    node:   { command: node,   args: ['--version'], pattern: 'v?([0-9.]+)' }
    python: { command: python, args: ['--version'], pattern: '([0-9.]+)' }
    rust:   { command: rustc,  args: ['--version'] }
  probeTexts: { missing: '无' }
```

```markdown
- Git {{git}}，Node {{node}}，Python {{python}}，Rust {{rust}}
```

| 字段 | 说明 |
|---|---|
| `command` | 可执行名（走 `PATH`）或绝对路径。不在 `PATH` 上的工具必须写绝对路径 |
| `args` | 固定参数数组，默认不经 shell 传递 |
| `shell` | 经平台 shell 执行。Windows 上 `npm` / `pnpm` 这类 `.cmd` 垫片必须设 `true`（不经 shell 直接起会 `EINVAL`） |
| `pattern` | 可选正则，取第一个捕获组当值；匹配不上就退回整行 |
| `timeoutMs` | 这一项的超时，默认 1500 |

取值规则，四种结果都是**有值的字符串**：

| 情况 | 值 |
|---|---|
| 有输出 | `stdout` 或 `stderr` 的第一条非空行，套 `pattern` 后截断到 120 字符（`java -version` 这类版本走 stderr，一样能取到） |
| 进程起不来（`ENOENT` / `EINVAL`，或 shell 报 127 / 9009） | `missing` 文案，默认 `(not installed)` |
| 起来了但什么都没印（例如 Windows 上 `python3` 是个空壳） | `empty` 文案，默认 `(no output)` |
| 超时 / 预算用尽 | `timeout` / `skipped` 文案 |

几条要紧的话：

- **探测只在挂载时跑一次**。DSH 的变量 provider 是**每次组装同步求值**的，把命令放进去等于每个模型步骤都起一批子进程。所以装/卸了工具后，改一下这一行的 config（`patchReload: live` 会重挂它）或重启 profile 才会更新。实测一轮 5 项约 0.4 秒，全在本机跑。
- **`probes` 与默认值按名字合并**，config 里的同名项覆盖默认值（例如这台机器要把 `bash` 写成绝对路径，就在 `probes.bash` 里覆盖）。整组默认值用 `probeDefaults: false` 关掉。
- **占位符必须存在**。provider 返回 `undefined` 会让引用它的条目渲染失败，所以插件从不注册空值 —— 缺工具也是一个值。
- **名字被占了只警告、不炸**。别的行已经注册过同名变量时，这一项被跳过并写进日志；其余变量照常注册，挂载不受影响。
- **写错的配置会拒绝挂载**。变量名不合法、`probes` 不是键值对、缺 `command`、`pattern` 不是合法正则、超过 64 项 —— 这些是组合文件的错，直接抛错比留下一个渲染不了的 `{{名字}}` 好。
- **探测在宿主进程里执行，不经 DSH 的工具沙箱**。命令只来自组合配置（部署自己的文件），永不接受来自模型或页面的输入。

## 变量

section 文本在每次组装时做 `{{变量}}` 插值，所以提示词里可以写实时事实。**变量必须由某一行注册**：本部署里 `@deepseek-ai/*` 的包没有注册任何提示词变量，所以 `{{...}}` 认的就是下面这 4 个，加上 `variables` 和 `probes` 补进来的那些。

| 变量 | 本机实测值 | 来源 |
|---|---|---|
| `{{os}}` | `Windows` | 友好平台名（`win32` → Windows，`darwin` → macOS，`linux` → Linux） |
| `{{os_release}}` | `10.0.19045` | `os.release()`：Windows 构建号 / Linux 内核版本 / macOS Darwin 版本 |
| `{{platform}}` | `win32` | `process.platform` |
| `{{arch}}` | `x64` | `process.arch` |

用法一：直接写进条目正文（设置页的编辑框，或 `sections/<id>.md`），比如在开头加一行

```markdown
Runtime environment: {{os}} ({{platform}}, {{arch}}).
```

用法二：补自己的变量（例如把 shell 也说清楚）

```yaml
config:
  variables:
    shell: 'PowerShell 7 (pwsh)'
```

```markdown
Shell: {{shell}}.
```

**插值是严格的**：引用未注册的变量、或注册了但 provider 返回 `undefined`，`assemble()` 直接抛错，不会渲染成空串，而且**没有转义语法**（想输出字面 `{{` 目前做不到）。所以加 `{{...}}` 之前，先确认对应变量已经注册。

## 条件注入（已移除）

1.x / 2.0.0 早期版本会给 `fastctx` 这条种子条目做一层工具可见性门控：FastCtx MCP 没连上时，发一行降级文案而不是那 40 行「优先用 `mcp__fastctx__*`」的指令，免得模型去调不存在的工具。

种子条目移出仓库后这层门控也一起去掉了 —— 它原来只认死那条 `fastctx` 条目的 id，而订阅来的条目 id 是 `<来源 slug>-fastctx`，本来也管不到。现在一条条目就是一段正文，要么开要么关。如果 FastCtx 不一定在，把「优先用它」写成条件句（例如「如果 `mcp__fastctx__*` 工具可见，就用它……」）比让插件猜更靠得住。

## 插件路由

浏览器不能写 settings 之外的通道，所以正文和订阅源另走插件自己注册的一条 prefix 路由 `/prompt-manager`：

| 方法 + 路径 | 作用 | 网关 |
|---|---|---|
| `GET /prompt-manager/status` | `{ dir, writable, ids, variables }` | 仅 loopback 对端 |
| `GET /prompt-manager/body/<id>` | `{ body, source, sha1, fileSha1 }` | 仅 loopback 对端 |
| `PUT /prompt-manager/body/<id>` | 写入正文，body 是 `{ body, fileSha1 }`，上限 256 KiB | loopback + same-origin |
| `DELETE /prompt-manager/body/<id>` | 删除覆盖文件（= 恢复默认） | loopback + same-origin |
| `POST /prompt-manager/id` | 为新标题分配一个未占用的 id | loopback + same-origin |
| `GET /prompt-manager/sources` | 列出配置的来源及其磁盘状态 | 仅 loopback 对端 |
| `POST /prompt-manager/sources` | `{ repo, ref?, mirror? }` → `{ id, repo, ref, mirror }` | loopback + same-origin |
| `POST /prompt-manager/sources/<slug>/check` | 探测上游、把变更取进暂存区 | loopback + same-origin |
| `POST /prompt-manager/sources/<slug>/apply` | 应用，body 可带 `{ files: [...] }` 只应用子集 | loopback + same-origin |
| `POST /prompt-manager/sources/<slug>/revert` | 还原上一次应用 | loopback + same-origin |
| `DELETE /prompt-manager/sources/<slug>` | 删除来源，它导入的条目一起移除 | loopback + same-origin |

- **并发保护**：页面读到的 `fileSha1` 会随写入回传，文件在编辑期间被外部改动就返回 409，页面提示重载；新建条目用 `fileSha1: null` 表示"这个 id 必须还没有文件"。
- **`/status` 顺带回报变量表**：探测在挂载时跑完就固定了，`status` 里的 `variables` 是不用等一个模型步骤就能核对探测结果的地方。
- **路径安全**：`<id>` 必须匹配 `^[a-z0-9][a-z0-9-]*$`（最长 64 字符），解析后的路径必须仍在 `sections/` 里，否则 400，不会碰文件系统。
- **原子写**：先写临时文件再 `rename`，中断不会留下半截正文。
- **添加来源**：Host 只做三件事 —— 校验 `repo`/`ref`/`mirror`（`mirror` 只收 https 源，且不带凭据、查询、锚点）、分配一个未占用的 slug、把规范化后的三样回显给页面。来源列表本身仍由设置页写进 settings，和条目索引同一条通道，所以不存在第二个写入者。重复的 `repo@ref` 直接 409（同一个仓库导两遍会让条目翻倍），来源总数上限 20、每个来源最多 50 条提示词。
- 没有 web server 的组合（TUI / SDK profile）不会注册这条路由，设置页显示正文目录不可达，提示词注入本身不受影响。

## 验证

挂载后打开 **设置 → 提示词**：列表里应该是空的（或你已有的条目），点「新增提示词」写一条、打开开关，下一个模型步骤就能在开场看到它。也可以确认这一行确实被组合进了配置：

```bash
dsh --profile web --dump-config
```

仓库自带七个测试，跑的是构建产物：

```bash
DSH_PACKAGES="$DSH_HOME/profiles/node_modules/@deepseek-ai" npm test
```

- `test/smoke.mjs`：把插件挂进真实的 `SystemPrompt` 注册表，断言新装即注入内置的机器环境条目（含包内正文的静态校验、本机正文覆盖内置、base 层索引）、settings 驱动的增删开关与排序、正文来自本地文件 / 订阅快照 / 缺失三种情况、垃圾索引清洗、四个环境变量与严格插值、探测变量（含缺工具与撞名两种情况），以及真实 schemastery 能解析这份索引 schema。
- `test/probe.mjs`：探测的取值规则（stdout / stderr / 空输出 / 起不来 / 超时 / 预算用尽）、`pattern` 抽取与三种退回、截断、`probes` 配置的形状校验，末尾再用真 runner 跑两个真命令。
- `test/store.mjs`：id 语法、路径不外逃、`absent`/`sha1`/`any` 三种写入栅栏、256 KiB 上限、原子写不留临时文件、目录不可用时的降级。
- `test/routes.mjs`：用假 req/res 直打路由 handler，覆盖 loopback 与 same-origin 网关、409 栅栏、400/404/405 状态码、遍历 id、超大请求，新增来源的校验（repo / ref / mirror）与 slug 分配、重复来源与来源上限，以及订阅源的六个动作与「订阅正文只读」。
- `test/source.mjs`：仓库/ref/slug 语法、条目 id 派生（长 slug 下仍逐文件唯一）、清单校验（含路径遍历）、镜像的两种写法与 https-only、atom feed 取 head sha。
- `test/net.mjs`：起一个本地假镜像，验证 `<镜像>/<url>` 重写、条件请求 304、非 raw URL 直连、HTML 页面识别，以及不可达镜像/超时/不可达 http 与 socks5 代理各自的失败分类。
- `test/sync.mjs`：staging → current 的三槽轮转、逐文件增删行统计、部分应用、还原（连同被删文件与它的标题/开关）、以及无清单/HTML 镜像/网络失败/路径遍历四类拒绝。
- `test/client.mjs`：在 Node 里用桩模块 materialize `client/client.js`，用一个带状态的最小渲染器驱动：三个 tab 的分层、订阅徽标、来源页增删与变更块、订阅正文只读与 fork、开关写入 settings、编辑器进出的整条链路。

测试按「本文件 → 当前目录的 `node_modules` → `DSH_PACKAGES`」三级解析 DSH 包，所以在 profile 目录下直接 `node /path/to/dsh-prompt-manager/test/smoke.mjs` 也能跑。测试全部离线：网络那一层用本地假镜像或桩 fetcher 覆盖。

想验证真实链路（会联网），把 `lib/net.js` 的 `createFetcher` 指向你的镜像，对一个真仓库跑一次 `checkSource` 即可 —— 实测 `gh-proxy.lolkda.top` 上：raw 经镜像 200 带 ETag、同一文件条件请求 304、atom feed 直连拿到 head sha。

## 注意

- **条目正文里可以写 `{{变量}}`**，但引用的名字必须已注册。smoke test 会把一段带环境变量的正文完整渲染一遍，未注册的引用会让它直接失败。
- **section 名是派生出来的**：每条固定注册为 `user:prompt-manager:<id>`，所以只要 id 不重复就不会和 `deployment:persona`、`harness:identity`、`app:web-surface` 这类已注册的 section 撞名。变量名撞上别的行时，这一项被跳过并记一条警告，挂载照常进行 —— 但正文里那个 `{{名字}}` 就会让组装失败，所以看到警告要么改名，要么把引用删掉。
- **`package.json` 里的 `dsh.client` 和 `client/client.js` 必须同时存在**：只声明浏览器半边而没有 bundle，浏览器插件表在挂载时会直接报错。两者的包名必须都叫 `dsh-prompt-manager`。
- **改 `cordis.patch.yml` 会热加载**：`patchReload: live` 时 HMR 会为这个 patch 文件单独起一个精确 watcher，所以增删 row 不用重启。
- **改插件代码要重启**：DSH 不监听插件模块文件，而 loader 按 URL 缓存 ESM 模块。浏览器半边的包元数据（`dsh.client`）与 bundle 字节也在启动时快照，所以 `git pull` 或改完 `lib/`、`client/` 之后必须重启 profile 才生效。
- **改正文不用重启**：`sections/*.md` 每次组装现读；订阅正文在点过「应用」之后，也是下一次组装就生效。
- **KV cache**：section 文本或顺序一变，缓存前缀从该点失效。文本稳定时开销只有一次。

## 结构

```
src/index.ts                插件入口：设置索引注册、section 调和、变量、路由装配
src/entries.ts              条目模型、id 语法、settings schema、内置条目与包内正文
src/store.ts                正文文件存储（路径限定、原子写、sha1 栅栏）
src/source.ts               订阅源：slug/id 派生、清单校验、镜像拼接、URL 构造
src/probe.ts                挂载时探测：命令取值规则、配置校验、结果兜底、默认探测组
src/net.ts                  唯一出网口径：代理 dispatcher 与条件 GET
src/sync.ts                 源的三槽轮转：检查、应用、还原、state.json
src/subscriptions.ts        订阅引擎：源列表、检查/应用/还原、索引同步
src/routes.ts               /prompt-manager 路由与网关
client/client.js            浏览器半边（设置页），手写的懒加载 CJS 工厂 bundle
lib/                        构建产物，loader 实际加载的文件
test/smoke.mjs              宿主行为冒烟测试（跑的是构建产物）
test/store.mjs              存储测试
test/probe.mjs              探测测试（注入 runner，末尾两个真命令）
test/routes.mjs             路由测试
test/source.mjs             订阅源与清单测试
test/net.mjs                出网与代理测试（本地假镜像）
test/sync.mjs               检查/应用/还原测试
test/client.mjs             浏览器 bundle 测试
examples/cordis.patch.yml   可直接抄进 profile 的 patch 行
environment.md              内置的机器环境条目正文（随包发布，可被本机正文覆盖）
tsconfig.json               构建与类型检查配置
```

## 开发

源码是 TypeScript，`lib/` 由 `tsc` 生成；浏览器半边是手写的 JS bundle，`npm run build` 只做语法检查（`node --check`），不需要打包器，因为它只 `require` 平台模块表里已有的 `react` 与 UI primitives：

```bash
npm install          # 装 typescript 与 DSH 类型包；prepare 会自动构建一次
npm run build        # src/*.ts -> lib/*.js + lib/types/*.d.ts，并检查 client/client.js
npm run typecheck    # tsc --noEmit
npm test             # 先构建，再跑四个测试
```

`lib/` 与 `client/` 都提交进仓库，所以克隆下来就能按相对路径挂载，不需要本地工具链。改完源码记得 `npm run build` 并一起提交。

宿主产物只 import `node:crypto` / `node:fs` / `node:module` / `node:os` / `node:path` / `node:url` / `node:http` 这几个内置模块；settings 需要的那份 `@deepseek-ai/schemastery` 是**运行时按需解析**的（取不到就不注册设置命名空间，设置页无从编辑，宿主照常挂载空索引），DSH 的包都只是 devDependencies，用来取类型。

## License

MIT
