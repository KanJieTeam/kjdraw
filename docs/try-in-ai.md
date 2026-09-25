# Try KJDraw in your AI client

Run one command from any directory. KJDraw installs for the current operating-system user and does not receive your model API key.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

Run the command from a normal PowerShell opened by the same Windows account
that runs WorkBuddy, Kimi Code, or ZCode. If the shell belongs to a different
Administrator account, the installer warns that the desktop client account was
not configured.

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

Requirements: Node.js 22 or newer; macOS/Linux also need `curl` and `tar`. The bootstrap reads the repository-controlled [install channel](../scripts/install-ai-channel.json), validates its exact public commit SHA, and downloads that pinned source archive into a persistent user-data directory. TraeCode uses its official `trae-cn://` import confirmation. Git credentials are not required. The official installer explicitly replaces only the named `kjdraw` MCP entry and KJDraw Skill during an upgrade; unrelated MCP servers and configuration fields are preserved. Other configuration conflicts still stop installation.

## What changes in your user account

| Client | User-level MCP configuration | User Skill |
| --- | --- | --- |
| Kimi Code | `~/.kimi-code/mcp.json` | `~/.kimi-code/skills/kjdraw-cad/` |
| WorkBuddy | `~/.workbuddy/mcp.json` | Not auto-installed; its public documentation exposes marketplace/upload installation rather than a filesystem discovery path. |
| ZCode | `~/.zcode/cli/config.json` | `~/.zcode/skills/kjdraw-cad/` |
| TraeCode | Official import link saved at `~/.kjdraw/trae-install-url.txt` | `~/.trae/skills/kjdraw-cad/` |

The connector preserves unrelated JSON fields and MCP servers. It creates `~/.kjdraw/host.kjd` only when the user has no existing host drawing. The installed host policy materializes exact create proposals as new, independently reopened KJD/DXF files plus an SVG preview under `~/.kjdraw/results/`; it never overwrites the source. In-place and destructive operations still require host review. TraeCode still asks for one confirmation because its official install protocol deliberately keeps that security boundary in the client.

## Updating after installation

Run the same one-line command again to move to the currently promoted source commit. This is an in-place update; uninstalling or reconfiguring each project is unnecessary. Restart the AI client and start a new task so its MCP process loads the new runtime. The install channel is promoted only by an explicit maintainer change after candidate verification; it is not the moving tip of `main`, and the installer never silently downloads new executable code while an agent task is running.

After upgrading once to a runtime with knowledge delivery, the installed MCP launcher checks the official versioned geology JSON manifest when a new MCP process starts. Data-only geology pack updates can then arrive without reinstalling the runtime: the manifest and pack are fetched over HTTPS, checked against SHA-256 and schema limits, and cached for offline fallback. Restart the client and open a new task to load a newly published pack; an already running task will not change underfoot. Set `KJDRAW_KNOWLEDGE_UPDATES=off` to use bundled knowledge only. This does **not** remotely update executable code, other engineering domains, or old installations that have not yet upgraded to this launcher. Independent cross-version client acceptance remains pending. Installing a Skill alone does not update the CAD engine.

## Verify the connection

Restart the client, open any workspace, start a new conversation, and ask in your own words:

```text
用 KJDraw 画一个半径 5 毫米的圆。
```

You do not need to mention MCP, tool names, ledger files, or proposal IDs. The client should discover KJDraw from its user-level configuration. A create request returns `candidate-ready` with actual KJD, DXF, and SVG paths. In-place edits follow the client host's review policy. Neither route silently overwrites the source drawing.

Verify all three signals:

1. The client calls a `kjdraw` MCP tool.
2. A create result identifies KJDraw, reports `candidate-ready`, and includes KJD, DXF, and SVG candidate paths.
3. Your source drawing has not been overwritten.

User-level configuration and real-engine command-line smoke tests are covered by the repository tests. Independent GUI and real-model acceptance for all four clients remains a KJDraw 1.0 release gate; this page does not claim that gate has passed.

[中文说明](try-in-ai.zh-CN.md) · [Agent integration](agent.md) · [Release status](status.md)
