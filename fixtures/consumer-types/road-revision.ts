import { KJAgentToolSession, type KJAgentRoadRevisionInput, type KJDocument, type KJDrawSDK } from '@kanjieteam/kjdraw'
import { restoreRoadDrawingRecipe } from '@kanjieteam/kjdraw/road-drawing-recipe'
import { mountKJDrawWorkbench } from '@kanjieteam/kjdraw/workbench'
import { captureDrawingView, type KJDrawingViewImage } from '@kanjieteam/kjdraw/drawing-image'

// Check the installed package's declarations across the persisted recipe,
// agent session, drawing-layout navigation and rendered-image boundaries.
async function reviewSavedRoad(sdk: KJDrawSDK, document: KJDocument, savedParameters: unknown) {
  const restored = await restoreRoadDrawingRecipe(document, savedParameters)
  const session = new KJAgentToolSession(sdk, document)
  const registered = await session.registerRoadDrawingRecipe(restored.recipe)
  const input: KJAgentRoadRevisionInput = {
    expectedRevision: registered.revision,
    units: 'meter',
    drawingId: registered.recipe.options.drawingId,
    leftWidthDelta: 0.75,
    rightWidthDelta: 0,
    elevationDelta: 1.25,
  }
  // @ts-expect-error The host registration is a frozen snapshot, not editable parameters.
  registered.recipe.input.pavement.leftWidth = 10
  return session.call('cad_propose_road_revision', input)
}

async function captureSheet(host: HTMLElement, sdk: KJDrawSDK, document: KJDocument, layoutId: string) {
  const workbench = mountKJDrawWorkbench(host, { sdk, document })
  await workbench.ready
  workbench.setDrawingLayout(layoutId)
  const preview: boolean = workbench.paperPreview
  const current: string | null = workbench.drawingLayoutId
  const image: KJDrawingViewImage = await captureDrawingView(document, {
    spaceId: workbench.spaceId!, bounds: [0, 0, 420, 297], width: 1200, height: 850,
  })
  const coordinateSystem: 'modelXY' | 'paperXY' = image.coordinateSystem
  workbench.setDrawingLayout(null)
  workbench.dispose()
  return { image, coordinateSystem, preview, current }
}

void reviewSavedRoad
void captureSheet
