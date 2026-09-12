# dsh-prompt-manager

把提示词作为 **system prompt section** 注入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH），并在 Web GUI 的 **设置 → 提示词** 里管理它们：开关、排序、新增、删除、改正文（markdown）。

提示词是一份**列表**，每条一个条目；正文里可以引用**变量**，而变量可以由你自己写的**脚本**提供：

| 部分 | 存在哪 | 谁在改 |
|---|---|---|
| 索引（标题 / 顺序 / 开关） | `$DSH_HOME/settings.yaml` 的 `prompt-manager:` 段 | 设置页，或手改文件 |
| 组合（挑哪几条） | 同一段里的 `presets` / `activePreset` | 设置页的「组合」页，或**聊天页输入栏的切换器** |
| 正文（markdown） | `$DSH_HOME/prompt-manager/sections/<id>.md` | 设置页，或任意编辑器 |
| 变量脚本 | `$DSH_HOME/prompt-manager/scripts/<name>.js` | 设置页的「变量」页，或任意编辑器 |

脚本是一段跑在子进程里的 JS（也可以是别的语言），打印一个 JSON 对象，键就成了提示词里能用的 `{{名字}}` —— 见「变量脚本」一节。

**组合**是这一版的第二层：把现有条目挑成一组，在聊天输入框下面的工具行里点一下就整体切换（见「组合」一节）。不用组合时，每条自己的开关说了算。

插件**只内置一条**提示词：机器环境（系统 / shell / 工具链版本，值由变量在挂载时探测填充）。其余提示词自己写，或从可订阅的仓库拉（见下节）。一份现成的提示词包在 [lolkda/dsh-prompt-pack](https://github.com/lolkda/dsh-prompt-pack)，里面是 CTF 作业契约和 FastCtx 工具路由两份。

## 从 2.x 升级（3.0.0）

3.0.0 只换**对外身份**，不动数据面：

| 变了 | 2.x | 3.0.0 |
|---|---|---|
| npm 包名 | `dsh-prompt-manager` —— 这个名字在 npm 与 DSH 商城上已被另一个插件占用 | `@lolkda/dsh-prompt-manager` |
| 客户端插件 id | `dsh-prompt-manager` | `@lolkda/dsh-prompt-manager`（必须等于包名） |
| cordis 插件名 / 挂载行 id | `prompt-manager` | `dsh-prompt-manager` |
| HTTP 路由前缀 | `/prompt-manager` | `/dsh-prompt-manager` |
| 安装方式 | 手改 profile 的 patch | `dsh plugin --profile web add github:lolkda/dsh-prompt-manager` 一条命令 |

**没变的（所以不用迁移）**：settings 命名空间 `prompt-manager:`、正文目录 `$DSH_HOME/prompt-manager/`、section 名 `user:prompt-manager:*`、组合包格式 `dsh-prompt-manager-pack`。

按你的装法做一件事就行：手写挂载的把 patch 行的 `id` 改成 `dsh-prompt-manager`（`name` 不用动）；装包的用新包名重装一次。然后重启 profile、刷新页面。旧路由前缀不再响应 —— 只有自己写的脚本或书签直连它时才会注意到。

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

三种装法，选一种。`lib/`、`client/`、`environment.md` 都随包发布，所以装完不需要本地工具链。

### 方式 A：`dsh plugin` 一条命令（推荐）

```bash
dsh plugin --profile web add github:lolkda/dsh-prompt-manager
```

这个命令把剩下的参数转给 profile 目录里的 pnpm（`dsh plugin --profile web remove <包名>` 同理），装完 DSH 会发现这个包的清单里声明了 `dsh.bundle.patch`，**自动把它加进 `dsh.profile.bundles`** 并应用包内那份 `cordis.patch.yml` —— profile 自己的 `cordis.patch.yml` 一个字都不用写。装完重启一次 profile。

发布到 npm 之后，同一条命令还可以写成包名：

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

- **读**：`$DSH_HOME/settings.yaml` 的 `prompt-manager:` 段（条目索引与组合）、`$DSH_HOME/prompt-manager/`（正文、脚本、订阅快照）、订阅源的仓库（可选镜像）。
- **写**：只管上面这两处。settings 段由页面通过 `scope.update` 写；正文与脚本先写临时文件再 `rename`，不留半截文件。
- **起进程**：按你 settings 里的配置跑**探测命令**（默认 `pwsh`/`git`/`node`/`python`，挂载时各跑一次）和**变量脚本**（`node <脚本文件>`，保存时 / 挂载时 / 你点「重新测量」时各跑一次）。命令与参数都来自这份配置，插件自己不带任何可执行文件，也不联网下载。
- **出网**：只有订阅源会出网（`fetch`，可配 https 镜像）。
- **HTTP**：注册一条 `/dsh-prompt-manager` 前缀路由，**仅 loopback 对端**可用，写操作另加 same-origin（见「插件路由」）。它不是认证：同机其它进程照样能调，边界是"别家网页进不来"。

## 设置页

打开 **设置 → 提示词**（侧栏位置由 `settings.section` 的 order 60 决定，排在 General / Models / Plugins / Agent presets / 市场之后）。

页面是几个视图（设置面板很窄，一次只做一件事）：

- **标题下的那行说明**末尾带**插件自己的仓库链接**（`lolkda/dsh-prompt-manager`，蓝色可点、新标签打开）和一句「拜托动个小手点颗星星吧。」——先标「插件仓库地址：」，再是链接，最后才是那句请求，请求刻意放在链接外面，免得点仓库地址时误点到一句话。地址和 `package.json` 的 `repository` 字段保持一致；这个 bundle 是手写的、没有能 import `package.json` 的构建步骤，所以这两个值是靠人保持一致（`REPO_SLUG` / `REPO_URL` 一组常量）。
- **列表**：三个 tab（全部 / 本地 / 订阅）做分层；每条一行 = 标题 + 注入开关 + 右侧「⋯」菜单（编辑 / 删除）。订阅来的条目带「订阅」徽标，metadata 里写明它是从哪个仓库来的 —— 那串 `owner/repo` 是**真的链接**，点开就是 GitHub 上的上游仓库（悬停显示 `owner/repo@ref` 和来源 slug）。点标题或「编辑」进入编辑器页面。底部是「新增提示词」「订阅来源（N）」「变量（N）」「组合（N）」。组合生效时，标题下面多一行说明，每条还会标出组合的结论（见「组合」一节）。没有任何条目时，列表提示去点「新增提示词」；索引已经到上限（`/status` 的 `maxEntries`）时「新增提示词」会直接拒绝并说明原因，因为再多的条目也不会被注入。
- **编辑器页面**：整个区域切成编辑器 —— 左上角「← 返回」，然后是标题、顺序、只读的 id 与正文状态、Markdown 正文 textarea、实时预览（用 shell 自带的 `MarkdownText` 渲染），底下是可用变量芯片（点一下插到光标处）和未注册/写法不对的引用警告，底部「保存修改」。**订阅条目的正文只读**，另有「fork 成本地条目」把它复制成一条可编辑的本地条目。返回时会确认未保存修改；新增提示词也直接进这个页面。
- **来源页面**：订阅源的增删、检查更新、应用、还原，见下节。
- **变量页面**：变量清单（值、来源、被哪些提示词引用）+ 脚本列表（它提供哪些变量、上次运行状态）+「新建脚本」「重新测量」。
- **脚本编辑器**：脚本名、正文、实时语法提示，底部「运行一次（测试）」和「保存并启用」，见「变量脚本」一节。
- **组合页面**：组合的增删、「设为当前 / 取消当前」，以及每个组合的成员勾选清单，见下节。

生效时机：**下一个模型步骤**。`systemPrompt.assemble()` 每个 agent step 调用一次，section 文本每次现算，所以开关、排序、正文都在下一轮对话生效，**不需要重启**。改代码另说，见文末「注意」。

持久化：只有 `http://127.0.0.1:...` 打开页面时索引才写进 `settings.yaml`；用局域网地址打开时 DSH 的设置通道退化为内存模式，页面会显示只读。

删除对任何条目都可用：删掉一条 = 先删它的正文文件，再把这一条从索引里移除（顺序是有意的：文件删不掉时索引不动，那条条目还在页面上、还能重试）。手改 `settings.yaml` 时要注意：settings 的分层合并对数组是「上层整体覆盖」，所以用户层写下的 `entries` 数组就是最终列表。

## 组合

一个**组合** = 从现有条目里挑一组，起个名字。它在两处露面：

- **聊天页输入框下面**的工具行右侧（模型选择器左边）有一个「提示词 · …」的芯片。点开是全部组合（带条目数）和「不用组合（按每条开关）」，选中即切换。不用去设置页，也不用重开会话。
- **设置 → 提示词 → 组合**：新建 / 编辑 / 删除 / 设为当前，每个组合用一张勾选清单挑成员。清单列的是**全部条目**（包括开关关着的），因为「把某条关掉的提示词临时打开」正是组合的用途。

三点要说清楚：

1. **组合生效时，组合说了算。** 每条提示词自己的开关原样留着不动，但在组合生效期间不参与判断；取消组合（或删掉当前组合）就回到那些开关。所以设置页的列表在组合生效时会明说「单条开关只在「不用组合」时生效」，每行还会标出「组合：注入 / 不注入」，圆点也按组合的结论显示 —— 免得开关看起来像坏了。
2. **切换是全局的。** 写的是 `settings.yaml` 里的 `activePreset`，所以所有会话、以及之后新开的会话都用它。切换在**下一个模型步骤**生效，不需要重启，也不需要重注册 section（section 文本每次组装现算）。代价是 system prompt 变了，KV cache 前缀失效一次，之后稳定下来就不再付。
3. **组合管选哪些，不管顺序。** 顺序仍然是每条自己的 `order`；组合里也没有排序。

`presets` 里可以写索引里不存在的 id（比如订阅还没拉回来），组合页会把它们标成「条目不存在」而不是替你删掉 —— 订阅回来就自动生效。但组合生效时宿主也会在日志里点名一次（`组合 ctf 里有 1 条不在索引里：…`），因为这条路径的默认结局是"静默地少注入一段"，而它通常意味着上游改了文件名。上限：20 个组合、每个最多 50 条。`activePreset` 指向一个不存在的组合时不会把提示词冻住：宿主回到单条开关，并在日志里说一次是哪个 id 解析不了。

打开页面的地址不是 loopback 时，DSH 的设置通道退化为内存模式，芯片会显示成只读并说明原因。

### 组合包：把一个组合导出成文件，换台机器导入

组合页每个组合的「⋯」菜单里有**导出组合包**，页脚有**导入组合包…**。导出下来的是一个 JSON 文件（`prompt-manager-pack-<组合 id>.json`），可以读、可以 diff、可以发给别人。

包里装什么，是按"这份正文属于谁"分的：

| 成员类型 | 包里放什么 | 为什么 |
|---|---|---|
| 本地条目 / 插件内置条目 | 正文**内联**进包（`body` + `origin`） | 除了这份文件，没有别的地方能复现它 |
| 订阅条目 | 只记**来源**（`slug` + `repo` + `ref` + `file`），正文不打包 | 正文属于上游。复制一份会让这条条目悄悄和上游脱钩；导入方配上同一个仓库（同 repo ⇒ 同 slug ⇒ 同条目 id），正文自然就出来了 |
| 组合里指向已不存在条目的 id | 记进 `missing` 数组，如实报告 | 这是在说"这个包不完整"，而不是默默少一条 |

导入时：

- **id 撞车就换一个**：`env` 变 `env-2`，标题保留，组合里的引用同步改写 —— 所以同一个包导两次是两个集合，不会互相覆盖。id 是按**原 id**加后缀，不是按标题重推（订阅条目的正文是按 id 去上游找的，而中文标题推出来的 id 没有意义）。
- **换了 id 的订阅条目会放弃来源标记**，作为普通条目导入：正文是按 id 去来源里找的，id 变了就永远读不到，留着「订阅」标记只会变成一条只读且永远空着的条目 —— 连手动粘贴正文都做不到。报告里会点名是哪几条。
- **绝不导入脚本**：脚本是代码，不在包的范围里。包里正文引用的 `{{变量}}` 按导入方的注册表解析，没注册的照旧按字面量渲染并在报告里列出来。
- **正文里出现写法不合法的 `{{...}}` 直接拒绝整包**：那种正文一进索引，每个模型步骤都会失败。
- **先校验、再写正文、最后一次性写索引**（`entries` + `presets` 一笔）。写正文中途失败会把这次写进去的文件删掉，所以被拒绝的包不会留下任何痕迹；索引最后写，最坏情况是留下几个没人指向的正文文件 —— 重导同一个包会复用同一批 id，正好收尾。
- 导入**不会**自动启用那个组合，也**不会**替你去配来源。

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

### 上游改了文件名怎么办

条目的 id 是**身份**，不是标签：组合记住的是它，正文也是按它去来源里找的。所以"把 `contract.md` 改名成 `ctf.md`"这种事必须不能让 id 跟着变。三层保护，从可靠到凑合：

1. **清单里写 `id`（最可靠，推荐）** —— `{"file": "ctf.md", "id": "contract"}`。id 就由这一行决定，之后文件怎么改名、正文怎么改，本地 id 都不动。它还能当**修复手段**：组合里记着一个已经不存在的 id 时，在上游清单里把它写回来，检查 → 应用，那条组合成员就重新生效了（人工给的标题 / 顺序 / 开关也一起回来）。
2. **正文没变的改名会自动认出来** —— 一次检查里恰好有一个被删的文件和一个新文件正文完全相同（sha1 一对一），就判定为改名，新路径沿用旧 id。检查列表会把两行标成「由 prompts/contract.md 改名」。
3. **认不出来时不猜** —— 改名同时改了正文，或者两个新文件的正文一模一样、无法判断谁继承了身份：那就按"删一条 + 加一条"处理，并在检查结果里说明原因（要固定身份就回到第 1 条）。

改名在计划里是**一对变更**：只勾其中一行，应用时两行一起落（只应用一半会让两条记账共用一个 id，索引里就会出现重复条目）。`id` 真的变了的时候（清单开始声明，或走第 2 条），你给旧 id 设的标题、顺序、开关会跟着搬到新 id 上，而不是从零开始一条关着的新条目。

组合里那个已经不存在的 id 不会永远沉默：组合生效时宿主会在日志里点名一次（`组合 ctf 里有 1 条不在索引里：…`），设置页的组合页也会把它标成「条目不存在」。所以"上游改名了但没被认出来"最多是**一条日志 + 一次勾选**的事，不会变成"某天发现提示词少了一段"。

### 手动更新的四步

1. **检查更新** —— 分支先用 `github.com/<repo>/commits/<ref>.atom` 拿 head sha（**零 API 配额**）；sha 没变就直接说"已是最新"，不发文件请求。变了（或 ref 是 tag/commit）才逐个文件发条件请求（`If-None-Match`），304 复用本地。本地那份正文文件如果被删了（手工清过、或者从别的机器同步过来），条件请求会退回无条件请求把它取回来 —— 否则 304 会把一个空正文当成最新版本暂存下来。
2. **看变更** —— 每个文件一行：`prompts/a.md  +14 / −3`，带勾选框（默认全选）。远端删掉的文件标「（删除）」，认出来的改名标「由 prompts/old.md 改名」（这一对勾哪个都等于勾两个）。
3. **应用** —— 旧正文进 `previous/`，暂存内容覆盖 `current/`，写回 `state.json`，然后补上新条目：**新条目默认关闭**，打开开关后才会注入。
4. **还原** —— 一次撤销：把上一次应用覆盖掉的文件放回去（记在 state 的 undo 账本里，所以被删的文件会连同标题/顺序/开关一起回来）。

订阅条目的正文只读（想改就 fork），标题、顺序、开关照旧可改；源被删掉时它的条目会一起移除。

把来源的 `enabled` 设成 `false` 是「**先停对上游的动作，但别动已经在用的正文**」：检查 / 应用 / 还原都返回 409 并说明原因，已应用的条目照常注入（页面上关掉某个条目才是让它不注入的方式）。要彻底停就把来源删掉。

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
    - id: owner-repo                       # 从 owner/repo 派生，可手改
      repo: owner/repo
      ref: main
      mirror: ''                           # 空 = 沿用全局
      enabled: true
```

### 文件布局

```
$DSH_HOME/prompt-manager/
  sections/<id>.md                        本地条目正文
  scripts/<name>.js                       变量脚本（一条脚本一个文件，输出一个 JSON 对象）
  scripts/.state.json                     每条脚本上次成功运行的 sha1 / 时间 / 变量值 / 退出码
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
| `scripts` | 空 | 变量脚本的执行覆盖：`{ <脚本名>: { command, args, timeoutMs } }`。默认 `node <脚本>`、3 秒超时；`args` 里的 `{script}` 会换成脚本绝对路径，没写就附加在末尾 |
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

内置正文引用的 `{{...}}` 由包内自带的探测默认值提供（下一节），所以开箱即可渲染。反过来，把 `probeDefaults` 关掉却留着这条条目，那 6 个变量就没人注册 —— 组装**不会因此失败**（见下面「未注册的引用按字面量渲染」），但正文里会出现 `Runtime environment: {{os}} ({{platform}}, {{arch}}).` 这样的原文，日志里各有一条警告。两者还是一对。

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
- **`probes` 里的同名项是整体替换，不是逐字段合并**。默认值里 `git` 带着 `args` 和 `pattern`，你只写 `git: { command: git }` 就同时丢掉了那两样（值变成输出整行、也不再带 `--version`），想要就一起写上。整组默认值用 `probeDefaults: false` 关掉。
- **占位符必须存在**。provider 返回 `undefined` 会让引用它的条目渲染失败，所以插件从不注册空值 —— 缺工具也是一个值。
- **名字被占了只警告、不炸**。别的行已经注册过同名变量时，这一项被跳过并写进日志；其余变量照常注册，挂载不受影响。
- **写错的配置会拒绝挂载**。变量名不合法、`probes` 不是键值对、缺 `command`、`pattern` 不是合法正则、超过 64 项 —— 这些是组合文件的错，直接抛错比留下一个渲染不了的 `{{名字}}` 好。
- **探测在宿主进程里执行，不经 DSH 的工具沙箱**。命令只来自组合配置（部署自己的文件），永不接受来自模型或页面的输入。

## 变量脚本：让提示词用你自己写的 JS

插件的变量分两类：**系统事实**（`{{os}}` 这类，插件注册）和**测量值**（探测，见上一节）。第三类是你自己写的脚本，在 **设置 → 提示词 → 变量** 里管：

- 一条脚本 = 一个文件 `scripts/<name>.js`，跑的时候是一个**独立子进程**。
- 脚本**打印一个 JSON 对象**，键就是变量名：`console.log(JSON.stringify({ rust: '1.80.0', go: 'go1.22' }))` —— 所以**一条脚本能给多个变量**，不需要在别处再登记名字。
- 值只在**挂载时**或你点「运行一次 / 重新测量」时测一次，然后缓存下来，之后每次组装读的是内存里的值。

### 新增一条脚本的四步

1. **新建脚本** —— 给个名字（小写字母、数字、连字符，就是文件名），页面给一份**能直接跑**的模板：读一个版本、打印成 JSON，并注释掉一行让你照抄成自己的变量。模板默认的那个键不会占用插件已经提供的名字（`pwsh` / `bash` / `git` / `node` / `python` 和八个环境事实），也不会去探一个多半没装的工具 —— 否则每台机器上都会多出一个 `(not installed)` 变量。
2. **写** —— 改成你要探测的东西。想加变量就往 JSON 里加一个键。任何语言都行，见下面 `config.scripts`。
3. **运行一次（测试）** —— 跑的就是保存时会跑的同一件事：同一条命令、同一个工作目录。页面会列出**这次会提供哪些变量、各是什么值**，还有退出码、耗时、stderr 和失败原因。
   **测试不写文件、不注册变量**，所以随便试都没有副作用 —— 试坏了也不会影响正在用的提示词。
4. **保存并启用** —— 保存会先跑一遍：输出不是合法 JSON、变量名不合法、名字和别的来源撞车，**都会被拒绝，磁盘上不会留下坏脚本**。通过后才落盘并注册，**下一个模型步骤生效，不用重启**。

保存成功后回到正文编辑器，输入框上方会列出当前所有可用变量，点一下就插到光标处；写了一个没注册的名字、或者写成 `{{不是变量名}}`，预览区下面会直接标红 —— 不用等模型步骤报错才发现。

### 约定

| 事情 | 行为 |
|---|---|
| 脚本输出 | 必须是**平铺的 JSON 对象**；值是字符串或数字（数字转成文本）。数组、嵌套对象、null 值、空对象都拒绝 |
| 变量名 | 键必须匹配 `^[a-z][a-z0-9_]*$`（小写字母开头，只含小写字母、数字、下划线），最长 64 个 |
| 值的长度 | 超过 120 字符会截断，页面会标出来 |
| 单脚本变量数 | 最多 64 个；脚本数最多 20 条 |
| 非 0 退出码 | 输出还能解析就照用（很多工具非 0 也照样打印），退出码在页面上显示；输出坏了才算失败 |
| 超时 / 起不来 | 默认 3 秒后杀掉（只杀解释器本身，脚本自己起的子进程不归它管）；`node` 不在 PATH 上时报「无法启动」 |
| 失败时 | **保留上一次成功测到的值**，只把错误显示在变量页上。提示词不会因此炸掉 |
| 删除脚本 | 文件、缓存一起删。它提供的变量分两种下场：**还有提示词引用**的留在最后一次的值上（否则正文里那几个 `{{名字}}` 会变成原文），**已经没人引用**的连变量一起删掉。删除前页面会列出哪些提示词还在引用它 |
| 改名的正确做法 | 先删掉旧脚本，再存成新名字 —— 旧名字的变量会被新脚本接管。两条脚本同时在磁盘上抢同一个名字会被拒（409），谁也不会悄悄覆盖谁 |
| 手工放文件 | 直接把 `.js` 丢进 `scripts/` 也一样，页面下次打开就能看到；没有缓存的那条会在挂载后台跑一次补上。反过来，手工**删掉**文件后，下一次「重新测量」或下一次挂载会发现它不见了：缓存条目清掉，它留下的变量按上面那条规则处理 |
| 两个 profile 共用一个 `storeDir` | 不推荐：`scripts/.state.json` 是整目录一份，两边各写各的、后写的覆盖先写的（最坏结果是某些脚本被判成「待重测」再跑一次，值不会错）。文案文件各存各的，没问题 |

### 脚本是怎么跑的

默认 `node <脚本绝对路径>`，工作目录是 `scripts/`，继承宿主的环境变量（所以 `PATH` 里的工具直接能用），加两个环境变量 `DSH_PROMPT_MANAGER=1` 和 `DSH_PROMPT_MANAGER_SCRIPT=<名字>`。想换解释器或加参数：

```yaml
- insert:
    - id: prompt-manager
      name: './vendor/dsh-prompt-manager/lib/index.js'
      config:
        scripts:
          toolchain: { timeoutMs: 5000 }
          inventory: { command: 'python', args: ['{script}'] }   # {script} 换成脚本绝对路径
```

**脚本以宿主进程的身份运行，没有沙箱** —— 它能读能写能上网。页面写入只有 loopback + same-origin 能过（和正文文件一样），但「设置页能写的东西现在包括会被执行的代码」这件事要自己心里有数：别把不信任的脚本放进去。

## 变量

section 文本在每次组装时做 `{{变量}}` 插值，所以提示词里可以写实时事实。**变量必须由某一行注册**：本部署里 `@deepseek-ai/*` 的包没有注册任何提示词变量，所以 `{{...}}` 认的就是下面这 8 个，加上 `variables`、`probes` 和变量脚本补进来的那些。

| 变量 | 本机实测值 | 来源 |
|---|---|---|
| `{{os}}` | `Windows` | 友好平台名（`win32` → Windows，`darwin` → macOS，`linux` → Linux） |
| `{{os_release}}` | `10.0.19045` | `os.release()`：Windows 构建号 / Linux 内核版本 / macOS Darwin 版本 |
| `{{platform}}` | `win32` | `process.platform` |
| `{{arch}}` | `x64` | `process.arch` |
| `{{home}}` | `C:\Users\Administrator` | `os.homedir()`：用户主目录 |
| `{{dsh_home}}` | `C:\Users\Administrator\.dsh` | 解析后的 harness home（`$DSH_HOME`，没设就是 `~/.dsh`）；和正文目录用的是**同一个**解析函数，所以两者不会各说各话 |
| `{{user}}` | `Administrator` | `os.userInfo().username`：harness 跑在哪个账号下 |
| `{{host}}` | `ADMIN-5MK6PJTEU` | `os.hostname()`：机器名 |

后 4 个和前 4 个一样是**进程级事实**，挂载时算一次，运行期间不会变（也不会白白让 KV 前缀失效）。写正文时用 `{{dsh_home}}/profiles/web/vendor/...` 这种路径，比硬编码 `C:\Users\...` 更经得起换机器。

**故意没有 `{{cwd}}`**：装配时拿得到的只有宿主进程的 `process.cwd()`，而 DSH 的**会话工作目录可以不是它**（`AssembleContext` 只带 `{scope, signal}`，会话信息在变量 provider 那层拿不到）。把一个进程目录叫成 `cwd`，只会让人误以为那是"我的工作目录"，所以宁可不提供。

`{{user}}`/`{{host}}` 这类取不到时报 `(unknown)` 而不是空串 —— 注册一个空值会让引用它的装配直接抛，整个模型步骤都会失败。

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

### 未注册的引用按字面量渲染

`@deepseek-ai/dsh-system-prompt` 的插值是**严格**的：引用未注册的变量、或注册了但 provider 返回 `undefined`，`renderPrompt()` 直接抛错，而 `dsh-agent-loop` 那一步没有兜底 —— 一个手滑的 `{{名字}}` 会让**整个系统提示词组装失败**，这一行配置再正确也一样。

所以插件在 `system-prompt/assemble` 这一步给自己的条目做一层护栏：**只有自己条目里、解析不了的那几个引用**会被就地转义成字面量（在 `{` 后面插一个零宽空格，渲染出来就是 `{{名字}}` 原文，人看不出区别，但注册表再也认不出它），每个引用在宿主日志里记一条警告，其余部分照常渲染。别人的 section 一个字节都不碰。

护栏只兜自己条目、只兜「解析不了」这一种：能解析的引用原样交给注册表；**变量脚本报错留下的不可用值、以及别的行注册失败**这类系统性问题，仍然按原样暴露。

配套的两件事：

- **保存时就拦**：`PUT /body/<id>` 遇到写法上就不成立的引用（`{{ x }}`、`{{a.b}}`、`{{}}` 这类，注册表正则无论如何都匹配不上）直接返回 422 并列出是哪几个，磁盘上不会留下注定渲染成原文的正文。名字合法但没注册的引用允许保存（它可能就是下一步要建的脚本），编辑器会标红提醒。
- **编辑器先说**：正文编辑器把当前可用变量列在输入框上方，未注册的引用和写法不对的引用都会在预览下方标出来，不用等一个模型步骤才发现。

想输出字面 `{{` 而没有对应的变量时，没有专门的转义语法：markdown 代码块在插值面前没有特殊地位，护栏也只管解析不了的写法，所以这种正文只能自己绕开（例如把大括号拆开写，或改成说明文字）。

## 条件注入（已移除）

1.x / 2.0.0 早期版本会给 `fastctx` 这条种子条目做一层工具可见性门控：FastCtx MCP 没连上时，发一行降级文案而不是那 40 行「优先用 `mcp__fastctx__*`」的指令，免得模型去调不存在的工具。

种子条目移出仓库后这层门控也一起去掉了 —— 它原来只认死那条 `fastctx` 条目的 id，而订阅来的条目 id 是 `<来源 slug>-fastctx`，本来也管不到。现在一条条目就是一段正文，要么开要么关。如果 FastCtx 不一定在，把「优先用它」写成条件句（例如「如果 `mcp__fastctx__*` 工具可见，就用它……」）比让插件猜更靠得住。

## 插件路由

浏览器不能写 settings 之外的通道，所以正文和订阅源另走插件自己注册的一条 prefix 路由 `/dsh-prompt-manager`：

| 方法 + 路径 | 作用 | 网关 |
|---|---|---|
| `GET /dsh-prompt-manager/status` | `{ dir, writable, ids, variables, maxEntries }` | 仅 loopback 对端 |
| `GET /dsh-prompt-manager/body/<id>` | `{ body, source, sha1, fileSha1 }` | 仅 loopback 对端 |
| `PUT /dsh-prompt-manager/body/<id>` | 写入正文，body 是 `{ body, fileSha1 }`，上限 256 KiB；写法不成立的 `{{...}}` 报 422 | loopback + same-origin |
| `DELETE /dsh-prompt-manager/body/<id>` | 删除覆盖文件（= 恢复默认） | loopback + same-origin |
| `POST /dsh-prompt-manager/id` | 为新标题分配一个未占用的 id | loopback + same-origin |
| `POST /dsh-prompt-manager/preset/id` | 为新组合分配一个未占用的 id；已到 20 个时 409 | loopback + same-origin |
| `GET /dsh-prompt-manager/pack/export?preset=<id>` | 导出这个组合的组合包（JSON，带 `Content-Disposition` 附件名）；没有这个组合 404 | 仅 loopback 对端 |
| `POST /dsh-prompt-manager/pack/import` | 导入一个组合包：先全量校验，再写正文，最后一次性写索引与组合；返回导入报告 | loopback + same-origin |
| `GET /dsh-prompt-manager/sources` | 列出配置的来源及其磁盘状态 | 仅 loopback 对端 |
| `POST /dsh-prompt-manager/sources` | `{ repo, ref?, mirror? }` → `{ id, repo, ref, mirror }` | loopback + same-origin |
| `POST /dsh-prompt-manager/sources/<slug>/check` | 探测上游、把变更取进暂存区 | loopback + same-origin |
| `POST /dsh-prompt-manager/sources/<slug>/apply` | 应用，body 可带 `{ files: [...] }` 只应用子集 | loopback + same-origin |
| `POST /dsh-prompt-manager/sources/<slug>/revert` | 还原上一次应用 | loopback + same-origin |
| `DELETE /dsh-prompt-manager/sources/<slug>` | 删除来源，它导入的条目一起移除 | loopback + same-origin |
| `GET /dsh-prompt-manager/variables` | 变量清单（值 / 来源 / 引用它的提示词）+ 脚本清单 + 脚本目录 | 仅 loopback 对端 |
| `POST /dsh-prompt-manager/variables/run` | 测试运行：`{ name }` 跑已保存的脚本，`{ name, source }` 把草稿写进临时文件跑 | loopback + same-origin |
| `POST /dsh-prompt-manager/variables/refresh` | 重跑全部脚本并刷新值 | loopback + same-origin |
| `GET /dsh-prompt-manager/script/<name>` | `{ source, sha1 }` | 仅 loopback 对端 |
| `PUT /dsh-prompt-manager/script/<name>` | 校验 → 跑 → 落盘 → 注册；body 是 `{ source, fileSha1 }` | loopback + same-origin |
| `DELETE /dsh-prompt-manager/script/<name>` | 删除脚本：没人引用的变量一起删，还被引用的冻结在最后一次的值上 | loopback + same-origin |

- **网关是两道**：对端必须是 loopback（`127.0.0.0/8` / `::1`），**并且 `Host` 头必须解析成 loopback 主机名**。第二道挡的是 DNS rebinding：`evil.example` 解析到 `127.0.0.1` 时对端地址是 loopback，只有 `Host` 才能说明这请求本来是冲谁来的。两类拒绝都返回 403 并说明是哪一道拒的。
  写操作再加一道 same-origin：`Origin` 与 `Host` 必须同时存在且同源。命令行工具（`curl` 之流）不带 `Origin`，所以写路由对它们是关的 —— 页面在写，脚本不该能远程改。
  **这不是认证**：同一台机器上的任何进程都能直接调这些路由。它的边界是"浏览器里的别人家的页面进不来"，不是"本机的别的程序进不来" —— 单用户工作机上是合适的取舍，多用户共享主机时就不够了。
- **并发保护**：页面读到的 `fileSha1` 会随写入回传，文件在编辑期间被外部改动就返回 409，页面提示重载；新建条目用 `fileSha1: null` 表示"这个 id 必须还没有文件"。脚本的保存是同一套栅栏。
- **脚本保存先跑后写**：`PUT /script/<name>` 会先把源码写到临时文件跑一遍，输出不合法（422）或变量名被别的来源占用（409）就拒绝，磁盘上不会留下坏脚本。测试运行（`/variables/run`）跑的是同一条命令，但不写文件、不注册变量。
- **`/status` 顺带回报变量表**：探测在挂载时跑完就固定了，`status` 里的 `variables` 是不用等一个模型步骤就能核对探测结果的地方；`maxEntries` 是索引上限（也是页面「新增」按钮拒绝的依据 —— 超过上限的条目正文能存下来，但永远不会被注入）。
- **路径安全**：`<id>` / `<name>` / `<slug>` 必须匹配各自的字符集（最长 64 字符），解析后的路径必须仍在 `sections/`、`scripts/`、`sources/` 里，否则 400，不会碰文件系统。id 在分发到 handler 之前先校验，所以每个 handler 拿到的都是合法 id，不用各自再防一遍。
- **原子写**：先写临时文件再 `rename`，中断不会留下半截正文。
- **单个响应有上限**：拉正文时边读边数，超过 1 MiB 就断开并报 `too-large`；`Content-Length` 撒谎也没用。
- **添加来源**：Host 只做三件事 —— 校验 `repo`/`ref`/`mirror`（`mirror` 只收 https 源，且不带凭据、查询、锚点）、分配一个未占用的 slug、把规范化后的三样回显给页面。来源列表本身仍由设置页写进 settings，和条目索引同一条通道，所以不存在第二个写入者。重复的 `repo@ref` 直接 409（同一个仓库导两遍会让条目翻倍），来源总数上限 20、每个来源最多 50 条提示词。
- **组合只借这条通道要一个 id**：`presets` / `activePreset` 和条目索引一样走 settings，所以「谁在写」仍然只有浏览器一个；`/preset/id` 提供页面算不出来的那一样 —— 一个没人占用的 id。
- **组合包是唯一一个由 Host 写索引的地方**：导入要把正文文件和 `entries` + `presets` 落到同一个动作里，页面来做这件事就会在两次写入之间留下半成品。所以 `/pack/import` 由 Host 写 settings（`scope.update` 一笔带上两个字段），页面只负责刷新。校验先于一切写入，写正文失败会回滚这次创建的文件。
- 没有 web server 的组合（TUI / SDK profile）不会注册这条路由，设置页显示正文目录不可达，提示词注入本身不受影响。

## 验证

挂载后打开 **设置 → 提示词**：列表里应该是空的（或你已有的条目），点「新增提示词」写一条、打开开关，下一个模型步骤就能在开场看到它。也可以确认这一行确实被组合进了配置：

```bash
dsh --profile web --dump-config
```

仓库自带十二个测试，跑的是构建产物：

```bash
DSH_PACKAGES="$DSH_HOME/profiles/node_modules/@deepseek-ai" npm test
```

- `test/smoke.mjs`：把插件挂进真实的 `SystemPrompt` 注册表，断言新装即注入内置的机器环境条目（含包内正文的静态校验、本机正文覆盖内置、base 层索引）、settings 驱动的增删开关与排序、正文来自本地文件 / 订阅快照 / 缺失三种情况、垃圾索引清洗、八个环境事实（含 home/dsh_home/user/host 的取值与「永不空串」）、探测变量（含缺工具、撞名、以及「同名覆盖是整体替换」三种情况）、**组合的生效判定**（成员照注入、组合外的条目即使开着也不注入、空 id 与失效 id 回到单条开关并记警告、组合里有不存在的成员时只报一次而不在每个模型步骤重报、切换不重注册 section、垃圾 preset 清洗）、未注册引用按字面量渲染并记警告、变量脚本在真实注册表里的完整链路（缓存值挂载即生效、没有缓存的脚本在挂载后台被真解释器测出来并能组装、删掉脚本后值冻结而不是报错），以及真实 schemastery 能解析这份索引 schema；末尾还让**真实路由打到真实 store 与真实索引**上跑一遍组合包：导出的包里本地条目带正文、订阅条目只带来源（含 repo/ref/file）、失效成员进 `missing`，再把这个包导回去（id 被占用就换名字、组合成员跟着改、放弃来源标记、正文真的落盘、索引与组合一次写入），同一个包导两次得到两个集合，读不出来的包一个字节都不动。
- `test/probe.mjs`：探测的取值规则（stdout / stderr / 空输出 / 起不来 / 超时 / 预算用尽）、`pattern` 抽取与三种退回、截断、`probes` 配置的形状校验，末尾再用真 runner 跑两个真命令。
- `test/guard.mjs`：护栏与真实 `renderPrompt` 对齐 —— 哪些引用会被转义、转义后渲染出来正好是原文、转义标记的数量与幂等性、能解析的引用一个字节不改、替换进去的值不会被二次扫描，以及 `{{{{嵌套}}}}` / `a{{{b` 这类相邻写法。
- `test/store.mjs`：id 语法、路径不外逃、`absent`/`sha1`/`any` 三种写入栅栏、256 KiB 上限、原子写不留临时文件、目录不可用时的降级。
- `test/routes.mjs`：用假 req/res 直打路由 handler，覆盖两道 loopback 网关（对端与 `Host`）与 same-origin、409 栅栏、400/404/405/422 状态码、非法 id 在分发前被拒、遍历 id、超大请求、写法不成立的引用被拒，新增来源的校验（repo / ref / mirror）与 slug 分配、重复来源、来源上限、关闭的来源返回 409、**组合 id 的分配与 20 个的上限**，以及订阅源的六个动作与「订阅正文只读」。
- `test/source.mjs`：仓库/ref/slug 语法、条目 id 派生（长 slug 下仍逐文件唯一、清单声明的 `id` 决定身份且同样受长度上限约束）、清单校验（含路径遍历）、镜像的两种写法与 https-only、atom feed 取 head sha。
- `test/net.mjs`：起一个本地假镜像，验证 `<镜像>/<url>` 重写、条件请求 304、非 raw URL 直连、HTML 页面识别、超限响应被拒，以及不可达镜像/超时/不可达 http 与 socks5 代理各自的失败分类。
- `test/sync.mjs`：staging → current 的三槽轮转、逐文件增删行统计、部分应用、还原（连同被删文件与它的标题/开关）、本地正文文件缺失时条件请求退回无条件请求、上游改名（正文没变时新路径沿用旧 id、一对变更一起落、正文同时改过就按新条目处理、两个文件正文相同则拒绝猜测并报警告、清单声明的 `id` 优先于文件名且能把 id 改回来）、以及无清单/HTML 镜像/网络失败/路径遍历四类拒绝。
- `test/subscriptions.mjs`：订阅引擎的簿记 —— 正文位置表只算一次（读一个正文不会重读 sources）、移动文件后刷新、关闭的来源拒绝检查/应用/还原但保留已应用的正文、删除来源后条目跟着消失、索引重建时本地条目保留 / 失效来源的条目清掉 / 新条目默认关闭、索引没变就不重复写、id 变了的条目把人工给的标题/顺序/开关一起带走（旧 id 不会在索引里留下第二条）。
- `test/pack.mjs`：组合包的格式与计划 —— 本地正文内联 / 订阅只记来源 / 组合里的失效成员进 `missing`、往返序列化、各类拒绝（换个格式的文件、版本过高、没有标题、正文超限、正文里有写法不合法的引用、超量、超大）、可恢复的字段（非法 id / 缺 order / 缺 enabled 都修好而不是拒绝）、导入计划（id 空闲就保留、被占用按原 id 加后缀并同步改写组合成员、订阅条目换了 id 就放弃来源标记并点名、容量先于一切检查）、以及正文写入的回滚（第二个文件写失败时第一个被删掉）。
- `test/scripts.mjs`：脚本输出解析与它的各种拒绝（非 JSON、数组、空对象、嵌套值、非法名、超量）、执行覆盖的解析与形状校验、语法检查、**保存先跑后写**的顺序（坏脚本不落盘）、写入栅栏、失败分类（超时 / 起不来 / 非 0 退出但有输出 / 非 0 且输出坏）、缓存与挂载声明、删除后冻结、路径不外逃，末尾用真 runner 跑一条真脚本并真的杀掉一个死循环。
- `test/client.mjs`：在 Node 里用桩模块 materialize `client/client.js`，用一个带状态的最小渲染器驱动：三个 tab 的分层、订阅徽标与指向上游仓库的链接、来源页增删与变更块（含改名标出「由 … 改名」）、订阅正文只读与 fork（fork 之后编辑器拿的是写入产生的 sha1，所以接着保存不会被栅栏拒掉）、删除时先删正文文件再改索引、达到索引上限时「新增」按钮拒绝、开关写入 settings、编辑器进出的整条链路、放弃未保存的草稿会先问一次、变量页（来源徽标、每行的「复制引用」、新建脚本、测试运行不注册也不碰 settings、保存并启用、未注册与写法不对的引用被标红，以及页面上**没有**插入按钮 —— 插入是编辑器的事，那里正文看得见、改得动、撤得回），以及组合的两半 —— **输入栏芯片**（按命名空间显示当前组合、菜单列出「不用组合」与各组合、选中只写 `activePreset` 这一个字段、内存模式页面拒绝切换、没有组合时指向设置页）和**组合页**（列表与「当前」徽标、成员勾选、新建时先向 Host 要 id 再写列表、删除当前组合时连 `activePreset` 一起清掉、设为当前 / 取消当前、导出组合包会把 Host 给的那份交给浏览器下载、Host 拒绝时页面照原话说出来、导入选中的文件原样 POST 出去、报告里点名所有被改过的 id 与做不到的事、不是 JSON 的文件在发请求之前就被拦下）。

测试按「本文件 → 当前目录的 `node_modules` → `DSH_PACKAGES`」三级解析 DSH 包，所以在 profile 目录下直接 `node /path/to/dsh-prompt-manager/test/smoke.mjs` 也能跑。测试全部离线：网络那一层用本地假镜像或桩 fetcher 覆盖。

想验证真实链路（会联网），把 `lib/net.js` 的 `createFetcher` 指向你的镜像，对一个真仓库跑一次 `checkSource` 即可 —— 实测 `gh-proxy.lolkda.top` 上：raw 经镜像 200 带 ETag、同一文件条件请求 304、atom feed 直连拿到 head sha。

## 注意

- **条目正文里可以写 `{{变量}}`**，但引用的名字要已注册。没注册的引用不会炸掉组装（插件会把它转义成字面量并记一条警告，见「未注册的引用按字面量渲染」），但**别把它当兜底**：那一段注入的就真是 `{{名字}}` 原文，模型看到的是一句带大括号的话，而不是你要的机器事实。
- **section 名是派生出来的**：每条固定注册为 `user:prompt-manager:<id>`，所以只要 id 不重复就不会和 `deployment:persona`、`harness:identity`、`app:web-surface` 这类已注册的 section 撞名。变量名撞上别的行时，这一项被跳过并记一条警告，挂载照常进行 —— 正文里那个 `{{名字}}` 于是变成字面量（同样有一条警告），等于这一行没提供它，所以看到警告要么给自己的变量改名，要么把引用删掉。
- **`package.json` 里的 `dsh.client`、`exports["./client"]` 和 `client/client.js` 必须同时在位**：只声明浏览器半边而没有 bundle，浏览器插件表在挂载时会直接报错（`declares dsh.client but exports no "./client" bundle`）。而且 **bundle 工厂的 `id` 必须等于包名** —— 客户端模块系统就是按包名把 bundle 和它的 Loader 行对起来的，所以现在这个 id 是 `@lolkda/dsh-prompt-manager`（3.0.0 之前是 `dsh-prompt-manager`）。
- **浏览器半边占两个插槽**：设置页在 `settings.section`（`client-ui-settings` 声明的），输入栏的组合芯片在 `conversation.input.right`（`client-ui-conversation` 声明的，工具行右侧、模型选择器左边）。所以 `dsh.client.inject` 里同时列了这两个包 —— 它决定的是加载顺序（让插槽的声明方先到），而这份元数据是**启动时快照**：新增或改动 inject 列表要重启 profile，只改 `client/client.js` 的内容仍然靠 HMR 原地重载。
- **改 `cordis.patch.yml` 会热加载**：`patchReload: live` 时 HMR 会为这个 patch 文件单独起一个精确 watcher，所以增删 row 不用重启。
- **改插件代码要重启，改浏览器半边不用**：DSH 不监听插件模块文件，而 loader 按 URL 缓存 ESM 模块，所以改完 `lib/` 必须重启 profile。
  浏览器半边不同：`dsh-client-hmr` 会轮询已注册 bundle 的文件基线，字节一变就调 `clientModules.rebuilt(id)` 并往 `/plugins/events` 推一帧 `rebuilt`，页面收到后 `invalidate(id, rev)` + `entry.refresh()` —— **原地重载，不用刷新页面**（实测：往 `client/client.js` 里加 25 字节，1 秒内就收到两帧，旧 rev → 新 rev）。
  部署**没挂** `dsh-client-hmr` 时没有这条链路：bundle 的 rev 不变、URL 带 `cache-control: immutable`，所以刷新页面也可能继续吃到旧副本，只能重启 profile。
- **改正文不用重启**：`sections/*.md` 每次组装现读；订阅正文在点过「应用」之后，也是下一次组装就生效。
- **加变量脚本不用重启**：脚本是数据文件，保存时插件自己注册新变量（实测：挂载之后调 `systemPrompt.variable()` 有效，下一次组装就读得到）。只有改 `lib/` 里的代码才要重启 profile。
- **脚本值不随会话变**：值在挂载或你点「重新测量」时测一次就固定下来 —— 这既是性能考虑，也是 KV cache 考虑：随每次组装变化的变量会让缓存前缀每步失效。会话相关的事实（模型、cwd 之类）归注册它们的插件所有，不在这个插件里造。
- **KV cache**：section 文本或顺序一变，缓存前缀从该点失效。文本稳定时开销只有一次。切换组合就是换一组 section，所以每切一次失效一次 —— 换来的是不用重启、不用重开会话。

## 结构

```
src/index.ts                插件入口：设置索引注册、section 调和、变量、路由装配（含组合的生效判定）
src/entries.ts              条目与组合的模型、id 语法、settings schema、内置条目与包内正文
src/store.ts                正文文件存储（路径限定、原子写、sha1 栅栏；脚本目录复用同一份）
src/scripts.ts              变量脚本：目录、异步执行、JSON 校验、缓存、保存/运行/删除
src/source.ts               订阅源：slug/id 派生、清单校验、镜像拼接、URL 构造
src/probe.ts                挂载时探测：命令取值规则、配置校验、结果兜底、默认探测组
src/guard.ts                引用护栏：把注册表解析不了的 {{...}} 转义成字面量
src/net.ts                  唯一出网口径：代理 dispatcher 与条件 GET
src/sync.ts                 源的三槽轮转：检查、应用、还原、state.json
src/subscriptions.ts        订阅引擎：源列表、检查/应用/还原、索引同步
src/pack.ts                 组合包格式：校验、导入计划、正文写入与回滚
src/routes.ts               /dsh-prompt-manager 路由与网关
client/client.js            浏览器半边（设置页 + 输入栏的组合芯片），手写的懒加载 CJS 工厂 bundle
lib/                        构建产物，loader 实际加载的文件
test/smoke.mjs              宿主行为冒烟测试（跑的是构建产物）
test/store.mjs              存储测试
test/probe.mjs              探测测试（注入 runner，末尾两个真命令）
test/guard.mjs              引用护栏测试（与真实 renderPrompt 交叉验证）
test/routes.mjs             路由测试
test/source.mjs             订阅源与清单测试
test/net.mjs                出网与代理测试（本地假镜像）
test/sync.mjs               检查/应用/还原测试
test/subscriptions.mjs      订阅引擎测试（位置表缓存、来源开关、索引重建）
test/pack.mjs               组合包测试（格式校验、导入计划、正文写入与回滚）
test/scripts.mjs            变量脚本测试（注入 runner，末尾真脚本与真超时）
test/client.mjs             浏览器 bundle 测试
tools/check-build.mjs       提交前核对 lib/ 是不是 src/ 的新构建
examples/cordis.patch.yml   可直接抄进 profile 的 patch 行（装了包就不需要写）
cordis.patch.yml            包自带的 bundle patch：装成依赖后 DSH 自动应用的那一层
environment.md              内置的机器环境条目正文（随包发布，可被本机正文覆盖）
tsconfig.json               构建与类型检查配置
```

## 开发

源码是 TypeScript，`lib/` 由 `tsc` 生成；浏览器半边是手写的 JS bundle，`npm run build` 只做语法检查（`node --check`），不需要打包器，因为它只 `require` 平台模块表里已有的 `react` 与 UI primitives：

```bash
npm install          # 只装开发依赖：typescript 与 DSH 类型包
npm run build        # src/*.ts -> lib/*.js + lib/types/*.d.ts，并检查 client/client.js
npm run typecheck    # tsc --noEmit
npm test             # 先构建，再跑十二个测试
npm run check:build  # 构建后核对 lib/ 没有未提交的改动（提交前跑）
```

清单里**没有生命周期脚本**（`prepare` 已换成 `prepublishOnly`）：`npm install` 不构建、git 安装也不构建，因为 `lib/`/`client/` 就是构建产物本身；`prepublishOnly` 只在 `npm publish` 时构建一次。这不是洁癖 —— pnpm 12 会拒绝执行 git 依赖的构建脚本（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），留着 `prepare` 等于让每个用 `dsh plugin add github:…` 装的人都撞一次墙。

### 包清单契约（照着做就能被 `dsh plugin` 装、被商城收录）

| 字段 | 本仓库的值 | 为什么 |
|---|---|---|
| `dsh.bundle.patch` | `./cordis.patch.yml` | DSH 靠它认「这是个 profile bundle」：装成依赖后**自动**进 `dsh.profile.bundles` 并应用这一层；商城没有它直接判 `SUBMISSION_BUNDLE_MISSING` |
| `dsh.client` | `{platform: 'web', inject: [...]}` + `exports["./client"]` | 浏览器半边；工厂 `id` 必须等于包名 |
| `dsh.compatibility.dshReleases` | 对官方最新三个版本逐版本写 `compatible`/`incompatible`/`unknown` | 商城上下架依据：三个版本里至少要有一个精确的 `compatible`，全 `unknown` 会被转 `unlisted` |
| `engines.node` | `>=22` | 商城会记录成兼容范围 |
| `publishConfig.access` | `public` | scoped 包默认私有，不写就发成私有包 |
| `files` | 必须含 `lib`、`client`、`cordis.patch.yml`、`environment.md` | 装出来的包要自洽 |
| 生命周期脚本 | 无 | 见上 |

包内 `cordis.patch.yml` 只 `insert` 自己这一行，`id` 用插件自有、不与别家条目撞的 id（商城会拿它和所有既有条目的 `entryIds` 比对），并且**不允许**出现 `name: '@deepseek-ai/…'` 这种冒充官方组件的行。

`lib/` 与 `client/` 都提交进仓库，所以克隆下来就能按相对路径挂载，不需要本地工具链 —— 这正是 `check:build` 存在的原因：**`lib/` 与 `src/` 必须同一个提交**，否则克隆出来挂载的是一份和源码对不上的代码（多出一个 `lib/foo.js` 而没被 `git add` 时尤其隐蔽，挂载会直接 `ERR_MODULE_NOT_FOUND`）。改完源码：`npm run build && npm test && npm run check:build && git add src lib client test README.md package.json package-lock.json && git commit`。

装成包来验证（不碰你自己的 profile）：`dsh plugin --profile pmcheck add git+file:///D:/path/to/checkout`，然后 `dsh --profile pmcheck --dump-config` 应该能看到 `id: dsh-prompt-manager` 那一行 —— 它是包内 `cordis.patch.yml` 自己插进去的，`pmcheck` 这个 profile 的 patch 文件从头到尾没动过。看完 `dsh plugin --profile pmcheck remove @lolkda/dsh-prompt-manager`，删掉 `$DSH_HOME/profiles/pmcheck` 即可。

在 profile 里用相对路径挂载时，`vendor/dsh-prompt-manager/` 是**另一份拷贝**，仓库里的改动不会自动过去：`npm run build` 之后要把 `lib/`（以及 `client/`、`environment.md` 这些随包发布的东西）同步过去，并重启 profile（宿主半边不热加载）。

宿主产物只 import `node:crypto` / `node:fs` / `node:module` / `node:os` / `node:path` / `node:url` / `node:http` 这几个内置模块；settings 需要的那份 `@deepseek-ai/schemastery` 是**运行时按需解析**的（取不到就不注册设置命名空间，设置页无从编辑，宿主照常挂载空索引），DSH 的包都只是 devDependencies，用来取类型。

## License

MIT
