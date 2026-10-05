import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { layoutCadMText, textFontFamily } from '../src/geometry/text-layout.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const source = 'BASE {\\fArial;待核对 {\\fCourier New;WW} Pending review} END\\P第二段：合成资料'
const edited = source.replace('待核对', '已核对')
const payload = text => ({ position: [20, 40, 0], text, height: 3, attachmentPoint: 1 })
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }

test('MTEXT local font scopes produce measured positioned runs and restore outer/base fonts without changing raw source', () => {
  const calls = [], base = textFontFamily({ fontFamily: 'Times New Roman' })
  const layout = layoutCadMText(payload(source), { fontFamily: 'Times New Roman' }, (text, height, family) => {
    calls.push({ text, height, family })
    return [...text].length * (family.startsWith('"Courier New"') ? 4 : family.startsWith('"Arial"') ? 2 : 1)
  })
  assert.equal(layout.text, source)
  assert.deepEqual(layout.lines.map(line => line.text), ['BASE 待核对 WW Pending review END', '第二段：合成资料'])
  const runs = layout.lines[0].runs
  assert.deepEqual(runs.map(run => run.text), ['BASE ', '待核对 ', 'WW', ' Pending review', ' END'])
  assert.deepEqual(runs.map(run => run.family.split(',')[0]), ['"Times New Roman"', '"Arial"', '"Courier New"', '"Arial"', '"Times New Roman"'])
  assert.equal(layout.lines[1].runs[0].family, base)
  let cursor = 0
  for (const run of runs) { assert.equal(run.left, cursor); cursor += run.width }
  assert.equal(layout.lines[0].width, cursor)
  assert.ok(calls.some(call => call.text === 'WW' && call.family.startsWith('"Courier New"')))
})

test('font-specific wrapping and all nine attachments keep finite positioned runs', () => {
  for (let attachmentPoint = 1; attachmentPoint <= 9; attachmentPoint++) {
    const layout = layoutCadMText({ ...payload('{\\fArial;AB}{\\fCourier New;CD}E\\P😀'), width: 6, attachmentPoint }, {},
      (text, height, family) => [...text].length * (family.startsWith('"Courier New"') ? 4 : 2))
    assert.deepEqual(layout.lines.map(line => line.text), ['AB', 'C', 'DE', '😀'])
    assert.ok(layout.corners.flat().every(Number.isFinite))
    for (const line of layout.lines) {
      assert.equal(line.runs[0].left, line.left)
      for (let index = 1; index < line.runs.length; index++) assert.equal(line.runs[index].left, line.runs[index - 1].left + line.runs[index - 1].width)
      assert.ok(line.width <= 6)
    }
  }
})

test('literal escaped braces/backslashes and CRLF preserve plain MTEXT compatibility and Unicode', () => {
  const raw = 'literal \\{brace\\} \\\\ path\\P中文😀\r\nlast'
  const layout = layoutCadMText(payload(raw), {}, text => [...text].length * 2)
  assert.equal(layout.text, raw)
  assert.deepEqual(layout.lines.map(line => line.text), ['literal {brace} \\ path', '中文😀', 'last'])
  const plain = layoutCadMText({ position: [100, 50], text: 'ABCD\\P中文😀', height: 2, width: 6, attachmentPoint: 5 }, {}, text => [...text].length * 2)
  assert.deepEqual(plain.lines.map(line => line.text), ['ABC', 'D', '中文😀'])
  assert.deepEqual(plain.lines.map(line => line.left), [-3, -1, -3])
  assert.deepEqual(plain.corners, [[97, 46.6], [103, 46.6], [103, 53.4], [97, 53.4]])
})

test('eight font scope levels are bounded and existing character/line/font-run budgets remain strict', () => {
  assert.equal(layoutCadMText(payload('{'.repeat(8) + '\\fArial;A' + '}'.repeat(8))).lines[0].text, 'A')
  assert.throws(() => layoutCadMText(payload('{'.repeat(9) + 'A' + '}'.repeat(9))), /eight levels/)
  assert.equal(layoutCadMText(payload('A'.repeat(65536))).lines[0].text.length, 65536)
  assert.throws(() => layoutCadMText(payload('A'.repeat(65537))), /65536 character/)
  assert.equal(layoutCadMText(payload('A\\P'.repeat(4095) + 'A')).lines.length, 4096)
  assert.throws(() => layoutCadMText(payload('A\\P'.repeat(4096) + 'A')), /4096 line/)
  assert.throws(() => layoutCadMText({ ...payload('A'.repeat(4097)), width: 1 }, {}, () => 1), /4096 line/)
  const runs = count => Array.from({ length: count }, (_, index) => `{\\f${index % 2 ? 'Arial' : 'Courier'};X}`).join('')
  assert.equal(layoutCadMText(payload(runs(4096))).lines[0].runs.length, 4096)
  assert.throws(() => layoutCadMText(payload(runs(4097))), /4096 font run/)
  assert.throws(() => layoutCadMText(payload('{\\fArial;A}{\\fCourier;B}'), {}, () => 1e308), /aggregate CAD text metrics/)
})

test('unknown/malformed/dynamic/SHX formatting rejects instead of stripping codes or loading fonts', () => {
  for (const raw of ['{\\H2x;large}', '\\C1;color', '\\pindent;', '\\Farial.shx;shape', '\\fArial|b1;bold',
    '\\furl(https://example.invalid/font);A', '\\fC:/fonts/a.ttf;A', '\\f../Arial;A', '\\fArial.ttf;A',
    '\\fArial', '\\f;A', '{A', 'A}', 'A\\', '\\Xunknown', '\\~space', 'A\u0000B']) {
    assert.throws(() => layoutCadMText(payload(raw)), /Rich MTEXT formatting is not supported/, raw)
  }
})

async function fixture(raw = source) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const style = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'LOCAL-NOTES', properties: { fontFamily: 'Times New Roman' }, current: true }, { document })
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 160, paperHeight: 100, paperUnits: 1,
    plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 160, windowMaxY: 100, flags: 0,
    scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  await document.transact('Local font fixture', tx => {
    tx.createEntity('MTEXT', { ...payload(raw), styleId: style.id }, { id: 'notes' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] }, { id: 'untouched' })
  })
  return { sdk, document, layout, session: new KJAgentToolSession(sdk, document) }
}

test('reviewed font-preserving edits are atomic, nonreplayable and survive actual reviewed undo/redo plus native and DXF reopening', async () => {
  const { sdk, document, session } = await fixture(), before = document.serialize(), baseline = document.fingerprint()
  const original = structuredClone(document.getObject('notes')), untouched = structuredClone(document.getObject('untouched'))
  const tables = structuredClone(document.snapshot().tables), resources = structuredClone(document.snapshot().resources)
  const proposal = ok(await session.call('cad_propose_text_edit', { expectedRevision: document.revision, units: 'millimeter', changes: [{ id: 'notes', expectedText: source, text: edited }] }))
  assert.equal(document.serialize(), before)
  assert.equal(proposal.preview.after[0].payload.text, edited)
  ok(await session.approve(proposal.planId, 'local-font-reviewer'))
  assert.deepEqual(document.getObject('notes'), { ...original, payload: { ...original.payload, text: edited } })
  assert.deepEqual(document.getObject('untouched'), untouched)
  assert.deepEqual(document.snapshot().tables, tables)
  assert.deepEqual(document.snapshot().resources, resources)
  assert.equal((await session.approve(proposal.planId, 'local-font-reviewer')).ok, false)
  const committed = document.fingerprint()
  for (const [kind, expected] of [['undo', baseline], ['redo', committed]]) {
    const read = ok(await session.call('cad_read_history', { expectedRevision: document.revision }))
    const serialized = document.serialize()
    const plan = ok(await session.call(`cad_propose_${kind}`, { expectedRevision: read.revision, units: read.units, targetHistoryId: read.history[`${kind}Target`].id }))
    assert.equal(document.serialize(), serialized)
    ok(await session.approve(plan.planId, 'local-font-reviewer'))
    assert.equal(document.fingerprint(), expected)
  }
  const native = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(JSON.parse(JSON.stringify(native.snapshot())), JSON.parse(JSON.stringify(document.snapshot())))
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'MTEXT' })[0].payload.text, edited)
  assert.equal(reopened.listEntities({ type: 'MTEXT' })[0].handle, original.handle)
  const reopenedLine = reopened.listEntities({ type: 'LINE' })[0]
  const semanticPayload = (drawing, value) => Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const reference = typeof item === 'string' && drawing.getObject(item)
    return [key, reference ? { type: reference.type, name: reference.name } : item]
  }))
  assert.equal(reopenedLine.handle, untouched.handle)
  assert.deepEqual(semanticPayload(reopened, reopenedLine.payload), semanticPayload(document, untouched.payload))
})

test('unsupported rich font edits retain full original state and no CAD proposal is registered', async () => {
  const { document, session, sdk } = await fixture(), before = document.serialize(), history = document.history
  const result = await session.call('cad_propose_text_edit', { expectedRevision: document.revision, units: 'millimeter', changes: [{ id: 'notes', expectedText: source, text: '{\\fhttps://example.invalid/font;wrong}' }] })
  assert.equal(result.ok, false)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
  assert.equal(sdk.agentPlans.list().length, 0)
})

test('SVG contains positioned local-font runs with escaped glyph text and no dynamic resources', async () => {
  const raw = '{\\fArial;<script>alert("X")</script> & note}{\\fCourier New;WW}\\Psecond'
  const { document, layout } = await fixture(raw), before = document.serialize()
  const output = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(output.report.status, 'approximate', 'Local unembedded fonts retain the existing explicit metrics approximation')
  assert.equal(output.report.diagnostics.length, 0)
  assert.match(output.svg, /<tspan[^>]+font-family="&quot;Arial&quot;/)
  assert.match(output.svg, /<tspan[^>]+font-family="&quot;Courier New&quot;/)
  assert.match(output.svg, /&lt;script&gt;alert\(&quot;X&quot;\)&lt;\/script&gt; &amp; note/)
  assert.doesNotMatch(output.svg, /<script|@font-face|(?:href|src)="https?:|\\fArial|\\Psecond/)
  assert.equal(document.serialize(), before)
  assert.ok(output.report.approximations.some(item => /unembedded/.test(item.reason)))
})

test('independent ezdxf retains exact raw font scopes, native handle and plain text with zero audit errors/fixes', async t => {
  if (!process.env.KJDRAW_PYTHON) { t.skip('Set KJDRAW_PYTHON for independent ezdxf validation'); return }
  const { sdk, document } = await fixture(), expectedHandle = document.getObject('notes').handle
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON, ['-c', String.raw`
import os,io,json,ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()))
m=d.modelspace().query('MTEXT')[0]; a=d.audit()
print(json.dumps({'raw':m.text,'plain':m.plain_text(),'handle':m.dxf.handle,'errors':len(a.errors),'fixes':len(a.fixes)},ensure_ascii=False))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout)
  assert.equal(audited.raw, source)
  assert.equal(audited.plain, 'BASE 待核对 WW Pending review END\n第二段：合成资料')
  assert.equal(audited.handle, expectedHandle)
  assert.equal(audited.errors + audited.fixes, 0)
})
