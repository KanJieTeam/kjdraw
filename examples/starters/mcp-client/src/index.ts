import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

interface RpcResponse {
  id?: number
  result?: {
    tools?: { name: string }[]
    structuredContent?: { value?: Record<string, unknown> }
  }
  error?: { code: number; message: string }
}

const serverEntry = process.env.KJDRAW_MCP_SERVER
  ? resolve(process.env.KJDRAW_MCP_SERVER)
  : fileURLToPath(new URL('../bin/kjdraw-mcp.mjs', import.meta.resolve('@kanjieteam/kjdraw')))
const workspace = resolve(
  process.env.KJDRAW_STARTER_OUTPUT
    ?? fileURLToPath(new URL('../workspace/', import.meta.url)),
)
await Promise.all([
  mkdir(resolve(workspace, 'proposals'), { recursive: true }),
  mkdir(resolve(workspace, 'results'), { recursive: true }),
])

const server = spawn(process.execPath, [
  serverEntry,
  '--workspace', workspace,
  '--blank', 'host.kjd',
  '--units', 'millimeter',
  '--proposal-dir', 'proposals',
  '--candidate-dir', 'results',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

let nextId = 0
const pending = new Map<number, {
  resolve: (value: RpcResponse) => void
  reject: (error: Error) => void
}>()
let stderr = ''
server.stderr.setEncoding('utf8')
server.stderr.on('data', chunk => { stderr += String(chunk) })
server.once('exit', code => {
  if (!pending.size) return
  const error = new Error(`MCP server exited with ${code}: ${stderr}`)
  for (const request of pending.values()) request.reject(error)
  pending.clear()
})
createInterface({ input: server.stdout }).on('line', line => {
  const response = JSON.parse(line) as RpcResponse
  if (typeof response.id !== 'number') return
  const request = pending.get(response.id)
  if (!request) return
  pending.delete(response.id)
  response.error
    ? request.reject(new Error(`MCP ${response.error.code}: ${response.error.message}`))
    : request.resolve(response)
})

function request(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
  const id = ++nextId
  const response = new Promise<RpcResponse>((resolveResponse, reject) => {
    pending.set(id, { resolve: resolveResponse, reject })
  })
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return response
}

try {
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'kjdraw-mcp-starter', version: '1.0.0' },
  })
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  const listed = await request('tools/list', {})
  if (!listed.result?.tools?.some(tool => tool.name === 'cad_propose_circles')) {
    throw new Error('cad_propose_circles was not advertised by the MCP server')
  }
  const proposed = await request('tools/call', {
    name: 'cad_propose_circles',
    arguments: {
      expectedRevision: 0,
      units: 'millimeter',
      circles: [{ center: { x: 20, y: 20 }, radius: 5 }],
    },
  })
  const value = proposed.result?.structuredContent?.value
  if (value?.status !== 'candidate-ready') throw new Error('MCP did not return a reviewable candidate')
  console.log(JSON.stringify({
    ok: true,
    tool: value.tool,
    status: value.status,
    sourceOverwritten: (value.candidate as Record<string, unknown>)?.sourceOverwritten,
    candidate: value.candidate,
  }, null, 2))
} finally {
  server.stdin.end()
  await new Promise<void>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      server.kill()
      reject(new Error(`MCP server did not exit cleanly: ${stderr}`))
    }, 5000)
    server.once('exit', code => {
      clearTimeout(timer)
      code === 0 ? resolveExit() : reject(new Error(`MCP server exited with ${code}: ${stderr}`))
    })
  })
}
