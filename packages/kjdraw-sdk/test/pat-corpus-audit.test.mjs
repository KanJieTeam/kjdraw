import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

test('PAT corpus audit keeps source local, enforces license gating and freezes a deterministic holdout split', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-pat-audit-'))
  try {
    const source = join(root, 'source'), nested = join(source, 'nested'), output = join(root, 'evidence', 'report.json')
    await mkdir(nested, { recursive: true })
    await writeFile(join(source, 'valid.pat'), '*VALID\n0,0,0,0,4,1,-3\n')
    await writeFile(join(nested, 'invalid.pat'), '*INVALID\nnot,numeric\n')
    const script = resolve('scripts/audits/audit-pat-knowledge-corpus.mjs')
    const run = spawnSync(process.execPath, [script, '--root', source, '--output', output, '--spdx', 'NOASSERTION', '--redistributable', 'false'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.schema, 'kjdraw.pat-corpus-audit.v1')
    assert.deepEqual({ files: report.summary.files, parsed: report.summary.parsed, rejected: report.summary.rejected }, { files: 2, parsed: 1, rejected: 1 })
    assert.equal(report.license.publishable, false)
    assert.equal(report.summary.developmentFiles + report.summary.holdoutFiles, 2)
    assert.equal(report.records.every(record => !record.path.includes(root) && !Object.hasOwn(record, 'patternLines')), true)

    const overwrite = spawnSync(process.execPath, [script, '--root', source, '--output', output], { encoding: 'utf8' })
    assert.notEqual(overwrite.status, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
