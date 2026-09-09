import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJCanvasRenderer } from '../../packages/kjdraw-sdk/src/canvas-renderer.js'
import { DxfViewer } from 'dxf-viewer'
import DxfParser from 'dxf-parser'

const counts = entities => {
  const out = {}
  for (const entity of entities) out[entity.type] = (out[entity.type] ?? 0) + 1
  return out
}
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

// All assets are served by the opt-in local runner, never a public drawing upload endpoint.
window.runLoadComparison = async (engine, id) => {
  const bytes = new Uint8Array(await (await fetch(`/drawing/${id}`)).arrayBuffer())
  const container = document.querySelector('#drawing')
  const fontBytes = await (await fetch('/font')).arrayBuffer()
  const fontUrl = URL.createObjectURL(new Blob([fontBytes]))
  const face = await new FontFace('ui-monospace', fontBytes).load()
  document.fonts.add(face)
  await document.fonts.ready
  const result = { engine, id, inputBytes: bytes.length }
  let renderer, sdk, viewer
  if (engine === 'kjdraw') {
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:100%;height:100%;display:block'
    container.append(canvas)
    renderer = new KJCanvasRenderer(canvas, { grid: false, pixelRatio: 1, theme: 'dark' })
    sdk = createKJDrawSDK()
  } else if (engine === 'dxf-viewer') {
    viewer = new DxfViewer(container, { autoResize: true, retainParsedDxf: true })
  }
  const t = performance.now()
  if (engine === 'kjdraw') {
    const drawing = await sdk.readDocument(bytes, { format: 'DXF' })
    result.parseAndDocumentMs = performance.now() - t
    renderer.setDocument(drawing)
    renderer.fit()
    result.apiLoadMs = performance.now() - t
    result.renderReport = renderer.report
    result.modelTypes = counts(drawing.listEntities({ ownerId: drawing.snapshot().spaces.modelSpaceId }))
    result.allTypes = counts(drawing.listEntities())
  } else if (engine === 'dxf-viewer') {
    const url = URL.createObjectURL(new Blob([bytes]))
    try { await viewer.Load({ url, fonts: [fontUrl] }) }
    finally { URL.revokeObjectURL(url) }
    result.apiLoadMs = performance.now() - t
    const dxf = viewer.GetDxf()
    result.modelTypes = counts((dxf?.entities ?? []).filter(e => !e.inPaperSpace && (!e.layout || e.layout === 'Model')))
    result.hasMissingChars = viewer.hasMissingChars
    result.drawCalls = viewer.renderer.info.render.calls
    const gl = viewer.renderer.getContext()
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    result.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable'
  } else if (engine === 'dxf-parser') {
    const parsed = new DxfParser().parseSync(new TextDecoder('utf-8').decode(bytes))
    result.parseOnlyMs = performance.now() - t
    result.modelTypes = counts((parsed.entities ?? []).filter(e => !e.inPaperSpace && (!e.layout || e.layout === 'Model')))
  } else throw new Error('Unknown comparison engine')
  if (engine !== 'dxf-parser') {
    await frame()
    result.scheduledFrameMs = performance.now() - t
    const times = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      if (renderer) renderer.render()
      else viewer.Render()
      times.push(performance.now() - start)
      await frame()
    }
    result.redrawCpuMs = times
    result.redrawComparable = false // CPU call duration excludes GPU completion; not an FPS comparison.
  }
  URL.revokeObjectURL(fontUrl)
  return result
}
