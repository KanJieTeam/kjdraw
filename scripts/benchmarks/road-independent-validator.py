"""Independent road mathematics and actual-DXF evidence. No KJDraw imports.
Layout may vary. The manifest associates real native entity handles with roles;
no model-reported areas, volumes, coordinates or success flags are trusted.
"""
import io,json,math,re,sys,logging
import ezdxf
EPS=1e-6

def linear(points,x):
 if x<points[0][0]-EPS or x>points[-1][0]+EPS:raise ValueError('OUTSIDE_SUPPLIED_DATA')
 for a,b in zip(points,points[1:]):
  if x<=b[0]+EPS:return a[1]+(x-a[0])*(b[1]-a[1])/(b[0]-a[0])
 raise ValueError('INTERPOLATION_FAILED')

def compute(data):
 alignment=data['alignment'];profile=[[p['station'],p['elevation']] for p in data['profile']];pav=data['pavement'];slopes=data['slopes'];start=data['startStation'];spans=[];station=start
 for a,b in zip(alignment,alignment[1:]):
  length=math.dist(a,b)
  if length<=0:raise ValueError('ZERO_ALIGNMENT_SPAN')
  tangent=[(b[0]-a[0])/length,(b[1]-a[1])/length];spans.append({'a':a,'b':b,'from':station,'to':station+length,'tangent':tangent});station+=length
 if abs(profile[0][0]-start)>EPS or abs(profile[-1][0]-station)>EPS:raise ValueError('PROFILE_COVERAGE')
 sections=[]
 for section in data['sections']:
  s=section['station'];ground=section['ground'];z=linear(profile,s);widths=[pav['rightWidth'],pav['leftWidth']]
  pavement=[[-widths[0],z+widths[0]*pav['rightCrossfall']],[0,z],[widths[1],z+widths[1]*pav['leftCrossfall']]]
  ends=[]
  for side,edge in [(-1,pavement[0]),(1,pavement[-1])]:
   difference=linear(ground,edge[0])-edge[1]
   if abs(difference)<1e-12:ends.append(edge);continue
   grade=(1/slopes['cutHtoV']) if difference>0 else (-1/slopes['fillHtoV'])
   outward=[p for p in ground if side*(p[0]-edge[0])>0];outward.sort(key=lambda p:side*p[0]);knots=[[edge[0],linear(ground,edge[0])]]+outward;roots=[]
   for a,b in zip(knots,knots[1:]):
    da=a[1]-edge[1]-side*(a[0]-edge[0])*grade;db=b[1]-edge[1]-side*(b[0]-edge[0])*grade
    if abs(da)<1e-12 and abs(db)<1e-12:raise ValueError('AMBIGUOUS_DAYLIGHT')
    if da*db<0 or abs(da)<1e-12 or abs(db)<1e-12:
     x=a[0] if abs(da)<1e-12 else b[0] if abs(db)<1e-12 else a[0]+(b[0]-a[0])*da/(da-db)
     point=[x,edge[1]+side*(x-edge[0])*grade]
     if not any(abs(x-r[0])<EPS for r in roots):roots.append(point)
   if len(roots)!=1:raise ValueError('DAYLIGHT_NOT_UNIQUE')
   ends.append(roots[0])
  design=[ends[0]]+pavement+[ends[1]];design=[p for i,p in enumerate(design) if i==0 or abs(p[0]-design[i-1][0])>1e-12]
  knots=sorted(set([p[0] for p in design]+[p[0] for p in ground if ends[0][0]<p[0]<ends[1][0]]));cut=fill=0
  for x,y in zip(knots,knots[1:]):
   a=linear(design,x)-linear(ground,x);b=linear(design,y)-linear(ground,y)
   if a*b<0:
    length=y-x;cross=length*abs(a)/(abs(a)+abs(b));values=[a*cross/2,b*(length-cross)/2]
   else:values=[(a+b)*(y-x)/2]
   cut+=sum(-v for v in values if v<0);fill+=sum(v for v in values if v>0)
  span=next((q for q in spans if s<q['to']),spans[-1]);t=span['tangent'];center=[span['a'][j]+(s-span['from'])*t[j] for j in [0,1]]
  grade=next(((b[1]-a[1])/(b[0]-a[0]) for a,b in zip(profile,profile[1:]) if s<b[0]),(profile[-1][1]-profile[-2][1])/(profile[-1][0]-profile[-2][0]))
  sections.append({'station':s,'ground':ground,'design':design,'elevation':z,'groundCenter':linear(ground,0),'grade':grade,'cut':cut,'fill':fill,'world':[[center[0]-t[1]*p[0],center[1]+t[0]*p[0]] for p in design]})
 intervals=[{'fromStation':a['station'],'toStation':b['station'],'length':b['station']-a['station'],'cut':(a['cut']+b['cut'])*(b['station']-a['station'])/2,'fill':(a['fill']+b['fill'])*(b['station']-a['station'])/2} for a,b in zip(sections,sections[1:])]
 edges=[]
 for q in spans:
  t=q['tangent']
  for offset in [-pav['rightWidth'],pav['leftWidth']]:edges.append([[p[0]-t[1]*offset,p[1]+t[0]*offset] for p in [q['a'],q['b']]])
 return {'sections':sections,'intervals':intervals,'cut':sum(i['cut'] for i in intervals),'fill':sum(i['fill'] for i in intervals),'edges':edges,'profile':profile}

def segments(points):return list(zip(points,points[1:]))
def visible(doc,e):
 layer=doc.layers.get(e.dxf.layer)
 if e.dxf.get('invisible',0) or layer.is_off() or layer.is_frozen() or layer.is_locked():raise ValueError('HIDDEN_EVIDENCE')

def native_segments(doc,handles):
 if not isinstance(handles,list) or not 0<len(handles)<=1024:raise ValueError('GEOMETRY_HANDLE_BUDGET')
 result=[]
 for h in handles:
  e=doc.entitydb.get(h)
  if e is None or e not in doc.modelspace():raise ValueError('MISSING_MODEL_ENTITY')
  visible(doc,e)
  if e.dxftype()=='LINE':
   if not finite_number(e.dxf.get('thickness',0)) or abs(e.dxf.get('thickness',0))>1e-12:raise ValueError('THICK_LINE')
   points=[list(e.dxf.start),list(e.dxf.end)]
  elif e.dxftype()=='LWPOLYLINE':
   if e.closed or any(abs(v[2])+abs(v[3])+abs(v[4])>1e-12 for v in e.get_points('xyseb')) or abs(e.dxf.elevation)>1e-12 or tuple(e.dxf.extrusion)!=(0,0,1):raise ValueError('CURVED_OR_THICK_GEOMETRY')
   points=[[p[0],p[1],0] for p in e.get_points('xy')]
  else:raise ValueError('NON_EDITABLE_GEOMETRY_ROLE')
  if any(abs(p[2])>EPS or not all(math.isfinite(v) for v in p) for p in points):raise ValueError('NON_XY_GEOMETRY')
  result.extend(segments([p[:2] for p in points]))
 return result

def covered(line,others):
 a,b=line;dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
 if length<EPS:return True
 intervals=[]
 for c,d in others:
  if max(abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)/length for p in [c,d])>EPS:continue
  x,y=sorted([((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length*length) for p in [c,d]])
  if y>=0 and x<=1:intervals.append((max(0,x),min(1,y)))
 end=0
 for x,y in sorted(intervals):
  if x>end+EPS/max(length,1):return False
  end=max(end,y)
 return end>=1-EPS/max(length,1)

def check_geometry(doc,handles,expected):
 actual=native_segments(doc,handles)
 if not all(covered(line,expected) for line in actual) or not all(covered(line,actual) for line in expected):raise ValueError('GEOMETRY_MISMATCH')
 if abs(sum(math.dist(a,b) for a,b in actual)-sum(math.dist(a,b) for a,b in expected))>EPS*max(1,len(expected)):raise ValueError('DUPLICATED_OR_EXTRA_GEOMETRY')

def finite_number(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
def finite_tree(value,depth=0):
 if depth>24:raise ValueError('JSON_DEPTH_BUDGET')
 if isinstance(value,float) and not math.isfinite(value):raise ValueError('NONFINITE_JSON_NUMBER')
 if isinstance(value,(list,dict)):
  if len(value)>10000:raise ValueError('JSON_COLLECTION_BUDGET')
  for item in value.values() if isinstance(value,dict) else value:finite_tree(item,depth+1)
def projection_mapping(role,xkey):
 origin=role.get('origin')
 if not isinstance(origin,list) or len(origin)!=2 or not all(finite_number(v) for v in origin) or not finite_number(role.get(xkey)) or not finite_number(role.get('elevationDatum')):raise ValueError('NONFINITE_VIEW_MAPPING')
def text_geometry(e,height):
 actual=e.dxf.height if e.dxftype()=='TEXT' else e.dxf.char_height
 point=list(e.dxf.insert)
 if not finite_number(actual) or actual<height-EPS or not all(finite_number(v) for v in point) or abs(point[2])>EPS:raise ValueError('NONFINITE_OR_SMALL_TEXT')

def numeric_cells(doc,handles,values,height):
 if len(handles)!=len(values):raise ValueError('TABLE_COLUMN_COUNT')
 positions=[]
 for h,expected in zip(handles,values):
  e=doc.entitydb.get(h)
  if e is None or e.dxftype() not in ('TEXT','MTEXT') or e not in doc.modelspace():raise ValueError('TABLE_CELL_ENTITY')
  visible(doc,e);text=e.plain_text().strip()
  if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)',text) or abs(float(text)-expected)>.000501:raise ValueError('TABLE_VALUE_MISMATCH')
  text_geometry(e,height)
  positions.append(e.dxf.insert)
 if any(abs(p.y-positions[0].y)>EPS for p in positions) or any(a.x>=b.x for a,b in zip(positions,positions[1:])):raise ValueError('TABLE_ROW_NOT_READABLE')
 return positions[0].y

def validate(dxf,data,options,manifest):
 for value in [data,options,manifest]:finite_tree(value)
 if manifest.get('schema')!='road-study-views@1':raise ValueError('MANIFEST_SCHEMA')
 if len(dxf.encode())>4194304 or len(json.dumps(manifest).encode())>262144:raise ValueError('ARTIFACT_BUDGET')
 notices=[]
 class Capture(logging.Handler):
  def emit(self,r):
   if 'non-unique' in r.getMessage():notices.append(r.getMessage())
 handler=Capture();logger=logging.getLogger('ezdxf');logger.addHandler(handler)
 try:doc=ezdxf.read(io.StringIO(dxf,newline=None))
 finally:logger.removeHandler(handler)
 audit=doc.audit()
 if notices or audit.errors or audit.fixes:raise ValueError('DXF_LOAD_OR_AUDIT')
 if doc.units!=6 or len(doc.modelspace())>5000 or doc.dxfversion not in ('AC1027','AC1032'):raise ValueError(f'DXF_FORMAT_UNITS_OR_BUDGET units={doc.units} version={doc.dxfversion} entities={len(doc.modelspace())}')
 if len({e.dxf.layer for e in doc.modelspace()})<3:raise ValueError('INSUFFICIENT_EDITABLE_LAYERS')
 calculation=compute(data);used=set();height=options['textHeight']
 if not finite_number(height) or height<=0:raise ValueError('TEXT_HEIGHT_REQUIREMENT')
 def claim(handles):
  if not isinstance(handles,list) or not handles or any(not isinstance(h,str) or not re.fullmatch(r'[0-9A-Fa-f]{1,16}',h) for h in handles):raise ValueError('ROLE_HANDLES')
  normalized=[h.upper() for h in handles]
  if len(set(normalized))!=len(normalized) or any(h in used for h in normalized):raise ValueError('REUSED_ROLE_HANDLE')
  used.update(normalized)
 def geometry(handles,expected):
  claim(handles);check_geometry(doc,handles,expected)
 def labels(handles,token):
  claim(handles)
  text=[]
  for h in handles:
   e=doc.entitydb.get(h)
   if e is None or e.dxftype() not in ('TEXT','MTEXT') or e not in doc.modelspace():raise ValueError('LABEL_ENTITY')
   visible(doc,e)
   text_geometry(e,height)
   text.append(e.plain_text())
  if token not in ' '.join(text).upper():raise ValueError('VIEW_LABEL_MISMATCH')
 plan=manifest['plan'];geometry(plan['alignment'],segments(data['alignment']));geometry(plan['edges'],calculation['edges']);labels(plan['labels'],'PLAN')
 if len(plan['sections'])!=len(calculation['sections']):raise ValueError('PLAN_SECTION_COUNT')
 for role,section in zip(plan['sections'],calculation['sections']):
  if role['station']!=section['station']:raise ValueError('PLAN_STATION')
  geometry(role['handles'],segments(section['world']))
 profile=manifest['profile'];projection_mapping(profile,'stationDatum');ph=options['profileScale']['horizontal'];pv=options['profileScale']['vertical']
 def mapped(points,role,h,v,xkey):return [[role['origin'][0]+(p[0]-role[xkey])*h,role['origin'][1]+(p[1]-role['elevationDatum'])*v] for p in points]
 geometry(profile['ground'],segments(mapped([[s['station'],s['groundCenter']] for s in calculation['sections']],profile,ph,pv,'stationDatum')))
 geometry(profile['design'],segments(mapped(calculation['profile'],profile,ph,pv,'stationDatum')));labels(profile['labels'],'PROFILE')
 if len(manifest['sections'])!=len(calculation['sections']):raise ValueError('SECTION_COUNT')
 for role,section in zip(manifest['sections'],calculation['sections']):
  if role['station']!=section['station']:raise ValueError('SECTION_STATION')
  projection_mapping(role,'offsetDatum')
  for kind in ['ground','design']:geometry(role[kind],segments(mapped(section[kind],role,options['sectionScale']['horizontal'],options['sectionScale']['vertical'],'offsetDatum')))
  labels(role['labels'],'STA')
 if len(manifest['stationTable'])!=len(calculation['sections']) or len(manifest['volumeTable'])!=len(calculation['intervals']):raise ValueError('TABLE_ROW_COUNT')
 ys=[]
 for row,s in zip(manifest['stationTable'],calculation['sections']):
  if row['station']!=s['station']:raise ValueError('STATION_TABLE_ASSOCIATION')
  claim(row['cells']);ys.append(numeric_cells(doc,row['cells'],[s['station'],s['elevation'],s['groundCenter'],s['grade']*100,s['cut'],s['fill']],height))
 if len(set(ys))!=len(ys):raise ValueError('OVERLAPPING_TABLE_ROWS')
 ys=[]
 for row,i in zip(manifest['volumeTable'],calculation['intervals']):
  if [row['fromStation'],row['toStation']]!=[i['fromStation'],i['toStation']]:raise ValueError('VOLUME_TABLE_ASSOCIATION')
  claim(row['cells']);ys.append(numeric_cells(doc,row['cells'],[i['fromStation'],i['toStation'],i['length'],i['cut'],i['fill']],height))
 if len(set(ys))!=len(ys):raise ValueError('OVERLAPPING_TABLE_ROWS')
 claim(manifest['totals']['cells']);numeric_cells(doc,manifest['totals']['cells'],[calculation['cut'],calculation['fill']],height)
 return {'passed':True,'validator':'independent-ezdxf-road','version':ezdxf.__version__,'entities':len(doc.modelspace()),'sections':len(calculation['sections']),'cutVolume':calculation['cut'],'fillVolume':calculation['fill'],'auditErrors':0,'auditFixes':0,'boundary':'Checks supplied-data geometry, real native role associations and numeric tables; does not certify engineering standards or full visual readability.'}

if __name__=='__main__':
 try:
  request=json.load(sys.stdin)
  if request.get('mode')=='compute':print(json.dumps(compute(request['input'])))
  else:print(json.dumps(validate(request['dxf'],request['input'],request['options'],request['manifest'])))
 except Exception as error:print(json.dumps({'passed':False,'validator':'independent-ezdxf-road','reason':str(error)[:1000],'errorType':type(error).__name__}))
