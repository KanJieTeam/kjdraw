import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = join(root, 'packages', 'kjdraw-sdk', 'src')
const entries = {
  vanilla: join(root, 'examples', 'starters', 'vanilla-browser', 'src', 'main.ts'),
  react: join(root, 'examples', 'starters', 'react-browser', 'src', 'main.tsx'),
  vue: join(root, 'examples', 'starters', 'vue-browser', 'src', 'main.ts'),
}
const packageEntryPlugin = {
  name: 'current-kjdraw-package',
  setup(builder) {
    builder.onResolve({ filter: /^@kanjieteam\/kjdraw(?:\/(.+))?$/ }, args => {
      const suffix = args.path.slice('@kanjieteam/kjdraw'.length)
      const files = { '': 'index.ts', '/react': 'react.ts', '/vue': 'vue.ts' }
      return { path: join(source, files[suffix]) }
    })
  },
}

const bundles = Object.fromEntries(await Promise.all(Object.entries(entries).map(async ([name, entry]) => {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [packageEntryPlugin], logLevel: 'silent',
  })
  return [name, result.outputFiles[0].text]
})))

async function load(page, name, body) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(body)
  await page.route('**/__kjdraw-starter.js', route => route.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8', body: bundles[name],
  }))
  await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1:4173/__kjdraw-starter.js' })
  await expect(page.locator('[data-canvas]')).toBeVisible()
  expect(errors).toEqual([])
}

test('Vanilla TypeScript starter mounts and completes its startup circle command', async ({ page }) => {
  await load(page, 'vanilla', '<div id="app"></div>')
  await expect(page.locator('[data-canvas]')).toHaveCount(1)
})

for (const framework of ['react', 'vue']) {
  test(`${framework} TypeScript starter mounts and executes its circle button`, async ({ page }) => {
    const host = framework === 'react' ? 'root' : 'app'
    await load(page, framework, `<div id="${host}"></div>`)
    const canvas = page.locator('[data-canvas]')
    const before = await canvas.evaluate(element => element.toDataURL())
    await page.getByRole('button', { name: 'Create 5 mm circle' }).click()
    await expect.poll(() => canvas.evaluate(element => element.toDataURL())).not.toBe(before)
  })
}
