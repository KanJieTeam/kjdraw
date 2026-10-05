import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { previewPlanarBoundaries, type KJPlanarBoundaryRequest } from '@kanjieteam/kjdraw/planar-boundaries'
import { applyPlanarBoundaryExtraction, type KJPlanarBoundaryEditResult } from '@kanjieteam/kjdraw/planar-boundary-edit'

export async function extractReviewedBoundaries(ids: readonly string[]): Promise<KJPlanarBoundaryEditResult> {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  const request: KJPlanarBoundaryRequest = { ids, units: 'millimeter', expectedRevision: document.revision }
  const preview = await previewPlanarBoundaries(document, request)
  return applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
}
