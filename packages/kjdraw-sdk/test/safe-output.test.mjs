import assert from 'node:assert/strict'
import { link, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writeOutputFiles } from '../bin/safe-output.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-output-race-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'original.dxf'), output = join(root, 'report.html')
  await writeFile(source, 'original source bytes')
  const handle = await open(source, 'r')
  let info
  try { info = await handle.stat({ bigint: true }) } finally { await handle.close() }
  return { root, source, output, protectedInputs: [{ path: await realpath(source), info }] }
}

for (const kind of ['hard link', 'symbolic link']) {
  test(`a ${kind} inserted immediately before rename does not truncate the protected source`, async t => {
    const { root, source, output, protectedInputs } = await fixture(t), before = await readFile(source)
    let called = 0
    await writeOutputFiles([{ path: output, data: 'complete new report' }], { protectedInputs,
      renameImpl: async (temporary, target) => {
        called++
        assert.equal(await readFile(temporary, 'utf8'), 'complete new report')
        if (kind === 'hard link') await link(source, target)
        else await symlink(source, target, 'file')
        await rename(temporary, target)
      },
    })
    assert.equal(called, 1); assert.deepEqual(await readFile(source), before)
    const sourceInfo = await stat(source, { bigint: true })
    assert.equal(sourceInfo.dev, protectedInputs[0].info.dev); assert.equal(sourceInfo.ino, protectedInputs[0].info.ino)
    assert.equal(await readFile(output, 'utf8'), 'complete new report')
    assert.deepEqual((await readdir(root)).sort(), ['original.dxf', 'report.html'])
  })
}

test('same input path and lexical aliases are refused without truncation', async t => {
  const { source, protectedInputs } = await fixture(t)
  await assert.rejects(writeOutputFiles([{ path: source, data: 'unsafe' }], { protectedInputs }), /aliases an input drawing/u)
  assert.equal(await readFile(source, 'utf8'), 'original source bytes')
})

test('duplicate output paths are refused before an earlier file is replaced', async t => {
  const { output } = await fixture(t)
  await writeFile(output, 'previous page')
  await assert.rejects(writeOutputFiles([{ path: output, data: 'first' }, { path: output, data: 'second' }]), /alias one another/u)
  assert.equal(await readFile(output, 'utf8'), 'previous page')
})

test('a staging failure preserves all prior outputs and removes owned temporary files', async t => {
  const { root, output } = await fixture(t), later = join(root, 'report.json')
  await writeFile(output, 'previous page'); await writeFile(later, 'previous JSON')
  await assert.rejects(writeOutputFiles([{ path: output, data: 'new page' }, { path: later, data: undefined }]), /data/u)
  assert.equal(await readFile(output, 'utf8'), 'previous page')
  assert.equal(await readFile(later, 'utf8'), 'previous JSON')
  assert.ok((await readdir(root)).every(name => !name.endsWith('.tmp')))
})

test('a failed rename preserves the protected source and cleans temporary output', async t => {
  const { root, source, output, protectedInputs } = await fixture(t)
  await assert.rejects(writeOutputFiles([{ path: output, data: 'new page' }], { protectedInputs,
    renameImpl: async () => { throw new Error('simulated filesystem rename failure') },
  }), /simulated filesystem rename failure/u)
  assert.equal(await readFile(source, 'utf8'), 'original source bytes')
  assert.deepEqual(await readdir(root), ['original.dxf'])
})
