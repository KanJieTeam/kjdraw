"""Reviewed model program execution, not an OS security sandbox.
No model credentials or transport are accepted. AST/audit guards add defense in
 depth; the caller must approve the exact source hash before invoking this file.
"""
import ast,builtins,contextlib,hashlib,io,json,os,pathlib,sys,time

def main():
 data=json.loads(sys.stdin.read(262145));code=data['code'];root=pathlib.Path(data['directory']).resolve(strict=True)
 if len(code.encode())>131072 or hashlib.sha256(code.encode()).hexdigest()!=data['sourceSha256']:raise ValueError('SOURCE_HASH_OR_BUDGET')
 tree=ast.parse(code);nodes=list(ast.walk(tree))
 if len(nodes)>20000:raise ValueError('AST_BUDGET')
 allowed_modules={'ezdxf','math','json'}
 forbidden_names={'eval','exec','compile','getattr','setattr','delattr','globals','locals','vars','dir','type','object','super','help','input','breakpoint','memoryview','classmethod','staticmethod','property','exit','quit'}
 for node in nodes:
  if isinstance(node,(ast.ClassDef,ast.Global,ast.Nonlocal,ast.AsyncFunctionDef,ast.Await)):raise ValueError('UNSUPPORTED_PYTHON_CONSTRUCT')
  if isinstance(node,ast.Import) and any(n.name not in allowed_modules for n in node.names):raise ValueError('IMPORT_NOT_ALLOWED')
  if isinstance(node,ast.ImportFrom) and (node.level or node.module not in allowed_modules or any(n.name.startswith('_') or n.name=='*' for n in node.names)):raise ValueError('IMPORT_NOT_ALLOWED')
  if isinstance(node,ast.Name) and (node.id in forbidden_names or node.id.startswith('__') and node.id!='__name__'):raise ValueError('REFLECTION_OR_EXECUTION_NOT_ALLOWED')
  if isinstance(node,ast.Attribute) and node.attr.startswith('_'):raise ValueError('PRIVATE_ATTRIBUTE_NOT_ALLOWED')
 if data.get('ezdxfPath'):sys.path.append(str(pathlib.Path(data['ezdxfPath']).resolve(strict=True)))
 import ezdxf,math
 # Load ordinary supported CAD renderers before installing file-access guards.
 import ezdxf.render.dim_linear,ezdxf.render.dim_radius,ezdxf.render.dim_diameter,ezdxf.render.dim_curved
 targets={root/'drawing.dxf',root/'drawing-manifest.json'}
 if any(p.exists() for p in targets):raise ValueError('OUTPUT_ALREADY_EXISTS')
 read_roots=[pathlib.Path(p).resolve() for p in sys.path if p and pathlib.Path(p).is_dir() and pathlib.Path(p).resolve()!=root]
 def inside(path,parent):return path==parent or parent in path.parents
 def audit(event,args):
  if event=='open':
   name,mode,flags=args
   if not isinstance(name,(str,bytes,os.PathLike)):raise PermissionError('FILE_DESCRIPTOR_NOT_ALLOWED')
   path=pathlib.Path(os.fsdecode(name)).resolve()
   writing=bool(flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND))
   if writing and path not in targets:raise PermissionError('WRITE_OUTSIDE_OUTPUT')
   if not writing and path not in targets and not any(inside(path,p) for p in read_roots):raise PermissionError('READ_OUTSIDE_RUNTIME')
  elif event.startswith(('socket.','subprocess.','ctypes.')) or event in ('os.system','os.exec','os.posix_spawn','os.spawn','os.fork','os.remove','os.rmdir','os.rename','os.link','os.symlink','os.chdir','os.listdir','os.scandir','os.putenv','os.unsetenv','os.mkdir'):
   raise PermissionError('HOST_SIDE_EFFECT_NOT_ALLOWED')
 sys.addaudithook(audit)
 original_open=builtins.open
 class BoundedWriter:
  def __init__(self,file,limit):self._file=file;self._limit=limit;self._bytes=0
  def write(self,value):
   size=len(value.encode(self._file.encoding or 'utf-8')) if isinstance(value,str) else len(value)
   if self._bytes+size>self._limit:raise ValueError('ARTIFACT_WRITE_BUDGET')
   self._bytes+=size;return self._file.write(value)
  def writelines(self,values):
   for value in values:self.write(value)
  def flush(self):return self._file.flush()
  def close(self):return self._file.close()
  def __enter__(self):return self
  def __exit__(self,*args):self.close()
 def bounded_open(file,mode='r',*args,**kwargs):
  writing=any(c in mode for c in 'wax+')
  if writing:
   target=pathlib.Path(file).resolve()
   if target not in targets or 'a' in mode or '+' in mode:raise PermissionError('WRITE_OUTSIDE_OUTPUT')
   result=original_open(file,mode,*args,**kwargs)
   return BoundedWriter(result,4194304 if target.name=='drawing.dxf' else 262144)
  return original_open(file,mode,*args,**kwargs)
 builtins.open=bounded_open
 real_import=builtins.__import__
 def limited_import(name,globals=None,locals=None,fromlist=(),level=0):
  if level or name not in allowed_modules:raise ImportError('IMPORT_NOT_ALLOWED')
  return real_import(name,globals,locals,fromlist,level)
 safe={name:getattr(builtins,name) for name in ['abs','all','any','bool','dict','enumerate','float','format','int','iter','isinstance','len','list','map','max','min','next','pow','print','range','reversed','round','set','slice','sorted','str','sum','tuple','zip','open','Exception','ValueError','RuntimeError','ZeroDivisionError']}
 safe['__import__']=limited_import
 namespace={'__builtins__':safe,'__name__':'__main__','OUTPUT_DXF':str(root/'drawing.dxf'),'OUTPUT_MANIFEST':str(root/'drawing-manifest.json')}
 class CappedLog(io.StringIO):
  def write(self,value):
   if self.tell()+len(value)>65536:raise ValueError('PROGRAM_LOG_BUDGET')
   return super().write(value)
 captured=CappedLog()
 with contextlib.redirect_stdout(captured),contextlib.redirect_stderr(captured):exec(compile(tree,'reviewed-candidate.py','exec'),namespace,namespace)
 if len(captured.getvalue().encode())>65536:raise ValueError('PROGRAM_LOG_BUDGET')
 sizes={p.name:p.stat().st_size for p in targets}
 if not 0<sizes['drawing.dxf']<=4194304 or not 0<sizes['drawing-manifest.json']<=262144:raise ValueError('ARTIFACT_BUDGET')
 manifest=json.loads((root/'drawing-manifest.json').read_text(encoding='utf-8'))
 if not isinstance(manifest,dict):raise ValueError('MANIFEST_OBJECT_REQUIRED')
 print(json.dumps({'passed':True,'ezdxfVersion':ezdxf.__version__,'artifacts':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in targets},'programLogBytes':len(captured.getvalue().encode()),'boundary':'Reviewed restricted subprocess; not an OS sandbox.'}))

if __name__=='__main__':
 try:main()
 except BaseException as error:
  print(json.dumps({'passed':False,'reason':type(error).__name__+': '+str(error)[:1000]}));sys.exit(1)
