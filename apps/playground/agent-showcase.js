import { translation3, transformEntityPayload } from '../../packages/kjdraw-sdk/src/index.js'

export const AGENT_REVISION_COMMAND = 'DEMO_APPLY_REVISION'

export const showcaseIntents = Object.freeze({
  en: Object.freeze({
    'service-yard': 'Re-plan the east service yard: move the eight battery banks 8 m north, remove temporary staging, and add a protected charging lane.',
    'fire-corridor': 'Open the east emergency corridor: move the battery banks 6 m west, remove temporary staging, and add a marked fire-access lane.',
    'inspection-buffer': 'Create a safer inspection zone: move the battery banks 4 m north, remove temporary staging, and add a continuous equipment buffer.',
  }),
  zh: Object.freeze({
    'service-yard': '重排东侧服务场：将 8 组电池设备向北移动 8 米，拆除临时堆场，并新增有防护的充电通道。',
    'fire-corridor': '打开东侧消防通道：将电池设备向西移动 6 米，拆除临时堆场，并新增消防车道标线。',
    'inspection-buffer': '建立安全巡检区：将电池设备向北移动 4 米，拆除临时堆场，并新增连续设备防护缓冲区。',
  }),
})

export function getShowcaseIntent(locale, preset) {
  return showcaseIntents[locale]?.[preset] ?? showcaseIntents.en[preset] ?? ''
}

export function isShowcaseIntent(value) {
  const normalized=String(value??'').trim()
  return Object.values(showcaseIntents).some(group=>Object.values(group).includes(normalized))
}

export function resolveShowcasePreset(raw) {
  const normalized=String(raw??'').trim(),value=normalized.toLowerCase()
  for(const group of Object.values(showcaseIntents))for(const [preset,intent] of Object.entries(group))if(normalized===intent)return preset
  if(/fire|emergency|corridor|消防|应急/.test(value))return 'fire-corridor'
  if(/inspect|buffer|巡检|缓冲|安全区/.test(value))return 'inspection-buffer'
  if(/service|battery|charging|yard|服务场|电池|充电|堆场/.test(value))return 'service-yard'
  return null
}

const rectangleSpec=(x,y,w,h,layerId)=>({type:'LWPOLYLINE',payload:{vertices:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(point=>({point})),closed:true,layerId}})
const lineSpec=(start,end,layerId)=>({type:'LINE',payload:{start,end,layerId}})
const circleSpec=(center,radius,layerId)=>({type:'CIRCLE',payload:{center,radius,layerId}})
const textSpec=(position,text,height,layerId)=>({type:'TEXT',payload:{position,text,height,rotation:0,layerId}})

function safetyAdditions(preset,layerId) {
  const specs=[]
  if(preset==='fire-corridor') {
    specs.push(rectangleSpec(232,21,7,42,layerId))
    for(let y=24;y<=59;y+=5)specs.push(lineSpec([233,y],[238,y+3],layerId))
    specs.push(lineSpec([235.5,24],[235.5,60],layerId),textSpec([225,64],'FIRE ACCESS  /  KEEP CLEAR',1,layerId))
  } else {
    const y0=preset==='service-yard'?31:27,y1=preset==='service-yard'?57:53
    specs.push(rectangleSpec(194,y0,46,y1-y0,layerId))
    for(let x=195;x<=239;x+=5.5)specs.push(circleSpec([x,y0],.48,layerId),circleSpec([x,y1],.48,layerId))
    specs.push(lineSpec([195,y0+2],[239,y0+2],layerId),textSpec([196,y1+2],preset==='service-yard'?'PROTECTED CHARGING LANE':'INSPECTION BUFFER',1,layerId))
  }
  return specs
}

export function createShowcaseRevision(document,preset) {
  if(!['service-yard','fire-corridor','inspection-buffer'].includes(preset))throw new Error(`Unknown showcase preset: ${preset}`)
  const layers=document.getTable('layers').records
  const layer=name=>layers.find(record=>record.name===name)??null
  const moveLayer=layer('Equipment · Rev A'),deleteLayer=layer('Temporary · remove'),addLayer=layer('Safety · proposal')
  if(!moveLayer||!deleteLayer||!addLayer)throw new Error('Drawing does not contain the showcase revision layers.')
  const modelSpaceId=document.snapshot().spaces.modelSpaceId,entities=document.listEntities({ownerId:modelSpaceId})
  const moveIds=entities.filter(entity=>entity.payload.layerId===moveLayer.id).map(entity=>entity.id)
  const deleteIds=entities.filter(entity=>entity.payload.layerId===deleteLayer.id).map(entity=>entity.id)
  if(!moveIds.length||!deleteIds.length)throw new Error('Showcase targets are missing or the revision is already applied.')
  const [dx,dy]=preset==='fire-corridor'?[-6,0]:preset==='inspection-buffer'?[0,4]:[0,8]
  return {moveIds,deleteIds,additions:safetyAdditions(preset,addLayer.id),dx,dy}
}

export function registerShowcaseCommand(sdk) {
  return sdk.commands.register({
    id:AGENT_REVISION_COMMAND,
    title:'Apply reviewed campus revision',
    capabilities:{domain:'playground-demo',operations:['move','erase','create'],atomic:true},
    execute:({document,transaction},args)=>{
      const moveIds=[...new Set(args.moveIds??[])],deleteIds=[...new Set(args.deleteIds??[])],additions=args.additions??[]
      const dx=Number(args.dx),dy=Number(args.dy)
      if(!Number.isFinite(dx)||!Number.isFinite(dy)||!Array.isArray(additions))throw new Error('Invalid deterministic revision arguments.')
      const movedIds=[]
      for(const id of moveIds){const entity=document.getObject(id);if(!entity||entity.kind!=='entity')throw new Error(`Move target does not exist: ${id}`);movedIds.push(transaction.updateObject(id,{payload:transformEntityPayload(entity.type,entity.payload,translation3(dx,dy))}).id)}
      const deletedIds=[]
      for(const id of deleteIds){const entity=document.getObject(id);if(!entity||entity.kind!=='entity')throw new Error(`Delete target does not exist: ${id}`);transaction.eraseObject(id);deletedIds.push(id)}
      const addedIds=[]
      for(const spec of additions){if(!spec||typeof spec.type!=='string'||!spec.payload)throw new Error('Invalid addition specification.');addedIds.push(transaction.createEntity(spec.type,spec.payload,spec.options).id)}
      return {movedIds,deletedIds,addedIds}
    },
  },{owner:'@kanjieteam/kjdraw-playground'})
}
