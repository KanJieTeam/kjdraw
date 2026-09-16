# Try KJDraw in your AI client

Run one command from any directory. KJDraw installs for the current operating-system user and does not receive your model API key.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

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

The connector preserves unrelated JSON fields and MCP servers. It creates `~/.kjdraw/host.kjd` only when the user has no existing host drawing. Input drawings are opened read-only. AI tool calls create pending proposals; only the host application can approve and apply them. TraeCode still asks for one confirmation because its official install protocol deliberately keeps that security boundary in the client.

## Verify the connection

Restart the client, open any workspace, start a new conversation, and ask in your own words:

```text
用 KJDraw 画一个半径 5 毫米的圆。
```

You do not need to mention MCP, tool names, ledger files, or proposal IDs. The client should discover KJDraw from its user-level configuration. For a drawing request, KJDraw returns a compact exact proposal first; the host applies it according to that client's approval policy. This separation prevents an agent from silently overwriting the source drawing.

Verify all three signals:

1. The client calls a `kjdraw` MCP tool.
2. The result identifies KJDraw and remains pending review.
3. Your source drawing has not been overwritten.

User-level configuration and real-engine command-line smoke tests are covered by the repository tests. Independent GUI and real-model acceptance for all four clients remains a KJDraw 1.0 release gate; this page does not claim that gate has passed.

[中文说明](try-in-ai.zh-CN.md) · [Agent integration](agent.md) · [Release status](status.md)
