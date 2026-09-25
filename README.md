<p align="center"><img src="docs/assets/hero.svg" alt="KJDraw — the engineering drawing harness for AI agents" width="100%"></p>

<p align="center"><strong>The open-source engineering drawing harness for AI agents.</strong></p>

<p align="center">
  Build engineering drawing workflows with high-level compilers, stable object identity,
  transactional editing, and one runtime across browsers, Node.js, CLI, and MCP.
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="https://kanjieteam.github.io/kjdraw/ai/"><strong>Try with AI</strong></a> ·
  <a href="https://kanjieteam.github.io/kjdraw/"><strong>Live editor</strong></a> ·
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><strong>Docs</strong></a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/KanJieTeam/kjdraw/releases"><img src="https://img.shields.io/github/v/release/KanJieTeam/kjdraw?include_prereleases&style=flat-square&labelColor=30363d&color=2863f0" alt="GitHub release"></a>
  <a href="https://www.npmjs.com/package/@kanjieteam/kjdraw"><img src="https://img.shields.io/npm/v/@kanjieteam/kjdraw/next?style=flat-square&label=npm_next&labelColor=30363d&color=2863f0" alt="npm release candidate"></a>
  <a href="https://kanjieteam.github.io/kjdraw/docs/latest/"><img src="https://img.shields.io/badge/Docs-get_started-2863f0?style=flat-square&labelColor=30363d" alt="Documentation"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2863f0?style=flat-square&labelColor=30363d" alt="Apache 2.0"></a>
</p>

---

## What is KJDraw?

KJDraw is an open-source TypeScript CAD engine and agent runtime for building
engineering drawing workflows into your own product. It gives applications and AI
agents one consistent way to create, inspect, edit, validate, preview and deliver
structured drawings without reducing the result to a screenshot or an opaque blob.

Use KJDraw when you need to:

- give an AI agent bounded, high-level CAD tools instead of asking it to emit hundreds of coordinates;
- embed an editable CAD workbench in a browser, React or Vue application;
- inspect existing drawings through stable object IDs, layers, references and spatial queries;
- compile supported engineering intent into native entities with deterministic geometry;
- verify a result through diagnostics, Undo/Redo, KJD/DXF reopen and rendered SVG evidence;
- keep drawings and model credentials local to the user's environment.

KJDraw is not an image generator and it is not a collection of frozen templates. It
is the execution layer between engineering intent and a reviewable CAD deliverable.

## AI agent compatibility

Install the KJDraw CAD Skill in a project for agents supported by the [Skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add KanJieTeam/kjdraw
```

The Skill teaches an agent when and how to use KJDraw. It does not install the CAD engine or connect the executable MCP server. To actually read or draw CAD files, also configure the KJDraw MCP server below (or use the supported desktop installer). The Skills CLI detects compatible agents and installs the Skill in the current project by default; its `-g` option installs for the current user.

KJDraw exposes CAD tools through standard **stdio MCP**. Any MCP-compatible client can use the same server configuration; model-specific adapters are optional and the drawing contract stays unchanged. Drawing files, model credentials and approval decisions remain with the client or local host.

| Client / entry point | Setup | Best for | Guide |
| --- | --- | --- | --- |
| **OpenAI Codex** | Add the `kjdraw` server to Codex MCP settings | Code-first agents that generate, inspect and edit KJD/DXF | [Model guide](https://kanjieteam.github.io/kjdraw/docs/latest/models/) |
| **Claude Desktop / Cursor / Cline** | Add the `kjdraw` server to the client MCP config | General chat, IDE workflows and drawing review | [MCP integration](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/) |
| **Kimi Code / WorkBuddy / ZCode / TraeCode** | Run the user-level installer; confirm the one-time import when prompted | Local desktop agent workflows | [Installation and security](docs/try-in-ai.md) |
| **Doubao / DeepSeek / other domestic models** | Connect the same server through an MCP-capable host; keep the model key in that host | Enterprise, private-network and domestic-model workflows | [Agent workflows](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) |
| **Custom agents / harnesses / enterprise hosts** | Register the same stdio MCP server, or call `agent-tools` and `model-adapters` from your host | Private deployments, custom UI and approval systems | [Model adapters](https://kanjieteam.github.io/kjdraw/docs/latest/models/) |
| **No model required** | Use the TypeScript SDK, CLI or browser editor | Regression tests, batch jobs and human editing | [File workflow](https://kanjieteam.github.io/kjdraw/docs/latest/files/) |

For a locally built 1.0.0-rc.3 checkout, install the package in a Node.js 22+ host project, create `proposals` and `results`, and replace both `/absolute/project` placeholders below with that project path. Check that `bin/kjdraw-mcp.mjs` exists before connecting; the npm `next` tag may still point to an older candidate. The portable server entry is:

```jsonc
{
  "mcpServers": {
    "kjdraw": {
      "command": "node",
      "args": ["/absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs", "--workspace", "/absolute/project", "--blank", "drawing.kjd", "--units", "millimeter", "--proposal-dir", "proposals", "--candidate-dir", "results"]
    }
  }
}
```

After connecting, start with read-only queries and previews, then let the host approve a proposal. KJDraw never treats model text as proof of CAD success and does not overwrite the source drawing without an explicit host decision. See [Agent workflows](https://kanjieteam.github.io/kjdraw/docs/latest/agent/), [MCP integration](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/) and the [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) for tool definitions, approval protocol and model adapters.
## Quick start

### From an AI agent

KJDraw ships an **MCP server**, so any MCP-compatible client can call the same CAD
tools. The installer configures KJDraw once at the user level for Kimi Code, WorkBuddy
and ZCode; TraeCode opens its official one-time import confirmation.

```jsonc
// .mcp.json, or your client's MCP configuration; requires a package containing kjdraw-mcp.mjs
{
  "mcpServers": {
    "kjdraw": {
      "command": "node",
      "args": ["/absolute/project/node_modules/@kanjieteam/kjdraw/bin/kjdraw-mcp.mjs", "--workspace", "/absolute/project", "--blank", "drawing.kjd", "--units", "millimeter", "--proposal-dir", "proposals", "--candidate-dir", "results"]
    }
  }
}
```

For supported desktop clients, the source-based user-level connector is the simpler path:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.sh | sh
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/scripts/install-ai.ps1 | iex
```

Your model key stays with your AI client — KJDraw never receives it. Create requests
are materialized as independently verified KJD, DXF and SVG candidate files and never
overwrite the source; in-place and destructive changes still require host review.
The same command performs later in-place updates from the [explicitly promoted install channel](scripts/install-ai-channel.json); restart the client and open a new task afterward. Knowledge packs are currently part of the local runtime, so repository knowledge changes do not reach existing installations automatically. [Installation details and security model →](docs/try-in-ai.md)

### In your app

```bash
npm install @kanjieteam/kjdraw@next
```

```tsx
import { KJDraw } from '@kanjieteam/kjdraw/react'

export default function DrawingPage() {
  return <KJDraw document="sample" locale="en" style={{ height: 720 }} />
}
```

Also available as a framework-free editor (`@kanjieteam/kjdraw/editor`), a Vue 3
component, and a CLI. These examples require **1.0.0-rc.3 or newer**. Check `npm view @kanjieteam/kjdraw dist-tags` before using `next`; if the registry still serves an older candidate, build the current source checkout instead.

### With no install at all

[Open the live editor](https://kanjieteam.github.io/kjdraw/) — no account or upload.
Explore mechanical, architectural, site and road samples; inspect layers; make an
edit; undo it; save and reopen. Samples demonstrate the product and are not construction
documents. See the [workbench guide](https://kanjieteam.github.io/kjdraw/docs/latest/workbench/).

---

## What one agent edit looks like

A model does not write hundreds of low-level entities. It names an intent; the engine
resolves the objects, applies one transaction, and returns evidence the host can review.

```jsonc
{
  "tool": "cad_propose_move",
  "args": {
    "expectedRevision": 0,
    "units": "millimeter",
    "ids": ["<stable-object-id>"],
    "dx": 1200,
    "dy": 0
  }
}
```

The host receives a pending proposal with the matched object identity, revision,
transaction boundary and validation evidence. It can approve, reject or keep the
proposal pending; accepted edits remain undoable and can be saved and reopened.

[Build an agent workflow →](https://kanjieteam.github.io/kjdraw/docs/latest/agent/) ·
[Agent integration guide →](docs/agent.md) ·
[Run it without a model or API key →](examples/agent-command.mjs)

---

## How KJDraw works

| Work at the intent level | Execute deterministically | Keep the drawing editable |
| --- | --- | --- |
| A model supplies requirements, constraints, and changes through a small set of high-level tools. | KJDraw resolves supported geometry, object identity, layers, references, and transactions. | Every accepted result remains structured CAD with Undo/Redo, save, and reopen support. |

## What you can build

| Workflow | Built-in foundation |
| --- | --- |
| **Understand existing drawings** | Paged reads, spatial and property queries, stable IDs, layers, references, topology, and change-impact inspection. |
| **Generate supported drawing types** | High-level compilers for manufacturing, architecture, site, road, data visualization, and geology workflows. |
| **Continue editing through conversation** | Precise selection, move, copy, rotate, scale, offset, stretch, lengthen, text/layer edits, and structural delete/reconnect/relayer operations. |
| **Embed CAD in your product** | JavaScript/TypeScript SDK, React and Vue components, packaged editor, CLI, and MCP tools powered by the same engine. |

---

## Scope and compatibility

KJDraw reads and writes native **KJD** drawings, **KJP** projects, and a
[documented DXF compatibility range](docs/dxf-compatibility.md).
**Direct DWG support is not included.**

Read, edit and save drawings from code or the CLI without an AI model — see the
[file guide](https://kanjieteam.github.io/kjdraw/docs/latest/files/).

| | KJDraw | ezdxf | LibreCAD | Excalidraw / tldraw |
| --- | --- | --- | --- | --- |
| Runs in the browser | ✅ | — | — | ✅ |
| Engineering entities (dimensions, blocks, hatches) | ✅ | ✅ | ✅ | — |
| Editor UI included | ✅ | — | ✅ | ✅ |
| Agent / MCP tools with stable object IDs | ✅ | — | — | — |
| DWG | — | — | partial | — |

## Contributing

**Our mission is to make KJDraw the default open-source CAD engine for the AI era.**

Bring a drawing that exposes a bug, build an integration, or help improve the engine. Work that directly helps users includes geometry and file compatibility, editing tools, Agent examples, accessibility, performance and documentation.

Read [Contributing](CONTRIBUTING.md) for the development workflow and [Governance](GOVERNANCE.md) for how decisions and maintenance work. For substantial changes, open an [issue](https://github.com/KanJieTeam/kjdraw/issues) to discuss the design first.

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci --ignore-scripts
npm run dev
```

Open **http://localhost:4173**. Before submitting changes, run `npm run typecheck` and `npm test`; UI changes also need `npm run test:browser`.

[Documentation](https://kanjieteam.github.io/kjdraw/docs/latest/) · [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) · [Roadmap](docs/roadmap.md) · [Support](SUPPORT.md) · [Release status](docs/status.md) · [License](LICENSE)

## Star History

<p align="center"><a href="https://www.star-history.com/#KanJieTeam/kjdraw&Date"><img src="https://api.star-history.com/svg?repos=KanJieTeam/kjdraw&type=Date" alt="KJDraw Star History" width="680"></a></p>

**Built by [KanJieTeam](https://github.com/KanJieTeam), open to contributors everywhere.**

[kanjieteam@163.com](mailto:kanjieteam@163.com) · Apache-2.0
