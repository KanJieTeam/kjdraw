import { cp, mkdir } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const out = new URL('../dist/', import.meta.url)
await mkdir(out, { recursive: true })
for (const path of ['apps/playground', 'packages/kjdraw-sdk/src', 'web/public/kjcore', 'docs', 'examples']) {
  await cp(new URL(path, root), new URL(path, out), { recursive: true })
}
await cp(new URL('apps/playground/index.html', root), new URL('index.html', out))
console.log('Static playground built in dist/. No server, account, or runtime dependency required.')
