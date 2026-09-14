import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJDRAW_BUILTIN_AGENT_CAPABILITIES,
  capabilityReference,
  createKJDrawBuiltinCapabilityRegistry,
  matchKJDrawBuiltinCapability,
} from '../src/agent-builtin-capabilities.js'
import { KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'

test('built-in capability catalog is immutable, versioned and backed only by registered high-level tools',()=>{
  assert.equal(KJDRAW_BUILTIN_AGENT_CAPABILITIES.length,11)
  assert.equal(new Set(KJDRAW_BUILTIN_AGENT_CAPABILITIES.map(item=>item.id)).size,11)
  assert.ok(Object.isFrozen(KJDRAW_BUILTIN_AGENT_CAPABILITIES))
  const known=new Set(KJDRAW_AGENT_TOOLS.map(tool=>tool.name))
  for(const descriptor of KJDRAW_BUILTIN_AGENT_CAPABILITIES){
    assert.ok(Object.isFrozen(descriptor));assert.ok(Object.isFrozen(descriptor.manifest))
    assert.equal(descriptor.id,descriptor.manifest.id);assert.equal(descriptor.version,descriptor.manifest.version)
    assert.match(descriptor.version,/^\d+\.\d+\.\d+$/)
    assert.ok(descriptor.manifest.requiredToolNames.length>=1)
    assert.equal(new Set(descriptor.manifest.requiredToolNames).size,descriptor.manifest.requiredToolNames.length)
    assert.ok(descriptor.manifest.requiredToolNames.every(name=>known.has(name)))
    assert.ok(descriptor.examples.every(example=>example.en&&example.zhCN))
    const writes=descriptor.manifest.requiredToolNames.some(name=>name.startsWith('cad_propose_'))
    assert.ok(descriptor.verification.includes(writes?'undo/redo':'no mutation'))
  }
  assert.throws(()=>{KJDRAW_BUILTIN_AGENT_CAPABILITIES[0].name.zhCN='changed'},TypeError)
})

test('built-in registry resolves exact content locks to its declared tools and trusted instructions',()=>{
  const registry=createKJDrawBuiltinCapabilityRegistry()
  assert.equal(registry.list().length,KJDRAW_BUILTIN_AGENT_CAPABILITIES.length)
  for(const descriptor of KJDRAW_BUILTIN_AGENT_CAPABILITIES){
    const lock=registry.createLock([capabilityReference(descriptor)])
    const resolved=registry.resolve({lock,allowedToolNames:KJDRAW_AGENT_TOOLS.map(tool=>tool.name)})
    assert.deepEqual(resolved.toolNames,descriptor.manifest.requiredToolNames)
    assert.match(resolved.instructions,new RegExp(`Capability ${descriptor.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}@${descriptor.version}`))
    assert.ok(Object.isFrozen(lock));assert.ok(Object.isFrozen(resolved))
    const forged=structuredClone(lock);forged[0].contentHash='0'.repeat(64)
    assert.throws(()=>registry.resolve({lock:forged,allowedToolNames:KJDRAW_AGENT_TOOLS.map(tool=>tool.name)}),/does not match/)
  }
})

test('generation shortcut does not mistake geology, negation, questions or mixed tasks for one compiler',()=>{
  const prompts=[
    '绘制钻孔地质柱状图。',
    '绘制岩性柱状图和地层说明。',
    'Draw a borehole column chart.',
    '绘制水平条形图。',
    'Draw a horizontal bar chart.',
    '不要绘制柱状图。',
    "Don't create a bar chart.",
    'How do I create a bar chart?',
    '如何绘制建筑平面图？',
    '绘制建筑平面图和季度产量柱状图。',
    'Create a site plan and a bar chart.',
    '绘制季度柱状图，然后删除旧对象。',
    'Create a bar chart and move the existing legend.',
  ]
  for(const prompt of prompts){
    assert.equal(matchKJDrawBuiltinCapability({prompt,units:'millimeter',entityCount:0}),null,prompt)
  }
})

test('inspection catalog exposes only read effects and a host cannot resolve an incomplete permission set',()=>{
  const registry=createKJDrawBuiltinCapabilityRegistry()
  const descriptor=KJDRAW_BUILTIN_AGENT_CAPABILITIES.find(item=>item.id==='builtin.drawing-inspection')
  assert.ok(descriptor)
  const lock=registry.createLock([capabilityReference(descriptor)])
  for(const name of descriptor.manifest.requiredToolNames){
    assert.equal(KJDRAW_AGENT_TOOLS.find(tool=>tool.name===name).effect,'read')
  }
  assert.throws(()=>registry.resolve({lock,allowedToolNames:['cad_read_drawing']}),/outside the host allowlist/)
})

test('host matcher selects only high-confidence bilingual blank-drawing intents with canonical units',()=>{
  const match=(prompt,units='millimeter',entityCount=0)=>matchKJDrawBuiltinCapability({prompt,units,entityCount})?.id??null
  assert.equal(match('Create a manufacturing drawing for a fixture plate with counterbores.'),'builtin.manufacturing-sheet')
  assert.equal(match('绘制带门窗的办公室建筑平面图。'),'builtin.architecture-plan')
  assert.equal(match('绘制季度产量柱状图和目标折线图。'),'builtin.cartesian-chart')
  assert.equal(match('Create a campus site plan with utilities.','meter'),'builtin.site-plan')
  assert.equal(match('根据路线、纵断面和横断面绘制道路工程图。','meter'),'builtin.road-plan-profile-sections')
  assert.equal(match('Draw two circles.'),null)
  assert.equal(match('绘制柱状图。','meter'),null)
  assert.equal(match('绘制柱状图。','millimeter',1),null)
  assert.equal(match('', 'millimeter'),null)
})
