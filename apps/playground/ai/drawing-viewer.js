const MIN_SCALE = 1e-7
const MAX_SCALE = 1e7
let viewerSequence = 0

export function zoomViewerCamera(camera, factor, point, viewport) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor))
  const dx = point[0] - viewport.width / 2
  const dy = viewport.height / 2 - point[1]
  return {
    centerX: camera.centerX + dx / camera.scale - dx / scale,
    centerY: camera.centerY + dy / camera.scale - dy / scale,
    scale,
  }
}

export function panViewerCamera(camera, dx, dy) {
  return { ...camera, centerX: camera.centerX - dx / camera.scale, centerY: camera.centerY + dy / camera.scale }
}

/** A view-only camera over the runtime's actual CAD document or pending preview. */
export function createDrawingViewer({ container, runtime, mode = 'document', planId, canvas: suppliedCanvas, labels = {} }) {
  if (!container?.ownerDocument || !runtime?.renderDocument || !runtime?.renderProposal || !runtime?.getViewerCamera) {
    throw new TypeError('Drawing viewer requires a container and CAD runtime')
  }
  const document = container.ownerDocument
  const window = document.defaultView
  const viewerId = ++viewerSequence
  const text = { title: 'Drawing', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit drawing', enlarge: 'Open drawing', close: 'Close drawing', hint: 'Scroll to zoom · Drag to pan', unavailable: 'Drawing preview unavailable', ...labels }
  const make = (tag, className, content) => {
    const element = document.createElement(tag)
    element.className = className
    if (content !== undefined) element.textContent = content
    return element
  }
  const shell = make('section', 'drawing-viewer')
  shell.setAttribute('aria-label', text.title)
  const toolbar = make('div', 'drawing-viewer-toolbar')
  const hint = make('span', 'drawing-viewer-hint', text.hint)
  hint.id = `drawing-viewer-hint-${viewerId}`
  const controls = make('div', 'drawing-viewer-controls')
  const stage = make('div', 'drawing-viewer-stage')
  stage.tabIndex = 0
  stage.setAttribute('role', 'group')
  stage.setAttribute('aria-label', text.title)
  stage.setAttribute('aria-describedby', hint.id)
  const canvas = suppliedCanvas ?? document.createElement('canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', text.title)
  const status = make('output', 'drawing-viewer-status')
  status.setAttribute('aria-live', 'off')
  const buttons = new Map()
  const cleanups = []
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options)
    cleanups.push(() => target.removeEventListener(event, handler, options))
  }
  const button = (action, title, content, handler) => {
    const element = make('button', '', content)
    element.type = 'button'
    element.dataset.viewerAction = action
    element.setAttribute('aria-label', title)
    element.title = title
    listen(element, 'click', handler)
    buttons.set(action, element)
    return element
  }
  controls.append(
    button('zoom-out', text.zoomOut, '−', () => zoom(1 / 1.25)),
    status,
    button('zoom-in', text.zoomIn, '+', () => zoom(1.25)),
    button('fit', text.fit, text.fit, fit),
    button('enlarge', text.enlarge, text.enlarge, enlarge),
  )
  toolbar.append(hint, controls)
  stage.append(canvas)
  shell.append(toolbar, stage)
  container.append(shell)

  let camera = null
  let fittedScale = 1
  let fitted = true
  let viewport = { width: 0, height: 0 }
  let revision = runtime.revision
  let frame = null
  let destroyed = false
  let dialog = null
  let returnFocus = null
  let pointer = null
  let failed = false
  const requestFrame = window?.requestAnimationFrame?.bind(window) ?? (callback => setTimeout(callback, 16))
  const cancelFrame = window?.cancelAnimationFrame?.bind(window) ?? clearTimeout

  function updateMetadata() {
    if (!camera) return
    const serialized = JSON.stringify(camera)
    for (const target of [shell, canvas]) {
      target.dataset.viewerMode = mode
      target.dataset.viewerScale = String(camera.scale)
      target.dataset.viewerCamera = serialized
    }
    const percentage = `${Math.round(camera.scale / fittedScale * 100)}%`
    status.textContent = typeof text.scale === 'function' ? text.scale(camera.scale / fittedScale) : percentage
    buttons.get('zoom-in').disabled = failed || camera.scale >= MAX_SCALE
    buttons.get('zoom-out').disabled = failed || camera.scale <= MIN_SCALE
  }

  function render() {
    frame = null
    if (destroyed || !shell.isConnected) return
    const rect = stage.getBoundingClientRect()
    const width = rect.width || stage.clientWidth
    const height = rect.height || stage.clientHeight
    // Closed details/hidden conversations will render when their size becomes available.
    if (width < 1 || height < 1) return
    const resized = width !== viewport.width || height !== viewport.height
    try {
      if (!camera || resized && fitted) {
        camera = runtime.getViewerCamera({ mode, planId, width, height })
        fittedScale = camera.scale
      } else if (resized) {
        const nextFit = runtime.getViewerCamera({ mode, planId, width, height })
        // Preserve the user's zoom relative to fit while enlarging the viewport.
        camera = { ...camera, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * nextFit.scale / fittedScale)) }
        fittedScale = nextFit.scale
      }
      viewport = { width, height }
      failed = false
      updateMetadata()
      const options = { width, height, camera, pixelRatio: Math.max(1, window?.devicePixelRatio || 1) }
      const report = mode === 'proposal' ? runtime.renderProposal(canvas, planId, options) : runtime.renderDocument(canvas, options)
      shell.dataset.viewerRendered = String(report?.rendered ?? 0)
      delete shell.dataset.viewerError
    } catch {
      failed = true
      shell.dataset.viewerError = 'true'
      status.textContent = text.unavailable
      buttons.get('zoom-in').disabled = true
      buttons.get('zoom-out').disabled = true
    }
  }

  function schedule() {
    if (!destroyed && frame === null) frame = requestFrame(render)
  }

  function refresh(next = {}) {
    if (destroyed) return
    const nextMode = next.mode ?? mode
    const nextPlan = next.planId ?? planId
    if (nextMode !== mode || nextPlan !== planId || runtime.revision !== revision || next.fit === true) {
      camera = null
      fitted = true
    }
    mode = nextMode
    planId = nextPlan
    revision = runtime.revision
    if (next.labels) {
      Object.assign(text, next.labels)
      hint.textContent = text.hint
      shell.setAttribute('aria-label', text.title)
      stage.setAttribute('aria-label', text.title)
      canvas.setAttribute('aria-label', text.title)
    }
    schedule()
  }

  function fit() {
    camera = null
    fitted = true
    schedule()
  }

  function zoom(factor, point = [viewport.width / 2, viewport.height / 2]) {
    if (destroyed || failed || !camera) return
    camera = zoomViewerCamera(camera, factor, point, viewport)
    fitted = false
    updateMetadata()
    schedule()
  }

  function pan(dx, dy) {
    if (destroyed || failed || !camera) return
    camera = panViewerCamera(camera, dx, dy)
    fitted = false
    updateMetadata()
    schedule()
  }

  function stopPan() {
    if (pointer && stage.hasPointerCapture?.(pointer.id)) stage.releasePointerCapture(pointer.id)
    pointer = null
    stage.classList.remove('is-panning')
  }

  function close() {
    if (!dialog || !dialog.open) return
    stopPan()
    container.append(shell)
    shell.classList.remove('is-enlarged')
    buttons.get('enlarge').hidden = false
    dialog.close()
    schedule()
    if (!destroyed && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  }

  function enlarge() {
    if (destroyed || dialog?.open) return
    stopPan()
    if (!dialog) {
      dialog = make('dialog', 'drawing-viewer-dialog')
      const head = make('div', 'drawing-viewer-dialog-head')
      const title = make('h2', '', text.title)
      title.id = `drawing-viewer-title-${viewerId}`
      dialog.setAttribute('aria-labelledby', title.id)
      const closeButton = button('close', text.close, '×', close)
      head.append(title, closeButton)
      dialog.append(head, make('div', 'drawing-viewer-dialog-body'))
      document.body.append(dialog)
      listen(dialog, 'cancel', event => { event.preventDefault(); close() })
      listen(dialog, 'close', () => {
        if (shell.parentElement !== container && !destroyed) {
          container.append(shell)
          shell.classList.remove('is-enlarged')
          buttons.get('enlarge').hidden = false
          schedule()
        }
      })
      listen(dialog, 'click', event => {
        if (event.target !== dialog) return
        const bounds = dialog.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
      })
    }
    returnFocus = document.activeElement
    dialog.querySelector('.drawing-viewer-dialog-body').append(shell)
    shell.classList.add('is-enlarged')
    buttons.get('enlarge').hidden = true
    dialog.showModal()
    stage.focus({ preventScroll: true })
    schedule()
  }

  listen(stage, 'wheel', event => {
    if (!camera || failed || !event.deltaY) return
    event.preventDefault()
    const rect = stage.getBoundingClientRect()
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1)
    zoom(Math.exp(-Math.max(-600, Math.min(600, delta)) * 0.0015), [event.clientX - rect.left, event.clientY - rect.top])
  }, { passive: false })
  listen(stage, 'pointerdown', event => {
    if (!camera || failed || pointer || ![0, 1].includes(event.button)) return
    event.preventDefault()
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    stage.setPointerCapture?.(event.pointerId)
    stage.classList.add('is-panning')
    stage.focus({ preventScroll: true })
  })
  listen(stage, 'pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return
    pan(event.clientX - pointer.x, event.clientY - pointer.y)
    pointer.x = event.clientX
    pointer.y = event.clientY
  })
  listen(stage, 'pointerup', event => { if (pointer?.id === event.pointerId) stopPan() })
  listen(stage, 'pointercancel', stopPan)
  listen(stage, 'lostpointercapture', stopPan)
  listen(stage, 'keydown', event => {
    const key = event.key
    if (['+', '=', '-', '_', '0', 'f', 'F', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) event.preventDefault()
    if (key === '+' || key === '=') zoom(1.25)
    else if (key === '-' || key === '_') zoom(1 / 1.25)
    else if (key === '0' || key.toLowerCase() === 'f') fit()
    else if (key === 'ArrowLeft') pan(40, 0)
    else if (key === 'ArrowRight') pan(-40, 0)
    else if (key === 'ArrowUp') pan(0, 40)
    else if (key === 'ArrowDown') pan(0, -40)
    else if (key === 'Escape' && dialog?.open) { event.preventDefault(); close() }
  })
  const ResizeObserver = window?.ResizeObserver
  const observer = ResizeObserver ? new ResizeObserver(schedule) : null
  observer?.observe(stage)
  listen(window, 'resize', schedule)
  schedule()

  return {
    refresh, fit, enlarge, close,
    getCamera: () => camera ? { ...camera } : null,
    destroy() {
      if (destroyed) return
      destroyed = true
      stopPan()
      if (frame !== null) cancelFrame(frame)
      frame = null
      observer?.disconnect()
      for (const cleanup of cleanups) cleanup()
      if (dialog?.open) dialog.close()
      dialog?.remove()
      // The host keeps its source canvas reference across conversation rerenders.
      if (suppliedCanvas) canvas.remove()
      shell.remove()
    },
  }
}
