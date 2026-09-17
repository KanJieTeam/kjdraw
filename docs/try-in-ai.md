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

Requirements: Node.js 22 or newer; macOS/Linux also need `curl` and `tar`. The bootstrap downloads a pinned public source archive into a persistent user-data directory, then safely merges user-level configuration for Kimi Code, WorkBuddy, and ZCode. TraeCode uses its official `trae-cn://` import confirmation. It does not need Git credentials. If an existing KJDraw entry or Skill has different content, installation stops instead of overwriting it.

## What changes in your user account

| Client | User-level MCP configuration | User Skill |
| --- | --- | --- |
| Kimi Code | `~/.kimi-code/mcp.json` | `~/.kimi-code/skills/kjdraw-cad/` |
| WorkBuddy | `~/.workbuddy/mcp.json` | Not auto-installed; its public documentation exposes marketplace/upload installation rather than a filesystem discovery path. |
| ZCode | `~/.zcode/cli/config.json` | `~/.zcode/skills/kjdraw-cad/` |
| TraeCode | Official import link saved at `~/.kjdraw/trae-install-url.txt` | `~/.trae/skills/kjdraw-cad/` |

The connector preserves unrelated JSON fields and MCP servers. It creates `~/.kjdraw/host.kjd` only when the user has no existing host drawing. The installed host policy materializes exact create proposals as new, independently reopened KJD/DXF files plus an SVG preview under `~/.kjdraw/results/`; it never overwrites the source. In-place and destructive operations still require host review. TraeCode still asks for one confirmation because its official install protocol deliberately keeps that security boundary in the client.

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
