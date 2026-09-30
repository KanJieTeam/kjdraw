import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

/** Generated public test sheet; no customer drawing or project data. */
export async function publicAnnotationSheet() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'public-annotation-sheet', units: 'millimeter' })
  await document.transact('Public annotation regression fixture', tx => {
    for (let i = 0; i < 75; i++) tx.createEntity('TEXT', {
      text: 'Depth ' + i, position: [i % 15 * 8, Math.floor(i / 15) * 5, 0], height: 2,
    }, { id: 'note-' + i })
    tx.createEntity('TEXT', { text: 'ZK03', position: [30, 45, 0], height: 2 }, { id: 'hole-label' })
    tx.createEntity('MTEXT', { text: '粉质黏土\\P层底 5.20', position: [60, 35, 0], height: 2, width: 30 }, { id: 'stratum-label' })
    tx.createEntity('LINE', { start: [30, 0, 0], end: [30, 40, 0] }, { id: 'hole-axis' })
    tx.createEntity('HATCH', { patternName: 'ANSI31', solid: false, patternScale: 1, patternAngle: 0,
      boundaryLoops: [{ flags: 22, external: true, closed: true, vertices: [[0, 0], [120, 0], [120, 30], [0, 30]] }],
    }, { id: 'stratum-hatch' })
  })
  return { sdk, document, dxf: await sdk.writeDocument(document, { format: 'DXF' }) }
}
