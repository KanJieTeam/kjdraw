import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { Agent, request } from 'node:https'
import { Readable, Transform } from 'node:stream'

const execFileAsync = promisify(execFile)
const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const OFFICIAL_ORIGIN = 'https://raw.githubusercontent.com'
const OFFICIAL_PATH = /^\/KanJieTeam\/kjdraw\/main\/knowledge\/geology\/[A-Za-z0-9._-]+\.json$/u
const MAX_BYTES = 1024 * 1024
const CONNECT_HEADER_BYTES = 8192

function officialUrl(value) {
  const url = new URL(value)
  if (url.origin !== OFFICIAL_ORIGIN || !OFFICIAL_PATH.test(url.pathname) || url.pathname.includes('..') ||
      url.username || url.password || url.search || url.hash) throw new Error('Knowledge URL must be an official HTTPS JSON resource')
  return url
}

function parseProxy(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const url = new URL(value.includes('://') ? value : `http://${value}`)
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || !Number.isInteger(Number(url.port || 80)) || Number(url.port || 80) < 1 ||
      Number(url.port || 80) > 65535) throw new Error('Knowledge proxy must be a credential-free HTTP proxy')
  return { hostname: url.hostname, port: Number(url.port || 80) }
}

export function parseWindowsProxySettings(enabledOutput, serverOutput) {
  if (!/ProxyEnable\s+REG_DWORD\s+0x0*1(?:\s|$)/iu.test(enabledOutput ?? '')) return null
  const setting = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/iu.exec(serverOutput ?? '')?.[1]?.trim()
  if (!setting) return null
  const entries = setting.split(';').map(part => part.trim()).filter(Boolean)
  const preferred = entries.find(part => /^https=/iu.test(part))
  const plain = entries.find(part => !part.includes('='))
  if (!preferred && !plain) return null
  return parseProxy((preferred ?? plain).replace(/^https=/iu, ''))
}

async function readWindowsProxySettings() {
  try {
    const options = { windowsHide: true, timeout: 1500, maxBuffer: 4096 }
    const [enabled, server] = await Promise.all([
      execFileAsync('reg.exe', ['query', REGISTRY_KEY, '/v', 'ProxyEnable'], options),
      execFileAsync('reg.exe', ['query', REGISTRY_KEY, '/v', 'ProxyServer'], options),
    ])
    return parseWindowsProxySettings(enabled.stdout, server.stdout)
  } catch { return null }
}

export async function resolveKnowledgeProxy({ env = process.env, platform = process.platform,
  readWindowsProxy = readWindowsProxySettings } = {}) {
  const explicit = env.HTTPS_PROXY ?? env.https_proxy
  if (explicit !== undefined) return parseProxy(explicit)
  return platform === 'win32' ? await readWindowsProxy() : null
}

function tunnelAgent(destination, proxy, signal) {
  const agent = new Agent({ keepAlive: false })
  agent.createConnection = (_options, callback) => {
    let finished = false
    let socket
    let secureSocket
    let header = Buffer.alloc(0)
    const complete = (error, connection) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', abort)
      if (error) {
        secureSocket?.destroy()
        socket?.destroy()
      }
      callback(error, connection)
    }
    const abort = () => complete(signal.reason ?? new Error('Knowledge download aborted'))
    if (signal?.aborted) { complete(signal.reason ?? new Error('Knowledge download aborted')); return }
    signal?.addEventListener('abort', abort, { once: true })
    socket = netConnect(proxy.port, proxy.hostname)
    socket.setTimeout(8000, () => complete(new Error('Knowledge proxy timed out')))
    socket.once('error', error => complete(error))
    socket.once('connect', () => socket.write(
      `CONNECT ${destination.hostname}:443 HTTP/1.1\r\nHost: ${destination.hostname}:443\r\nProxy-Connection: close\r\n\r\n`))
    socket.on('data', function receive(bytes) {
      header = Buffer.concat([header, bytes])
      if (header.byteLength > CONNECT_HEADER_BYTES) return complete(new Error('Knowledge proxy response header exceeds size limit'))
      const end = header.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', receive)
      if (!/^HTTP\/1\.[01] 200(?:\s|$)/u.test(header.subarray(0, end).toString('latin1').split('\r\n')[0]))
        return complete(new Error('Knowledge proxy refused HTTPS tunnel'))
      if (end + 4 !== header.byteLength) return complete(new Error('Knowledge proxy sent unexpected tunnel bytes'))
      secureSocket = tlsConnect({ socket, servername: destination.hostname, rejectUnauthorized: true },
        () => complete(null, secureSocket))
      secureSocket.once('error', error => complete(error))
    })
  }
  return agent
}

export function boundedKnowledgeStream(response, signal, maxBytes = MAX_BYTES) {
  let size = 0
  const limited = new Transform({ transform(chunk, _encoding, done) {
    size += chunk.byteLength
    done(size > maxBytes ? new Error('Knowledge download exceeds size limit') : null, chunk)
  } })
  const abort = () => limited.destroy(signal.reason ?? new Error('Knowledge download aborted'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  response.once('error', error => limited.destroy(error))
  response.once('aborted', () => limited.destroy(new Error('Knowledge response aborted')))
  response.once('close', () => {
    if (!response.complete && !response.readableEnded) limited.destroy(new Error('Knowledge response closed early'))
  })
  limited.once('error', error => response.destroy(error))
  limited.once('close', () => signal?.removeEventListener('abort', abort))
  response.pipe(limited)
  return limited
}

/** Fetch official data through an explicit or Windows system HTTP proxy, without changing global network behavior. */
export async function fetchKnowledgeThroughProxy(value, { signal, redirect = 'manual', timeoutMs = 8000 } = {}, config = {}) {
  const url = officialUrl(value)
  if (redirect !== 'manual' && redirect !== 'error') throw new Error('Knowledge redirects are not permitted')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid knowledge proxy timeout')
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const proxy = config.proxy === undefined ? await resolveKnowledgeProxy(config) :
    (typeof config.proxy === 'string' ? parseProxy(config.proxy) : config.proxy)
  if (!proxy) return fetch(url, { signal: boundedSignal, redirect: 'manual', cache: 'no-store' })
  const agent = tunnelAgent(url, proxy, boundedSignal)
  return await new Promise((resolve, reject) => {
    let limited
    const req = request(url, { agent, signal: boundedSignal, method: 'GET', headers: { Accept: 'application/json' } }, response => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400) {
        response.destroy()
        agent.destroy()
        reject(new Error('Knowledge redirect refused'))
        return
      }
      const contentLength = Number(response.headers['content-length'])
      if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
        response.destroy()
        agent.destroy()
        reject(new Error('Knowledge download exceeds size limit'))
        return
      }
      limited = boundedKnowledgeStream(response, boundedSignal)
      response.once('end', () => agent.destroy())
      resolve({ ok: status >= 200 && status < 300, status, redirected: false,
        headers: new Headers(response.headers), body: Readable.toWeb(limited) })
    })
    req.once('error', error => { limited?.destroy(error); agent.destroy(); reject(error) })
    req.end()
  })
}