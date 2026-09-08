import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const repositoryRoot = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, repositoryRoot), 'utf8')

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
    assert.match(workflow, /workflows\/ci\.yml\/runs\?head_sha=\$sha&event=push/)
    assert.match(workflow, /workflows\/pages\.yml\/runs\?head_sha=\$sha&event=push/)
    assert.match(workflow, /head_branch == "main"/)
  }

  assert.match(release, /already exists as a draft/)
  assert.match(release, /publish or delete that draft manually/)
  assert.doesNotMatch(release, /gh release edit[^\n]*--draft=false/)
})

test('Pages runs for dependency and package-manifest changes', async () => {
  const workflow = await read('.github/workflows/pages.yml')

  assert.match(workflow, /- package\.json/)
  assert.match(workflow, /- package-lock\.json/)
  assert.match(workflow, /- packages\/kjdraw-sdk\/package\.json/)
  assert.match(workflow, /node-version:\s*24/)
})

test('Pages uploads and deploys the same run-and-attempt-scoped artifact', async () => {
  const workflow = await read('.github/workflows/pages.yml')

  assert.match(workflow, /PAGES_ARTIFACT_NAME: github-pages-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/)
  assert.match(workflow, /name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/)
  assert.match(workflow, /artifact_name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/)
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
