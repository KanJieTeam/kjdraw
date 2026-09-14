const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024 * 1024

const boundedText = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)

function normalizeEndpoint(value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('DWG conversion service URL is required.')
  let url
  try { url = new URL(raw) } catch { throw new Error('Enter a valid HTTP or HTTPS service URL.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The DWG service URL must use HTTP or HTTPS.')
  const localHttp=['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname.toLowerCase())
  if(url.protocol==='http:'&&!localHttp)throw new Error('Use HTTPS for remote DWG services. HTTP is allowed only for localhost.')
  if (url.username || url.password) throw new Error('Do not put credentials in the DWG service URL.')
  return url.href
}

function safeRecord(value, depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value === 'string' ? boundedText(value, 1_000) : value
  if (depth > 3) return undefined
  if (Array.isArray(value)) return value.slice(0, 50).map(row => safeRecord(row, depth + 1)).filter(row => row !== undefined)
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).slice(0, 50).filter(([key])=>!/(?:api[_-]?key|token|secret|auth|password|cookie|credential)/i.test(key)).map(([key, row]) => [boundedText(key, 80), safeRecord(row, depth + 1)]).filter(([, row]) => row !== undefined))
}

function decodeBase64(value, maximum) {
  const encoded=String(value??'').replace(/\s/g,'')
  if(encoded.length>Math.ceil(maximum/3)*4+4)throw new Error('The provider base64 result exceeds the configured size limit.')
  const binary = atob(encoded)
  if(binary.length>maximum)throw new Error('The provider result exceeds the configured size limit.')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function abortable(promise, signal) {
  if (!signal) return promise
  if(signal.aborted)throw signal.reason ?? new DOMException('Cancelled', 'AbortError')
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{signal.removeEventListener('abort',onAbort);reject(signal.reason??new DOMException('Cancelled','AbortError'))}
    signal.addEventListener('abort',onAbort,{once:true})
    promise.then(value=>{signal.removeEventListener('abort',onAbort);resolve(value)},error=>{signal.removeEventListener('abort',onAbort);reject(error)})
  })
}

async function responseMessage(response) {
  try { return boundedText(new TextDecoder().decode(await readBoundedBytes(response,64*1024)), 700) || `${response.status} ${response.statusText}` }
  catch { return `${response.status} ${response.statusText}` }
}

function contentLength(response) {
  const raw=response.headers.get('content-length')
  if(raw===null)return null
  const length=Number(raw)
  if(!Number.isSafeInteger(length)||length<0)throw new Error('The provider returned an invalid Content-Length.')
  return length
}

async function readBoundedBytes(response, maximum) {
  const declared=contentLength(response)
  if(declared!==null&&declared>maximum){await response.body?.cancel().catch(()=>{});throw new Error('The provider response exceeds the configured size limit.')}
  if(!response.body?.getReader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>maximum)throw new Error('The provider response exceeds the configured size limit.');return bytes}
  const reader=response.body.getReader(),chunks=[]
  let total=0
  try{
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      const chunk=value instanceof Uint8Array?value:new Uint8Array(value)
      total+=chunk.length
      if(total>maximum){await reader.cancel('KJDraw response size limit exceeded').catch(()=>{});throw new Error('The provider response exceeds the configured size limit.')}
      chunks.push(chunk)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(total);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return bytes
}

async function readJsonResult(response, endpoint, request, onTransportPhase, fetchImpl, maximum) {
  const transportMaximum=Math.ceil(maximum/3)*4+1024*1024
  const payload = JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,transportMaximum))), result = payload?.result && typeof payload.result === 'object' ? payload.result : payload
  const format = String(result?.format ?? request.target).toUpperCase()
  let data
  if (typeof result?.dxf === 'string') data = result.dxf
  else if (typeof result?.data === 'string') data = result.data
  else if (typeof result?.dxfBase64 === 'string') data = decodeBase64(result.dxfBase64,maximum)
  else if (typeof result?.dataBase64 === 'string') data = decodeBase64(result.dataBase64,maximum)
  else if (typeof result?.downloadUrl === 'string') {
    onTransportPhase?.('download')
    const downloadUrl = new URL(result.downloadUrl, endpoint)
    if (!['http:', 'https:'].includes(downloadUrl.protocol)) throw new Error('The provider returned an unsafe download URL.')
    if(downloadUrl.origin!==new URL(endpoint).origin)throw new Error('The provider download URL must use the configured service origin.')
    const downloaded = await abortable(fetchImpl(downloadUrl, { signal: request.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers: { Accept: 'application/dxf,text/plain,application/octet-stream' } }), request.signal)
    if (!downloaded.ok) throw new Error(`Converted drawing download failed: ${await responseMessage(downloaded)}`)
    data = await readBoundedBytes(downloaded,maximum)
  } else throw new Error('The provider response did not contain converted drawing data or a download URL.')
  if(typeof data==='string'&&new TextEncoder().encode(data).length>maximum)throw new Error('The provider result exceeds the configured size limit.')
  return {
    format,
    data,
    sourceSha256: result?.sourceSha256,
    sha256: result?.sha256,
    providerVersion: boundedText(result?.providerVersion ?? result?.converterVersion ?? result?.version, 128) || undefined,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    approximations: Array.isArray(result?.approximations) ? result.approximations : [],
    diagnostics: safeRecord(result?.diagnostics ?? {}),
    converter: boundedText(result?.converter, 120),
  }
}

/** HTTP transport for the SDK's host-provided DWG conversion contract. */
export function createPlaygroundDwgProvider({ endpoint, fetchImpl = globalThis.fetch, onTransportPhase, maxResultBytes = DEFAULT_MAX_RESULT_BYTES } = {}) {
  const serviceUrl = normalizeEndpoint(endpoint)
  const resultLimit=Number(maxResultBytes)
  if(!Number.isSafeInteger(resultLimit)||resultLimit<1||resultLimit>DEFAULT_MAX_RESULT_BYTES)throw new Error(`DWG result limit must be between 1 and ${DEFAULT_MAX_RESULT_BYTES} bytes.`)
  const provider = {
    id: 'kjdraw.playground.http', version: '1', locality: 'self-hosted', outputFormats: Object.freeze(['DXF']),
    limits: Object.freeze({ maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES, maxResultBytes: resultLimit }),
    endpoint: serviceUrl, lastDiagnostics: {},
    async convert(request) {
      const form = new FormData()
      form.append('file', new Blob([request.source.bytes], { type: 'application/acad' }), request.source.name)
      form.append('outputFormat', request.target);form.append('sourceSha256', request.source.sha256);form.append('dwgVersion', request.source.dwgVersion);form.append('client', 'KJDraw Playground')
      onTransportPhase?.('upload');request.onProgress?.({phase:'convert',completed:10,total:100,unit:'percent'})
      onTransportPhase?.('convert');request.onProgress?.({phase:'convert',completed:35,total:100,unit:'percent'})
      const response = await abortable(fetchImpl(serviceUrl, { method: 'POST', body: form, signal: request.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers: { Accept: 'application/dxf,application/json,text/plain,application/octet-stream' } }), request.signal)
      if (!response.ok) throw new Error(`DWG provider failed: ${await responseMessage(response)}`)
      onTransportPhase?.('download');request.onProgress?.({phase:'convert',completed:85,total:100,unit:'percent'})
      const contentType = String(response.headers.get('content-type') ?? '').toLowerCase()
      const parsed = contentType.includes('json')
        ? await readJsonResult(response, serviceUrl, request, onTransportPhase, fetchImpl,provider.limits.maxResultBytes)
        : { format: request.target, data: await readBoundedBytes(response,provider.limits.maxResultBytes), providerVersion: boundedText(response.headers.get('x-kjdraw-converter-version'), 128) || undefined, warnings: [], approximations: [], diagnostics: {}, converter: boundedText(response.headers.get('x-kjdraw-converter'), 120) }
      provider.lastDiagnostics = Object.freeze({ diagnostics: parsed.diagnostics })
      request.onProgress?.({phase:'convert',completed:100,total:100,unit:'percent'})
      const { diagnostics: _diagnostics, converter: _converter, ...result } = parsed
      return result
    },
  }
  return provider
}

export const validateDwgProviderEndpoint = normalizeEndpoint
