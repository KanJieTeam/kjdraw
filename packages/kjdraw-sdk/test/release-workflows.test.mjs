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

test('publishing guide distinguishes reusable and standalone trusted publishers', async () => {
  const guide = await read('docs/npm-publishing.md')

  assert.match(guide, /trusted publishing/i)
  assert.match(guide, /calling workflow/i)
  assert.match(guide, /release\.yml/)
  assert.match(guide, /npm-publish\.yml/)
  assert.match(guide, /NPM_TOKEN.*fallback/is)
  assert.match(guide, /scoped granular access token/i)
  assert.match(guide, /v1\.0\.0-rc\.2.*GitHub Release/is)
  assert.match(guide, /npm registry is still pending/i)
  assert.match(guide, /releases\/download\/v1\.0\.0-rc\.2\/kanjieteam-kjdraw-1\.0\.0-rc\.2\.tgz/)
  assert.doesNotMatch(guide, /has not been published yet/i)
  assert.doesNotMatch(guide, /immutable Release asset/i)
  assert.match(guide, /local npm or browser login is not available inside GitHub Actions/i)
})
