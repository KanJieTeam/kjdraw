# Try KJDraw in your AI client

## Skill-first local CLI

For a terminal-capable agent, install Node.js 22+, the published CAD runtime, and the `kjdraw-cad` Skill. Codex, Claude Code and Cursor do **not** need an MCP entry for this route:

```sh
npm install -g @kanjieteam/kjdraw@next
npx skills add KanJieTeam/kjdraw --skill kjdraw-cad -g -a codex -a claude-code -a cursor -y
```

Keep only the `-a` options for agents you use. `npx skills add` installs instructions, **not** the CAD engine; the global npm command installs the engine. Verify the installed CLI with `kjdraw agent tools cad_propose_circles`. If you only want to inspect a tool without installing globally, `npx --yes --package=@kanjieteam/kjdraw@1.0.0-rc.3 kjdraw agent tools cad_propose_circles` also works, but the Skill needs a persistent `kjdraw` command for normal use.

For a local smoke test, create `circle.json` in a test workspace containing `{"expectedRevision":0,"units":"millimeter","circles":[{"center":{"x":0,"y":0},"radius":5}]}`, then run there:

```sh
kjdraw agent call cad_propose_circles --blank demo.kjd --units millimeter --args-file circle.json
```

The result gives a `.kjdraw/proposals/` ledger and says `awaiting-host-approval`; the source drawing is not modified. Inspect the returned proposal. A human can then run the review command in an **interactive terminal**, substituting the exact ledger path and absolute workspace path:

```sh
kjdraw-review --workspace <absolute-workspace-path> --ledger <returned-ledger-path> --sequence 1 --candidate reviewed.kjd --approve
```

The reviewer writes independently checked KJD/DXF candidates without overwriting the source. `kjdraw agent tools <name>` provides the live argument schema; the Skill should use a high-level drawing tool rather than emit hundreds of primitives.

## Existing optional MCP installer

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

## Optional MCP connector coverage

The table describes the current connector code, not a guarantee that the separately pinned one-line MCP installer has the same version. Use the Skill-first npm setup above for Codex, Claude Code and Cursor. For the MCP route, check the [installer's pinned commit](../scripts/install-ai-channel.json) before assuming a client entry was configured.

| Client | User-level MCP configuration | User Skill |
| --- | --- | --- |
| Kimi Code | `~/.kimi-code/mcp.json` | `~/.kimi-code/skills/kjdraw-cad/` |
| WorkBuddy | `~/.workbuddy/mcp.json` | Not auto-installed; its public documentation exposes marketplace/upload installation rather than a filesystem discovery path. |
| ZCode | `~/.zcode/cli/config.json` | `~/.zcode/skills/kjdraw-cad/` |
| TraeCode | Official import link saved at `~/.kjdraw/trae-install-url.txt` | `~/.trae/skills/kjdraw-cad/` |
| Claude Code | `~/.claude.json` (`mcpServers.kjdraw`) | `~/.claude/skills/kjdraw-cad/` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/kjdraw-cad/` |
| Codex | Register MCP with `codex mcp add` below | `~/.codex/skills/kjdraw-cad/` |

The connector preserves unrelated JSON fields and MCP servers. It creates `~/.kjdraw/host.kjd` only when the user has no existing host drawing. The installed host policy materializes exact create proposals as new, independently reopened KJD/DXF files plus an SVG preview under `~/.kjdraw/results/`; it never overwrites the source. In-place and destructive operations still require host review. TraeCode still asks for one confirmation because its official install protocol deliberately keeps that security boundary in the client.

## Codex and portable Skills

The `npx skills add` command above installs the KJDraw Skill into the agents selected with `-a`. To add or update it in other agents supported by the [Skills CLI](https://github.com/vercel-labs/skills), select those agents instead:

```sh
npx skills add KanJieTeam/kjdraw --skill kjdraw-cad -g -a codex -a claude-code -a cursor -y
```

The Skills CLI also accepts `-a '*'` for all of its supported agent types. This installs **instructions only**; install the CAD runtime separately as shown above. MCP remains optional for clients that cannot run the CLI or deliberately want native tool registration; those clients can use the [standard stdio entry](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/#en-client-config) after checking their own configuration format.

For the **optional MCP route**, Codex uses its own TOML configuration, so the KJDraw installer does not edit it. After installing that runtime, register its stable launcher using the [official Codex MCP CLI](https://learn.chatgpt.com/docs/extend/mcp). On Windows PowerShell:

```powershell
$kjdrawMcp = Join-Path $env:LOCALAPPDATA 'KJDraw\bin\kjdraw-mcp.mjs'
codex mcp add kjdraw -- node $kjdrawMcp --workspace $env:USERPROFILE --input .kjdraw/host.kjd --proposal-dir .kjdraw/proposals --candidate-dir .kjdraw/results
codex mcp list
```

On macOS/Linux:

```sh
kjdraw_mcp="${XDG_DATA_HOME:-$HOME/.local/share}/kjdraw/bin/kjdraw-mcp.mjs"
codex mcp add kjdraw -- node "$kjdraw_mcp" --workspace "$HOME" --input .kjdraw/host.kjd --proposal-dir .kjdraw/proposals --candidate-dir .kjdraw/results
codex mcp list
```

If `kjdraw` already exists in Codex, review that entry with `codex mcp list` before replacing it. Do not point Codex at a transient `npx` cache. Restart Codex and ask it to draw a 5 mm circle; verify the tool call and candidate files as below. Claude Code and Cursor receive MCP entries from the KJDraw installer, but still require a new client session and the same live check. Configuration tests are not independent GUI acceptance.

## Updating after installation

Run the same one-line command again to move to the currently promoted source commit. This is an in-place update; uninstalling or reconfiguring each project is unnecessary. Restart the AI client and start a new task so its MCP process loads the new runtime. The install channel is promoted only by an explicit maintainer change after candidate verification; it is not the moving tip of `main`, and the installer never silently downloads new executable code while an agent task is running.

After upgrading once to a runtime with knowledge delivery, the installed MCP launcher checks the official versioned geology JSON manifest when a new MCP process starts. Data-only geology pack updates can then arrive without reinstalling the runtime: the manifest and pack are fetched over HTTPS, checked against SHA-256 and schema limits, and cached for offline fallback. Restart the client and open a new task to load a newly published pack; an already running task will not change underfoot. Set `KJDRAW_KNOWLEDGE_UPDATES=off` to use bundled knowledge only. This does **not** remotely update executable code, other engineering domains, or old installations that have not yet upgraded to this launcher. Independent cross-version client acceptance remains pending. Installing a Skill alone does not update the CAD engine.

## Verify the connection

Restart the client, open any workspace, start a new conversation, and ask in your own words:

```text
用 KJDraw 画一个半径 5 毫米的圆。
```

For the existing **MCP installer route**, you do not need to mention tool names, ledger files, or proposal IDs. The client should discover KJDraw from its user-level configuration. A create request returns `candidate-ready` with actual KJD, DXF, and SVG paths. The new Skill-first CLI route instead returns a proposal ledger for separate human review. Neither route silently overwrites the source drawing.

Verify all three signals:

1. The client calls a `kjdraw` MCP tool.
2. A create result identifies KJDraw, reports `candidate-ready`, and includes KJD, DXF, and SVG candidate paths.
3. Your source drawing has not been overwritten.

User-level configuration and real-engine command-line smoke tests are covered by the repository tests. Independent GUI and real-model acceptance for each claimed client remains a KJDraw 1.0 release gate; this page does not claim that gate has passed.

[中文说明](try-in-ai.zh-CN.md) · [Agent integration](agent.md) · [Release status](status.md)
