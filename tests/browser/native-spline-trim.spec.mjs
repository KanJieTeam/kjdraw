import { test, expect } from '@playwright/test'

test('rational native spline cuts survive browser history, KJD/DXF reopening and another cut', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    const original = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
      degree: 2, controlPoints: [[10, 0, 0], [10, 10, 0], [0, 10, 0]],
      knots: [0, 0, 0, 1, 1, 1], weights: [1, Math.SQRT1_2, 1],
    } }, { document })
    const note = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { text: 'Manual note', position: [20, 0, 0], height: 2 } }, { document })
    const source = JSON.stringify(original), manual = JSON.stringify(note), historyBefore = document.history.undoCount
    const pieces = await sdk.executeCommand('BREAK', { id: original.id, parameter: .5 }, { document, expectedRevision: document.revision })
    const oneUndo = document.history.undoCount === historyBefore + 1
    const primaryIdentity = pieces[0].id === original.id && pieces[0].handle === original.handle
    await document.undo()
    const restored = JSON.stringify(document.getObject(original.id)) === source && document.listEntities({ type: 'SPLINE' }).length === 1
    await document.redo()
    const reopenedSDK = createKJDrawSDK(), reopened = reopenedSDK.openDocument(document.serialize())
    await reopenedSDK.executeCommand('BREAK', { id: original.id, parameter: .25 }, { document: reopened, expectedRevision: reopened.revision })
    const exported = await reopenedSDK.writeDocument(reopened, { format: 'DXF', version: '2018' })
    const nativeSDK = createKJDrawSDK(), native = await nativeSDK.readDocument(exported, { format: 'DXF' })
    const curves = native.listEntities({ type: 'SPLINE' })
    // Independent recursive basis evaluation plus the analytic radius of the
    // original rational quarter circle, rather than sampled polyline geometry.
    let maxRadiusError = 0
    for (const entity of curves) {
      const p = entity.payload, start = p.knots[p.degree], end = p.knots[p.controlPoints.length]
      const basis = (i, degree, u) => {
        if (!degree) return p.knots[i] <= u && u < p.knots[i + 1] ? 1 : 0
        const a = p.knots[i + degree] - p.knots[i], b = p.knots[i + degree + 1] - p.knots[i + 1]
        return (a ? (u - p.knots[i]) / a * basis(i, degree - 1, u) : 0)
          + (b ? (p.knots[i + degree + 1] - u) / b * basis(i + 1, degree - 1, u) : 0)
      }
      for (const fraction of [0, .13, .47, .81, 1]) {
        let point
        if (fraction === 1) point = p.controlPoints.at(-1)
        else {
          const u = start + (end - start) * fraction, coefficients = p.controlPoints.map((_, i) => basis(i, p.degree, u) * p.weights[i])
          const denominator = coefficients.reduce((a, b) => a + b, 0)
          point = [0, 1].map(axis => p.controlPoints.reduce((sum, value, i) => sum + value[axis] * coefficients[i], 0) / denominator)
        }
        maxRadiusError = Math.max(maxRadiusError, Math.abs(Math.hypot(point[0], point[1]) - 10))
      }
    }
    return { oneUndo, primaryIdentity, restored, manualBeforeReopenUnchanged: JSON.stringify(document.getObject(note.id)) === manual,
      originalManualRecord: JSON.parse(manual), reopenedManualRecord: JSON.parse(JSON.stringify(reopened.getObject(note.id))),
      nativeManualText: native.listEntities({ type: 'TEXT' })[0].payload.text,
      nativeCurveCount: curves.length, degrees: curves.map(entity => entity.payload.degree),
      nativePolylineCount: native.listEntities({ type: 'LWPOLYLINE' }).length, maxRadiusError }
  })
  expect(result).toMatchObject({ oneUndo: true, primaryIdentity: true, restored: true, manualBeforeReopenUnchanged: true,
    nativeManualText: 'Manual note', nativeCurveCount: 3, degrees: [2, 2, 2], nativePolylineCount: 0 })
  expect(result.maxRadiusError).toBeLessThan(1e-10)
  expect(result.reopenedManualRecord).toEqual(result.originalManualRecord)
  expect(errors).toEqual([])
})

test('native spline trim retains original parameter domains and failed browser edits remain atomic', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 2,
      controlPoints: [[0, 0, 0], [5, 10, 0], [10, 0, 0]], knots: [2, 2, 2, 6, 6, 6] } }, { document })
    const boundaries = []
    for (const x of [2, 8]) boundaries.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [x, -10, 0], end: [x, 10, 0] } }, { document }))
    const before = document.serialize(), history = JSON.stringify(document.history)
    let refused = false
    try { await sdk.executeCommand('TRIM', { id: spline.id, boundaryIds: boundaries.map(entity => entity.id), pickPoint: [5, 9, 0] }, { document }) }
    catch (error) { refused = /spline parameter|certified|pick point/i.test(error.message) }
    const atomic = before === document.serialize() && history === JSON.stringify(document.history)
    const primary = await sdk.executeCommand('TRIM', { id: spline.id, boundaryIds: boundaries.map(entity => entity.id), pickPoint: [5, 5, 0] }, { document, expectedRevision: document.revision })
    const curves = document.listEntities({ type: 'SPLINE' })
    const domains = curves.map(entity => [entity.payload.knots[entity.payload.degree], entity.payload.knots[entity.payload.controlPoints.length]])
    await document.undo()
    return { refused, atomic, primaryIdentity: primary.id === spline.id && primary.handle === spline.handle,
      degrees: curves.map(entity => entity.payload.degree), domains,
      sourceRestored: JSON.stringify(document.getObject(spline.id)) === JSON.stringify(spline),
      boundariesUnchanged: boundaries.every(entity => JSON.stringify(document.getObject(entity.id)) === JSON.stringify(entity)) }
  })
  expect(result).toMatchObject({ refused: true, atomic: true, primaryIdentity: true, degrees: [2, 2], sourceRestored: true, boundariesUnchanged: true })
  expect(result.domains[0][0]).toBe(2)
  expect(result.domains[0][1]).toBeCloseTo(2.8, 7)
  expect(result.domains[1][0]).toBeCloseTo(5.2, 7)
  expect(result.domains[1][1]).toBe(6)
})
