#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { reviewDrawingFiles, writeReviewReport } from './report.mjs'

export const HELP = `Read-only KJDraw drawing review (ASCII DXF / KJD)
node examples/drawing-review/cli.mjs --before A.dxf [--after B.dxf] --out review \
  --units millimeter --scope model --identity semantic

Required: --before, --out, --units (millimeter|meter|inch),
          --scope (model|all|layout:<exact name>),
          --identity (semantic|same-lineage-handles)
Optional: --layer <exact name> (repeatable), --window xmin,ymin,xmax,ymax,
          --max-entities 1..50000, --max-findings 1..10000,
          --max-normalization-nodes 1..1000000 (shared per drawing)
Handle identity is an assertion that both files share one CAD lineage.
No input is modified. JSON, CSV, HTML and SDK SVG previews are generated.
Exit 0: report generated (including warnings); exit 1: invalid input/failure.
`

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true }
  const options = {}, seen = new Set()
  const names = { '--before': 'before', '--after': 'after', '--out': 'out', '--units': 'units', '--scope': 'scope', '--identity': 'identity', '--window': 'window', '--max-entities': 'maxEntities', '--max-findings': 'maxFindings', '--max-normalization-nodes': 'maxNormalizationNodes' }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1]
    if (!Object.hasOwn(names, flag) && flag !== '--layer') throw new Error(`Unknown argument: ${flag}`)
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (flag === '--layer') { (options.layers ??= []).push(value); continue }
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`)
    seen.add(flag); options[names[flag]] = value
  }
  for (const name of ['before', 'out', 'units', 'scope', 'identity']) if (!options[name]) throw new Error(`Missing --${name}`)
  if (options.window !== undefined) {
    const coordinates = options.window.split(',')
    if (coordinates.some(value => !value.trim())) throw new Error('Preview window cannot contain empty coordinates')
    options.window = coordinates.map(Number)
  }
  for (const name of ['maxEntities', 'maxFindings', 'maxNormalizationNodes']) if (options[name] !== undefined) {
    if (!/^\d+$/u.test(options[name])) throw new Error(`${name} requires an integer`)
    options[name] = Number(options[name])
  }
  return options
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  if (options.help) { console.log(HELP); return }
  const report = await reviewDrawingFiles(options), file = await writeReviewReport(report, options.out)
  console.log(JSON.stringify({ report: file, mode: report.mode, sources: report.drawings.map(drawing => ({ side: drawing.side, sha256: drawing.source.sha256,
    imported: drawing.coverage.totalImportedEntities, selected: drawing.coverage.selectedEntities, findings: drawing.checks.findings.length,
    unsupported: drawing.coverage.unsupported.length, previews: drawing.previews.map(preview => preview.report.status) })), comparison: report.comparison?.counts ?? null }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Drawing review failed: ${error.message}`); process.exitCode = 1 })
}
