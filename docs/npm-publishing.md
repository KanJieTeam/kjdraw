# npm package and publishing

The SDK package is `@kanjie/kjdraw-sdk`. Preview releases use npm's `next` dist-tag; only stable versions may update `latest`.

## Consumer path

```sh
npm install @kanjie/kjdraw-sdk@next
node node_modules/@kanjie/kjdraw-sdk/examples/quickstart.mjs
```

Applications import the dependency normally:

```js
import { createKJDrawSDK } from '@kanjie/kjdraw-sdk'
```

## Maintainer release gate

The manual `Publish SDK to npm` workflow reruns tests, verifies generated TypeScript-owned ESM, runs release checks, requires the package version's Git tag to resolve to the exact workflow commit, previews package contents, and then publishes with provenance.

The repository must contain an npm Actions token in the GitHub Actions secret named `NPM_TOKEN`, and the npm account behind it must have permission to publish the `@kanjie` scope. Never place the token in source, documentation, issues or workflow text. npm authentication is independent of GitHub login.

The first publish should be manually observed. A preview version is published under `next`, so `npm install @kanjie/kjdraw-sdk` will not receive it until a stable release intentionally updates `latest`.
