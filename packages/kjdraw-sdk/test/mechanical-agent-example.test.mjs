import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const example = fileURLToPath(new URL('../../../examples/mechanical-flange-agent.mjs', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')

function execute(outputDirectory) {
  const child = spawnSync(process.execPath, [example, outputDirectory], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, '')
  return JSON.parse(child.stdout)
}

function independentlyInspect(dxf) {
  const script = String.raw`
import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()
d=ezdxf.read(io.StringIO(s));a=d.audit();m=d.modelspace()
c=list(m.query('CIRCLE'));q=list(m.query('DIMENSION'))
r=lambda n:sum(abs(e.dxf.radius-n)<1e-9 for e in c)
print(json.dumps({'version':ezdxf.__version__,'units':d.units,'circles':len(c),'dimensions':len(q),'r60':r(60),'r45':r(45),'r20':r(20),'r5':r(5),'layouts':[x.name for x in d.layouts],'errors':len(a.errors),'fixes':len(a.fixes)}))`
  const python = process.env.KJDRAW_PYTHON ?? 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', script], dxf, {
    encoding: 'utf8', timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(result.stderr ?? '')) return null
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

test('public natural-language flange case creates deterministic editable KJD, DXF and SVG artifacts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-public-mechanical-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const firstDirectory = join(root, 'first'), secondDirectory = join(root, 'second')
  const first = execute(firstDirectory), second = execute(secondDirectory)

  assert.match(first.request, /outside diameter 120 mm.*six 10 mm.*90 mm pitch circle/u)
  assert.equal(first.tool, 'cad_propose_mechanical_flange')
  assert.equal(first.status, 'committed')
  assert.equal(first.revision, 1)
  assert.equal(first.entityCount, 38)
  assert.equal(first.dxfSha256, second.dxfSha256)
  assert.deepEqual(first.intent, second.intent)
  assert.deepEqual(first.files, { kjd: 'mechanical-flange.kjd', dxf: 'mechanical-flange.dxf', svg: 'mechanical-flange.svg' })
  assert.deepEqual(first.svg, second.svg)
  assert.ok(['complete', 'approximate'].includes(first.svg.status))
  assert.equal(first.svg.rendered, 37)
  assert.equal(first.svg.diagnosticCount, 0)

  const bytes = async (directory, key) => readFile(join(directory, first.files[key]))
  assert.equal(sha256(await bytes(firstDirectory, 'dxf')), sha256(await bytes(secondDirectory, 'dxf')), 'DXF output changed between identical runs')

  const sdk = createKJDrawSDK()
  const kjd = await sdk.readDocument(await bytes(firstDirectory, 'kjd'), { format: 'KJD' })
  const repeatedKjd = await sdk.readDocument(await bytes(secondDirectory, 'kjd'), { format: 'KJD', documentId: 'repeated-public-flange' })
  const dxfBytes = await bytes(firstDirectory, 'dxf')
  const dxf = await sdk.readDocument(dxfBytes, { format: 'DXF' })
  for (const document of [kjd, repeatedKjd, dxf]) {
    assert.equal(document.validate().valid, true)
    assert.equal(document.snapshot().header.units, 'millimeter')
    assert.equal(document.listEntities({ type: 'CIRCLE' }).length, 9)
    assert.equal(document.listEntities({ type: 'DIMENSION' }).length, 4)
    assert.ok(document.listEntities({ type: 'DIMENSION' }).every(entity => entity.payload.color === 7), 'dimensions must remain readable on the white A3 preview')
    assert.equal(document.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.ok(document.listObjects({ kind: 'layout' }).some(item => item.name === first.layout.name))
  }

  const svg = (await bytes(firstDirectory, 'svg')).toString('utf8')
  const repeatedSvg = (await bytes(secondDirectory, 'svg')).toString('utf8')
  assert.match(svg, /<svg[^>]+width="420mm"[^>]+height="297mm"/u)
  for (const value of [svg, repeatedSvg]) {
    assert.equal((value.match(/data-entity-type="CIRCLE"/gu) ?? []).length, 9)
    assert.equal((value.match(/data-entity-type="DIMENSION"/gu) ?? []).length, 4)
    assert.doesNotMatch(value, /#ffff00/iu)
    assert.doesNotMatch(value, /<image\b/u)
  }

  const external = independentlyInspect(dxfBytes.toString('utf8'))
  if (!external) t.diagnostic('Independent ezdxf unavailable; candidate CI must provide KJDRAW_PYTHON')
  else {
    assert.equal(external.units, 4)
    assert.deepEqual({ circles: external.circles, dimensions: external.dimensions }, { circles: 9, dimensions: 4 })
    assert.deepEqual({ r60: external.r60, r45: external.r45, r20: external.r20, r5: external.r5 }, { r60: 1, r45: 1, r20: 1, r5: 6 })
    assert.ok(external.layouts.includes(first.layout.name))
    assert.equal(external.errors, 0)
    assert.equal(external.fixes, 0)
  }
})
