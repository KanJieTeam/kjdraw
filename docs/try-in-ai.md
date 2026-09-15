# Try KJDraw in your AI client

Run one command from the project you want to connect. KJDraw does not receive your model API key.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

Requirements: Node.js 22 or newer; macOS/Linux also need `curl` and `tar`. The bootstrap downloads a pinned public source archive into a persistent user-data directory, then writes project configuration for Kimi Code, WorkBuddy, ZCode, and TraeCode in one transaction. It does not need Git credentials. If an existing KJDraw entry or Skill has different content, installation stops instead of overwriting it.

## What changes in your project

| Client | MCP configuration | Project Skill |
| --- | --- | --- |
| Kimi Code | `.kimi-code/mcp.json` | `.kimi-code/skills/kjdraw-cad/` |
| WorkBuddy | `.workbuddy/mcp.json` | Not auto-installed; its public documentation exposes marketplace/upload installation rather than a filesystem discovery path. |
| ZCode | `.zcode/config.json` | `.zcode/skills/kjdraw-cad/` |
| TraeCode | `.trae/mcp.json` | `.trae/skills/kjdraw-cad/` |

The connector preserves unrelated JSON fields and MCP servers. It creates `.kjdraw/host.kjd` only when the project has no existing host drawing. Input drawings are opened read-only. AI tool calls create pending proposals; only the host application can approve and apply them.

## Verify the connection

Restart the client, open the same project, start a new conversation, and ask:

```text
Use KJDraw to read the current drawing, then draw a circle with a 5 mm radius. Create a pending proposal only.
```

Verify all three signals:

1. The client calls a `kjdraw` MCP tool.
2. The result identifies KJDraw and remains pending review.
3. Your source drawing has not been overwritten.

Project configuration and real-engine command-line smoke tests are covered by the repository tests. Independent GUI and real-model acceptance for all four clients remains a KJDraw 1.0 release gate; this page does not claim that gate has passed.

[中文说明](try-in-ai.zh-CN.md) · [Agent integration](agent.md) · [Release status](status.md)
