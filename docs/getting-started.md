# Getting started

## Run the browser playground

Install Node.js 22+ from https://nodejs.org/ and clone this repository. Run `node scripts/serve.mjs` from its root, then open http://localhost:4173. The server listens on loopback only. Set `PORT` in your shell to choose another port.

No dependency installation is needed. Modern browsers with ES modules, Canvas 2D, WebAssembly and Web Crypto are required. Candidate CI covers Node.js on Windows, macOS and Linux plus the launch journey in Chromium, Firefox and WebKit; product teams should add hardware-specific rendering QA for their supported devices.

Select objects by clicking their geometry. Use L/P/C/A/T/D for line, polyline, circle, arc, text and distance; V returns to selection and Escape cancels. Scroll to zoom and middle-drag to pan. Snaps use SDK endpoint/midpoint/center/nearest queries. The reference renderer intentionally excludes some complex formatting and nested resource behavior; unsupported view entities remain in the document.

Open accepts DXF, KJD and KJP files, with a 20 MiB playground limit. KJP downloads preserve the entire project; DXF exports the active document through the published bounded ASCII profile. Browser-tab reload discards unsaved edits. For persistent storage, integrate `BrowserKjpFileBinding` or your own native project provider.

## Consume the SDK

Install the current release candidate from npm's `next` channel:

```sh
npm install @kanjieteam/kjdraw@next
```

For checkout-based development, install the local package in your application:

```sh
npm install /path/to/kjdraw/packages/kjdraw-sdk
```

Then import `createKJDrawSDK` from `@kanjieteam/kjdraw`, or mount the ready-made workbench from `@kanjieteam/kjdraw/workbench`. The SDK has no runtime npm dependencies and no UI framework requirement. Rust/WASM is an optional separately hosted artifact. Browse the [versioned developer portal](https://kanjieteam.github.io/kjdraw/docs/latest/) or see the [npm release policy](npm-publishing.md).

```js
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'example' })
await sdk.executeCommand('CREATE', {
  type: 'CIRCLE', payload: { center: [10, 10, 0], radius: 5 },
})
console.log(drawing.serialize())
```

See `examples/agent-command.mjs` for command envelopes and `examples/deployment-providers.mjs` for local/remote provider wiring. `MOVE` accepts `dx` and `dy` (or `from` and `to`), not a `delta` array. Browse the declaration-driven [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) for every root and subpath export, or read [how it is generated](api-reference.md).

## Build and verify

```sh
node scripts/test.mjs
node --no-warnings scripts/build-typescript.mjs --check
node scripts/build-declarations.mjs --check
node scripts/build-docs-site.mjs --check
node scripts/build-api-docs.mjs --check
node scripts/audit-dxf-corpus.mjs
node scripts/check.mjs
node scripts/build.mjs
```

The build creates a static `dist/` directory. Serve it with any static HTTP server, including under a subdirectory. Do not open index.html via `file://`; module loading and Web Crypto require an appropriate origin. Development serving intentionally exposes only public runtime paths.

## Rebuild the included WASM

Install stable Rust using https://rustup.rs/ and add the target:

```sh
rustup target add wasm32-unknown-unknown
node scripts/build-wasm.mjs
node scripts/test.mjs
```

Native kernel tests: `cargo test --locked --manifest-path runtime/kjcore-rs/Cargo.toml`.

The script copies the rebuilt artifact into `web/public/kjcore/kjcore.wasm`. CI rebuilds and tests the artifact from public sources. The SDK can operate through its TypeScript reference path without WASM; backend identity remains explicit in the capability manifest.
