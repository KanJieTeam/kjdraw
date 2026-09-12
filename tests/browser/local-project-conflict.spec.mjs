import { test, expect } from '@playwright/test'

import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function projectBytes(id) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'model', title: id })
  await document.transact('Fixture', transaction => transaction.createEntity('LINE', { start: [0, 0], end: [20, 0] }))
  const session = KJProjectSession.create({ sdk, id, title: id, documents: [document] })
  const bytes = await session.package({ modifiedAt: '2026-09-13T04:00:00.000Z' })
  session.destroy()
  return bytes
}

test('local project save reports an external file conflict and keeps download as a safe escape', async ({ page }) => {
  const external = await projectBytes('external-change')
  await page.addInitScript(value => {
    let stored = new Uint8Array()
    let writes = 0
    const handle = {
      kind: 'file',
      name: 'bound-project.kjp',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => ({
        arrayBuffer: async () => stored.slice().buffer,
      }),
      createWritable: async () => ({
        write: async data => { stored = new Uint8Array(data).slice() },
        close: async () => { writes += 1 },
        abort: async () => {},
      }),
    }
    window.showOpenFilePicker = async () => [handle]
    window.showSaveFilePicker = async () => handle
    window.__localProjectFixture = {
      replaceExternally: () => { stored = new Uint8Array(value).slice() },
      state: () => ({ writes, bytes: stored.byteLength }),
    }
  }, [...external])
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await expect(page.locator('#save-local')).toBeVisible()
  await page.locator('#save-local').click()
  await expect(page.locator('#file-state')).toHaveText('Saved locally')
  await expect.poll(() => page.evaluate(() => window.__localProjectFixture.state().writes)).toBe(1)

  await page.evaluate(() => window.__localProjectFixture.replaceExternally())
  await page.locator('#save-local').click()
  await expect(page.locator('.workbench')).toHaveAttribute('data-last-error', /changed outside KJDraw/)
  expect(await page.evaluate(() => window.__localProjectFixture.state().writes)).toBe(1)

  const download = page.waitForEvent('download')
  await page.locator('#save').click()
  await download
})
