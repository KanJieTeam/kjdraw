import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const pinned = '466d8be59e1be68dea19043427b4ec9f6295c0ee'

test('one-line AI bootstraps pin one public candidate and connect all clients without npx or force', async () => {
  const [powerShell, shell] = await Promise.all([read('scripts/install-ai.ps1'), read('scripts/install-ai.sh')])
  for (const source of [powerShell, shell]) {
    assert.match(source, new RegExp(pinned))
    assert.match(source, /kjdraw-connect\.mjs/)
    assert.match(source, /codeload\.github\.com\/KanJieTeam\/kjdraw/)
    assert.match(source, /--all --apply --workspace/)
    assert.match(source, /--input ['"]?\.kjdraw\/host\.kjd|--blank ['"]?\.kjdraw\/host\.kjd/)
    assert.doesNotMatch(source, /\bnpx\b|git clone|push|--force|reset --hard/)
  }
})

test('both homepages lead with the same runnable one-command AI install', async () => {
  const [english, chinese] = await Promise.all([read('README.md'), read('README.zh-CN.md')])
  for (const source of [english, chinese]) {
    assert.match(source, /irm https:\/\/raw\.githubusercontent\.com\/KanJieTeam\/kjdraw\/main\/scripts\/install-ai\.ps1 \| iex/)
    assert.match(source, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/KanJieTeam\/kjdraw\/main\/scripts\/install-ai\.sh \| sh/)
  }
})
