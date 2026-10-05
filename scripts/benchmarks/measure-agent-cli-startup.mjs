// Local proposal-only timing for the published Skill CLI path; no model request.
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'

const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--bin' || args[2] !== '--runs') {
  throw new Error('Usage: node scripts/benchmarks/measure-agent-cli-startup.mjs --bin <installed-kjdraw.mjs> --runs <1..50>')
}
const bin = resolve(args[1])
const runs = Number(args[3])
if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error('Runs must be an integer from 1 to 50')
const workspace = await mkdtemp(join(tmpdir(), 'kjdraw-cli-probe-'))
const durationsMs = []
try {
  await writeFile(join(workspace, 'circle.json'), JSON.stringify({
    expectedRevision: 0,
    units: 'millimeter',
    circles: [{ center: { x: 0, y: 0 }, radius: 5 }],
  }))
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now()
    const child = spawnSync(process.execPath, [bin, 'agent', 'call', 'cad_propose_circles',
      '--blank', `circle-${index}.kjd`, '--units', 'millimeter', '--args-file', 'circle.json',
      '--workspace', workspace], { cwd: workspace, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000 })
    const elapsed = performance.now() - started
    if (child.error || child.status !== 0) throw new Error(`CLI invocation ${index + 1} failed: ${child.error?.message ?? child.stderr?.slice(0, 300)}`)
    const result = JSON.parse(child.stdout)
    if (result.ok !== true || result.value?.status !== 'awaiting-host-approval') throw new Error(`CLI invocation ${index + 1} did not produce a pending proposal`)
    durationsMs.push(Number(elapsed.toFixed(1)))
  }
} finally {
  // `workspace` is the exact directory returned by mkdtemp inside the OS temp.
  if (!isAbsolute(workspace) || !resolve(workspace).startsWith(resolve(tmpdir()) + sep)
    || !basename(workspace).startsWith('kjdraw-cli-probe-')) throw new Error('Unsafe temporary workspace')
  await rm(workspace, { recursive: true, force: true })
}
const sorted = [...durationsMs].sort((a, b) => a - b)
const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
console.log(JSON.stringify({ kind: 'local Skill CLI proposal-only startup', bin,
  runs, medianMs: Number(median.toFixed(1)), minMs: sorted[0], maxMs: sorted.at(-1), durationsMs,
  scope: 'Fresh Node process per call; includes local CLI startup, validation and ledger write. Excludes model request, human review, candidate DXF export and client overhead.' }, null, 2))
