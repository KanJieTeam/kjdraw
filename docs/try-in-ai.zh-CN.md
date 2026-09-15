# Try with AI

在你的项目目录中运行一条命令，即可把 KJDraw 接入当前支持的 AI 客户端。无需分别配置四次，也无需把模型 API Key 交给 KJDraw。

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

安装器要求 Node.js 22 或更新版本；macOS/Linux 还需要 `curl` 与 `tar`。它会下载固定提交的公开源码归档，不依赖 Git 凭据；随后在一次事务中配置 Kimi Code、WorkBuddy、ZCode 和 TraeCode，并在项目中建立 `.kjdraw/host.kjd`。发现同名配置或 Skill 内容冲突时会拒绝写入，不会强制覆盖。

安装完成后重启客户端，用它打开同一项目并输入：`使用 KJDraw 读取当前图纸，然后画一个半径 5 mm 的圆；只生成待审核提案。` 看到 `kjdraw` 工具调用、待审核状态与本地 KJDraw 标识，才算实际调用了 KJDraw。

## 当前候选状态

当前可公开复现的手动固定源码候选是：

```text
466d8be59e1be68dea19043427b4ec9f6295c0ee
```

这是源码候选安装，不是 npm 发布证明。`@kanjieteam/kjdraw@1.0.0-rc.3` 尚未发布；发布前不要把 `npm install ...@1.0.0-rc.3` 或 `npx` 写成可用安装方式。下面的命令把源码固定安装到持久目录，不会把临时 `_npx` 缓存写入 MCP 配置。

命令行测试已经覆盖四份 MCP 配置、三份原生项目 Skill、圆形 KJD/DXF 落盘重开和一次 `cad_read_drawing` 调用，但尚未在四个客户端 GUI 中逐一验证，也没有调用真实模型。

## 前置条件

- 安装 Git 和 Node.js 22 或更新版本。
- 终端以及四个客户端进程的 `PATH` 都必须能找到同一个持久安装的 `node`。macOS 从 Finder 启动应用时尤其需要核对这一点。
- 准备一个已存在的真实项目目录；不能使用符号链接。项目根目录不能放置会遮蔽系统 Node.js 的 `node`、`node.exe`、`node.cmd` 或类似启动文件。
- 关闭正在修改该项目配置的客户端。安装完成后重新打开项目并建立新会话。

## Windows PowerShell：手动固定 SHA 安装（可选）

只替换第一段中的 `C:\REPLACE\WITH\ABSOLUTE\PROJECT`，必须填写项目的绝对路径。整行在 PowerShell 中运行：

```powershell
$ErrorActionPreference='Stop'; $KJ_PROJECT='C:\REPLACE\WITH\ABSOLUTE\PROJECT'; $KJ_INSTALL=Join-Path $env:LOCALAPPDATA 'KJDraw-source-466d8be'; $KJ_SHA='466d8be59e1be68dea19043427b4ec9f6295c0ee'; if(-not [IO.Path]::IsPathRooted($KJ_PROJECT) -or -not (Test-Path -LiteralPath $KJ_PROJECT -PathType Container)){throw 'Replace KJ_PROJECT with an existing absolute project directory'}; Get-Command node,git -CommandType Application -ErrorAction Stop | Out-Null; node -e "if(+process.versions.node.split('.')[0]<22)process.exit(1)"; if($LASTEXITCODE){throw 'Node.js >=22 is required'}; if(Test-Path -LiteralPath $KJ_INSTALL){throw 'Pinned install directory already exists; inspect it instead of overwriting it'}; git clone --filter=blob:none --no-checkout https://github.com/KanJieTeam/kjdraw.git $KJ_INSTALL; if($LASTEXITCODE){throw 'git clone failed'}; git -C $KJ_INSTALL checkout --detach $KJ_SHA; if($LASTEXITCODE){throw 'git checkout failed'}; $KJ_ACTUAL=(git -C $KJ_INSTALL rev-parse HEAD).Trim(); if($KJ_ACTUAL -ne $KJ_SHA){throw 'Public source SHA verification failed'}; node (Join-Path $KJ_INSTALL 'packages/kjdraw-sdk/bin/kjdraw-connect.mjs') --all --apply --workspace $KJ_PROJECT --blank '.kjdraw/host.kjd' --units millimeter
```

## macOS：手动固定 SHA 安装（可选）

只替换第一段中的 `/REPLACE/WITH/ABSOLUTE/PROJECT`，必须填写项目的绝对路径。整行在 `sh`、`bash` 或 `zsh` 中运行：

```sh
set -eu; KJ_PROJECT='/REPLACE/WITH/ABSOLUTE/PROJECT'; KJ_INSTALL="$HOME/.kjdraw-source-466d8be"; KJ_SHA='466d8be59e1be68dea19043427b4ec9f6295c0ee'; case "$KJ_PROJECT" in /*) ;; *) echo 'KJ_PROJECT must be absolute' >&2; exit 1;; esac; [ -d "$KJ_PROJECT" ] || { echo 'project directory not found' >&2; exit 1; }; command -v node >/dev/null; command -v git >/dev/null; node -e 'if(+process.versions.node.split(".")[0]<22)process.exit(1)'; [ ! -e "$KJ_INSTALL" ] || { echo 'pinned install directory exists; refusing overwrite' >&2; exit 1; }; git clone --filter=blob:none --no-checkout https://github.com/KanJieTeam/kjdraw.git "$KJ_INSTALL"; git -C "$KJ_INSTALL" checkout --detach "$KJ_SHA"; [ "$(git -C "$KJ_INSTALL" rev-parse HEAD)" = "$KJ_SHA" ]; node "$KJ_INSTALL/packages/kjdraw-sdk/bin/kjdraw-connect.mjs" --all --apply --workspace "$KJ_PROJECT" --blank '.kjdraw/host.kjd' --units millimeter
```

命令会新建 `.kjdraw/host.kjd`，一次性接入四家 MCP，并从包内同一个 KJDraw Skill 源安装各客户端公开支持的项目级 Skill：

| 客户端 | MCP 项目配置 | Skill 项目位置 | 安装后动作 |
| --- | --- | --- | --- |
| Kimi Code CLI | `.kimi-code/mcp.json` | `.kimi-code/skills/kjdraw-cad/` | 新建会话，可用 `/skill:kjdraw-cad` 核验 |
| WorkBuddy | `.workbuddy/mcp.json` | 官方只公开市场/上传安装，没有文件发现路径 | MCP 自动接入；Skill 不伪造自动安装 |
| ZCode | `.zcode/config.json` | `.zcode/skills/kjdraw-cad/` | 设置 → 技能 → 刷新并确认启用 |
| TraeCode | `.trae/mcp.json` | `.trae/skills/kjdraw-cad/` | 启用项目级 MCP，重启客户端 |

三份 Skill 都逐文件复制自同一个已打包源，并记录统一 SHA-256。目标不存在才创建；若同名 Skill 内容不一致，整个事务会在写入前拒绝，不覆盖用户文件。WorkBuddy 仍可通过 MCP 工具调用 KJDraw，但其官方文档没有公开可由命令安全写入的 Skill 目录，因此当前不宣称 Skill 自动注册。

连接器不会替换不一致的现有 `kjdraw` 条目：发现冲突时，四份配置和空白图纸都不会写入。添加条目时会保留其它 JSON 字段和 MCP 服务，但 JSON 排版可能被规范化。若 ZCode 的 `.agents/mcp.json` 已有活动服务，连接器也会拒绝创建会遮蔽它的原生配置；请先在 ZCode 中人工合并。

如果项目已有要读取的 KJD 或 DXF，请把命令末尾的：

```text
--blank '.kjdraw/host.kjd' --units millimeter
```

替换为相对项目根目录的输入路径，例如：

```text
--input 'drawings/example.kjd'
```

输入图纸只供 MCP host 读取；AI 只能产生待宿主审核的修改提案，不能自行批准或覆盖输入图纸。

## 本地冒烟测试

安装连接成功后，可在同一终端运行离线测试。它会在项目中建立一个 `kjdraw-smoke-*` 目录，验证圆形创建、撤销/重做、KJD/DXF 写入重开，以及 MCP 的 `cad_read_drawing`；它不会调用模型。

Windows PowerShell：

```powershell
node (Join-Path $KJ_INSTALL 'packages/kjdraw-sdk/bin/kjdraw-connect.mjs') --smoke-circle --workspace $KJ_PROJECT
```

macOS：

```sh
node "$KJ_INSTALL/packages/kjdraw-sdk/bin/kjdraw-connect.mjs" --smoke-circle --workspace "$KJ_PROJECT"
```

成功结果应包含 `"fixtureOnly": true`、`"realModelInvoked": false`、`"tool": "cad_read_drawing"`，并显示 KJD 与 DXF 的 `diskReopen.valid` 均为 `true`。这只证明本地引擎和 MCP 进程可工作，不证明四个 GUI 已连接，也不证明真实模型的工具调用兼容性或工程图质量。

最后分别用四个客户端打开同一个项目，确认项目受信任、项目级 MCP 已启用并能看到 `kjdraw`。新建会话后先调用只读的 `cad_read_drawing`。客户端是否成功启动 MCP、是否把工具交给所选模型，必须在目标电脑上逐一观察，不能从配置文件存在推断。

## npm `1.0.0-rc.3` 发布后

发布完成并核对 npm 的版本、`gitHead`、完整性和 provenance 后，才能把源码候选命令替换为固定版本的持久 npm 安装。即使届时也不要使用一次性 `npx` 进程生成持久 MCP 配置；应先安装到稳定目录，再从该目录运行 `kjdraw-connect`。发布状态和核验方式见 [npm package and publishing](npm-publishing.md)。
