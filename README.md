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
cd "$DSH_HOME/profiles/web"
mkdir -p vendor
cp -r /path/to/dsh-ctf-prompt vendor/
```

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

## 验证

挂载后新开一个会话，看开场是否出现 `## CTF Core Contract`。也可以确认这一行确实被组合进了配置：

```bash
dsh --profile web --dump-config
```

仓库自带一个 smoke test，它把插件挂进真实的 `SystemPrompt` 注册表并跑一次 `assemble()`，断言 section 落在 persona 之后、契约文本进入渲染结果：

```bash
DSH_PACKAGES="$DSH_HOME/profiles/node_modules/@deepseek-ai" node test/smoke.mjs
```

它按「本文件 → 当前目录的 `node_modules` → `DSH_PACKAGES`」三级解析 DSH 包，所以在 profile 目录下直接 `node /path/to/dsh-ctf-prompt/test/smoke.mjs` 也能跑。

## 注意

- **不要写 `{{...}}`**。DSH 对 section 文本做严格变量插值，未注册的变量、注册了但返回 `undefined` 的变量、畸形的 `{{` 都会让 `assemble()` 抛错，而且没有转义语法。目前 `contract.md` 里没有这类写法。
- **`sectionName` 不能和已注册的重名**（例如 `deployment:persona`、`harness:identity`、`app:web-surface`），否则挂载即失败。
- **改 `cordis.patch.yml` 会热加载**（该 profile 是 `patchReload: live`）；新增 `.js` 文件后建议重启 profile。
- **KV cache**：section 文本或顺序一变，缓存前缀从该点失效。契约文本稳定时开销只有一次。

## 结构

```
contract.md             提示词正文（唯一需要改的文件）
lib/index.js            插件：注册 section
examples/cordis.patch.yml  可直接抄进 profile 的 patch 行
```

## License

MIT
