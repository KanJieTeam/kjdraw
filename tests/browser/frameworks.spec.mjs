import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
let reactBundle = ''
let vueBundle = ''

test.beforeAll(async () => {
  const shared = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"development"' },
  }
  const [react, vue] = await Promise.all([
    build({ ...shared, entryPoints: [resolve(repositoryRoot, 'fixtures/frameworks/react-browser.ts')] }),
    build({ ...shared, entryPoints: [resolve(repositoryRoot, 'fixtures/frameworks/vue-browser.ts')] }),
  ])
  reactBundle = react.outputFiles[0]?.text ?? ''
  vueBundle = vue.outputFiles[0]?.text ?? ''
  if (!reactBundle || !vueBundle) throw new Error('Framework browser bundles were not generated')
})

async function prepare(page, bundle) {
  await page.goto('/')
  await page.evaluate(() => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('main')
    host.id = 'framework-host'
    host.style.width = '1100px'
    host.style.height = '640px'
    document.body.append(host)
  })
  await page.addScriptTag({ content: bundle })
}

test('React StrictMode preserves the editor across prop updates and disposes on unmount', async ({ page }) => {
  await prepare(page, reactBundle)
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().mounted ?? false)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().workbenches ?? 0)).toBe(1)

  await page.evaluate(() => window.__kjdrawReactTest?.captureInstance())
  const before = await page.evaluate(() => window.__kjdrawReactTest?.snapshot())
  await page.evaluate(() => window.__kjdrawReactTest?.addLine())
  await page.evaluate(() => window.__kjdrawReactTest?.moveLine())
  await page.evaluate(() => window.__kjdrawReactTest?.setLayout('focus'))
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().layout)).toBe('focus')
  const focused = await page.evaluate(() => window.__kjdrawReactTest?.snapshot())
  expect(focused?.sameInstance).toBe(true)
  expect(focused?.sameDocument).toBe(true)
  expect(focused?.lineStart).toEqual([6, 4, 0])
  await page.evaluate(() => window.__kjdrawReactTest?.undo())
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().lineStart)).toEqual([0, 0, 0])
  await page.evaluate(() => window.__kjdrawReactTest?.redo())
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().lineStart)).toEqual([6, 4, 0])
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().sdkDocuments ?? 0)).toBe(2)
  expect(await page.evaluate(() => window.__kjdrawReactTest?.snapshot().hostDocumentPresent)).toBe(true)
  await page.evaluate(() => window.__kjdrawReactTest?.setToolbar(false))
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().toolbarVisible ?? true)).toBe(false)
  await page.evaluate(() => window.__kjdrawReactTest?.setLocale('zh-CN'))
  await expect.poll(() => page.evaluate(() => window.__kjdrawReactTest?.snapshot().locale)).toBe('zh-CN')

  const updated = await page.evaluate(() => window.__kjdrawReactTest?.snapshot())
  expect(updated?.sameInstance).toBe(true)
  expect(updated?.sameDocument).toBe(true)
  expect(updated?.entityCount).toBe((before?.entityCount ?? 0) + 1)
  expect(updated?.workbenches).toBe(1)

  await page.evaluate(() => window.__kjdrawReactTest?.setReadonly(true))
  await expect(page.locator('#framework-host [data-tool="line"]')).toBeDisabled()
  expect(await page.evaluate(() => window.__kjdrawReactTest?.attemptEdit())).toContain('read only')
  const readOnlyCount = await page.evaluate(() => window.__kjdrawReactTest?.snapshot().entityCount ?? 0)
  await page.evaluate(() => window.__kjdrawReactTest?.setReadonly(false))
  await expect(page.locator('#framework-host [data-tool="line"]')).toBeEnabled()
  expect(await page.evaluate(() => window.__kjdrawReactTest?.attemptEdit())).toBe(null)
  expect(await page.evaluate(() => window.__kjdrawReactTest?.snapshot().entityCount)).toBe(readOnlyCount + 1)

  const changesBeforeReopen = await page.evaluate(() => window.__kjdrawReactTest?.snapshot().changeEvents ?? 0)
  expect(await page.evaluate(() => window.__kjdrawReactTest?.reopen())).toBe(true)
  expect(await page.evaluate(() => window.__kjdrawReactTest?.attemptEdit())).toBe(null)
  expect(await page.evaluate(() => window.__kjdrawReactTest?.snapshot().changeEvents)).toBe(changesBeforeReopen + 1)
  expect(await page.evaluate(() => window.__kjdrawReactTest?.snapshot().sameInstance)).toBe(true)

  expect(await page.evaluate(() => window.__kjdrawReactTest?.unmount())).toBe(true)
  await expect(page.locator('#framework-host')).toBeEmpty()
})

test('Vue updates editor props in place and exposes the imperative API', async ({ page }) => {
  await prepare(page, vueBundle)
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().mounted ?? false)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().workbenches ?? 0)).toBe(1)

  await page.evaluate(() => window.__kjdrawVueTest?.captureInstance())
  const before = await page.evaluate(() => window.__kjdrawVueTest?.snapshot())
  await page.evaluate(() => window.__kjdrawVueTest?.addLine())
  await page.evaluate(() => window.__kjdrawVueTest?.moveLine())
  await page.evaluate(() => window.__kjdrawVueTest?.setLayout('compact'))
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().layout)).toBe('compact')
  const compact = await page.evaluate(() => window.__kjdrawVueTest?.snapshot())
  expect(compact?.sameInstance).toBe(true)
  expect(compact?.sameDocument).toBe(true)
  expect(compact?.lineStart).toEqual([6, 4, 0])
  await page.evaluate(() => window.__kjdrawVueTest?.undo())
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().lineStart)).toEqual([0, 0, 0])
  await page.evaluate(() => window.__kjdrawVueTest?.redo())
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().lineStart)).toEqual([6, 4, 0])
  await page.evaluate(() => window.__kjdrawVueTest?.setToolbar(false))
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().toolbarVisible ?? true)).toBe(false)
  await page.evaluate(() => window.__kjdrawVueTest?.setLocale('zh-CN'))
  await expect.poll(() => page.evaluate(() => window.__kjdrawVueTest?.snapshot().locale)).toBe('zh-CN')

  const updated = await page.evaluate(() => window.__kjdrawVueTest?.snapshot())
  expect(updated?.sameInstance).toBe(true)
  expect(updated?.sameDocument).toBe(true)
  expect(updated?.entityCount).toBe((before?.entityCount ?? 0) + 1)
  expect(updated?.workbenches).toBe(1)

  expect(await page.evaluate(() => window.__kjdrawVueTest?.unmount())).toBe(true)
  await expect(page.locator('#framework-host')).toBeEmpty()
})
