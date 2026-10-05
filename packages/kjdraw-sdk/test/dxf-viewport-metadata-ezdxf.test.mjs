import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

// Synthetic standard object graph. No private drawing bytes or project facts.
const fixture = (version, label) => [0,'SECTION',2,'HEADER',9,'$ACADVER',1,version,0,'ENDSEC',
  0,'SECTION',2,'ENTITIES',0,'TEXT',5,'10',8,'0',10,1,20,2,40,2,1,label,
  0,'VIEWPORT',5,'20',102,'{ACAD_XDICTIONARY',360,'30',102,'}',8,'0',67,1,
  10,50,20,50,30,0,40,90,41,80,68,1,69,2,12,0,22,0,16,0,26,0,36,1,17,0,27,0,37,0,45,80,90,0,348,'61',0,'ENDSEC',
  0,'SECTION',2,'OBJECTS',
  0,'DICTIONARY',5,'30',330,'20',100,'AcDbDictionary',281,1,3,'SYNTHETIC_DATA',360,'31',
  0,'XRECORD',5,'31',330,'30',100,'AcDbXrecord',280,1,1,'opaque annotation data',340,'41',
  0,'SCALE',5,'41',330,'40',100,'AcDbScale',300,'1:100',140,1,141,100,290,0,
  0,'DICTIONARY',5,'40',330,'50',100,'AcDbDictionary',281,1,3,'SYNTHETIC_SCALE',350,'41',
  0,'DICTIONARY',5,'50',330,'0',100,'AcDbDictionary',281,1,3,'ACAD_SCALELIST',350,'40',3,'ACAD_VISUALSTYLE',350,'60',
  0,'DICTIONARY',5,'60',330,'50',100,'AcDbDictionary',281,1,3,'SYNTHETIC_STYLE',350,'61',
  0,'VISUALSTYLE',5,'61',330,'60',100,'AcDbVisualStyle',2,'Synthetic',70,0,291,0,
  0,'ENDSEC',0,'EOF',''].join('\n')

function independentAudit(path) {
  const code = [
    'import ezdxf, json, sys',
    'document = ezdxf.readfile(sys.argv[1])',
    'audit = document.audit()',
    'viewport = document.entitydb.get("20")',
    'root = document.rootdict',
    'scale = document.entitydb.get("41")',
    'style = document.entitydb.get("61")',
    'record = document.entitydb.get("31")',
    'json.dump({"reader": ezdxf.__version__, "errors": [str(e.message) for e in audit.errors], "fixes": [str(e.message) for e in audit.fixes],',
    '"dxfVersion": document.dxfversion,',
    '"viewportType": viewport.dxftype() if viewport else None,',
    '"extensionHandle": viewport.extension_dict.handle if viewport and viewport.has_extension_dict else None,',
    '"visualStyleHandle": viewport.dxf.get("visual_style_handle") if viewport else None,',
    '"scaleHandle": root.get("ACAD_SCALELIST").dxf.handle if root.get("ACAD_SCALELIST") else None,',
    '"rootHandle": root.dxf.handle,',
    '"styleDictionaryHandle": root.get("ACAD_VISUALSTYLE").dxf.handle if root.get("ACAD_VISUALSTYLE") else None,',
    '"scaleType": scale.dxftype() if scale else None, "styleType": style.dxftype() if style else None,',
    '"scaleTags": [[tag.code, tag.value] for group in scale.xtags.subclasses for tag in group if tag.code in (300, 140, 141, 290)] if scale else None,',
    '"scaleRegistration": root.get("ACAD_SCALELIST").get("SYNTHETIC_SCALE").dxf.handle,',
    '"styleRegistration": root.get("ACAD_VISUALSTYLE").get("SYNTHETIC_STYLE").dxf.handle,',
    '"extensionRegistration": viewport.extension_dict.dictionary.get("SYNTHETIC_DATA").dxf.handle,',
    '"owners": {handle: document.entitydb.get(handle).dxf.owner for handle in ("30", "31", "40", "41", "60", "61")},',
    '"recordTags": [[tag.code, str(tag.value)] for tag in record.tags] if record else None,',
    '"texts": [entity.dxf.text for entity in document.modelspace().query("TEXT")]}, sys.stdout)',
  ].join('\n')
  const result = spawnSync(process.env.KJDRAW_PYTHON ?? 'python', ['-c', code, path], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [process.env.KJDRAW_EZDXF_PATH, process.env.PYTHONPATH].filter(Boolean).join(delimiter), PYTHONIOENCODING: 'utf-8' },
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

for (const variant of [
  { version: 'AC1015', label: 'SYNTHETIC', changed: 'EDITED' },
  { version: 'AC1021', label: '合成孔位 ZK-A', changed: '合成孔位 ZK-B · VERIFIED' },
]) test(`independent ezdxf ${variant.version} preserves viewport metadata and text without audit repairs`, {
  skip: process.env.KJDRAW_VIEWPORT_EZDXF !== '1' && 'set KJDRAW_VIEWPORT_EZDXF=1 and install the independent ezdxf validator',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-viewport-ezdxf-'))
  try {
    const adapter = createDXFFileAdapter(), sdk = createKJDrawSDK()
    let document = await adapter.read(fixture(variant.version, variant.label))
    const label = document.listEntities({ type: 'TEXT' })[0]
    await sdk.executeCommand('TEXTEDIT', { changes: [{ id: label.id, expectedText: variant.label, text: variant.changed }] }, { document })
    for (let round = 0; round < 3; round++) {
      const output = adapter.write(document), path = join(directory, `round-${round}.dxf`)
      await writeFile(path, output)
      const result = independentAudit(path)
      assert.deepEqual(result.errors, [], `independent errors at round ${round}`)
      assert.deepEqual(result.fixes, [], `independent repairs at round ${round}`)
      assert.equal(result.dxfVersion, variant.version, 'source DXF version must not be silently downgraded')
      assert.equal(result.viewportType, 'VIEWPORT')
      assert.equal(result.extensionHandle, '30')
      assert.equal(result.visualStyleHandle, '61')
      assert.equal(result.scaleHandle, '40')
      assert.equal(result.styleDictionaryHandle, '60')
      assert.equal(result.scaleType, 'SCALE')
      assert.equal(result.styleType, 'VISUALSTYLE')
      assert.deepEqual(result.scaleTags, [[300, '1:100'], [140, 1], [141, 100], [290, 0]])
      assert.equal(result.scaleRegistration, '41')
      assert.equal(result.styleRegistration, '61')
      assert.equal(result.extensionRegistration, '31')
      assert.deepEqual(result.owners, { 30: '20', 31: '30', 40: result.rootHandle, 41: '40', 60: result.rootHandle, 61: '60' })
      assert.deepEqual(result.recordTags, [[1, 'opaque annotation data'], [340, '41']])
      assert.deepEqual(result.texts, [variant.changed])
      t.diagnostic(`round ${round + 1}: ezdxf ${result.reader}, zero audit errors/fixes; extension, XRECORD, SCALE and visual style retained`)
      document = await adapter.read(output)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
