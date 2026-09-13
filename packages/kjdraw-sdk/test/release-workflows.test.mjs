import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const repositoryRoot = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, repositoryRoot), 'utf8')
const exactMainBinding = /test "\$\(git rev-parse refs\/remotes\/origin\/main\)" = "\$sha"/

function requireExactMainBinding(workflow) {
  assert.match(workflow, exactMainBinding, 'release publication must require the tagged SHA to equal current origin/main')
}

test('npm publishing pins an OIDC-capable runtime and preserves dist-tag intent', async () => {
  const workflow = await read('.github/workflows/npm-publish.yml')

  assert.match(workflow, /node-version:\s*24/)
  assert.match(workflow, /package-manager-cache:\s*false/)
  assert.match(workflow, /npm >= 11\.5\.1 is required/)
  assert.match(workflow, /expected_tag="latest"/)
  assert.match(workflow, /\[\[ "\$version" == \*-\* \]\] && expected_tag="next"/)
  assert.match(workflow, /npm view "@kanjieteam\/kjdraw" "dist-tags\.\$\{expected_tag\}"/)
  assert.match(workflow, /Refusing to alter an existing release automatically/)
  assert.match(workflow, /--tag "\$\{\{ steps\.registry\.outputs\.expected_tag \}\}" --provenance/)
})

test('release gates the exact main SHA on CI and Pages without publishing drafts', async () => {
  const [release, npmPublish] = await Promise.all([
    read('.github/workflows/release.yml'),
    read('.github/workflows/npm-publish.yml'),
  ])

  for (const workflow of [release, npmPublish]) {
    requireExactMainBinding(workflow)
    assert.match(workflow, /workflows\/ci\.yml\/runs\?head_sha=\$sha&event=push/)
    assert.match(workflow, /workflows\/pages\.yml\/runs\?head_sha=\$sha&event=push/)
    assert.match(workflow, /head_branch == "main"/)
  }

  assert.match(release, /already exists as a draft/)
  assert.match(release, /publish or delete that draft manually/)
  assert.doesNotMatch(release, /gh release edit[^\n]*--draft=false/)
})

test('release exact-main gate rejects an ancestor-only publication workflow', () => {
  const ancestorOnly = `sha="$(git rev-list -n 1 "$RELEASE_TAG")"
test "$(git rev-parse HEAD)" = "$sha"
git merge-base --is-ancestor "$sha" origin/main`

  assert.throws(() => requireExactMainBinding(ancestorOnly), /must require the tagged SHA to equal current origin\/main/)
})

test('release provenance audit binds exact main and can only verify, attest and upload',async()=>{
 const workflow=await read('.github/workflows/release-provenance.yml')
 assert.match(workflow,/branches:\s*\n\s*- main/)
 assert.match(workflow,/workflow_dispatch:/)
 assert.match(workflow,/contents:\s*read/)
 assert.doesNotMatch(workflow,/contents:\s*write/)
 assert.match(workflow,/test "\$sha" = "\$GITHUB_SHA"/)
 assert.match(workflow,/test "\$\(git rev-parse refs\/remotes\/origin\/main\)" = "\$sha"/)
 assert.match(workflow,/workflows\/ci\.yml\/runs\?head_sha=\$sha&event=push/)
 assert.match(workflow,/workflows\/pages\.yml\/runs\?head_sha=\$sha&event=push/)
 const pack=workflow.indexOf('npm pack --workspace packages/kjdraw-sdk')
 const generate=workflow.indexOf('node scripts/release-artifacts.mjs')
 const verify=workflow.indexOf('node scripts/audits/verify-release-artifacts.mjs dist/release-candidate')
 const attest=workflow.indexOf('uses: actions/attest@')
 const upload=workflow.indexOf('uses: actions/upload-artifact@')
 assert.ok(pack>=0&&generate>pack&&verify>generate&&attest>verify&&upload>attest)
 assert.match(workflow,/subject-checksums: dist\/release-candidate\/SHA256SUMS/)
 assert.match(workflow,/gh attestation verify "dist\/release-candidate\/\$name" --repo "\$GITHUB_REPOSITORY"/)
 assert.match(workflow,/dist\/provenance-audit\/provenance\.sigstore\.json/)
 assert.match(workflow,/published:false/)
 assert.doesNotMatch(workflow,/npm publish|gh release (?:create|upload|edit)|git tag|push:\s*\n\s*tags:/)
})

test('Pages uses the release runtime for every main commit', async () => {
  const workflow = await read('.github/workflows/pages.yml')

  assert.doesNotMatch(workflow, /^    paths(?:-ignore)?:/m)
  assert.match(workflow, /node-version:\s*24/)
})

test('Pages uploads and deploys the same run-and-attempt-scoped artifact', async () => {
  const workflow = await read('.github/workflows/pages.yml')

  assert.match(workflow, /PAGES_ARTIFACT_NAME: github-pages-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/)
  assert.match(workflow, /name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/)
  assert.match(workflow, /artifact_name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/)
})

test('Pages success requires the deployed workbench and docs to match the exact checkout', async () => {
  const workflow = await read('.github/workflows/pages.yml')
  const deployment = workflow.indexOf('uses: actions/deploy-pages@')
  const liveVerification = workflow.indexOf('node scripts/audits/verify-live-site.mjs "$DEPLOYED_SITE_URL"')

  assert.ok(deployment >= 0, 'Pages must deploy an artifact')
  assert.ok(liveVerification > deployment, 'live verification must run after deployment')
  assert.match(workflow, /DEPLOYED_SITE_URL: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/)
  assert.match(workflow, /npx playwright install --with-deps chromium/)
  assert.match(workflow, /for attempt in \$\(seq 1 10\)/)
  assert.match(workflow, /exit 1/)
})

test('CI verifies the packed editor lifecycle in a clean offline browser consumer', async () => {
  const workflow = await read('.github/workflows/ci.yml')

  assert.match(workflow, /Verify packed editor lifecycle in a clean offline consumer/)
  assert.match(workflow, /node scripts\/audits\/verify-packed-editor-lifecycle\.mjs/)
})

test('publishing guide distinguishes reusable and standalone trusted publishers', async () => {
  const guide = await read('docs/npm-publishing.md')

  assert.match(guide, /trusted publishing/i)
  assert.match(guide, /calling workflow/i)
  assert.match(guide, /release\.yml/)
  assert.match(guide, /npm-publish\.yml/)
  assert.match(guide, /NPM_TOKEN.*fallback/is)
  assert.match(guide, /scoped granular access token/i)
  assert.match(guide, /local npm or browser login is not available inside GitHub Actions/i)
})

test('release docs separate the source candidate from live registry verification', async () => {
  const [guide, status, packageText] = await Promise.all([
    read('docs/npm-publishing.md'), read('docs/status.md'), read('packages/kjdraw-sdk/package.json'),
  ])
  const { version } = JSON.parse(packageText)
  for (const document of [guide, status]) {
    assert.ok(document.includes(`source-tree candidate is \`${version}\``))
    assert.match(document, /checkout version does not establish npm publication/i)
    assert.match(document, /npm view @kanjieteam\/kjdraw dist-tags/)
    assert.ok(document.includes(`npm view @kanjieteam/kjdraw@${version} version`))
    assert.match(document, /npm install @kanjieteam\/kjdraw@next/)
    assert.doesNotMatch(document, /npm registry is still pending|After RC2 reaches npm|Available only after npm publication succeeds/i)
  }
  assert.match(guide, /npm install https:\/\/github\.com\/KanJieTeam\/kjdraw\/releases\/download\/v[^/\s]+\/kanjieteam-kjdraw-[^\s]+\.tgz/)
  assert.match(guide, /A tag is not evidence that npm publication succeeded/)
  assert.doesNotMatch(status, /all three pass locally/)
})
