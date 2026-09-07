import { KJValidationError } from '../errors.js'

const EXPECTED_ABI_MAGIC=0x4b4a4301
const EXPECTED_SOLID_MODEL_VERSION=1
const SOLID_ERRORS=Object.freeze({201:'三维参数无效',202:'三维网格无效',203:'该布尔运算超出当前精确基本体范围',204:'三维运算结果为空'})
function rawExports(source){return source?.exports??source}
function fail(exports,operation,result){const code=Math.abs(Number(result)||Number(exports.kjcore_last_error?.())||0);return new KJValidationError(`KJCore ${operation} 失败：${SOLID_ERRORS[code]??`错误 ${code||'unknown'}`}`,{code,operation})}
function assertSolidAbi(source){const exports=rawExports(source);if(!exports||Number(exports.kjcore_abi_magic?.())>>>0!==EXPECTED_ABI_MAGIC)throw new KJValidationError('KJCore 三维 WASM ABI 不兼容');if(Number(exports.kjcore_solid_model_version?.())!==EXPECTED_SOLID_MODEL_VERSION)throw new KJValidationError('KJCore 三维模型版本不兼容');for(const name of ['kjcore_alloc_f64','kjcore_free_f64','kjcore_solid_open_mesh','kjcore_solid_box','kjcore_solid_cylinder','kjcore_solid_cone','kjcore_solid_sphere','kjcore_solid_sweep','kjcore_solid_loft','kjcore_solid_transform','kjcore_solid_boolean','kjcore_solid_validate','kjcore_solid_volume','kjcore_solid_serialize_json','kjcore_solid_close','kjcore_byte_result_len','kjcore_byte_result_value'])if(typeof exports[name]!=='function')throw new KJValidationError(`KJCore 三维 ABI 缺失 ${name}`);if(!exports.memory?.buffer)throw new KJValidationError('KJCore 三维 ABI 缺失共享内存');return exports}
function flatPoints(points,label='points'){if(!Array.isArray(points)||points.length<3)throw new KJValidationError(`${label} 至少需要三个三维点`);const out=[];for(let index=0;index<points.length;index++){const row=Array.isArray(points[index])?points[index]:[points[index]?.x,points[index]?.y,points[index]?.z];if(row.length<3||![row[0],row[1],row[2]].every(Number.isFinite))throw new KJValidationError(`${label}[${index}] 必须包含有限 XYZ`);out.push(Number(row[0]),Number(row[1]),Number(row[2]))}return out}
function withF64(exports,values,callback){const source=Float64Array.from(values),pointer=Number(exports.kjcore_alloc_f64(source.length));if(source.length&&!pointer)throw new KJValidationError('KJCore 无法分配三维输入缓冲区');try{new Float64Array(exports.memory.buffer,pointer,source.length).set(source);return callback(pointer,source.length)}finally{exports.kjcore_free_f64(pointer,source.length)}}
function readBytes(exports,operation,result){if(!Number.isInteger(result)||result<0)throw fail(exports,operation,result);const length=Number(exports.kjcore_byte_result_len());if(length!==result)throw new KJValidationError(`KJCore ${operation} 返回长度不兼容`);const bytes=new Uint8Array(length);for(let index=0;index<length;index++){const value=Number(exports.kjcore_byte_result_value(index));if(!Number.isInteger(value)||value<0||value>255)throw new KJValidationError(`KJCore ${operation} 返回无效字节`);bytes[index]=value}return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}

export class KJCoreSolidSession{
  #exports;#handle
  constructor(exports,handle){this.#exports=exports;this.#handle=handle}
  get closed(){return this.#handle===0}
  #open(){if(this.closed)throw new KJValidationError('KJCore 三维会话已经关闭')}
  validate(){this.#open();const result=Number(this.#exports.kjcore_solid_validate(this.#handle));if(result!==1)throw fail(this.#exports,'solid_validate',result);return true}
  get volume(){this.#open();const value=Number(this.#exports.kjcore_solid_volume(this.#handle));if(!Number.isFinite(value)||value<=0)throw fail(this.#exports,'solid_volume',this.#exports.kjcore_last_error?.());return value}
  serialize(){this.#open();return JSON.parse(readBytes(this.#exports,'solid_serialize_json',Number(this.#exports.kjcore_solid_serialize_json(this.#handle))))}
  transform(matrix){this.#open();const values=Array.from(matrix??[]).map(Number);if(values.length!==16||!values.every(Number.isFinite))throw new KJValidationError('三维变换必须是有限 4×4 矩阵');return withF64(this.#exports,values,(pointer,length)=>session(this.#exports,Number(this.#exports.kjcore_solid_transform(this.#handle,pointer,length)),'solid_transform'))}
  boolean(other,operation='union'){this.#open();if(!(other instanceof KJCoreSolidSession)||other.closed)throw new KJValidationError('布尔运算需要两个打开的 KJCore 三维会话');const code={union:0,intersection:1,difference:2}[String(operation).toLowerCase()];if(code==null)throw new KJValidationError(`未知三维布尔运算：${operation}`);return session(this.#exports,Number(this.#exports.kjcore_solid_boolean(this.#handle,other.#handle,code)),'solid_boolean')}
  close(){if(this.closed)return false;const handle=this.#handle;this.#handle=0;const result=Number(this.#exports.kjcore_solid_close(handle));if(result!==1)throw fail(this.#exports,'solid_close',result);return true}
}
function session(exports,handle,operation){if(!Number.isInteger(handle)||handle<=0)throw fail(exports,operation,handle);return new KJCoreSolidSession(exports,handle)}
function point3(value,label){const row=Array.isArray(value)?value:[value?.x,value?.y,value?.z];if(row.length<3||![row[0],row[1],row[2]].every(Number.isFinite))throw new KJValidationError(`${label} 必须是有限三维点`);return row.map(Number)}

export function createKJCoreSolidBackend(wasmModuleOrInstance){const exports=assertSolidAbi(wasmModuleOrInstance),primitive=(name,args)=>session(exports,Number(exports[name](...args)),name);return Object.freeze({
  id:'kanjie.kjcore.solid-wasm',authoritative:true,modelVersion:EXPECTED_SOLID_MODEL_VERSION,
  openMesh(mesh){const vertices=flatPoints(mesh?.vertices,'vertices'),triangles=(mesh?.triangles??[]).flatMap((row,index)=>{if(!Array.isArray(row)||row.length!==3||!row.every(value=>Number.isInteger(value)&&value>=0))throw new KJValidationError(`triangles[${index}] 必须包含三个无符号整数`);return row});return withF64(exports,vertices,(vp,vc)=>withF64(exports,triangles,(tp,tc)=>session(exports,Number(exports.kjcore_solid_open_mesh(vp,vc,tp,tc)),'solid_open_mesh')))},
  box({center=[0,0,0],size}={}){const c=point3(center,'center'),s=point3(size,'size');return primitive('kjcore_solid_box',[...c,...s])},
  cylinder({center=[0,0,0],radius,height,segments=32}={}){return primitive('kjcore_solid_cylinder',[...point3(center,'center'),Number(radius),Number(height),Number(segments)])},
  cone({center=[0,0,0],bottomRadius,topRadius=0,height,segments=32}={}){return primitive('kjcore_solid_cone',[...point3(center,'center'),Number(bottomRadius),Number(topRadius),Number(height),Number(segments)])},
  sphere({center=[0,0,0],radius,segments=32}={}){return primitive('kjcore_solid_sphere',[...point3(center,'center'),Number(radius),Number(segments)])},
  sweep({profile,vector}={}){const values=flatPoints(profile,'profile'),v=point3(vector,'vector');return withF64(exports,values,(pointer,length)=>session(exports,Number(exports.kjcore_solid_sweep(pointer,length,...v)),'solid_sweep'))},
  loft({bottom,top}={}){const a=flatPoints(bottom,'bottom'),b=flatPoints(top,'top');return withF64(exports,a,(ap,al)=>withF64(exports,b,(bp,bl)=>session(exports,Number(exports.kjcore_solid_loft(ap,al,bp,bl)),'solid_loft')))},
})}

export const KJCORE_SOLID_MODEL_VERSION=EXPECTED_SOLID_MODEL_VERSION
