import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { reviewDrawingFiles, writeReviewReport } from '../examples/drawing-review/report.mjs'

const cli = fileURLToPath(new URL('../examples/drawing-review/cli.mjs', import.meta.url))
const demo = fileURLToPath(new URL('../examples/drawing-review/demo.mjs', import.meta.url))
const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '5', 'AB', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
const options = { units: 'millimeter', scope: 'model', identity: 'semantic' }

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'kjdraw-report-output-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const before = path.join(root, 'source.dxf'), out = path.join(root, 'report')
  await writeFile(before, dxf); await mkdir(out)
  return { root, before, out }
}

function run(before, out, after) {
  return spawnSync(process.execPath, [cli, '--before', before, ...(after ? ['--after', after] : []), '--out', out,
    '--units', 'millimeter', '--scope', 'model', '--identity', 'semantic'], { encoding: 'utf8' })
}

for (const name of ['before-1.svg', 'report.html', 'findings.csv', 'report.json']) {
  test(`review CLI refuses an input hard link at ${name} before writing any report file`, async t => {
    const { before, out } = await fixture(t), original = await readFile(before)
    const target = path.join(out, name)
    await link(before, target)
    const [sourceInfo, outputInfo] = await Promise.all([stat(before, { bigint: true }), stat(target, { bigint: true })])
    assert.equal(sourceInfo.dev, outputInfo.dev); assert.equal(sourceInfo.ino, outputInfo.ino)
    const result = run(before, out)
    assert.equal(result.status, 1, result.stdout); assert.match(result.stderr, /aliases an input drawing/u)
    assert.deepEqual(await readFile(before), original); assert.deepEqual(await readFile(target), original)
    assert.deepEqual(await readdir(out), [name])
  })
}

test('review protects the after drawing and preserves earlier outputs on a late-target conflict', async t => {
  const { root, before, out } = await fixture(t), after = path.join(root, 'after.dxf')
  await writeFile(after, dxf); await writeFile(path.join(out, 'before-1.svg'), 'previous preview')
  await link(after, path.join(out, 'report.json'))
  const result = run(before, out, after)
  assert.equal(result.status, 1); assert.match(result.stderr, /aliases an input drawing/u)
  assert.equal(await readFile(before, 'utf8'), dxf); assert.equal(await readFile(after, 'utf8'), dxf)
  assert.equal(await readFile(path.join(out, 'before-1.svg'), 'utf8'), 'previous preview')
  assert.deepEqual(await readdir(out), ['before-1.svg', 'report.json'])
})

test('review refuses report-to-report hard link aliases before refreshing earlier outputs', async t => {
  const { before, out } = await fixture(t)
  await writeFile(path.join(out, 'before-1.svg'), 'previous preview')
  await writeFile(path.join(out, 'report.html'), 'previous page')
  await link(path.join(out, 'report.html'), path.join(out, 'findings.csv'))
  const result = run(before, out)
  assert.equal(result.status, 1); assert.match(result.stderr, /Output targets alias one another/u)
  assert.equal(await readFile(path.join(out, 'before-1.svg'), 'utf8'), 'previous preview')
  assert.equal(await readFile(path.join(out, 'report.html'), 'utf8'), 'previous page')
  assert.equal(await readFile(path.join(out, 'findings.csv'), 'utf8'), 'previous page')
  assert.equal(await readFile(before, 'utf8'), dxf)
})

for (const dangling of [false, true]) {
  test(`review refuses a ${dangling ? 'dangling' : 'source-targeting'} output symlink`, async t => {
    const { root, before, out } = await fixture(t), target = path.join(out, 'report.html')
    await symlink(dangling ? path.join(root, 'missing.dxf') : before, target, 'file')
    const result = run(before, out)
    assert.equal(result.status, 1); assert.match(result.stderr, /symbolic link/u)
    assert.equal(await readFile(before, 'utf8'), dxf)
    assert.deepEqual(await readdir(out), ['report.html'])
  })
}

test('review resolves a directory alias and refuses the same protected disk object', async t => {
  const { root, before, out } = await fixture(t), alias = path.join(root, 'out-alias')
  await symlink(out, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await link(before, path.join(out, 'report.html'))
  const result = run(path.join(root, '.', 'source.dxf'), path.join(alias, '..', 'out-alias'))
  assert.equal(result.status, 1); assert.match(result.stderr, /aliases an input drawing/u)
  assert.equal(await readFile(before, 'utf8'), dxf)
  assert.deepEqual(await readdir(out), ['report.html'])
})

test('review refuses the canonical input path even when the input name is a symlink', async t => {
  const { root, before, out } = await fixture(t), input = path.join(root, 'input-alias.dxf')
  await writeFile(path.join(out, 'report.html'), dxf)
  await symlink(path.join(out, 'report.html'), input, 'file')
  const result = run(input, out)
  assert.equal(result.status, 1); assert.match(result.stderr, /aliases an input drawing/u)
  assert.equal(await readFile(input, 'utf8'), dxf); assert.equal(await readFile(before, 'utf8'), dxf)
})

test('new reports and ordinary repeated reports succeed without rewriting input or unrelated hard links', async t => {
  const { root, before, out } = await fixture(t), original = await readFile(before)
  assert.equal(run(before, out).status, 0)
  const previous = await readFile(path.join(out, 'report.html')), saved = path.join(root, 'saved-page.html')
  await link(path.join(out, 'report.html'), saved)
  await writeFile(before, dxf.replace('\n10\n21\n0\n', '\n20\n21\n0\n'))
  const revisedInput = await readFile(before)
  const result = run(before, out)
  assert.equal(result.status, 0, result.stderr)
  assert.notDeepEqual(revisedInput, original); assert.deepEqual(await readFile(before), revisedInput)
  assert.deepEqual(await readFile(saved), previous)
  assert.notDeepEqual(await readFile(path.join(out, 'report.html')), previous)
  const serialized = await readFile(path.join(out, 'report.json'), 'utf8')
  assert.equal(serialized.includes(root), false); assert.equal(serialized.includes('inputIdentity'), false)
  assert.match(await readFile(path.join(out, 'before-1.svg'), 'utf8'), /<svg/u)
  assert.ok((await readdir(out)).every(name => !name.endsWith('.tmp')))
})

test('invalid input leaves original bytes and an existing report untouched', async t => {
  const { root, out } = await fixture(t), input = path.join(root, 'invalid.kjd')
  await writeFile(input, '{ invalid JSON'); await writeFile(path.join(out, 'report.html'), 'previous page')
  const result = run(input, out)
  assert.equal(result.status, 1)
  assert.equal(await readFile(input, 'utf8'), '{ invalid JSON')
  assert.equal(await readFile(path.join(out, 'report.html'), 'utf8'), 'previous page')
  assert.deepEqual(await readdir(out), ['report.html'])
})

test('report API refuses protected hard links as well as the CLI', async t => {
  const { before, out } = await fixture(t), report = await reviewDrawingFiles({ before, ...options })
  await link(before, path.join(out, 'report.html'))
  await assert.rejects(writeReviewReport(report, out), /aliases an input drawing/u)
  assert.equal(await readFile(before, 'utf8'), dxf)
})

test('demo refreshes its generated samples and report without truncating an unrelated linked file', async t => {
  const { before, out } = await fixture(t)
  await link(before, path.join(out, 'sample-a.dxf'))
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, [demo, out], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(before, 'utf8'), dxf)
    assert.match(await readFile(path.join(out, 'sample-a.dxf'), 'utf8'), /Plate A/u)
    assert.match(await readFile(path.join(out, 'sample-b.dxf'), 'utf8'), /Plate B/u)
    assert.match(await readFile(path.join(out, 'report.html'), 'utf8'), /<svg/u)
  }
})
