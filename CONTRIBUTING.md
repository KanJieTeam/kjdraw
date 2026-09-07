# Contributing to KJDraw

Thank you for helping build an open CAD foundation. Small, reproducible contributions are especially welcome.

## Development

Use Node.js 22 or newer. Run `node scripts/serve.mjs` for the playground, `node scripts/test.mjs` for tests, and `node scripts/check.mjs` for release consistency. These commands have no npm dependencies. Rust work requires stable Rust and the `wasm32-unknown-unknown` target; see [Getting started](docs/getting-started.md).

## Changes

Open an issue before large API, document-format or geometry-authority changes. Include a small reproduction, expected/actual behavior, runtime version, and relevant entity/format types. Pull requests should explain the user-visible result and its verification. Add tests for changed geometry, transactions and file preservation. Update the capability boundaries if a limitation changes.

Do not silently approximate unsupported operations or drop objects on export. The renderer is a projection, not a second document database. UI, plugins and agent hosts should share public SDK commands.

Only submit code and sample files you are entitled to publish under Apache-2.0. Do not upload private project files or proprietary fonts, templates, symbols, binaries, customer information, or secrets. Prefer small synthetic fixtures. AI-assisted changes are welcome when the contributor understands, reviews and tests them; generated output alone is not correctness evidence.

## Review and releases

KanJieTeam currently maintains releases. Public SDK changes land here first; downstream products adopt pinned versions after validation. We use semantic versioning for packages and explicit preview tags while the API is evolving. Breaking changes require release notes and a migration explanation. External reviewers can become maintainers through sustained, reviewed contributions; there is no automatic commit access.

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
