import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { PassThrough, Readable } from 'node:stream'
import test from 'node:test'
import { boundedKnowledgeStream, fetchKnowledgeThroughProxy, parseWindowsProxySettings, resolveKnowledgeProxy } from '../bin/kjdraw-knowledge-proxy.mjs'

const official = 'https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/geology/manifest.json'

async function mockProxy(reply) {
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.once('data', bytes => {
      assert.match(bytes.toString('latin1'), /^CONNECT raw\.githubusercontent\.com:443 HTTP\/1\.1\r\n/u)
      reply(socket)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { proxy: `http://127.0.0.1:${server.address().port}`,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) } }
}

test('explicit HTTPS_PROXY wins over Windows settings and rejects credentials', async () => {
  let windowsReads = 0
  const config = { env: { HTTPS_PROXY: 'http://127.0.0.1:7890' }, platform: 'win32',
    readWindowsProxy: async () => { windowsReads++; return { hostname: 'elsewhere', port: 8080 } } }
  assert.deepEqual(await resolveKnowledgeProxy(config), { hostname: '127.0.0.1', port: 7890 })
  assert.equal(windowsReads, 0)
  await assert.rejects(resolveKnowledgeProxy({ ...config, env: { HTTPS_PROXY: 'http://user:secret@127.0.0.1:7890' } }), /credential-free/u)
  await assert.rejects(resolveKnowledgeProxy({ ...config, env: { HTTPS_PROXY: 'socks5://127.0.0.1:7890' } }), /credential-free/u)
})

test('Windows system proxy is selected only when enabled and with an HTTPS endpoint', async () => {
  const enabled = 'ProxyEnable    REG_DWORD    0x1'
  assert.deepEqual(parseWindowsProxySettings(enabled, 'ProxyServer    REG_SZ    127.0.0.1:7890'),
    { hostname: '127.0.0.1', port: 7890 })
  assert.deepEqual(parseWindowsProxySettings(enabled, 'ProxyServer    REG_SZ    http=localhost:1111;https=127.0.0.1:7890'),
    { hostname: '127.0.0.1', port: 7890 })
  assert.equal(parseWindowsProxySettings('ProxyEnable REG_DWORD 0x0', 'ProxyServer REG_SZ 127.0.0.1:7890'), null)
  assert.equal(parseWindowsProxySettings(enabled, 'ProxyServer REG_SZ socks=127.0.0.1:7890'), null)
  assert.deepEqual(await resolveKnowledgeProxy({ env: {}, platform: 'win32',
    readWindowsProxy: async () => ({ hostname: '127.0.0.1', port: 7890 }) }),
  { hostname: '127.0.0.1', port: 7890 })
})

test('nonofficial URLs and proxy URL credentials are rejected before connecting', async () => {
  for (const url of [
    'http://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/geology/manifest.json',
    'https://example.com/KanJieTeam/kjdraw/main/knowledge/geology/manifest.json',
    'https://raw.githubusercontent.com/KanJieTeam/kjdraw/main/knowledge/other/manifest.json',
    `${official}?token=secret`,
  ]) await assert.rejects(fetchKnowledgeThroughProxy(url, {}, { proxy: 'http://127.0.0.1:7890' }), /official HTTPS JSON/u)
  await assert.rejects(fetchKnowledgeThroughProxy(official, {}, { proxy: 'http://user:secret@127.0.0.1:7890' }), /credential-free/u)
  await assert.rejects(fetchKnowledgeThroughProxy(official, { redirect: 'follow' }, { proxy: 'http://127.0.0.1:7890' }), /redirects/u)
})

test('CONNECT non-200 is rejected without fetching any response body', async t => {
  const proxy = await mockProxy(socket => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'))
  t.after(proxy.close)
  await assert.rejects(fetchKnowledgeThroughProxy(official, { signal: AbortSignal.timeout(2000) }, { proxy: proxy.proxy }),
    /refused HTTPS tunnel/u)
})

test('a proxy cannot substitute plaintext for authenticated TLS', async t => {
  const proxy = await mockProxy(socket => socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'))
  t.after(proxy.close)
  await assert.rejects(fetchKnowledgeThroughProxy(official, { signal: AbortSignal.timeout(750) }, { proxy: proxy.proxy }))
})

test('AbortSignal stops a stalled CONNECT', async t => {
  const proxy = await mockProxy(() => {})
  t.after(proxy.close)
  await assert.rejects(fetchKnowledgeThroughProxy(official, { signal: AbortSignal.timeout(100) }, { proxy: proxy.proxy }))
})

test('oversized CONNECT response header is rejected', async t => {
  const proxy = await mockProxy(socket => socket.end('HTTP/1.1 200 OK\r\nX-Fill: ' + 'a'.repeat(8300) + '\r\n\r\n'))
  t.after(proxy.close)
  await assert.rejects(fetchKnowledgeThroughProxy(official, { signal: AbortSignal.timeout(2000) }, { proxy: proxy.proxy }),
    /response header exceeds size limit/u)
})

test('streaming body enforces byte limit even without Content-Length', async () => {
  const upstream = new PassThrough()
  const reader = Readable.toWeb(boundedKnowledgeStream(upstream, undefined, 5)).getReader()
  upstream.write('abc')
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'abc')
  upstream.write('def')
  await assert.rejects(reader.read(), /exceeds size limit/u)
})

test('abort after headers rejects the active body reader', async () => {
  const controller = new AbortController()
  const upstream = new PassThrough()
  const reader = Readable.toWeb(boundedKnowledgeStream(upstream, controller.signal)).getReader()
  upstream.write('part')
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'part')
  controller.abort(new Error('test abort'))
  await assert.rejects(reader.read(), /test abort/u)
})