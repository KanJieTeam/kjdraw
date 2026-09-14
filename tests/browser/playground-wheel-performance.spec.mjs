import { expect, test } from '@playwright/test'

test('dense energy-campus wheel bursts render once per animation frame', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Focused playground performance coverage runs once in Chromium')
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.clearRect
    globalThis.__kjdrawClearCount = 0
    CanvasRenderingContext2D.prototype.clearRect = function (...arguments_) {
      globalThis.__kjdrawClearCount++
      return original.apply(this, arguments_)
    }
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#sample-select').selectOption('sample-resilient-campus')
  await expect(page.locator('#sample-select')).toHaveValue('sample-resilient-campus')

  const result = await page.locator('#canvas').evaluate(async canvas => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const rect = canvas.getBoundingClientRect(), clientX = rect.left + rect.width * .55, clientY = rect.top + rect.height * .45
    const hoverStarted = performance.now()
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    const hoverElapsed = performance.now() - hoverStarted
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    globalThis.__kjdrawClearCount = 0
    const started = performance.now()
    for (let index = 0; index < 24; index++) canvas.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      deltaY: index % 2 ? 18 : -24,
    }))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { hoverElapsed, renders: globalThis.__kjdrawClearCount, elapsed: performance.now() - started }
  })
  expect(result.hoverElapsed).toBeLessThan(1000)
  expect(result.renders).toBe(1)
  expect(result.elapsed).toBeLessThan(1000)
})
