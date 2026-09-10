import type { KJDocument } from './document.js'
import type { KJRoadDesignInput } from './road-design.js'
import { buildRoadDrawing, type KJRoadDrawingResult } from './road-drawing.js'
import { restoreRoadDrawingRecipe, type KJRoadDrawingRecipe, type KJRestoredRoadDrawingRecipe } from './road-drawing-recipe.js'
import { applyRoadDrawingRevision, type KJRoadDrawingRevisionReceipt } from './road-drawing-update.js'
import type { KJAgentGeometryPreview, KJAgentPreviewEntity } from './agent-preview.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { canonicalStringify, deepFreeze, type ReadonlyDeep } from './utils.js'

export interface KJAgentRoadRevisionInput {
  expectedRevision: number
  units: 'meter'
  drawingId: string
  leftWidthDelta: number
  rightWidthDelta: number
  /** Uniform additive offset to all design profile elevations, in meters. */
  elevationDelta: number
}
export interface KJAgentRoadRevisionProposal {
  previous: ReadonlyDeep<KJRoadDrawingResult>
  next: ReadonlyDeep<KJRoadDrawingResult>
  recipe: ReadonlyDeep<KJRoadDrawingRecipe>
  preview: KJAgentGeometryPreview
  evidence: {
    drawingId: string; units: 'meter'; expectedRevision: number; entityCount: number
    designParameters: { input: KJRoadDesignInput; options: KJRoadDrawingRecipe['options'] }
    previousDesignParameters: { input: KJRoadDesignInput; options: KJRoadDrawingRecipe['options'] }
    changes: KJAgentRoadRevisionInput
    changedCounts: { updated: number; created: number; removed: number; unchanged: number }
    previousTotalVolume: KJRoadDrawingResult['calculation']['totalVolume']
    totalVolume: KJRoadDrawingResult['calculation']['totalVolume']
    calculation: KJRoadDrawingResult['calculation']
    frames: KJRoadDrawingResult['frames']; bounds: KJRoadDrawingResult['bounds']
    projections: KJRoadDrawingResult['projections']; limitations: readonly string[]
  }
}
const fail = (message: string): never => { throw new KJValidationError(`Road revision proposal: ${message}`) }
function parse(input: unknown): KJAgentRoadRevisionInput {
  const names=['expectedRevision','units','drawingId','leftWidthDelta','rightWidthDelta','elevationDelta']
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) fail('requires a plain input object')
  const keys=Reflect.ownKeys(input as object), data: Record<string, unknown>={}
  if(keys.length!==names.length)fail('all specified fields required; extra fields forbidden')
  for(const name of names){const d=Object.getOwnPropertyDescriptor(input,name);if(!d || !('value' in d) || !d.enumerable)fail('accessors and missing fields forbidden');data[name]=d!.value}
  if(!Number.isSafeInteger(data.expectedRevision)||Number(data.expectedRevision)<0)fail('invalid expectedRevision')
  if(data.units!=='meter'||typeof data.drawingId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(data.drawingId))fail('meter units and exact drawingId required')
  for(const key of ['leftWidthDelta','rightWidthDelta','elevationDelta'])if(typeof data[key]!=='number'||!Number.isFinite(data[key])||Math.abs(data[key] as number)>1e9)fail('deltas must be finite within ±1e9 meters')
  if(!data.leftWidthDelta&&!data.rightWidthDelta&&!data.elevationDelta)fail('all-zero revision would make no changes')
  return data as unknown as KJAgentRoadRevisionInput
}
function counts(receipt: ReadonlyDeep<KJRoadDrawingRevisionReceipt>) { return { updated:receipt.updatedIds.length, created:receipt.createdIds.length, removed:receipt.removedIds.length, unchanged:receipt.unchangedIds.length } }
/** Host recipe must already have been restored at this exact document revision. The
 * detached revalidation below also rejects manual edits and forged compiled output. */
export async function buildAgentRoadRevision(document: KJDocument, input: KJAgentRoadRevisionInput, registered: ReadonlyDeep<KJRestoredRoadDrawingRecipe>): Promise<ReadonlyDeep<KJAgentRoadRevisionProposal>> {
  const data=parse(input),source=document.snapshot(),revision=document.revision
  if(data.expectedRevision!==revision)throw new KJRevisionConflictError(data.expectedRevision,revision)
  if(registered.revision!==revision||registered.documentId!==document.id)fail('registered recipe is stale; host must restore and register it again')
  if(Object.keys(source.objects).length>250000)fail('document exceeds 250000 objects')
  const restored=await restoreRoadDrawingRecipe(document,registered.recipe)
  if(restored.recipe.options.drawingId!==data.drawingId)fail('drawingId does not match the host-registered recipe')
  const previous=restored.drawing, nextInput=structuredClone(restored.recipe.input) as KJRoadDesignInput
  nextInput.pavement.leftWidth+=data.leftWidthDelta;nextInput.pavement.rightWidth+=data.rightWidthDelta
  nextInput.profile=nextInput.profile.map(point=>({...point,elevation:point.elevation+data.elevationDelta}))
  const recipe={...structuredClone(restored.recipe),input:nextInput} as KJRoadDrawingRecipe
  const next=buildRoadDrawing(nextInput,recipe.options)
  for(const drawing of [previous,next]){
    if(drawing.entities.length>512||drawing.resources.layers.length+drawing.resources.linetypes.length>32)fail('road drawing exceeds 512 entities or 32 resources')
    if(drawing.calculation.sections.length>64||drawing.calculation.sections.reduce((sum,section)=>sum+section.ground.length,0)>4096)fail('road survey exceeds the agent data budget')
  }
  if(new TextEncoder().encode(JSON.stringify({previous,next})).length>4194304)fail('revision working set exceeds 4 MiB')
  const draft=document.fork(),receipt=await applyRoadDrawingRevision(draft,previous,next,{expectedRevision:revision})
  if(!receipt.updatedIds.length&&!receipt.createdIds.length&&!receipt.removedIds.length)fail('requested deltas make no representable geometry change')
  const project=(doc: KJDocument,id:string): KJAgentPreviewEntity=>{const entity=doc.getObject(id)!;return {id,type:entity.type,payload:entity.payload}}
  const before=[...receipt.updatedIds,...receipt.removedIds].map(id=>project(document,id)),after=[...receipt.updatedIds,...receipt.createdIds].map(id=>project(draft,id))
  if(before.length>512||after.length>512||before.length+after.length>1024)fail('changed geometry exceeds the review budget')
  const preview: KJAgentGeometryPreview={documentId:document.id,revision,command:'ROAD_DRAWING_UPDATE',before,after}
  const bytes=(value:unknown):number=>new TextEncoder().encode(JSON.stringify(value)).length
  if(bytes(before)>262144||bytes(after)>262144||bytes(preview)>524288)fail('geometry preview exceeds 256 KiB per side or 512 KiB total')
  const evidence={drawingId:data.drawingId,units:'meter' as const,expectedRevision:revision,entityCount:next.entities.length,designParameters:{input:nextInput,options:recipe.options},previousDesignParameters:{input:structuredClone(restored.recipe.input) as KJRoadDesignInput,options:recipe.options},changes:data,changedCounts:counts(receipt),previousTotalVolume:previous.calculation.totalVolume,totalVolume:next.calculation.totalVolume,calculation:next.calculation,frames:next.frames,bounds:next.bounds,projections:next.projections,limitations:next.limitations}
  if(new TextEncoder().encode(JSON.stringify(evidence)).length>262144)fail('calculation evidence exceeds 256 KiB')
  if(document.snapshot()!==source||document.revision!==revision)throw new KJRevisionConflictError(revision,document.revision)
  return deepFreeze({previous,next,recipe,preview,evidence}) as ReadonlyDeep<KJAgentRoadRevisionProposal>
}
