import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const python = process.env.KJDRAW_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3')
const bridge = fileURLToPath(new URL('./ezdxf-interop.py', import.meta.url))

function runPython(action, path) {
  const result = spawnSync(python, [bridge, action, path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error([`Independent ezdxf ${action} failed`, result.stdout, result.stderr].filter(Boolean).join('\n'))
  return JSON.parse(result.stdout)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const directory = await mkdtemp(join(tmpdir(), 'kjdraw-dxf-interop-'))
try {
  const kjdrawOutput = join(directory, 'kjdraw-output.dxf')
  const externalInput = join(directory, 'ezdxf-input.dxf')
  const roundTrip = join(directory, 'kjdraw-roundtrip.dxf')

  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'cross-implementation-output', title: 'KJDraw → ezdxf' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'KJ_INTEROP', color: 3 })
  const payloads = [
    ['LINE', { start: [0, 0, 0], end: [120, 35, 0], layerId: layer.id }],
    ['CIRCLE', { center: [40, 60, 0], radius: 12.5, layerId: layer.id }],
    ['ARC', { center: [95, 65, 0], radius: 18, startAngle: Math.PI / 9, endAngle: Math.PI * 7 / 6, layerId: layer.id }],
    ['LWPOLYLINE', { vertices: [[0, 100], { point: [50, 100, 0], bulge: 0.35 }, [70, 125], [0, 125]], closed: true, layerId: layer.id }],
    ['TEXT', { position: [10, 145, 0], text: 'KJDraw interop', height: 4, layerId: layer.id }],
  ]
  for (const [type, payload] of payloads) await sdk.executeCommand('CREATE', { type, payload })
  const emitted = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  await writeFile(kjdrawOutput, emitted)
  const externalRead = runPython('inspect', kjdrawOutput)
  assert.equal(externalRead.dxfVersion, 'AC1032')
  assert.equal(externalRead.auditErrors, 0)
  assert.equal(externalRead.modelspaceEntities.LINE, 1)
  assert.equal(externalRead.modelspaceEntities.CIRCLE, 1)
  assert.ok(externalRead.layers.includes('KJ_INTEROP'))

  const externalGeneration = runPython('generate', externalInput)
  const externalBytes = await readFile(externalInput)
  const imported = await createKJDrawSDK().readDocument(externalBytes, { format: 'DXF', version: '2018' })
  assert.equal(imported.getTable('layers').records.some(row => row.name === 'KJ_INTEROP'), true)
  assert.equal(imported.listEntities({ type: 'LINE' }).length >= 2, true, 'model and block LINE entities must import')
  assert.equal(imported.listEntities({ type: 'CIRCLE' }).length >= 2, true, 'model and block CIRCLE entities must import')
  assert.equal(imported.listEntities({ type: 'ARC' }).length, 1)
  assert.equal(imported.listEntities({ type: 'LWPOLYLINE' }).length, 1)
  assert.equal(imported.listEntities({ type: 'TEXT' }).length, 1)
  assert.equal(imported.listEntities({ type: 'INSERT' }).length, 1)
  const polyline = imported.listEntities({ type: 'LWPOLYLINE' })[0]
  assert.equal(polyline.payload.closed, true)
  assert.equal(polyline.payload.vertices.some(vertex => Number(vertex.bulge ?? 0) !== 0), true)

  const reopenedSDK = createKJDrawSDK()
  reopenedSDK.attachDocument(imported)
  await writeFile(roundTrip, await reopenedSDK.writeDocument(imported, { format: 'DXF', version: '2018' }))
  const externalRoundTrip = runPython('inspect', roundTrip)
  assert.equal(externalRoundTrip.auditErrors, 0)
  assert.equal(externalRoundTrip.modelspaceEntities.INSERT, 1)

  console.log(JSON.stringify({
    schema: 'com.kanjie.kjdraw.audit.dxf-interop@1',
    independentImplementation: `ezdxf ${externalRead.ezdxfVersion}`,
    direction: ['KJDraw write → ezdxf read/audit', 'ezdxf write → KJDraw read/write → ezdxf read/audit'],
    files: {
      kjdrawOutputSha256: sha256(Buffer.from(emitted)),
      externalInputSha256: sha256(externalBytes),
      roundTripSha256: sha256(await readFile(roundTrip)),
    },
    externalRead,
    externalGeneration,
    externalRoundTrip,
    limitation: 'Independent open-source implementation evidence for the tested ASCII R2018 subset; not Autodesk certification.',
  }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
