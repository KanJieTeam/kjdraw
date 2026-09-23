<p align="center"><img src="docs/assets/hero.svg" alt="KJDraw — the engineering drawing harness for AI agents" width="100%"></p>

<h1 align="center">The open-source engineering drawing harness for AI agents.</h1>

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

> **Status: 1.0 release candidate.** Command-line configuration and real-engine smoke
> tests pass; independent GUI and model acceptance is still a release gate.
> See [release status](docs/status.md).

---

## Why KJDraw

Generating geometry is no longer the hard part. Engineering CAD starts where geometry ends: a drawing contains hundreds of related objects, and the model must find the same object again across turns, preserve dimensions, layers, blocks, hatches and references, and produce a consistent result after Undo, export, save and reopen.

Asking an LLM to emit coordinates and primitive entities one by one creates four predictable failures:

- Token cost grows with the size of the drawing.
- Geometry and engineering constraints drift across turns.
- Without stable object identity, the next edit becomes a guess.
- A rendered result does not prove that the drawing remains editable or auditable.

KJDraw turns the same job into one sentence:

```text
Draw an engineering borehole log with KJDraw: generate strata, lithology hatching,
elevations and annotations from the borehole data.
```

KJDraw is not another model trained to draw a few templates. It gives different
models and agents the same CAD execution layer: **the model decides what to draw;
the engine decides how to draw it correctly.** The model submits engineering intent,
facts and constraints; geometry, object identity, layers, references, transactions,
validation and file output are resolved deterministically by the local engine.

---

## Quick start

### From an AI agent

KJDraw ships an **MCP server**, so any MCP-compatible client can call the same CAD
tools. The installer configures KJDraw once at the user level for Kimi Code, WorkBuddy
and ZCode; TraeCode opens its official one-time import confirmation.

```jsonc
// .mcp.json, or your client's MCP configuration
{
  "mcpServers": {
    "kjdraw": {
      "command": "npx",
      "args": ["-y", "@kanjieteam/kjdraw", "mcp"]
    }
  }
}
```

Or install the user-level connector once:

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
[Installation details and security model →](docs/try-in-ai.md)

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
component, and a CLI. These examples require **1.0.0-rc.3 or newer**; use `next`.

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
    "objectIds": ["<stable-object-id>"],
    "delta": { "dx": 1200, "dy": 0 },
    "units": "mm"
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
