import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const repositoryRoot = new URL('../../../', import.meta.url)

test('Pages builds every exact main commit without path-filter gaps', async () => {
  const workflow = await readFile(new URL('.github/workflows/pages.yml', repositoryRoot), 'utf8')

  assert.match(workflow, /^on:\r?\n  push:\r?\n    branches: \[main\]/m)
  assert.doesNotMatch(workflow, /^    paths(?:-ignore)?:/m)
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]+[^\r\n]*\r?\n        with:\r?\n          ref: \$\{\{ github\.sha \}\}/)
})
