# 在智能体中使用 KJDraw

在任意目录运行一次安装命令，KJDraw 就会安装到当前操作系统用户，而不是绑定当前项目。模型 API Key 始终由智能体客户端保管，KJDraw 不收集 Key。

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

要求 Node.js 22 或更新版本；macOS/Linux 还需要 `curl` 与 `tar`。安装器下载固定公开提交，不依赖 Git 凭据，也不会使用临时 `npx` 缓存作为长期 MCP 入口。

## 安装到哪里

| 客户端 | 当前用户 MCP 配置 | 当前用户 Skill | 生效范围 |
| --- | --- | --- | --- |
| Kimi Code | `~/.kimi-code/mcp.json` | `~/.kimi-code/skills/kjdraw-cad/` | 所有工作区 |
| WorkBuddy | `~/.workbuddy/mcp.json` | 官方没有公开可安全写入的本地 Skill 发现路径 | 所有工作区 |
| ZCode | `~/.zcode/cli/config.json` | `~/.zcode/skills/kjdraw-cad/` | 所有工作区 |
| TraeCode | 官方 `trae-cn://` 导入确认 | `~/.trae/skills/kjdraw-cad/` | 确认后由客户端全局管理 |

KJDraw 的共享可编辑宿主图纸位于 `~/.kjdraw/host.kjd`，待审核提案位于 `~/.kjdraw/proposals/`。TraeCode 的官方导入链接同时保存在 `~/.kjdraw/trae-install-url.txt`；如果系统已经注册 TraeCode，安装器会打开一次确认窗口。

TraeCode 保留一次客户端确认是它的官方安全边界。KJDraw 不通过猜测内部文件路径来绕过确认，也不会把项目级 `.trae/mcp.json` 冒充用户级配置。

## 安全边界

- 安装器精确合并 `kjdraw` 条目，保留其它 MCP 服务和无关配置字段。
- 已存在但内容不同的 `kjdraw` 条目或 Skill 会阻止整个事务，不会被强制覆盖。
- 若 ZCode 的用户级 `~/.agents/mcp.json` 已有活动服务，安装器会拒绝创建可能遮蔽它的原生配置，要求先人工合并。
- KJDraw MCP 只读取宿主图纸；模型产生的是待审核提案，不能自行批准或覆盖源图。
- 配置文件存在只能证明安装结果，不能证明某个 GUI 已加载 MCP，也不能证明所选模型实际调用了工具。

## 验证是否真正调用 KJDraw

安装完成后重启目标客户端，在任意工作区新建对话，直接用自然语言输入：

```text
用 KJDraw 画一个半径 5 毫米的圆。
```

不需要写 MCP、工具名、ledger 文件或 plan ID。客户端会从用户级配置自动发现 KJDraw。对于会改图的请求，KJDraw 先返回紧凑且精确的候选修改，再由宿主客户端按自身的审核策略应用；这是刻意保留的安全边界，避免智能体静默覆盖源图。

验收时必须同时看到：

1. 智能体调用名称带 `kjdraw` 的 MCP 工具；
2. 返回结果是待宿主审核，而不是直接覆盖图纸；
3. `~/.kjdraw/host.kjd` 保持可重开，提案写入独立目录；
4. 客户端界面能识别 KJDraw 名称或 Skill，而不是仅由模型口头声称“已经绘图”。

## 当前候选状态

这是固定公开源码候选安装，不是 npm `latest` 发布证明。源码版本仍为 `1.0.0-rc.3`，npm `next` 仍为 `1.0.0-rc.2`；在新包完成版本、完整性、`gitHead` 与 provenance 验收前，不应把尚未发布的 npm 命令写成可用安装方式。

连接器与 CLI 已覆盖用户级路径、幂等安装、冲突拒绝、事务回滚、PowerShell 5.1、MCP 启动和只读诊断。四个客户端的真实 GUI 与真实模型独立验收仍是正式 1.0 发布门槛，不能由自动化文件测试替代。
