import { KJValidationError } from '../errors.js'
import { normalizeSplineDefinition, splinePoint2 } from './curves.js'

type Point3 = readonly [number,number,number]
type Data = Readonly<Record<string,unknown>>
export interface KJHatchSplineEdge extends Record<string,unknown> {
  readonly type:'SPLINE';readonly degree:number;readonly controlPoints:readonly Point3[];readonly knots:readonly number[];readonly weights:readonly number[];readonly fitPoints:readonly Point3[];readonly periodic:boolean
}
export interface KJHatchSplineConic {readonly center:Point3;readonly majorAxis:Point3;readonly ratio:number;readonly counterClockwise:boolean}
const point=(value:unknown,label:string):Point3=>{
  if(!Array.isArray(value)||value.length<2||value.length>3)throw new KJValidationError(`${label} must be an XY point`)
  const result=[Number(value[0]),Number(value[1]),Number(value[2]??0)] as Point3
  if(!result.every(Number.isFinite)||result[2]!==0)throw new KJValidationError(`${label} must be finite XY at Z=0`)
  return result
}

/** Structural DXF edge normalization. Exact topology support is deliberately narrower. */
export function normalizeHatchSplineEdge(source:Data,label='Hatch SPLINE edge'):KJHatchSplineEdge{
  const raw=Array.isArray(source.controlPoints)?source.controlPoints:[]
  if(raw.length>4096)throw new KJValidationError(`${label} exceeds 4096 control points`)
  const controlPoints=raw.map((value,index)=>point(value,`${label} controlPoints[${index}]`))
  const definition=normalizeSplineDefinition({degree:Number(source.degree),controlPoints,...(Array.isArray(source.knots)?{knots:source.knots.map(Number)}:{}),...(Array.isArray(source.weights)?{weights:source.weights.map(Number)}:{})})
  if(definition.degree>10)throw new KJValidationError(`${label} degree exceeds 10`)
  const fitSource=Array.isArray(source.fitPoints)?source.fitPoints:[]
  if(fitSource.length>4096)throw new KJValidationError(`${label} exceeds 4096 fit points`)
  const fitPoints=fitSource.map((value,index)=>point(value,`${label} fitPoints[${index}]`))
  const tangent=(key:'startTangent'|'endTangent'):Point3|undefined=>source[key]==null?undefined:point(source[key],`${label} ${key}`)
  const startTangent=tangent('startTangent'),endTangent=tangent('endTangent')
  return {type:'SPLINE',degree:definition.degree,controlPoints:definition.controlPoints.map(value=>[value[0],value[1],0]),knots:definition.knots,weights:definition.weights,fitPoints,periodic:source.periodic===true||Number(source.periodic)===1,...(startTangent?{startTangent}:{}),...(endTangent?{endTangent}:{})}
}

/** Recognize the exact four-span rational-quadratic representation of a closed ellipse. */
export function closedHatchSplineConic(source:Data):KJHatchSplineConic|null{
  let edge:KJHatchSplineEdge
  try{edge=normalizeHatchSplineEdge(source)}catch{return null}
  if(edge.degree!==2||edge.periodic||edge.controlPoints.length!==9||edge.knots.length!==12||edge.weights.length!==9||edge.fitPoints.length)return null
  const domain=edge.knots.at(-1)!-edge.knots[0]!
  if(!(domain>0))return null
  const expected=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1],near=(a:number,b:number,t=1e-9)=>Math.abs(a-b)<=t*Math.max(1,Math.abs(a),Math.abs(b))
  if(edge.knots.some((value,index)=>!near((value-edge.knots[0]!)/domain,expected[index]!)))return null
  const w=edge.weights[0]!
  if(!(w>0)||edge.weights.some((value,index)=>!near(value/w,index%2?Math.SQRT1_2:1)))return null
  const p=edge.controlPoints,c:[number,number,number]=[(p[0]![0]+p[4]![0])/2,(p[0]![1]+p[4]![1])/2,0],u:[number,number,number]=[p[0]![0]-c[0],p[0]![1]-c[1],0],v:[number,number,number]=[p[2]![0]-c[0],p[2]![1]-c[1],0]
  const lu=Math.hypot(u[0],u[1]),lv=Math.hypot(v[0],v[1]),scale=Math.max(1,lu,lv,...p.flat().map(Math.abs)),tolerance=1e-8*scale
  if(!(lu>tolerance&&lv>tolerance)||Math.abs(u[0]*v[0]+u[1]*v[1])>tolerance*scale)return null
  const expectedPoints=[[c[0]+u[0],c[1]+u[1]],[c[0]+u[0]+v[0],c[1]+u[1]+v[1]],[c[0]+v[0],c[1]+v[1]],[c[0]-u[0]+v[0],c[1]-u[1]+v[1]],[c[0]-u[0],c[1]-u[1]],[c[0]-u[0]-v[0],c[1]-u[1]-v[1]],[c[0]-v[0],c[1]-v[1]],[c[0]+u[0]-v[0],c[1]+u[1]-v[1]],[c[0]+u[0],c[1]+u[1]]]
  if(p.some((value,index)=>Math.hypot(value[0]-expectedPoints[index]![0]!,value[1]-expectedPoints[index]![1]!)>tolerance))return null
  const start=splinePoint2(edge,edge.knots[edge.degree]!),end=splinePoint2(edge,edge.knots[edge.controlPoints.length]!)
  if(Math.hypot(start[0]-end[0],start[1]-end[1])>tolerance)return null
  const counterClockwise=u[0]*v[1]-u[1]*v[0]>0
  if(lu>=lv)return {center:c,majorAxis:u,ratio:lv/lu,counterClockwise}
  return {center:c,majorAxis:v,ratio:lu/lv,counterClockwise:!counterClockwise}
}

export function sampleHatchSpline(source:Data,stepsPerSpan=24):readonly [number,number][] {
  const edge=normalizeHatchSplineEdge(source),values=[...new Set(edge.knots.slice(edge.degree,edge.controlPoints.length+1))],result:[number,number][]=[]
  for(let span=1;span<values.length;span++)for(let step=span===1?0:1;step<=stepsPerSpan;step++)result.push(splinePoint2(edge,values[span-1]!+(values[span]!-values[span-1]!)*step/stepsPerSpan))
  return result
}
