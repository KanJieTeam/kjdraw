import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createKJDrawSDK } from '../src/index.js'

const cli = fileURLToPath(new URL('../bin/kjdraw.mjs', import.meta.url))

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

test('headless CLI validates, inspects and converts KJD without network services', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-cli-'))
  try {
    const source = join(directory, 'source.kjd')
    const converted = join(directory, 'converted.dxf')
    const sdk = createKJDrawSDK()
    const document = sdk.createDocument({ documentId: 'cli-fixture', title: 'CLI fixture' })
    await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [25, 10, 0] } })
    await writeFile(source, document.serialize({ pretty: true }))

    const inspected = run(['inspect', source])
    assert.equal(inspected.valid, true)
    assert.equal(inspected.document.id, 'cli-fixture')
    assert.equal(inspected.document.entityTypes.LINE, 1)

    const conversion = run(['convert', source, converted, '--dxf-version', '2018'])
    assert.equal(conversion.outputFormat, 'DXF')
    assert.match(await readFile(converted, 'utf8'), /SECTION[\s\S]*ENTITIES/)
    assert.equal(run(['validate', converted]).document.entityTypes.LINE, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
