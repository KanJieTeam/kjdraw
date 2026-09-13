import assert from 'node:assert/strict'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const scripts = {
  mechanical: String.raw`
import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read();d=ezdxf.read(io.StringIO(s));a=d.audit();m=d.modelspace();p=d.layouts.get('A3 MECHANICAL 1:2')
circles=list(m.query('CIRCLE'));arcs=list(m.query('ARC'));dims=list(m.query('DIMENSION'))
print(json.dumps({'version':ezdxf.__version__,'units':d.units,'circles':len(circles),'r5':sum(abs(e.dxf.radius-5)<1e-9 for e in circles),'r9':sum(abs(e.dxf.radius-9)<1e-9 for e in circles),'r6arcs':sum(abs(e.dxf.radius-6)<1e-9 for e in arcs),'dimensions':len(dims),'paper':[p.dxf.paper_width,p.dxf.paper_height],'errors':len(a.errors),'fixes':len(a.fixes)}))`,
  architecture: String.raw`
import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read();d=ezdxf.read(io.StringIO(s));a=d.audit();m=d.modelspace();p=d.layouts.get('A3 ARCH 1-100')
names=[e.dxf.name for e in m.query('INSERT')];layers={e.dxf.name for e in d.layers}
print(json.dumps({'version':ezdxf.__version__,'units':d.units,'doors':names.count('A-DOOR-0900'),'windows':names.count('A-WINDOW-1500'),'doorMembers':len(list(d.blocks.get('A-DOOR-0900'))),'windowMembers':len(list(d.blocks.get('A-WINDOW-1500'))),'layers':sorted(layers),'paper':[p.dxf.paper_width,p.dxf.paper_height],'errors':len(a.errors),'fixes':len(a.fixes)}))`,
  site: String.raw`
import io,json,os,ezdxf
s=open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read();d=ezdxf.read(io.StringIO(s));a=d.audit();m=d.modelspace();p=d.layouts.get('Site plan 1:500')
road=list(m.query('LWPOLYLINE[layer=="C-ROAD"]'));water=list(m.query('*[layer=="U-WATER"]'))
pts=[list(v[:2]) for v in road[0].get_points('xy')]
print(json.dumps({'version':ezdxf.__version__,'units':d.units,'roads':len(road),'water':len(water),'roadPoints':pts,'paper':[p.dxf.paper_width,p.dxf.paper_height],'errors':len(a.errors),'fixes':len(a.fixes)}))`,
}

export function independentlyInspectProductionDxf(kind, dxf) {
  assert.ok(Object.hasOwn(scripts, kind), `unknown production workflow ${kind}`)
  const python = process.env.KJDRAW_PYTHON ?? 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', scripts[kind]], dxf, {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr ?? '')) return null
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}
