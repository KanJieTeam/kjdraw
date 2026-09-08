# npm package and publishing

The published SDK package is `@kanjieteam/kjdraw`. Preview releases use npm's `next` dist-tag; stable versions update `latest`. As the first public version, `0.7.1-preview.1` is available from both tags.

## Consumer path

```sh
npm install @kanjieteam/kjdraw
node node_modules/@kanjieteam/kjdraw/examples/quickstart.mjs
```

Applications import the dependency normally:

```js
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
```

## Maintainer release gate

The manual `Publish SDK to npm` workflow reruns tests, verifies generated TypeScript-owned ESM, runs release checks, requires the package version's Git tag to resolve to the exact workflow commit, previews package contents, and then publishes with provenance.

The repository must contain an npm Actions token in the GitHub Actions secret named `NPM_TOKEN`, and the npm account behind it must have permission to publish the `@kanjie` scope. Never place the token in source, documentation, issues or workflow text. npm authentication is independent of GitHub login.

The first publication was manually observed and verified from a clean directory. Future CI publications use provenance and retain the preview/stable tag policy above.
