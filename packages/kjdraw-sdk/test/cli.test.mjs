import assert from 'node:assert/strict'
import { link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
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

async function safetyFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-cli-output-safety-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.kjd'), sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'cli-output-safety', units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [25, 10, 0] } })
  const original = Buffer.from(document.serialize({ pretty: true }))
  await writeFile(source, original)
  return { directory, source, original }
}

for (const extension of ['dxf', 'kjd', 'kjp']) {
  test(`convert refuses an input hard link at the ${extension.toUpperCase()} output without altering source bytes`, async t => {
    const { directory, source, original } = await safetyFixture(t), output = join(directory, `converted.${extension}`)
    await link(source, output)
    const a = await stat(source, { bigint: true }), b = await stat(output, { bigint: true })
    assert.equal(a.dev, b.dev); assert.equal(a.ino, b.ino)
    const result = spawnSync(process.execPath, [cli, 'convert', source, output], { encoding: 'utf8' })
    assert.equal(result.status, 1); assert.match(result.stderr, /aliases an input drawing/u)
    assert.deepEqual(await readFile(source), original); assert.deepEqual(await readFile(output), original)
  })
}

test('convert refuses the same path through a lexical alias', async t => {
  const { directory, source, original } = await safetyFixture(t)
  const result = spawnSync(process.execPath, [cli, 'convert', source, `${directory}/./source.kjd`], { encoding: 'utf8' })
  assert.equal(result.status, 1); assert.match(result.stderr, /aliases an input drawing/u)
  assert.deepEqual(await readFile(source), original)
})

for (const dangling of [false, true]) {
  test(`convert refuses a ${dangling ? 'dangling' : 'source-targeting'} output symlink`, async t => {
    const { directory, source, original } = await safetyFixture(t), output = join(directory, 'converted.dxf')
    await symlink(dangling ? join(directory, 'missing.dxf') : source, output, 'file')
    const result = spawnSync(process.execPath, [cli, 'convert', source, output], { encoding: 'utf8' })
    assert.equal(result.status, 1); assert.match(result.stderr, /symbolic link/u)
    assert.deepEqual(await readFile(source), original)
  })
}

test('convert can refresh regular output without altering its other hard links or its source', async t => {
  const { directory, source, original } = await safetyFixture(t), output = join(directory, 'converted.dxf'), saved = join(directory, 'previous.dxf')
  await writeFile(output, 'previous output'); await link(output, saved)
  assert.equal(run(['convert', source, output]).outputFormat, 'DXF')
  assert.equal(run(['validate', output]).document.entityTypes.LINE, 1)
  assert.equal(await readFile(saved, 'utf8'), 'previous output')
  assert.deepEqual(await readFile(source), original)
  assert.equal(run(['convert', source, output]).outputFormat, 'DXF')
  assert.equal(run(['validate', output]).document.entityTypes.LINE, 1)
  assert.deepEqual(await readFile(source), original)
})

test('invalid convert input preserves source and pre-existing output', async t => {
  const { directory, source } = await safetyFixture(t), output = join(directory, 'converted.dxf')
  await writeFile(source, '{ invalid JSON'); await writeFile(output, 'previous output')
  const result = spawnSync(process.execPath, [cli, 'convert', source, output], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(await readFile(source, 'utf8'), '{ invalid JSON')
  assert.equal(await readFile(output, 'utf8'), 'previous output')
})
