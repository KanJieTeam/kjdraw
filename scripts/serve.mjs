import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, relative, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8' }
const port = Number(process.env.PORT ?? 4173)
export const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const publicPath = pathname === '/' ? '/apps/playground/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname
    if (!['/apps/playground/', '/packages/kjdraw-sdk/src/', '/web/public/kjcore/', '/docs/', '/examples/'].some(prefix => publicPath.startsWith(prefix))) { res.writeHead(404).end(); return }
    const target = resolve(root, `.${publicPath}`)
    const rel = relative(root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.split(sep).some(part => part.startsWith('.'))) { res.writeHead(403).end(); return }
    const data = await readFile(target)
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch { res.writeHead(404).end('Not found') }
})
server.listen(port, '127.0.0.1', () => console.log(`KJDraw Playground → http://localhost:${port}`))
