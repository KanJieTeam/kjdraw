#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const directory = join(root, 'knowledge', 'geology')
const packName = `geology-core-${KJDRAW_GEOLOGY_KNOWLEDGE_PACK.version}.json`
const bytes = Buffer.from(`${JSON.stringify(KJDRAW_GEOLOGY_KNOWLEDGE_PACK, null, 2)}\n`)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const descriptor = {
  id: KJDRAW_GEOLOGY_KNOWLEDGE_PACK.id,
  version: KJDRAW_GEOLOGY_KNOWLEDGE_PACK.version,
  sha256,
  url: `https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/geology/${packName}`,
}
const manifest = Buffer.from(`${JSON.stringify({ schema: 'kjdraw.knowledge-delivery.v1', packs: { column: descriptor, section: descriptor } }, null, 2)}\n`)
const outputs = [[join(directory, packName), bytes], [join(directory, 'manifest.json'), manifest]]
if (process.argv.slice(2).join(' ') === '--check') {
  for (const [path, expected] of outputs) {
    const current = await readFile(path)
    if (!current.equals(expected)) throw new Error(`${path} differs from the compiled public geology pack`)
  }
} else if (process.argv.length === 2) {
  await mkdir(directory, { recursive: true })
  for (const [path, output] of outputs) await writeFile(path, output)
} else throw new Error('Usage: node scripts/build-geology-delivery.mjs [--check]')
process.stdout.write(`Geology delivery ${KJDRAW_GEOLOGY_KNOWLEDGE_PACK.id}@${KJDRAW_GEOLOGY_KNOWLEDGE_PACK.version} ${sha256}\n`)
