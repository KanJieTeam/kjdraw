import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const pinned = '69bec8788cae65e02091a269110ea329dfff6f1f'

test('one-line AI bootstraps pin one public candidate and connect all clients without npx or force', async () => {
  const [powerShell, shell] = await Promise.all([read('scripts/install-ai.ps1'), read('scripts/install-ai.sh')])
  for (const source of [powerShell, shell]) {
    assert.match(source, new RegExp(pinned))
    assert.match(source, /kjdraw-connect\.mjs/)
    assert.match(source, /kjdraw-mcp\.mjs/)
    assert.match(source, /--check-tool-schemas/)
    assert.match(source, /moonshot-walle-compatible-v1/)
    assert.match(source, /codeload\.github\.com\/KanJieTeam\/kjdraw/)
    for (const option of ['--all', '--apply', '--scope', '--workspace']) assert.match(source, new RegExp(option))
    assert.match(source, /--input|--blank/)
    assert.match(source, /\.kjdraw\/host\.kjd/)
    assert.match(source, /--candidate-dir/)
    assert.match(source, /\.kjdraw\/results/)
    assert.match(source, /--previous-mcp-script/)
    assert.match(source, /--replace-existing/)
    for (const previous of ['source-7b25cf4', 'source-b022932', 'source-6da40b2', 'source-85d750e', 'source-c526aa7', 'source-a3c1bca', 'source-71df822', 'source-616133e']) assert.match(source, new RegExp(previous))
    assert.doesNotMatch(source, /KJDRAW_PROJECT|Get-Location|\$PWD/)
    assert.doesNotMatch(source, /\bnpx\b|git clone|push|--force|reset --hard/)
  }
  assert.match(powerShell, /IsPathRooted/)
  assert.doesNotMatch(powerShell, /IsPathFullyQualified/)
  assert.match(powerShell, /\$KJDrawArgs \+= '--replace-existing'/)
  assert.match(powerShell, /earlier KJDraw MCP process is still attached/u)
  assert.match(powerShell, /Existing candidate HTML files are immutable/u)
  assert.doesNotMatch(powerShell, /Stop-Process|taskkill/u)
  assert.match(powerShell, /^[\x00-\x7f]*$/u)
  assert.match(shell, /set -- "\$@" --replace-existing/)
})

test('English default and Chinese homepage lead with the same runnable one-command AI install', async () => {
  const [english, chinese] = await Promise.all([read('README.md'), read('README.zh-CN.md')])
  for (const source of [chinese, english]) {
    assert.match(source, /irm https:\/\/raw\.githubusercontent\.com\/KanJieTeam\/kjdraw\/main\/scripts\/install-ai\.ps1 \| iex/)
    assert.match(source, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/KanJieTeam\/kjdraw\/main\/scripts\/install-ai\.sh \| sh/)
  }
})
