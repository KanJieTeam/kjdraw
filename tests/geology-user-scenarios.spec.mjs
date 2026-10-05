import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildGeologyUserScenarios, serializeGeologyUserScenarios, validateGeologyUserScenarios, renderGeologyUserScenarioReviewHtml, FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'

const frozenText = await readFile(FIXTURE_URL, 'utf8')
const frozen = JSON.parse(frozenText)

test('frozen questions are byte-for-byte deterministic and explicitly unexecuted synthetic data', () => {
  assert.equal(serializeGeologyUserScenarios(), frozenText)
  assert.deepEqual(buildGeologyUserScenarios(), frozen)
  assert.deepEqual(frozen.provenance, {
    kind: 'synthetic-human-style-prompts', realUserData: false, privateDrawingContent: false, executionStatus: 'not-run',
  })
  assert.deepEqual(validateGeologyUserScenarios(frozen), {
    count: 1080, standaloneCount: 1020, intents: 187, taskIntentions: 170, sequences: 6,
  })
})

test('questions cover the investigation technician workflow rather than numeric-only geometry variations', () => {
  const families = new Set(frozen.taskCatalog.map(item => item.family))
  for (const family of ['investigation-preparation', 'investigation-point-layout', 'source-query', 'source-water-depth',
    'source-strata', 'source-observation', 'source-section', 'geological-presentation', 'batch-historical-workflow',
    'cad-annotation', 'cad-persistence', 'capability-boundary', 'ambiguity', 'invalid-source']) assert.ok(families.has(family), family)
  assert.equal(new Set(frozen.taskCatalog.map(item => item.id)).size, 170)
  assert.ok(new Set(frozen.taskCatalog.map(item => item.en.replace(/\d+(?:\.\d+)?/g, '#'))).size >= 120)
  for (const language of ['zh-CN', 'en', 'mixed']) assert.ok(frozen.scenarios.some(item => item.language === language))
  for (const interaction of ['direct', 'colloquial', 'followup', 'correction', 'mixed-language', 'sequence-turn']) {
    assert.ok(frozen.scenarios.some(item => item.interaction === interaction), interaction)
  }
})

test('DXF graphic editing is distinct from geology source mutation and missing correlations require clarification', () => {
  const graphicEdit = frozen.scenarios.find(item => item.expected.intent === 'capability-boundary.graphic-water-only-approved')
  assert.equal(graphicEdit.inputKind, 'dxf-graphics')
  assert.equal(graphicEdit.expected.mutation, 'cad-proposal')
  const absentSource = frozen.scenarios.find(item => item.expected.intent === 'capability-boundary.dxf-water-source-missing')
  assert.equal(absentSource.expected.mutation, 'blocked')
  assert.equal(absentSource.expected.clarification.required, true)
  const unknownLinks = frozen.scenarios.find(item => item.expected.intent === 'ambiguity.cross-hole-correlation-unsupplied')
  assert.equal(unknownLinks.expected.mutation, 'none')
  assert.equal(unknownLinks.expected.clarification.required, true)
  for (const scenario of frozen.scenarios.filter(item => item.inputKind === 'dxf-graphics')) {
    assert.ok(!['source-proposal', 'source-commit', 'mixed-proposal'].includes(scenario.expected.mutation), scenario.id)
  }
})

test('six independent ten-turn chains cover review, undo/redo, refresh, mixed edits and export/reopen', () => {
  assert.equal(frozen.sequences.length, 6)
  for (const sequence of frozen.sequences) {
    assert.equal(sequence.independent, true)
    assert.equal(sequence.turnIds.length, 10)
    const turns = sequence.turnIds.map(id => frozen.scenarios.find(item => item.id === id))
    assert.ok(turns[0].prerequisites.includes('sequence:fresh-independent-document-and-chat'))
    turns.forEach((turn, index) => {
      assert.equal(turn.sequence.turn, index + 1)
      assert.equal(turn.sequence.previousTurnId, turns[index - 1]?.id ?? null)
      if (index > 0) assert.ok(turn.prerequisites.includes(`sequence:previous-turn=${turns[index - 1].id}`))
    })
  }
  const sequenceIntents = frozen.scenarios.filter(item => item.sequence).map(item => item.expected.intent)
  for (const intent of ['cad-persistence.undo-latest-commit', 'cad-persistence.redo-latest-undo',
    'session.refresh-committed-source', 'mixed.move-unrelated-circle', 'cad-persistence.export-real-dxf',
    'cad-persistence.reopen-exported-dxf', 'capability-boundary.exported-dxf-recipe-loss']) assert.ok(sequenceIntents.includes(intent), intent)
  const tenChanges = frozen.scenarios.filter(item => item.sequence?.id === 'section-ten-source-revisions')
  assert.equal(tenChanges.length, 10)
  assert.ok(tenChanges.every(item => item.expected.mutation === 'source-proposal'))
})

test('schema validator rejects malformed identity, duplicates, missing preservation and fictional results', () => {
  const changes = [
    ['duplicate ID', value => { value.scenarios[1].id = value.scenarios[0].id }],
    ['duplicate prompt', value => { value.scenarios[1].prompt = value.scenarios[0].prompt }],
    ['missing checks', value => { value.scenarios[0].expected.checks = [] }],
    ['missing preservation', value => { value.scenarios[0].expected.mustPreserve = [] }],
    ['invalid domain', value => { value.scenarios[0].domain = 'unknown' }],
    ['invalid input', value => { value.scenarios[0].inputKind = 'imaginary-source' }],
    ['fake pass record', value => { value.scenarios[0].passed = true }],
    ['fake execution provenance', value => { value.provenance.executionStatus = 'passed' }],
    ['real-user-data claim', value => { value.provenance.realUserData = true }],
    ['wrong total', value => { value.count++ }],
  ]
  for (const [label, change] of changes) {
    const candidate = structuredClone(frozen)
    change(candidate)
    assert.throws(() => validateGeologyUserScenarios(candidate), /Invalid geology user scenario corpus/, label)
  }
})

test('schema validator rejects source fabrication, premature mutation and missing explicit host approval', () => {
  const changes = [
    ['DXF source fabrication', value => {
      value.scenarios.find(item => item.inputKind === 'dxf-graphics').expected.mutation = 'source-proposal'
    }],
    ['ambiguous request writes', value => {
      const scenario = value.scenarios.find(item => item.expected.clarification.required)
      scenario.expected.mutation = 'cad-proposal'
    }],
    ['proposal without approval', value => {
      const scenario = value.scenarios.find(item => item.expected.mutation === 'cad-proposal')
      scenario.expected.checks = scenario.expected.checks.filter(item => item !== 'explicit-host-approval-before-commit')
    }],
    ['source preservation missing', value => {
      const scenario = value.scenarios.find(item => item.expected.mutation === 'source-proposal')
      scenario.expected.mustPreserve = ['something-else']
    }],
  ]
  for (const [label, change] of changes) {
    const candidate = structuredClone(frozen)
    change(candidate)
    assert.throws(() => validateGeologyUserScenarios(candidate), /Invalid geology user scenario corpus/, label)
  }
})

test('schema validator rejects cross-sequence state leaks, missing resets and broken turn chains', () => {
  for (const change of [
    value => { value.sequences[0].independent = false },
    value => { value.scenarios.find(item => item.sequence?.turn === 2).sequence.previousTurnId = value.sequences[1].turnIds[0] },
    value => {
      const first = value.scenarios.find(item => item.sequence?.turn === 1)
      first.prerequisites = first.prerequisites.filter(item => item !== 'sequence:fresh-independent-document-and-chat')
    },
  ]) {
    const candidate = structuredClone(frozen)
    change(candidate)
    assert.throws(() => validateGeologyUserScenarios(candidate), /Invalid geology user scenario corpus/)
  }
})

test('schema validator rejects credential-shaped values and absolute private paths', () => {
  for (const addition of ['sk-' + 'x'.repeat(32), 'C:' + '\\private\\survey.dxf', '/home/person/private-survey.dxf', 'file:///private/survey.dxf']) {
    const candidate = structuredClone(frozen)
    candidate.scenarios[0].prompt += ` ${addition}`
    assert.throws(() => validateGeologyUserScenarios(candidate), /credential-shaped content|private or absolute filesystem path/)
  }
})

test('standalone review HTML includes every expanded question, Chinese workflow navigation and unexecuted status', () => {
  const html = renderGeologyUserScenarioReviewHtml(frozen)
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('<html lang="zh-CN">'))
  assert.ok(html.includes('1080 模拟问题，尚未执行'))
  assert.equal((html.match(/<article class="question"/g) ?? []).length, 1080)
  assert.equal((html.match(/class="not-run">未执行/g) ?? []).length, 1080)
  assert.ok(html.includes('Ctrl+F'))
  for (const label of ['资料核对与勘察纲要', '勘探点布置与孔号点位', '标贯与取样记录', '批量出图与历史文件复核',
    '用户口语指令', '前提资料与状态', '需改变／预期行为', '必须保留', '验收要点', '澄清与不能猜的事项']) assert.ok(html.includes(label), label)
  for (const scenario of frozen.scenarios) assert.ok(html.includes(`id="${scenario.id}"`), scenario.id)
  assert.ok(!/<script\b|<iframe\b|<img\b|<link\b|<details\b/i.test(html))
  assert.ok(!/href="https?:|src="https?:|@import|url\(/i.test(html))
  assert.ok(html.includes('Content-Security-Policy'))
  assert.ok(html.includes("default-src 'none'"))
})

test('review HTML escapes question text, task labels, prerequisites, preservation, checks and clarification', () => {
  const candidate = structuredClone(frozen)
  const payload = '<img src="https://invalid.example/pixel" onerror="alert(1)"><script>alert(2)</script>&\'quoted\''
  candidate.scenarios[0].prompt += ` ${payload}`
  candidate.scenarios[0].prerequisites.push(payload)
  candidate.scenarios[0].expected.mustPreserve.push(payload)
  candidate.scenarios[0].expected.checks.push(payload)
  candidate.taskCatalog[0].zh += payload
  candidate.scenarios.find(item => item.expected.clarification.required).expected.clarification.questions.push(payload)
  const html = renderGeologyUserScenarioReviewHtml(candidate)
  assert.ok(!html.includes(payload))
  assert.ok(!/<img\b|<script\b|\bonerror="/i.test(html))
  assert.ok(html.includes('&lt;img src=&quot;https://invalid.example/pixel&quot; onerror=&quot;alert(1)&quot;&gt;'))
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;&amp;&#39;quoted&#39;'))
  assert.ok((html.match(/&lt;script&gt;alert\(2\)&lt;\/script&gt;/g) ?? []).length >= 6)
})
