import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KJAgentToolSession,
  createKJDrawSDK,
  exportDrawingSvg,
} from '../packages/kjdraw-sdk/src/index.js'

export const request = 'Draw an editable A3 manufacturing drawing for a circular flange: outside diameter 120 mm, bore 40 mm, thickness 20 mm, six 10 mm through holes equally spaced on a 90 mm pitch circle.'

export const intent = Object.freeze({
  version: '1.0.0',
  expectedRevision: 0,
  units: 'millimeter',
  locale: 'en',
  drawingId: 'PUBLIC-FLANGE-120-6',
  title: 'SIX-HOLE MOUNTING FLANGE',
  outerDiameter: 120,
  boreDiameter: 40,
  thickness: 20,
  boltCount: 6,
  boltCircleDiameter: 90,
  boltHoleDiameter: 10,
})

export async function buildMechanicalFlangeExample(outputDirectory) {
  const directory = resolve(outputDirectory)
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: intent.drawingId, units: intent.units })
  const session = new KJAgentToolSession(sdk, document)
  const proposed = await session.call('cad_propose_mechanical_flange', intent)
  if (!proposed.ok) throw new Error(proposed.error.message)
  const plan = proposed.value
  const approved = await session.approve(plan.planId, 'public-example-host')
  if (!approved.ok || approved.value.status !== 'committed') throw new Error(approved.ok ? 'Mechanical flange proposal did not commit' : approved.error.message)

  const layout = document.listObjects({ kind: 'layout' }).find(item => item.name?.startsWith('KJ_MECH_'))
  if (!layout) throw new Error('Mechanical flange layout was not created')
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const drawing = exportDrawingSvg(document, { layoutId: layout.id })
  if (drawing.report.diagnostics.length) throw new Error(`Mechanical flange SVG export has diagnostics: ${JSON.stringify(drawing.report.diagnostics)}`)

  const files = {
    kjd: 'mechanical-flange.kjd',
    dxf: 'mechanical-flange.dxf',
    svg: 'mechanical-flange.svg',
  }
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(resolve(directory, files.kjd), kjd),
    writeFile(resolve(directory, files.dxf), dxf),
    writeFile(resolve(directory, files.svg), drawing.svg),
  ])
  return Object.freeze({
    request,
    tool: 'cad_propose_mechanical_flange',
    intent,
    status: approved.value.status,
    revision: document.revision,
    entityCount: document.listEntities().length,
    layout: { id: layout.id, name: layout.name },
    svg: { status: drawing.report.status, rendered: drawing.report.rendered, diagnosticCount: drawing.report.diagnostics.length },
    files,
    dxfSha256: createHash('sha256').update(dxf).digest('hex'),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildMechanicalFlangeExample(process.argv[2] ?? 'kjdraw-mechanical-example')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
