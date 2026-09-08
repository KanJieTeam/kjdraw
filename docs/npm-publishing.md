# npm package and publishing

The public SDK package is `@kanjieteam/kjdraw`. Release candidates are published on npm's `next` dist-tag; stable versions are published on `latest`.

## Install and try it

```sh
npm install @kanjieteam/kjdraw@1.0.0-rc.2
```

The npm package page and repository badge are the source of truth for the currently published version. The `1.0.0-rc.2` editor API in this checkout has not been published yet. Until that candidate is available, build this repository and install the local package into a test application:

```sh
git clone https://github.com/KanJieTeam/kjdraw.git
cd kjdraw
npm ci
npm run build
npm install /path/to/kjdraw/packages/kjdraw-sdk
```

The checkout package can then provide the upcoming editor entry point:

```js
import { createKJDrawEditor } from '@kanjieteam/kjdraw/editor'
```

## Recommended authentication: npm trusted publishing

KJDraw's release workflows are prepared for [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with GitHub Actions OIDC. This is the preferred route: it creates short-lived credentials for one verified workflow run and publishes with npm provenance, without storing a long-lived npm token in the repository.

In the npm package settings for `@kanjieteam/kjdraw`, add a GitHub Actions trusted publisher with the exact GitHub organization, repository and workflow filename. The normal release path calls the reusable npm workflow from `.github/workflows/release.yml`, so the trusted publisher must match `release.yml`—npm validates the calling workflow for a `workflow_call` publication.

This workflow uses direct `npm publish`, so enable that action in the trusted publisher's **Allowed actions**. A connection that allows only `npm stage publish` cannot complete this workflow. Use organization `KanJieTeam`, repository `kjdraw`, workflow filename `release.yml`, and leave Environment name empty unless the workflow is changed to declare one.

The standalone `.github/workflows/npm-publish.yml` workflow is also manually dispatchable. A standalone run has a different workflow identity, so add a second trusted-publisher connection that matches `npm-publish.yml` before using that path. If the npm package is configured only for `release.yml`, use the normal release workflow instead of the standalone dispatch. Keep the workflow filenames stable after configuring npm.

Trusted publishing requires npm CLI 11.5.1 or newer and Node.js 22.14.0 or newer. The workflows use Node.js 24 and fail before package verification if the npm CLI is older than 11.5.1. Both the caller and reusable workflow grant the required `id-token: write` permission.

## Optional token fallback

The repository may provide an Actions secret named `NPM_TOKEN` as a fallback for maintainers who have not enabled trusted publishing. It must be a scoped granular access token with publish access to `@kanjieteam/kjdraw` and must satisfy npm's current organization and 2FA publishing policy. A local npm or browser login is not available inside GitHub Actions. Never paste a token into source, documentation, issues, workflow inputs or logs.

OIDC is recommended; `NPM_TOKEN` is optional and is not needed after the trusted publisher is configured correctly.

## Release gates

Create an annotated version tag whose name exactly matches the SDK package version, for example `v1.0.0-rc.2`. The `Release` workflow accepts only a tag whose target is on `main`, then waits for both the exact-SHA `CI` and `Deploy playground` runs to succeed. It rebuilds and tests the SDK, verifies generated sources and declarations, audits an isolated packed-package consumer, creates the GitHub release and delegates npm publication.

The npm workflow independently checks the tag, GitHub release, exact-SHA CI and Pages deployment before publishing. Existing npm versions are immutable: a rerun succeeds only when the expected dist-tag already points to that exact version. The workflow never silently moves `latest` or `next` for an existing version. An existing draft GitHub release is also left untouched; review and publish or delete it manually before rerunning.

No workflow in this repository retrieves credentials or publishes from a developer workstation. Running a workflow is an explicit maintainer action, and the release gates remain authoritative.

## Verify the deployed site

After Pages succeeds, run the live smoke check from the exact deployed checkout:

```sh
npx playwright install chromium
node scripts/audits/verify-live-site.mjs https://kanjieteam.github.io/kjdraw/
```

The check compares deployed SDK, workbench, documentation and GIF assets with the checkout, then exercises sample drawings, layers, Agent review/save-reopen/undo, API links, guide search and the language switch. It saves screenshots under `.cache/live-site/`. Set `KJDRAW_CHROME_PATH` to use an existing Chrome executable instead of installing Chromium.

If your network requires an existing proxy, set `KJDRAW_HTTP_PROXY` to its URL for this verification run. This affects only the audit browser and does not change system or Git proxy settings.
