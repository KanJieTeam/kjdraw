import { expect, test } from '@playwright/test'
import { installSyntheticViewerObserver, validateSyntheticViewerObservations } from '../../scripts/record-synthetic-geology-demo.mjs'

// Actual exported recorder observer running in a real browser. These synthetic
// DOM-only diagnostics never start an AI runtime, contact or mock a provider,
// or claim model/CAD acceptance. The normal repository browser config is used.
async function observedPage(page) {
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await page.addInitScript(installSyntheticViewerObserver)
  await page.goto('about:blank')
  return {
    async snapshot() {
      return page.evaluate(async () => {
        // Mutation delivery is real, including changes batched in one task.
        await new Promise(resolve => queueMicrotask(resolve))
        return structuredClone(window.__syntheticViewerObservations)
      })
    },
    assertNoRequests() { expect(requests).toEqual([]) },
  }
}

function assertUnavailable(observations, mode = 'proposal') {
  expect(observations.length).toBeGreaterThan(0)
  let previous = 0
  for (const observation of observations) {
    expect(Object.keys(observation).sort()).toEqual(['mode', 'timeMs'])
    expect(observation.mode).toBe(mode)
    expect(Number.isFinite(observation.timeMs)).toBe(true)
    expect(observation.timeMs).toBeGreaterThanOrEqual(previous)
    previous = observation.timeMs
  }
  expect(() => validateSyntheticViewerObservations(observations)).toThrow(/preview must never enter an unavailable state/)
}

test('actual recorder observer catches a stable error attribute on an existing viewer', async ({ page }) => {
  const probe = await observedPage(page)
  await page.evaluate(() => {
    const viewer = document.createElement('div')
    viewer.id = 'synthetic-existing-viewer'; viewer.dataset.viewerMode = 'proposal'
    document.body.append(viewer)
  })
  expect(await probe.snapshot()).toEqual([])
  await page.evaluate(() => { document.getElementById('synthetic-existing-viewer').dataset.viewerError = 'true' })
  const observations = await probe.snapshot()
  expect(observations).toHaveLength(1)
  assertUnavailable(observations); probe.assertNoRequests()
})

test('actual recorder observer retains same-task true-to-deleted error attributes after recovery', async ({ page }) => {
  const probe = await observedPage(page)
  await page.evaluate(() => {
    const viewer = document.createElement('div')
    viewer.id = 'synthetic-transient-viewer'; viewer.dataset.viewerMode = 'proposal'
    document.body.append(viewer)
  })
  expect(await probe.snapshot()).toEqual([])
  await page.evaluate(() => {
    const viewer = document.getElementById('synthetic-transient-viewer')
    viewer.dataset.viewerError = 'true'; delete viewer.dataset.viewerError
  })
  await expect(page.locator('[data-viewer-error="true"]')).toHaveCount(0)
  assertUnavailable(await probe.snapshot()); probe.assertNoRequests()
})

test('actual recorder observer scans nested added nodes and document fragments for an already failed viewer', async ({ page }) => {
  const probe = await observedPage(page)
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment(), wrapper = document.createElement('section'), viewer = document.createElement('div')
    viewer.dataset.viewerMode = 'proposal'; viewer.dataset.viewerError = 'true'
    wrapper.append(viewer); fragment.append(wrapper); document.body.append(fragment)
  })
  const observations = await probe.snapshot()
  expect(observations).toHaveLength(1)
  assertUnavailable(observations); probe.assertNoRequests()
})

test('actual recorder observer retains an added viewer error cleared in the same insertion task', async ({ page }) => {
  const probe = await observedPage(page)
  await page.evaluate(() => {
    const viewer = document.createElement('div')
    viewer.dataset.viewerMode = 'proposal'; viewer.dataset.viewerError = 'true'
    document.body.append(viewer); viewer.dataset.viewerError = 'false'
  })
  await expect(page.locator('[data-viewer-error="true"]')).toHaveCount(0)
  assertUnavailable(await probe.snapshot()); probe.assertNoRequests()
})

test('actual recorder observer retains a failed added viewer removed before mutation delivery', async ({ page }) => {
  const probe = await observedPage(page)
  await page.evaluate(() => {
    const viewer = document.createElement('div')
    viewer.dataset.viewerMode = 'proposal'; viewer.dataset.viewerError = 'true'
    document.body.append(viewer); viewer.remove()
  })
  await expect(page.locator('[data-viewer-error="true"]')).toHaveCount(0)
  const observations = await probe.snapshot()
  expect(observations).toHaveLength(1)
  assertUnavailable(observations); probe.assertNoRequests()
})

test('actual recorder observer emits only finite time and whitelisted modes, never DOM text or arbitrary attribute strings', async ({ page }) => {
  const probe = await observedPage(page), marker = 'PUBLIC_SYNTHETIC_PRIVACY_MARKER_DO_NOT_COLLECT'
  await page.evaluate(value => {
    for (const mode of ['document', 'proposal', value]) {
      const viewer = document.createElement('div')
      viewer.dataset.viewerMode = mode; viewer.dataset.viewerError = 'true'
      viewer.dataset.sourcePath = value; viewer.textContent = value
      document.body.append(viewer)
    }
  }, marker)
  const observations = await probe.snapshot()
  expect(observations.map(observation => observation.mode)).toEqual(['document', 'proposal', 'unknown'])
  for (const observation of observations) {
    expect(Object.keys(observation).sort()).toEqual(['mode', 'timeMs'])
    expect(Number.isFinite(observation.timeMs)).toBe(true)
    expect(observation.timeMs).toBeGreaterThanOrEqual(0)
  }
  expect(JSON.stringify(observations)).not.toContain(marker)
  expect(() => validateSyntheticViewerObservations(observations)).toThrow(/preview must never enter an unavailable state/)
  probe.assertNoRequests()
})

test('actual recorder observer permits a clean workflow and ignores unrelated metadata changes', async ({ page }) => {
  const probe = await observedPage(page)
  await page.evaluate(() => {
    const viewer = document.createElement('div')
    viewer.dataset.viewerMode = 'document'; viewer.textContent = 'Synthetic clean viewer'
    document.body.append(viewer)
    viewer.dataset.viewerError = 'false'; viewer.dataset.viewerMode = 'proposal'; viewer.dataset.otherMetadata = 'Synthetic'
    delete viewer.dataset.viewerError
  })
  const observations = await probe.snapshot()
  expect(observations).toEqual([])
  expect(validateSyntheticViewerObservations(observations)).toBe(true)
  probe.assertNoRequests()
})
