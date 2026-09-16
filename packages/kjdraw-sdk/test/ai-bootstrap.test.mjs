import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const pinned = '71df8226e32db56fd9f5be3b5efc270362c0d819'

test('one-line AI bootstraps pin one public candidate and connect all clients without npx or force', async () => {
  const [powerShell, shell] = await Promise.all([read('scripts/install-ai.ps1'), read('scripts/install-ai.sh')])
  for (const source of [powerShell, shell]) {
    assert.match(source, new RegExp(pinned))
    assert.match(source, /kjdraw-connect\.mjs/)
    assert.match(source, /codeload\.github\.com\/KanJieTeam\/kjdraw/)
    for (const option of ['--all', '--apply', '--scope', '--workspace']) assert.match(source, new RegExp(option))
    assert.match(source, /--input|--blank/)
    assert.match(source, /\.kjdraw\/host\.kjd/)
    assert.match(source, /--candidate-dir/)
    assert.match(source, /\.kjdraw\/results/)
    assert.match(source, /--previous-mcp-script/)
    assert.doesNotMatch(source, /KJDRAW_PROJECT|Get-Location|\$PWD/)
    assert.doesNotMatch(source, /\bnpx\b|git clone|push|--force|reset --hard/)
  }
  assert.match(powerShell, /IsPathRooted/)
  assert.doesNotMatch(powerShell, /IsPathFullyQualified/)
  assert.match(powerShell, /^[\x00-\x7f]*$/u)
})

test('Chinese default and English homepage lead with the same runnable one-command AI install', async () => {
  const [chinese, english] = await Promise.all([read('README.md'), read('README.en.md')])
  for (const source of [chinese, english]) {
    assert.match(source, /irm https:\/\/raw\.githubusercontent\.com\/KanJieTeam\/kjdraw\/main\/scripts\/install-ai\.ps1 \| iex/)
    assert.match(source, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/KanJieTeam\/kjdraw\/main\/scripts\/install-ai\.sh \| sh/)
  }
})
