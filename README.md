# dsh-prompt-manager

[![ci](https://github.com/lolkda/dsh-prompt-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/lolkda/dsh-prompt-manager/actions/workflows/ci.yml)

把提示词作为 **system prompt section** 注入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH），并在 Web GUI 的 **设置 → 提示词** 里管理它们：开关、排序、新增、删除、改正文（markdown）。

正文里可以引用 `{{变量}}`。变量来自三类：插件注册的机器事实、挂载时跑的探测命令、你自己写的脚本（打印一个 JSON 对象，键就是变量名）。

除了 system prompt，这个插件还能替换 **DSH 压缩上下文时发给摘要模型的那条指令**（原本写死在 `dsh-compaction-basic` 里）—— 见「压缩指令」一节。

| 部分 | 存在哪 | 谁在改 |
|---|---|---|
| 索引（标题 / 顺序 / 开关 / 压缩指令指针） | `$DSH_HOME/settings.yaml` 的 `prompt-manager:` 段 | 设置页，或手改文件 |
| 组合（挑哪几条 / 用哪条压缩指令） | 同一段里的 `presets` / `activePreset` | 设置页的「组合」页，或聊天页输入栏的切换器 |
| 正文（markdown） | `$DSH_HOME/prompt-manager/sections/<id>.md` | 设置页，或任意编辑器 |
| 变量脚本 | `$DSH_HOME/prompt-manager/scripts/<name>.js` | 设置页的「变量」页，或任意编辑器 |

插件只内置一条提示词：机器环境（系统 / shell / 工具链版本，由变量在挂载时探测填充）。其余自己写，或从可订阅的仓库拉。一份现成的提示词包在 [lolkda/dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack)（CTF 作业契约 + FastCtx 工具路由）。

## 安装

三种装法，选一种。`lib/`、`client/`、`environment.md` 都随包发布，所以装完不需要本地工具链。

### 方式 A：`dsh plugin` 一条命令（推荐）

```bash
dsh plugin --profile web add github:lolkda/dsh-prompt-manager
```

这个命令把剩下的参数转给 profile 目录里的 pnpm，装完 DSH 会发现这个包的清单里声明了 `dsh.bundle.patch`，**自动把它加进 `dsh.profile.bundles`** 并应用包内那份 `cordis.patch.yml` —— profile 自己的 `cordis.patch.yml` 一个字都不用写。装完重启一次 profile。

发布到 npm 的同一条命令（`@lolkda/dsh-prompt-manager` 已上架）：

```bash
dsh plugin --profile web add @lolkda/dsh-prompt-manager
```

### 方式 B：相对路径挂载（离线 / 开发用，不装包）

```bash
git clone https://github.com/lolkda/dsh-prompt-manager "$DSH_HOME/profiles/web/vendor/dsh-prompt-manager"
```

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-prompt-manager
      name: './vendor/dsh-prompt-manager/lib/index.js'
```

loader 用 `new URL(name, ctx.baseUrl)` 解析前导 `./`，而 `ctx.baseUrl` 就是 profile 目录，所以这个路径指向 `$DSH_HOME/profiles/web/vendor/dsh-prompt-manager/lib/index.js`。

**两种方式二选一**：既装包又留这一行，插件会被挂载两次。不写 `config` 也可以 —— `environment` 默认就是开的，要关就在你自己的 patch 层里覆盖。

### 卸载

```bash
dsh plugin --profile web remove @lolkda/dsh-prompt-manager
```

删掉依赖后，DSH 下次启动会把它的层从 `dsh.profile.bundles` 里摘掉，重启 profile 生效。手写挂载（方式 B）删掉那一行、再删 vendor 目录即可。删包不动你的条目：正文在 `$DSH_HOME/prompt-manager/`，索引在 settings 里，都不属于这个包。

### 装完怎么确认

```bash
dsh --profile web --dump-config        # 组合出来的树里应该有一行 id: dsh-prompt-manager
curl -s http://127.0.0.1:3080/dsh-prompt-manager/status | head -c 200
```

再打开 **设置 → 提示词**，列表里应该有你已有的条目（或内置的「本机环境」那条）。

## 这个包读写什么、会起什么进程

按 DSH STORE 的四项访问轴逐项说明。汇总权限等级是 **`high`** —— 按商店的定义，"可访问任意网络、任意 Shell"即属此级，本插件两条都沾（下详）；这不是自谦也不是自夸，是照它的判定口径填的。**本插件不访问任何凭据**，理由见「凭据」一条。

- **文件（`files`）**：读 `$DSH_HOME/settings.yaml` 的 `prompt-manager:` 段（条目索引与组合）、`$DSH_HOME/prompt-manager/`（正文、脚本、订阅快照）；写也只有这两处 —— settings 段由页面通过 `scope.update` 写，正文与脚本先写临时文件再 `rename`，不留半截文件。**不写 `$DSH_HOME` 之外的任何路径**，不读环境变量的敏感项，不碰会话文件（会话内容不经本插件）。
- **网络（`network`）**：只有订阅源会出网（`fetch` 拉 `prompt-manager.json` 与正文，可配 https 镜像）。探测命令与变量脚本可能自行出网，那是**你配置的命令**在做，不是插件在做。不开监听端口，不做任何回连或遥测。
- **命令（`commands`）**：按你 settings 里的配置跑**探测命令**（默认 `pwsh`/`bash`/`git`/`node`/`python`，挂载时各跑一次）和**变量脚本**（`node <脚本文件>`，保存时 / 挂载时 / 你点「重新测量」时各跑一次）。命令、参数、脚本全部来自这份配置，**插件自己不带任何可执行文件**；删掉配置就没有任何进程被起。它们以 DSH 进程的权限运行，你怎么审自己写的脚本，就怎么审这里的配置。
- **凭据（`credentials`）**：**不读取、不存储、不转发任何凭据。** 具体地：不读环境变量里的 token/key、不读 git 凭据助手、不读 `~/.npmrc` 之类凭据文件、不发带认证头的请求。仓库里出现 `token`/`credential`/`password` 字样的地方只有两类，都不是凭据访问：`client/client.js` 里的 "token" 指**变量占位符**（`{{名字}}` 这种东西，与 React 的 key）和 README 发布章节里"**不放**任何 npm token（改走 OIDC）"的说明；`src/source.ts` 与 `src/routes.ts` 各有一处**守卫**，作用是**拒绝**带凭据的镜像 URL（`url.username`/`url.password` 非空即报错）。换句话说，凭据相关代码在这里是**拒收**逻辑，不是采集逻辑。
- **改请求**：只碰**压缩**那一次调用（见「压缩指令」一节）。监听 `llm/stream`，只在 `purpose === 'compaction'` 时把最后那条指令消息换成本插件里配置的正文；**普通对话请求一个字节都不动**。没配压缩指令时不注册任何替换动作。可以整体关掉：`compaction: false`。
- **HTTP**：注册一条 `/dsh-prompt-manager` 前缀路由，**仅 loopback 对端**（`127.0.0.0/8` / `::1`，且 `Host` 头也必须是 loopback 主机名 —— 挡 DNS rebinding）可用，写操作再加 same-origin。端点清单见 `src/routes.ts`。**它不是认证**：同机其它进程照样能调，边界是"别家网页进不来"，单用户工作机上够用。
- **生命周期脚本**：**没有** `preinstall`/`install`/`postinstall`/`prepare` 任何一项（`npm install` 不构建、git 安装也不构建，因为 `lib/`、`client/` 就是提交进仓库的构建产物）；只有 `prepublishOnly`，它只在**作者**执行 `npm publish` 时跑，装包的人永远不会触发。
- **外部运行依赖**：无。`dependencies` 为空，运行期只用 DSH 自己提供的服务（`systemPrompt`、`settingsScope`、`llm`）与 Node 内置模块；`lib/` 与 `client/` 都是自洽产物。
- **已知风险**（照实说，不粉饰）：
  - 那条 loopback 路由**不是认证**，同机任意进程都能调它读写你的提示词索引 —— 单用户工作机上够用，多用户/共享机器上不够。
  - 探测命令与变量脚本**以 DSH 的权限执行**，能力上限等于你给 DSH 的权限；恶意或手误的脚本能做的事，插件拦不住。
  - 订阅来的正文会**注入 system prompt**，等于让第三方仓库的内容进入你的模型上下文；只订阅你信得过的仓库，应用前先看 diff（来源页会列出变更文件与增删行数）。
  - 订阅条目默认只读，但**「fork 成本地条目」之后就是本地正文**，之后它的内容与来源仓库不再有关系。

## 设置页

**设置 → 提示词**（order 60，排在 General / Models / Plugins / Agent presets / 市场之后）：

- **列表**：三个 tab（全部 / 本地 / 订阅）分层；一行 = 标题 + 注入开关 + 右侧「⋯」菜单（编辑 / 删除）。订阅条目带「订阅」徽标，其中的 `owner/repo` 是指向上游仓库的真链接。底部是「新增提示词」「新增压缩指令」「订阅来源（N）」「变量（N）」「组合（N）」—— 固定两列一行，奇数个时最后一个占满整行，所以这一行不会随面板宽几个像素而变形。条目数到上限时「新增」直接拒绝并说明原因。标题下面那行说明末尾是插件自己的仓库链接和一句点星请求。
- **编辑器**：标题、顺序、只读 id、Markdown 正文 + 实时预览、可用变量芯片（点一下插到光标处）、未注册引用的警告，底部「保存修改」。**订阅条目的正文只读**，另有「fork 成本地条目」。
- **来源页 / 变量页 / 脚本编辑器 / 组合页**：分别见后面四节。

**生效时机是下一个模型步骤**：`systemPrompt.assemble()` 每个 agent step 调用一次，section 文本每次现算，所以开关、排序、正文都不需要重启。改插件代码另说，见文末「注意」。

**持久化**：只有从 `http://127.0.0.1:...` 打开页面时索引才写进 `settings.yaml`；用局域网地址打开时 DSH 的设置通道退化为内存模式，页面会显示只读。

**删除**一条 = 先删正文文件、再从索引移除（顺序有意：文件删不掉时索引不动，条目还在、还能重试）。

## 压缩指令

DSH 把上下文压成摘要时，会额外发一次模型调用：重放当前对话前缀，最后追加一条**指令消息**告诉摘要模型输出什么结构。这条指令原本写死在 `dsh-compaction-basic` 里，本插件让你把它换成自己写的一条 markdown —— 和普通条目一样有 id、有正文文件、能进组合包。

- **建一条**：列表页底部「新增压缩指令」。分配一个 id 并直接打开编辑页，**正文是空的** —— 这条指令要替换的是 DSH 自带的那一份，从这里读不到它，所以不预填骨架（照抄一份既是替别人的措辞做猜测，也会随上游改动过时；顺带一提，那样抄来的文字里只要出现 `{{...}}` 形状的字面量，就会被下面的引用校验直接拒绝保存）。**这是一份草稿：不保存就什么都不写**，直接返回不会在列表里留下空条目（离开前会确认一次，问的是「放弃这条新压缩指令？」）。空正文不会生效：指针照旧回退到 DSH 自带的那条。点「保存修改」时按一个顺序写三样：正文文件、索引里那条记录、根字段 `compaction` 指针。它不是 system prompt section：**不注册 section、不参与注入开关**，`order` 只影响列表排序。
- **改正文**：照常进编辑页写，正文里可以用 `{{变量}}`（插值规则与 section 相同，见「变量」一节；解析不了的引用按字面量写出去并记一条日志，绝不让那次压缩失败）。
- **指针什么时候会动**：只有三种动作写根字段 `compaction` —— 保存一条新建的压缩指令、点「设为当前／取消当前」、以及**删掉/改掉它正指着的那条**（删除或「转为普通段落」时指针在同一个动作里放掉，不留一个指不到东西的指针）。组合生效期间这三处都不碰根指针：组合的指针归「组合」页。
- **哪个生效**：根字段 `compaction: <id>` 决定；**有组合生效时由组合自己的 `compaction` 决定**（组合指向空 = 用 DSH 自带的，不会回退到根字段）。所以组合生效期间保存一条新指令，**不会**去动根指针 —— 那一下现在不决定任何事，却会在你哪天取消组合时突然生效；条目照建，到「组合」页把它选成那个组合的压缩指令才算数，页面保存后会直接这么说。指针指向不存在的条目、指向普通段落条目、或正文为空 → 回退到 DSH 自带指令并记一次日志。**永远不会有"空指令"发出去**。
- **在哪儿切**：列表页那行的「设为当前／取消当前」，或者「压缩 · …」芯片 —— 芯片的位置与「组合」一节说的那对芯片相同（空白会话在输入框那行，有内容后搬到「对话 / 轨迹」那一行的右侧），两个入口写的是同一个字段。
- **生效时机是下一次压缩**，不是下一个模型步骤 —— 压缩什么时候发生由 DSH 的阈值策略决定（默认上下文用到 80%）。想立刻验证：`/compact`，或把阈值调低。
- **导出组合**时，`compaction` 指针和它指向的正文一起进包；导入时指针跟着新 id 走，实在带不动（包没装这条）就把指针清空并明确报告，而不是留一个指不到东西的指针。
- **看它有没有真的生效**：列表页状态行显示 `压缩指令：<标题> · 已替换 N 次 · 最近 <时间>`（N 来自 `/dsh-prompt-manager/status` 的 `compaction` 字段）。摘要看起来"格式不一样"的时候，第一个该看的就是这行。
- **改不了的部分**：摘要落进会话时外面那层 `<compacted-summary>` 标签和「自动生成的检查点」前导语（`This is an automatically generated checkpoint …`）是后端在摘要返回**之后**自己拼的，不在这次请求里，所以拦不到。要改它们只能自己写一个压缩后端（实现 `CompactionEngine`）。本插件只替换**发给模型的指令**。
- **关掉**：`compaction: false`，所有压缩调用恢复原样。

## 组合

一个**组合** = 从现有条目里挑一组，起个名字。两个入口：

- **芯片两个位置，同一对芯片**：新会话还空着的时候（宿主那时不画会话标题栏）在**聊天页输入框下面**的工具行右侧（模型选择器左边）；发出第一条消息后搬到**「对话 / 轨迹」那一行的右侧**（会话标题行下面那一行，页面右上角那组图标的下方）。位置只在「空会话 → 有内容」这一下搬一次 —— 正文区滚动、输入框长高、回合在跑、压缩在跑，都不会再推动它，所以点它不会点空。两处都是「提示词 · …」和「压缩 · …」这两个，读同一个命名空间，不会各说各的：点开是全部组合和「不用组合（按每条开关）」，选中即切换。
- **设置 → 提示词 → 组合**：增删改、设为当前，每个组合用勾选清单挑成员。清单列**全部条目**（含关着的）—— 「把某条关掉的提示词临时打开」正是组合的用途。压缩指令不在成员清单里，改由组合自己的「压缩指令」选择器挑（见「压缩指令」一节）。

三点要紧的：

1. **组合生效时组合说了算**：每条自己的开关原样留着，但不参与判断；取消组合（或删掉当前组合）就回到那些开关。页面上会标出「组合：注入 / 不注入」，免得开关看起来坏了。
2. **切换是全局的**（写 `activePreset`，所有会话都跟着变），在**下一个模型步骤**生效，不需要重启、也不需要重注册 section。代价是 system prompt 变了，KV cache 前缀失效一次。
3. **组合管选哪些，不管顺序**：顺序仍是每条自己的 `order`。

`presets` 里可以写索引里还不存在的 id（订阅还没拉回来），组合页会标成「条目不存在」而不是替你删掉；组合生效时宿主也会在日志里点名一次。上限 20 个组合、每个 50 条成员。`activePreset` 指向不存在的组合时不会冻住提示词：回到单条开关并记一次警告。

### 组合包：把一个组合导出成文件

组合页每个组合的「⋯」菜单 + 页脚，导出得到 `prompt-manager-pack-<组合 id>.json`。包里装什么按"正文属于谁"分：

| 成员类型 | 包里放什么 | 为什么 |
|---|---|---|
| 本地 / 内置条目 | 正文**内联** | 除了这份文件没有别处能复现它 |
| 订阅条目 | 只记来源（`slug` + `repo` + `ref` + `file`） | 正文属于上游；导入方配上同一个仓库，正文自然就出来（同 repo ⇒ 同 slug ⇒ 同 id） |
| 指向已不存在条目的 id | 记进 `missing`，如实报告 | 这是在说"这个包不完整" |

导入时：**id 撞车就加后缀**（`env` → `env-2`，组合成员同步改写，所以同一个包导两次是两个集合）；**换了 id 的订阅条目放弃来源标记**（正文按 id 去上游找，id 变了就永远读不到，留着只读标记反而更糟）；**绝不导入脚本**（脚本是代码）；正文里有写法不合法的 `{{...}}` **整包拒绝**（那种正文一进索引每个步骤都会失败）；**先校验、再写正文、最后一次性写索引**，写正文中途失败会把已写的文件删掉。导入不会自动启用那个组合，也不会替你配来源。

## 订阅 GitHub 仓库

一个**来源** = 一个仓库 + 一个 ref。在**来源页**填 `owner/name`、ref（分支 / tag / commit）和可选镜像；它接上会检查一次，之后**只在你点「检查更新」时**才联网。

### 仓库要长什么样

根目录必须有一份 `prompt-manager.json`（[dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack) 根目录那份就是示例）：

```json
{
  "prompts": [
    { "file": "contract.md", "title": "CTF 契约", "order": 10 },
    { "file": "fastctx.md", "title": "FastCtx 工具路由", "order": 20 }
  ]
}
```

`id` 缺省取文件名，`title` / `order` / `enabled` 可以不写。要这份清单是因为列举目录要么消耗 GitHub API 配额、要么解析整仓 tarball，而"作者多写一个文件"代价最低。清单是远端内容，所以每个字段都校验：非法路径、`..`、非 `.md`、重复文件、超过 50 条都拒绝。

### 上游改了文件名怎么办

条目的 id 是**身份**（组合记的是它，正文也按它去来源里找），所以改名不能让 id 跟着变。三层保护：

1. **清单里写 `id`（最可靠）**：`{"file": "ctf.md", "id": "contract"}` —— 之后文件怎么改名、正文怎么改，本地 id 都不动。它还是**修复手段**：组合里记着已不存在的 id 时，在上游清单里把它写回来，检查 → 应用，那条成员就重新生效（人工给的标题 / 顺序 / 开关一起回来）。
2. **正文没变的改名会自动认出来**：一次检查里恰好一个文件被删、一个文件新增且正文 sha1 相同，就判定改名，新路径沿用旧 id，列表里标「由 prompts/contract.md 改名」。
3. **认不出来时不猜**：改名同时改了正文、或两个新文件正文一样无法判断谁继承身份 —— 按"删一条 + 加一条"处理并说明原因（要固定身份就回到第 1 条）。

改名在计划里是**一对变更**：只勾一行，应用时两行一起落（只应用一半会让两条记账共用一个 id）。id 真的变了时，你给旧 id 设的标题 / 顺序 / 开关会跟着搬到新 id。

### 手动更新的四步

1. **检查更新**：分支先用 `github.com/<repo>/commits/<ref>.atom` 拿 head sha（**零 API 配额**），没变就说"已是最新"；变了才逐文件发 `If-None-Match` 条件请求，304 复用本地。本地正文被手工删过时退回无条件请求取回来。
2. **看变更**：每文件一行 `prompts/a.md  +14 / −3`，带勾选框（默认全选）。远端删掉的标「（删除）」，认出的改名标「由 … 改名」。
3. **应用**：旧正文进 `previous/`，暂存覆盖 `current/`，写回 `state.json`，补上新条目 —— **新条目默认关闭**。
4. **还原**：一次撤销上一次应用（被删的文件连标题 / 顺序 / 开关一起回来）。

订阅条目的正文只读（想改就 fork），标题 / 顺序 / 开关照旧可改；来源被删时它的条目一起移除。把来源的 `enabled` 设成 `false` 是"先停对上游的动作、别动在用的正文"：检查 / 应用 / 还原都返回 409，已应用的条目照常注入。

### 通道与文件布局

| 环节 | 走法 |
|---|---|
| 变化探测 | `https://github.com/<repo>/commits/<ref>.atom`（直连，不消耗配额） |
| 取正文 | `<镜像>/https://raw.githubusercontent.com/...` 或 `{url}` 模板，带 `If-None-Match` |
| 代理 | `none` = 默认 fetch（已继承 DSH 启动器从环境变量装的全局代理）；`http` = undici `ProxyAgent`；`socks5` = undici 的 `Socks5ProxyAgent` |

镜像**只作用于 `raw.githubusercontent.com`**，`api.github.com` / `codeload.github.com` 一律直连。镜像返回 HTML 页面时会被识别并报错，绝不会把错误页当提示词暂存。代理与镜像全局一份，写在 `settings.yaml` 的 `prompt-manager` 段：

```yaml
prompt-manager:
  mirror: 'https://gh-proxy.example'      # 空 = 不过镜像
  proxy: { kind: socks5, url: 'socks5://127.0.0.1:1080' }
  sources:
    - id: owner-repo                       # 从 owner/repo 派生，可手改
      repo: owner/repo
      ref: main
      mirror: ''                           # 空 = 沿用全局
      enabled: true
```

```
$DSH_HOME/prompt-manager/
  sections/<id>.md                        本地条目正文
  scripts/<name>.js                       变量脚本（一条一个文件，输出一个 JSON 对象）
  scripts/.state.json                     每条脚本上次成功运行的 sha1 / 时间 / 变量值 / 退出码
  sources/<slug>/current/<file>.md        订阅正文快照
  sources/<slug>/previous/<file>.md       上一次应用替换掉的版本
  sources/<slug>/staging/<file>.md        检查下载完、还没应用的正文
  sources/<slug>/state.json               应用时间、head sha、逐文件 sha1/etag、undo 账本
```

## 配置

插件不带提示词，所以配置里只剩它注册的变量和正文目录；排序、section 名、正文本身都是每条自己的事（section 名固定为 `user:prompt-manager:<id>`）。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `environment` | `true` | 注册下面那组环境变量 |
| `variables` | 空 | 额外的固定值变量 `{{名字}}`。名字要满足 `[a-z][a-z0-9_]*`，不能和已注册的重名 |
| `probes` | 空 | 挂载时跑一次的命令，每个注册一个变量（见下节）。最多 64 项 |
| `probeDefaults` | `true` | 同时运行包内自带的探测默认值（`pwsh` / `bash` / `git` / `node` / `python`），内置条目靠它们解析变量 |
| `scripts` | 空 | 变量脚本的执行覆盖：`{ <脚本名>: { command, args, timeoutMs } }`，默认 `node <脚本>`、3 秒超时；`args` 里的 `{script}` 换成脚本绝对路径 |
| `probeTexts` | 英文占位符 | 探测没拿到版本时的文案，可覆盖 `missing` / `empty` / `timeout` / `skipped` |
| `probeBudgetMs` | `8000` | 整轮探测的时间上限，超出的记 `skipped` |
| `storeDir` | `$DSH_HOME/prompt-manager` | 正文所在目录（其中用 `sections/` 子目录）。`$DSH_HOME` 取值：显式 `storeDir` > 非空 `$DSH_HOME` > `~/.dsh` |
| `compaction` | `true` | 允许把压缩指令换成索引里指定的那条（见「压缩指令」一节）。默认值不改变任何行为：没配条目时压缩调用原样发出。设 `false` 可彻底关掉这个接缝 |

## 内置条目

包里只有一条：`environment.md`（id `env`，标题「机器环境」，order 5），索引放在 settings 的 **base 层**，所以新装起来打开设置页就能看到、能拨开关、也能编辑。同一个 id 的取值优先级：订阅快照 > 本机正文文件 `sections/env.md` > 包内正文。

- **关掉**：设置页拨开关。**删掉**：会往 user 层写一份不含该 id 的 `entries`（base 层被整体遮蔽）；想恢复就删掉 `settings.yaml` 里 `prompt-manager.entries` 这一项。
- 部署**没有 settings 服务**时也照样注入（此时索引就是内置条目本身）。
- 内置正文引用的变量由包内探测默认值提供，所以开箱即可渲染。把 `probeDefaults` 关掉却留着这条条目，那 6 个变量就没人注册 —— 组装不会失败，但正文里会出现 `{{os}}` 原文并各记一条警告。

## 探测：把工具版本变成变量

`probes` 让插件在**挂载时**跑一遍命令，把结果注册成变量。包内已带一组默认探测（`pwsh` / `bash` / `git` / `node` / `python`），下面是覆盖或补充：

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
| `command` | 可执行名（走 `PATH`）或绝对路径 |
| `args` | 固定参数数组，默认不经 shell |
| `shell` | 经平台 shell 执行。Windows 上 `npm` / `pnpm` 这类 `.cmd` 垫片必须设 `true`，否则 `EINVAL` |
| `pattern` | 可选正则，取第一个捕获组；匹配不上就退回整行 |
| `timeoutMs` | 这一项的超时，默认 1500 |

四种结果都是**有值的字符串**，所以引用永远不会渲染成空：有输出 → 第一条非空行（`stdout` 或 `stderr`，套 `pattern`、截断到 120 字符）；起不来 → `missing` 文案（默认 `(not installed)`）；起来了没印东西 → `empty`（默认 `(no output)`）；超时 / 预算用尽 → `timeout` / `skipped`。

四条要紧的话：**只在挂载时跑一次**（DSH 的变量 provider 每次组装同步求值，把命令放进去等于每个步骤起一批子进程；装了新工具就改一下 config 或重启）；**同名项是整体替换**（`git: { command: git }` 会连 `args` 和 `pattern` 一起丢掉）；**名字被占了只警告不炸**（跳过这一项，其余照常）；**写错的配置直接拒绝挂载**（变量名不合法、缺 `command`、`pattern` 不是合法正则、超过 64 项）。命令在宿主进程里执行、不经工具沙箱，但只来自组合配置这个部署自己的文件，永不接受模型或页面的输入。

## 变量脚本：让提示词用你自己写的 JS

一条脚本 = 一个文件 `scripts/<name>.js`，跑起来是**独立子进程**，**打印一个 JSON 对象**，键就是变量名 —— 所以一条脚本能给多个变量：

```js
console.log(JSON.stringify({ rust: '1.80.0', go: 'go1.22' }))
```

值只在**挂载时**或你点「运行一次 / 重新测量」时测一次，之后每次组装读内存里的值。

四步：**新建脚本**（给个名字，页面给一份能直接跑的模板）→ **改**（往 JSON 里加键）→ **运行一次（测试）**（跑的是保存时会跑的同一件事：同一条命令、同一个工作目录；页面列出这次会提供哪些变量、退出码、耗时、stderr。**测试不写文件、不注册变量**）→ **保存并启用**（保存会先跑一遍，输出不是合法 JSON、变量名不合法、名字和别人撞车都拒绝，磁盘上不会留下坏脚本；通过后落盘并注册，下一个模型步骤生效）。回到正文编辑器，输入框上方列出当前可用变量，点一下插到光标处；写了没注册的名字会直接在预览区标红。

| 事情 | 行为 |
|---|---|
| 输出 | 平铺 JSON 对象，值是字符串或数字；数组、嵌套对象、null、空对象都拒 |
| 变量名 | `^[a-z][a-z0-9_]*$`，最长 64 |
| 长度 / 数量 | 值超 120 字符截断；单脚本最多 64 个变量，脚本最多 20 条 |
| 非 0 退出码 | 输出还能解析就照用，退出码显示在页面上 |
| 超时 / 起不来 | 默认 3 秒后杀掉（只杀解释器本身）；`node` 不在 `PATH` 上报「无法启动」 |
| 失败时 | **保留上一次成功测到的值**，错误显示在变量页，提示词不受影响 |
| 删除脚本 | 文件与缓存一起删。仍被引用的变量冻结在最后一次的值上，没被引用的连变量一起删；删除前页面列出哪些提示词还在引用它 |
| 改名 | 先删旧的、再存新的（旧名字的变量会被新脚本接管）。两条脚本抢同一个名字会被拒（409） |
| 手工放文件 | 直接把 `.js` 丢进 `scripts/` 一样生效，下次打开页面就能看到；没有缓存的会在挂载后台跑一次补上 |

默认 `node <脚本绝对路径>`，工作目录是 `scripts/`，继承宿主环境变量，另加 `DSH_PROMPT_MANAGER=1` 和 `DSH_PROMPT_MANAGER_SCRIPT=<名字>`。换解释器或加参数写 `config.scripts`：`inventory: { command: 'python', args: ['{script}'] }`。

**脚本以宿主进程的身份运行，没有沙箱** —— 能读能写能上网。写入只有 loopback + same-origin 能过（和正文一样），但"设置页能写的东西现在包括会被执行的代码"这件事要心里有数：别放不信任的脚本。

## 变量

section 文本每次组装做 `{{变量}}` 插值。**变量必须由某一行注册**；本部署里 `@deepseek-ai/*` 的包不注册提示词变量，所以 `{{...}}` 认的就是这 8 个，加上 `variables`、`probes`、脚本补进来的那些：

| 变量 | 本机实测值 | 来源 |
|---|---|---|
| `{{os}}` | `Windows` | 友好平台名（`win32` → Windows，`darwin` → macOS，`linux` → Linux） |
| `{{os_release}}` | `10.0.19045` | `os.release()`：Windows 构建号 / Linux 内核版本 / macOS Darwin 版本 |
| `{{platform}}` | `win32` | `process.platform` |
| `{{arch}}` | `x64` | `process.arch` |
| `{{home}}` | `C:\Users\Administrator` | `os.homedir()` |
| `{{dsh_home}}` | `C:\Users\Administrator\.dsh` | 解析后的 harness home（`$DSH_HOME`，没设就是 `~/.dsh`），和正文目录用同一个解析函数 |
| `{{user}}` | `Administrator` | `os.userInfo().username` |
| `{{host}}` | `ADMIN-5MK6PJTEU` | `os.hostname()` |

都是**进程级事实**，挂载时算一次，运行期间不变（也不会白白让 KV 前缀失效）。正文里用 `{{dsh_home}}/profiles/web/vendor/...` 这种路径比硬编码 `C:\Users\...` 更经得起换机器。

**故意没有 `{{cwd}}`**：装配时拿得到的只有宿主进程的 `process.cwd()`，而 DSH 的会话工作目录可以不是它（`AssembleContext` 只带 `{scope, signal}`）。把一个进程目录叫成 `cwd` 只会让人误以为那是"我的工作目录"，所以宁可不提供。

**没注册的引用不会炸掉组装**：插件把它转义成字面量并记一条警告（`test/guard.mjs` 与真实 `renderPrompt` 交叉验证）。但那一段注入的就真是 `{{名字}}` 原文 —— 别把它当兜底。

## 升级

### 从 3.0.x（3.1.0）

只加东西，不需要迁移：

- 索引多了可选字段 `compaction`（根字段）和组合上的 `compaction`、条目上的 `kind: 'compaction'`。老文档原样生效：没有 `compaction` 就继续用 DSH 自带的压缩指令，升级前后**压缩调用逐字节相同**。
- 组合包格式 `dsh-prompt-manager-pack` 版本仍是 1：包里多出可选的 `preset.compaction` 与 `entries[].kind`，3.0 写的包照样能导入（导入后组合不带压缩指令）。
- 宿主多了一个可选依赖 `@deepseek-ai/dsh-llm`（只用到它的类型；运行时经 `ctx.inject(['llm'], …)` 取服务，没有它插件照常挂载，只是没有压缩接缝）。

### 从 2.x（3.0.0）

只换**对外身份**，不动数据面：

| 变了 | 2.x | 3.0.0 |
|---|---|---|
| npm 包名 | `dsh-prompt-manager` —— 该名字在 npm 与 DSH 商城上已被另一个插件占用 | `@lolkda/dsh-prompt-manager` |
| 客户端插件 id | `dsh-prompt-manager` | `@lolkda/dsh-prompt-manager`（必须等于包名） |
| cordis 插件名 / 挂载行 id | `prompt-manager` | `dsh-prompt-manager` |
| HTTP 路由前缀 | `/prompt-manager` | `/dsh-prompt-manager` |
| 安装方式 | 手改 profile 的 patch | `dsh plugin … add` 一条命令 |

**没变的（所以不用迁移）**：settings 命名空间 `prompt-manager:`、正文目录 `$DSH_HOME/prompt-manager/`、section 名 `user:prompt-manager:*`、组合包格式 `dsh-prompt-manager-pack`。手写挂载的把 patch 行的 `id` 改成 `dsh-prompt-manager`（`name` 不用动），装包的用新包名重装一次，然后重启 profile、刷新页面。

### 从 1.x（2.0.0）

2.0.0 把插件从「CTF 契约注入器」改名成通用的提示词管理器（插件名与仓库名从 `dsh-ctf-prompt` 换成 `dsh-prompt-manager`，旧 GitHub 地址 301）。要改三处：挂载行用新的 vendor 路径或包名；`settings.yaml` 的 `ctf-prompt:` 段改名成 `prompt-manager:`（`entries` 不用动）；`$DSH_HOME/ctf-prompt/sections/*.md` 挪到 `$DSH_HOME/prompt-manager/sections/`。同一次改名里 `contract` / `fastctx` 两条种子条目移出仓库，变成 [dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack) 这份可订阅的包。

## 为什么用插件而不是 AGENTS.md

DSH 里两种注入方式落在不同通道：

| 方式 | 落点 | 声明优先级 |
|---|---|---|
| `ctx.systemPrompt.section()`（本插件） | system prompt 正文 | 高 |
| `AGENTS.md` / `CLAUDE.md` | 对话里的 user 角色 `<system-reminder>` | DSH 明确声明「不覆盖 system 指令」 |

插件注册的 section 会和 harness identity、persona、工具指引拼成同一段 system prompt，因此权威性和它们完全等同。需要「必须遵守」的契约时用这个；描述性的项目知识仍然放 `AGENTS.md` 更合适。

## 注意

- **改插件代码要重启，改浏览器半边不用**：DSH 不监听插件模块文件，loader 按 URL 缓存 ESM 模块，所以改完 `lib/` 必须重启 profile。浏览器半边另有一条 HMR 链路（`dsh-client-hmr` 轮询已注册 bundle，字节一变就通知页面原地重载）；部署没挂 `dsh-client-hmr` 时没有这条链路，刷新页面也可能吃到旧副本，只能重启。
- **`dsh.client` 那类元数据是启动时快照**：改动 `inject` 列表或包名要重启 profile；只改 `client/client.js` 的内容靠 HMR。
- **改正文不用重启**：`sections/*.md` 每次组装现读；订阅正文点过「应用」后也是下一次组装生效。**加变量脚本不用重启**：脚本是数据文件，保存时插件自己注册新变量。
- **脚本值不随会话变**：值在挂载或你点「重新测量」时测一次就固定。这既是性能考虑，也是 KV cache 考虑 —— 随每次组装变化的变量会让缓存前缀每步失效。会话相关的事实（模型、cwd 之类）归注册它们的插件所有，不在这个插件里造。
- **section 名是派生的**：每条固定 `user:prompt-manager:<id>`，所以只要 id 不重复就不会和 `deployment:persona`、`harness:identity` 这类已注册 section 撞名。
- **package.json 的三样必须同时在位**：`dsh.client`、`exports["./client"]`、`client/client.js` —— 只声明浏览器半边而没有 bundle，浏览器插件表挂载时会直接报错。bundle 工厂的 `id` 必须等于包名。
- **KV cache**：section 文本或顺序一变，缓存前缀从该点失效；文本稳定时开销只有一次。切换组合就是换一组 section，所以每切一次失效一次 —— 换来的是不用重启、不用重开会话。

## 开发

```bash
npm install          # 只装开发依赖：typescript 与 DSH 类型包
npm run build        # src/*.ts -> lib/*.js + lib/types/*.d.ts，并检查 client/client.js
npm run typecheck    # tsc --noEmit
npm test             # 先构建，再跑十四个测试（test/*.mjs，各自文件头有说明）
npm run check:build  # 核对 lib/ 没有未提交的改动（提交前跑）
npm run check:pack   # 核对 npm 会打包的内容里有 bundle patch、浏览器半边、构建产物
```

**发布由 tag 触发**。`.github/workflows/ci.yml` 在每次 push / PR 上跑构建、测试、`check:build`、`check:pack`（ubuntu + windows 两个平台）；`.github/workflows/release.yml` 只在 `v*` tag 上发布 —— 先校验 tag 与 `package.json` 版本一致，再跑同一套门禁，然后 `npm publish --provenance --access public` 并开一个 GitHub Release。发一版就三行：

```bash
npm version patch --no-git-tag-version   # 或手改 package.json
git add -A && git commit -m "chore: 3.1.0"
git tag v3.1.0 && git push origin main --follow-tags
```

认证走 npm 的 **Trusted Publisher（OIDC）**，仓库里不放任何 npm token —— npm 正在淘汰"绕过 2FA、长期有效"的发布 token，而 OIDC 换来的凭证只活这一次运行，并顺带生成 provenance（包页面上会标出它是从哪个 commit 的哪次运行构建的）。首次要在 npm 包页 Settings → Trusted Publisher 里填 `lolkda` / `dsh-prompt-manager` / `release.yml`。

`lib/` 与 `client/` 都提交进仓库，所以克隆下来就能按相对路径挂载，不需要工具链 —— 这正是 `check:build` 存在的原因：**`lib/` 与 `src/` 必须同一个提交**，否则挂载的是一份和源码对不上的代码（多出一个 `lib/foo.js` 而没 `git add` 时尤其隐蔽，挂载会直接 `ERR_MODULE_NOT_FOUND`）。改完源码：`npm run build && npm test && npm run check:build && git add -A && git commit`。

清单里**没有生命周期脚本**（`prepare` 换成了 `prepublishOnly`）：`npm install` 不构建、git 安装也不构建，因为 `lib/`/`client/` 就是构建产物；`prepublishOnly` 只在 `npm publish` 时构建一次。这不是洁癖 —— pnpm 12 会拒绝执行 git 依赖的构建脚本（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），留着 `prepare` 等于让每个用 `dsh plugin add github:…` 装的人都撞一次墙。

### 包清单契约（照着做就能被 `dsh plugin` 装、被商城收录）

| 字段 | 本仓库的值 | 为什么 |
|---|---|---|
| `dsh.bundle.patch` | `./cordis.patch.yml` | DSH 靠它认「这是个 profile bundle」：装成依赖后**自动**进 `dsh.profile.bundles` 并应用这一层；商城没有它直接判 `SUBMISSION_BUNDLE_MISSING` |
| `dsh.client` | `{platform: 'web', inject: [...]}` + `exports["./client"]` | 浏览器半边；工厂 `id` 必须等于包名 |
| `dsh.compatibility.dsh` | `>=0.1.5-rc.1 <0.2.0` | 瞄准的 DSH 线。**不写不是"留空"而是被推断**：校验脚本会拿唯一的 `@deepseek-ai/dsh-*` peer 范围顶上，那是个依赖服务的范围，读起来像"任何 DSH 都行" |
| `dsh.compatibility.dshReleases` | 官方最新三个版本逐版本声明 | 商城上下架依据：至少要有一个精确的 `compatible`，全 `unknown` 会被转 `unlisted` |
| `dsh.compatibility.dshOperations` | 逐版本记 `install`/`start`/`uninstall`/`rollback` 四项 | 商城要的是**真跑过**的操作证据，范围声明不能顶替；只有实测过的版本写 `passed`，没测的照实写 `unknown`（实测过程见 `docs/marketplace-evidence.md`） |
| `engines.node` | `>=22` | 商城记录成兼容范围 |
| `publishConfig.access` | `public` | scoped 包默认私有 |
| `files` | 含 `lib`、`client`、`cordis.patch.yml`、`environment.md` | 装出来的包要自洽 |
| 生命周期脚本 | 无 | 见上 |

包内 `cordis.patch.yml` 只 `insert` 自己这一行，`id` 用插件自有、不与别家条目撞的 id（商城会拿它和所有既有条目的 `entryIds` 比对），并且**不允许**出现 `name: '@deepseek-ai/…'` 这种冒充官方组件的行。

装成包来验证（不碰你自己的 profile）：`dsh plugin --profile pmcheck add git+file:///D:/path/to/checkout`，然后 `dsh --profile pmcheck --dump-config` 应该能看到 `id: dsh-prompt-manager` 那一行 —— 它是包内 `cordis.patch.yml` 自己插进去的，`pmcheck` 的 patch 文件从头到尾没动过。看完 `remove` 掉、删掉 `$DSH_HOME/profiles/pmcheck` 即可。

## License

MIT
