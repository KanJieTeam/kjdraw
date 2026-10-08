# 在智能体中使用 KJDraw

## Skill 优先的本地 CLI

在支持终端的智能体中，安装 Node.js 22+、已发布的 CAD 运行时和 `kjdraw-cad` Skill。Codex、Claude Code、Cursor 走这条路线**不必注册 MCP**：

```sh
npm install -g @kanjieteam/kjdraw
npx skills add KanJieTeam/kjdraw -g
```

Skills CLI 会找到仓库中唯一的 `kjdraw-cad` Skill，并检测本机已安装的智能体；如有提示，选择目标即可。它只安装指令，**不会安装 CAD 引擎**；前一行 npm 命令负责安装引擎。用 `kjdraw agent tools cad_propose_circles` 验证安装。只想临时查看工具时也能运行 `npx --yes --package=@kanjieteam/kjdraw@1.0.0-rc.4 kjdraw agent tools cad_propose_circles`，但日常使用 Skill 仍需要持久可用的 `kjdraw` 命令。

本地冒烟测试：在测试工作区新建 `circle.json`，内容为 `{"expectedRevision":0,"units":"millimeter","circles":[{"center":{"x":0,"y":0},"radius":5}]}`，然后在该目录运行：

```sh
kjdraw agent call cad_propose_circles --blank demo.kjd --units millimeter --args-file circle.json
```

返回 `.kjdraw/proposals/` 下的账本与 `awaiting-host-approval`；不会改动源图。先查看提案，再由真人在**交互终端**执行下列审核命令，把路径替换成实际返回的账本与工作区绝对路径：

```sh
kjdraw-review --workspace <工作区绝对路径> --ledger <返回的账本路径> --sequence 1 --candidate reviewed.kjd --approve
```

审核器将生成经独立检查的 KJD/DXF，不覆盖源图。`kjdraw agent tools <name>` 给出当前工具参数 schema；Skill 应优先选高层工程工具，而非逐个生成几百个基础图元。

批准后，在同一测试工作区分别重开检查：

```sh
kjdraw inspect reviewed.kjd
kjdraw inspect reviewed.dxf
```

两个命令都应报告 `valid: true` 和预期实体；只有待审提案不算完成图纸。要复验**实际发布的 npm 包**而非仓库源码，可将 `@kanjieteam/kjdraw@1.0.0-rc.4` 安装到隔离目录，在源码检出中运行 `node scripts/audits/verify-published-agent-first-use.mjs --package-root <隔离目录/node_modules/@kanjieteam/kjdraw>`。脚本中的批准是自动化冒烟测试夹具，不能算独立真人或真实模型验收。

## 浏览器对话：数据流与边界

独立的 [KJDraw AI 对话页](https://kanjieteam.github.io/kjdraw/ai/) 是可选的自带 Key 预览版。GitHub Pages 静态页面把 API Key 放在授权请求头中，**直接发送到你填写的 HTTPS 模型接口**；请求还包含你的输入、最近对话及本次绘图所需的图纸上下文。KJDraw 没有托管模型代理。只有在你信任该接口且有权分享图纸数据时才应使用。

对话、图纸及模型连接配置（**包括明文 API Key**）保存在此浏览器的 IndexedDB 中，刷新后可继续使用；KJDraw 不提供服务端同步。清除本站数据会一并删除这些内容，在共用电脑上请在离开前清除。请求不携带浏览器登录凭据、拒绝重定向；模型接口还必须允许浏览器跨域访问，因此不少服务商的原生 API 无法直接连接。页面使用仅允许本站脚本的 CSP 元标签，且不加载第三方脚本，但静态站的 CSP 元标签**不能替代服务端安全响应头或独立安全认证**。当前浏览器测试使用模拟模型响应，不能算各服务商真实接口验收。每次 CAD 修改仍须审阅并批准。

## 现有的可选 MCP 安装器

在任意目录运行一次安装命令，KJDraw 就会安装到当前操作系统用户，而不是绑定当前项目。模型 API Key 始终由智能体客户端保管，KJDraw 不收集 Key。

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

请在启动 WorkBuddy、Kimi Code 或 ZCode 的同一 Windows 账号下打开普通 PowerShell，
不要切换到另一个 `Administrator` 账号执行。安装器只写入当前账号；账号不一致时会
明确警告，不会把“下载成功”误报成桌面客户端已经更新。

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

要求 Node.js 22 或更新版本；macOS/Linux 还需要 `curl` 与 `tar`。安装器读取仓库维护的[安装渠道清单](../scripts/install-ai-channel.json)，校验其中精确的公开提交 SHA，再下载该提交；不依赖 Git 凭据，也不会使用临时 `npx` 缓存作为长期 MCP 入口。

## 可选 MCP 接入范围

下表描述当前连接器代码，并不保证单独锁定版本的一行 MCP 安装器与 npm 包相同。Codex、Claude Code、Cursor 优先使用上面的 npm + Skill 路线。选择 MCP 时，请先核对[安装器锁定的提交](../scripts/install-ai-channel.json)，不要仅凭表格判断客户端配置已经写入。

| 客户端 | 当前用户 MCP 配置 | 当前用户 Skill | 生效范围 |
| --- | --- | --- | --- |
| Kimi Code | `~/.kimi-code/mcp.json` | `~/.kimi-code/skills/kjdraw-cad/` | 所有工作区 |
| WorkBuddy | `~/.workbuddy/mcp.json` | 官方没有公开可安全写入的本地 Skill 发现路径 | 所有工作区 |
| ZCode | `~/.zcode/cli/config.json` | `~/.zcode/skills/kjdraw-cad/` | 所有工作区 |
| TraeCode | 官方 `trae-cn://` 导入确认 | `~/.trae/skills/kjdraw-cad/` | 确认后由客户端全局管理 |
| Claude Code | `~/.claude.json` 中的 `mcpServers.kjdraw` | `~/.claude/skills/kjdraw-cad/` | 所有工作区 |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/kjdraw-cad/` | 所有工作区 |
| Codex | 使用下方的 `codex mcp add` 注册 | `~/.codex/skills/kjdraw-cad/` | 所有工作区 |

KJDraw 的共享可编辑宿主图纸位于 `~/.kjdraw/host.kjd`，审计提案位于 `~/.kjdraw/proposals/`，独立候选图位于 `~/.kjdraw/results/`。TraeCode 的官方导入链接同时保存在 `~/.kjdraw/trae-install-url.txt`；如果系统已经注册 TraeCode，安装器会打开一次确认窗口。

TraeCode 保留一次客户端确认是它的官方安全边界。KJDraw 不通过猜测内部文件路径来绕过确认，也不会把项目级 `.trae/mcp.json` 冒充用户级配置。

## Codex 与通用 Skill

上方的 `npx skills add` 命令会把 KJDraw Skill 安装到 `-a` 指定的智能体。要给 [Skills CLI](https://github.com/vercel-labs/skills) 支持的其他智能体安装或更新同一个 Skill，换成对应的 `-a` 参数即可：

```sh
npx skills add KanJieTeam/kjdraw --skill kjdraw-cad -g -a codex -a claude-code -a cursor -y
```

Skills CLI 也提供 `-a '*'` 批量分发给它支持的所有客户端。但 **Skill 只是一套使用说明**：CAD 引擎要按上面的 npm 命令另行安装。没有终端、或明确希望使用原生工具注册的客户端仍可选择 MCP，并按各自格式配置[标准 stdio 服务条目](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/#zh-client-config)。

**仅当选择可选 MCP 路线时**，Codex 才需要按 [Codex 官方 MCP 命令](https://learn.chatgpt.com/docs/extend/mcp)注册稳定启动器；本地 CLI 路线不需要。Codex 使用独立 TOML 配置，KJDraw 安装器不会直接改写它。Windows PowerShell：

```powershell
$kjdrawMcp = Join-Path $env:LOCALAPPDATA 'KJDraw\bin\kjdraw-mcp.mjs'
codex mcp add kjdraw -- node $kjdrawMcp --workspace $env:USERPROFILE --input .kjdraw/host.kjd --proposal-dir .kjdraw/proposals --candidate-dir .kjdraw/results
codex mcp list
```

macOS/Linux：

```sh
kjdraw_mcp="${XDG_DATA_HOME:-$HOME/.local/share}/kjdraw/bin/kjdraw-mcp.mjs"
codex mcp add kjdraw -- node "$kjdraw_mcp" --workspace "$HOME" --input .kjdraw/host.kjd --proposal-dir .kjdraw/proposals --candidate-dir .kjdraw/results
codex mcp list
```

如果 Codex 中已存在 `kjdraw` 服务，先用 `codex mcp list` 核对，不要盲目覆盖；也不要让 Codex 长期指向临时 `npx` 缓存。重新启动 Codex 并新建会话，按下方的圆形冒烟用例核对真实 MCP 调用和候选文件。Claude Code、Cursor 的 MCP 条目由安装器配置，但仍需重启并做同样的真实客户端检查。

## 安全边界

- 安装器精确合并 `kjdraw` 条目，保留其它 MCP 服务和无关配置字段。
- 官方安装器显式替换同名的 `kjdraw` MCP 条目和 KJDraw Skill，以完成原位升级；其它 MCP 服务和无关配置字段保持不变。其它配置冲突仍会拒绝安装。
- 若 ZCode 的用户级 `~/.agents/mcp.json` 已有活动服务，安装器会拒绝创建可能遮蔽它的原生配置，要求先人工合并。
- KJDraw MCP 不允许模型选择输出路径或覆盖源图。安装器显式启用的宿主策略只会把精确的新建提案物化为新的 KJD、DXF 与 SVG 候选文件；原位修改与破坏性操作仍保留宿主审核。
- 配置文件存在只能证明安装结果，不能证明某个 GUI 已加载 MCP，也不能证明所选模型实际调用了工具。

## 后续更新

以后运行同一条一行命令即可切换到安装渠道已提升的精确源码提交；这是原位更新，不必先卸载，也不用逐个项目重新配置。更新后完全退出并重启客户端，再开一个新对话，让新的 MCP 进程载入运行时。渠道不是随 `main` 自动移动的分支头；维护者应在候选验证通过后显式提升，正在执行的智能体任务不会静默下载并执行新代码。

地质知识随运行时一同提供。已发布的 rc.4 **默认关闭远程地质知识更新**：仓库中的可变 JSON 清单只有 SHA-256，没有可独立验证发布者身份的签名；哈希不能替代签名。此改动**不会自动修复已经安装的 rc.3 包或旧安装渠道固定的启动器**；这些旧安装应在启动环境中设置 `KJDRAW_KNOWLEDGE_UPDATES=off`，直到升级运行时。未来须在发布包内固定验证公钥，并为清单签名后，才能重新开放远程或缓存知识。升级后重启客户端；只更新 Skill 不会更新 CAD 引擎。

## 验证是否真正调用 KJDraw

安装完成后重启目标客户端，在任意工作区新建对话，直接用自然语言输入：

```text
用 KJDraw 画一个半径 5 毫米的圆。
```

不需要写 MCP、工具名、ledger 文件或 plan ID。客户端会从用户级配置自动发现 KJDraw。新建类请求完成后会返回 `candidate-ready` 以及实际 KJD、DXF、SVG 路径；原位修改则按宿主客户端的审核策略执行。两条路径都不会静默覆盖源图。

验收时必须同时看到：

1. 智能体调用名称带 `kjdraw` 的 MCP 工具；
2. 新建请求返回 `candidate-ready`，并给出 KJD、DXF、SVG 三种独立候选文件；
3. `~/.kjdraw/host.kjd` 保持可重开且未被覆盖，提案和候选图分别写入独立目录；
4. 客户端界面能识别 KJDraw 名称或 Skill，而不是仅由模型口头声称“已经绘图”。

## 版本与验收

当前源码发布目标为 `1.0.0`，正式渠道使用 `latest`；以 `npm view @kanjieteam/kjdraw dist-tags` 查询实际发布结果。上面的一行 MCP 安装器使用单独锁定的旧源码渠道，不等于 npm 安装；优先使用本文开头的 npm＋Skill 路线。

连接器与 CLI 已覆盖用户级路径、幂等安装、冲突拒绝、事务回滚、PowerShell 5.1、MCP 启动和只读诊断。客户端真实 GUI、独立用户及跨模型验收仍是后续工作；本地自动化测试不能冒称这些验收已经通过。
