import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replaceReportFile } from '../scripts/benchmarks/atomic-report.mjs'

test('report replacement survives transient Windows locks with bounded retries and identical paths', async () => {
  const calls = [], sleeps = []
  await replaceReportFile(join(tmpdir(), 'fixture.next.json'), join(tmpdir(), 'fixture.json'), {
    renameImpl: async (...paths) => { calls.push(paths); if (calls.length < 4) throw Object.assign(new Error('locked'), { code: 'EPERM' }) },
    sleep: async value => { sleeps.push(value) },
  })
  assert.equal(calls.length, 4)
  assert.ok(calls.every(paths => JSON.stringify(paths) === JSON.stringify(calls[0])))
  assert.deepEqual(sleeps, [50, 100, 150])
})

test('permanent or non-lock IO errors are not hidden and retries never exceed the bound', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ENOSPC', 'ENOENT']) {
    let calls = 0, sleeps = 0
    const failure = Object.assign(new Error('IO failure'), { code })
    await assert.rejects(replaceReportFile(join(tmpdir(), 'fixture.next.json'), join(tmpdir(), 'fixture.json'), {
      renameImpl: async () => { calls++; throw failure }, sleep: async () => { sleeps++ },
    }), error => error === failure)
    const lock = ['EPERM', 'EACCES', 'EBUSY'].includes(code)
    assert.equal(calls, lock ? 7 : 1); assert.equal(sleeps, lock ? 6 : 0)
  }
})

test('actual replacement preserves the old report on failure and atomically replaces it on success', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-atomic-report-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'report.next.json'), target = join(directory, 'report.json')
  await writeFile(target, 'previous checkpoint'); await writeFile(source, 'next checkpoint')
  await assert.rejects(replaceReportFile(source, target, { renameImpl: async () => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' })
  }, sleep: async () => {} }))
  assert.equal(await readFile(target, 'utf8'), 'previous checkpoint')
  assert.equal(await readFile(source, 'utf8'), 'next checkpoint')
  await replaceReportFile(source, target)
  assert.equal(await readFile(target, 'utf8'), 'next checkpoint')
})

test('invalid report paths and unbounded retry settings fail before filesystem IO', async () => {
  let calls = 0
  for (const [source, target, attempts] of [
    [join(tmpdir(), 'same'), join(tmpdir(), 'same'), 7],
    [join(tmpdir(), 'one', 'next'), join(tmpdir(), 'two', 'report'), 7],
    [join(tmpdir(), 'next'), join(tmpdir(), 'report'), 8],
  ]) await assert.rejects(replaceReportFile(source, target, { attempts, renameImpl: async () => { calls++ } }))
  assert.equal(calls, 0)
})
