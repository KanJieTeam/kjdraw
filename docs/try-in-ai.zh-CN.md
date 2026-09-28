# 在智能体中使用 KJDraw

## Skill 优先的本地 CLI

支持终端的智能体默认让 `kjdraw-cad` Skill 调用 `kjdraw agent`，**不必**为 Codex、Claude Code 或 Cursor 注册 MCP。可用 [Skills CLI](https://github.com/vercel-labs/skills) 分发 Skill：

```sh
npx skills add KanJieTeam/kjdraw --skill kjdraw-cad -g -a codex -a claude-code -a cursor -y
```

Skill 是指令，不是 CAD 引擎。包含 `agent` 命令的 npm 包目前仍是**源码候选，尚未发布到 npm `next`**。在 KJDraw 源码检出目录运行 `node packages/kjdraw-sdk/bin/kjdraw.mjs agent tools cad_propose_circles`，可验证真实工具 schema；待包含此命令的 npm 包发布后，才可直接使用安装后的 `kjdraw` 命令。不要把 `npx skills add` 当作已经安装绘图运行时。

本地冒烟测试：在源码目录新建 `circle.json`，内容为 `{"expectedRevision":0,"units":"millimeter","circles":[{"center":{"x":0,"y":0},"radius":5}]}`，然后运行：

```sh
node packages/kjdraw-sdk/bin/kjdraw.mjs agent call cad_propose_circles --blank demo.kjd --units millimeter --args-file circle.json
```

返回 `.kjdraw/proposals/` 下的账本与 `awaiting-host-approval`；`demo.kjd` 保持空白。先查看提案，再由真人在**交互终端**执行下列审核命令，把路径替换成实际返回的账本与源码目录绝对路径：

```sh
node packages/kjdraw-sdk/bin/kjdraw-review.mjs --workspace <源码目录绝对路径> --ledger <返回的账本路径> --sequence 1 --candidate reviewed.kjd --approve
```

审核器将生成经独立检查的 KJD/DXF，不覆盖源图。`kjdraw agent tools <name>` 给出当前工具参数 schema；Skill 应优先选高层工程工具，而非逐个生成几百个基础图元。

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

## 源码候选的接入范围

下表描述当前源码候选；公开一行安装器锁定的渠道尚未提升到包含 Claude Code、Cursor 和 Codex Skill 的版本。不能据此认为公开安装器已经写入这些配置。

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

官方安装器会把 KJDraw Skill 复制到 Codex、Claude Code、Cursor 等已列出的客户端。若要给 [Skills CLI](https://github.com/vercel-labs/skills) 支持的其它智能体安装或更新同一个 Skill，可指定目标客户端：

```sh
npx skills add KanJieTeam/kjdraw --skill kjdraw-cad -g -a codex -a claude-code -a cursor -y
```

Skills CLI 也提供 `-a '*'` 批量分发给它支持的所有客户端。但 **Skill 只是一套使用说明**：不会安装 CAD 引擎，也不代表客户端与真实模型已经验收。具备终端的客户端装好运行时后可直接走上面的本地 CLI。没有终端、或明确希望使用原生工具注册的客户端仍可选择 MCP，并按各自格式配置[标准 stdio 服务条目](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/#zh-client-config)。

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

先用同一安装命令升级一次到具备知识分发能力的运行时。之后，已安装的 MCP 启动器在新进程启动时检查官方带版本的地质 JSON 清单；纯数据知识包更新无需再次安装运行时。清单与知识包经 HTTPS 下载，并通过 SHA-256、结构和大小限制校验；离线时回退到已验证缓存或内置知识。客户端需重启并新建对话才能载入新知识，运行中的任务不会变化。设 `KJDRAW_KNOWLEDGE_UPDATES=off` 可只使用内置知识。这不会远程更新可执行代码、其他领域知识，也不会自动升级仍使用旧启动器的安装。跨版本独立客户端验收仍待完成；仅更新 Skill 也不会更新 CAD 引擎。

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

## 当前候选状态

这是固定公开源码候选安装，不是 npm `latest` 发布证明。源码版本为 `1.0.0-rc.3`；npm `next` 可能仍是旧候选版，请以实时 `npm view @kanjieteam/kjdraw dist-tags` 为准；在新包完成版本、完整性、`gitHead` 与 provenance 验收前，不应把尚未发布的 npm 命令写成可用安装方式。

连接器与 CLI 已覆盖用户级路径、幂等安装、冲突拒绝、事务回滚、PowerShell 5.1、MCP 启动和只读诊断。各客户端的真实 GUI 与真实模型独立验收仍是正式 1.0 发布门槛，不能由自动化文件测试替代。
