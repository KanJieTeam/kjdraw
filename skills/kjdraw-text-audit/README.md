# Drawing text audit

English | [简体中文](README.zh-CN.md)

An independently installable, read-only KJDraw Skill. Ask your agent to inventory drawing text, report repeated literal labels, or check the exact labels you provide. It reuses the CAD runtime; it does not add a parser, drawing engine or MCP server.

## Use

Requirements: a compatible local KJDraw runtime with `cad_read_drawing` and `cad_query_drawing`, and an agent with terminal access. The current Skills CLI requires Node.js 22.20+; the runtime has its own version requirements. Paper-space checks also require `cad_read_layouts`. Check installed tools rather than assuming a particular release contains them.

From a checkout, list the Skill without changing client configuration:

```sh
npx skills add ./skills/kjdraw-text-audit --list
```

With permission to change your own client's Skill setup, install from that directory:

```sh
npx skills add ./skills/kjdraw-text-audit
```

The Skill and CAD runtime are separate installations. This directory need not be inside the installed runtime or rely on another installed Skill. Repository-shorthand installation is available only after this directory is merged into the default source; until then use the local directory or your own fork.

Example request:

> Audit the model-space TEXT and MTEXT in `drawing.dxf`. Report exact duplicate strings and whether `Project: Demo` and `ZK01` occur. Do not change the file.

## Input and output

Input: a local DXF/KJD, an accessible workspace, scope, and optional exact required strings. Literal text checks can use a unitless drawing; they do not infer measurements or source borehole data.

Output: an inventory bound to the imported document revision and source digest, with returned native IDs, type, layer/owner scope, text/counts, duplicates, missing caller-required strings and import/coverage limitations. Include handles only when the actual tool returns them; otherwise mark unavailable. Identical labels can be legitimate. Stored MTEXT includes formatting syntax; a plain-text rendering comparison is outside this sample's contract.

DXF is imported once into a new internal scratch KJD snapshot before multi-call reads, because separate CLI imports regenerate native UUIDs and owner IDs. The original DXF and snapshot remain unchanged; the user does not need to manage or adopt a new format. Read calls can create empty session-ledger files in the scratch workspace, not mutation proposals or approval receipts. Audit results cover supported imported records, not certified lossless DXF interpretation.

No drawing edits, mutation proposals, approvals, edited exports or external model requests are implemented by this package. The host agent may use its configured model to reason over the tool output; that is a host choice, not a hidden API integration in this Skill.

## Acceptance and contribution

Use the [acceptance cases](references/acceptance.md) when validating the workflow. The repository tests exercise actual CLI reads, pagination, native records and source preservation with public synthetic fixtures—not model performance or engineering certification:

```sh
node scripts/validate-community-skills.mjs
node --test tests/community-skills.spec.mjs tests/community-text-audit.spec.mjs
```

Copy the small package pattern for a different workflow, choose a new name, change its real inputs/outputs and write focused behavioral tests. Do not merely rename this package and claim a new CAD capability. Source code and original example materials follow the repository's Apache-2.0 license; this package contains no customer drawings or third-party templates.
