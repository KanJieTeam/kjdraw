import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIXTURE_URL, validateGeologyUserScenarios } from './generate-geology-user-scenarios.mjs'
import { PUBLIC_FIXTURE_IDS, BUILDABLE_PREREQUISITES, buildPublicScenarioFixture, fixtureStateSignature,
  scenarioFixtureInputBindings as baseScenarioFixtureInputBindings } from './helpers/geology-scenario-fixtures.mjs'
import { NEXT_SCENARIO_DESCRIPTORS, NEXT_ORACLE_SCENARIO_IDS, assessNextScenarioReadiness, nextScenarioDescriptor,
  buildNextScenarioFixture, nextScenarioFixtureInputBindings, nextScenarioAnswerFrame, expectedNextScenarioAnswer,
  expectedNextScenarioOutcome, evaluateNextScenarioOracle } from './helpers/geology-next-scenario-oracles.mjs'
import { ROUND3_SCENARIO_DESCRIPTORS, ROUND3_ORACLE_SCENARIO_IDS, assessRound3ScenarioReadiness, round3ScenarioDescriptor,
  buildRound3ScenarioFixture, round3ScenarioFixtureInputBindings, round3ScenarioAnswerFrame, expectedRound3ScenarioAnswer,
  expectedRound3ScenarioOutcome, evaluateRound3ScenarioOracle } from './helpers/geology-round3-scenario-oracles.mjs'
import { HISTORY_SCENARIO_DESCRIPTORS, HISTORY_ORACLE_SCENARIO_IDS, assessHistoryScenarioReadiness, historyScenarioDescriptor,
  buildHistoryScenarioFixture, historyScenarioInputBindings, historyScenarioAnswerFrame, expectedHistoryScenarioAnswer,
  expectedHistoryScenarioOutcome, evaluateHistoryScenarioOracle } from './helpers/geology-history-scenario-oracles.mjs'
import { ROUND4_NATIVE_DESCRIPTORS, ROUND4_NATIVE_SCENARIO_IDS, assessRound4NativeReadiness, round4NativeDescriptor,
  buildRound4NativeFixture, round4NativeInputBindings, round4NativeAnswerFrame, expectedRound4NativeAnswer,
  expectedRound4NativeOutcome, evaluateRound4NativeOracle } from './helpers/geology-round4-native-oracles.mjs'
import { ROUND5_INVENTORY_DESCRIPTORS, ROUND5_INVENTORY_SCENARIO_IDS, assessRound5InventoryReadiness, round5InventoryDescriptor,
  buildRound5InventoryFixture, round5InventoryInputBindings, round5InventoryAnswerFrame, expectedRound5InventoryAnswer,
  expectedRound5InventoryOutcome, evaluateRound5InventoryOracle } from './helpers/geology-round5-inventory-oracles.mjs'
import { SUPPLIED_CREATION_DESCRIPTORS, SUPPLIED_CREATION_SCENARIO_IDS, assessSuppliedCreationReadiness, suppliedCreationDescriptor,
  buildSuppliedCreationFixture, suppliedCreationInputBindings, expectedSuppliedCreationOutcome,
  evaluateSuppliedCreationOracle } from './helpers/geology-supplied-creation-oracles.mjs'
import { ROUND6_SOURCE_WORKFLOW_DESCRIPTORS, ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS,
  assessRound6SourceWorkflowReadiness, round6SourceWorkflowDescriptor, buildRound6SourceWorkflowFixture,
  round6SourceWorkflowInputBindings, expectedRound6SourceWorkflowOutcome,
  evaluateRound6SourceWorkflowOracle } from './helpers/geology-round6-source-workflow-oracles.mjs'
import { ROUND7_POINT_PLAN_DESCRIPTORS, ROUND7_POINT_PLAN_SCENARIO_IDS, assessRound7PointPlanReadiness,
  round7PointPlanDescriptor, buildRound7PointPlanFixture, round7PointPlanInputBindings,
  expectedRound7PointPlanOutcome, evaluateRound7PointPlanOracle } from './helpers/geology-round7-point-plan-oracles.mjs'
import { canonicalStringify } from '../../packages/kjdraw-sdk/src/utils.js'
import { readGeologyDrawingRecipe, prepareGeologyDrawingRevision } from '../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { isGeologyAnswerContractV4Scenario, geologyAnswerContractV4Frame, evaluateGeologyAnswerContractV4 } from './helpers/geology-answer-contract-v4.mjs'

const frozen = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
validateGeologyUserScenarios(frozen)
const INITIAL_INTENTS = Object.freeze([
  'cad-query.inventory', 'cad-query.exact-hole-label', 'cad-query.partial-label', 'cad-query.raw-mtext',
  'cad-annotation.replace-native-text', 'cad-annotation.printed-depth-only', 'cad-annotation.printed-water-labels',
  'cad-transform.move-exact-objects', 'cad-transform.rotate-selected-detail', 'cad-transform.circle-radius',
  'source-water-depth.paired-water-revision', 'source-water-depth.collar-elevation-revision', 'source-water-depth.extend-total-depth',
  'source-strata.shift-adjacent-boundary', 'source-strata.rename-and-reclassify',
  'source-observation.add-sample', 'source-observation.revise-spt-value',
  'source-section.one-hole-depth', 'source-section.multi-hole-water', 'source-section.one-hole-collar',
])
export const INITIAL_BATCH_SCENARIO_IDS = Object.freeze(INITIAL_INTENTS.map(intent => {
  const scenario = frozen.scenarios.find(item => item.expected.intent === intent && item.interaction === 'direct' && item.language === 'zh-CN')
  if (!scenario) throw new Error(`Initial oracle scenario missing: ${intent}`)
  return scenario.id
}))
const NEXT_INTENTS = Object.freeze([
  'source-water-depth.initial-water-revision', 'source-water-depth.clear-initial-water', 'source-water-depth.clear-stable-water',
  'source-strata.merge-supplied-intervals', 'source-strata.remove-explicit-stratum', 'source-strata.redistribute-layer-thickness',
  'source-section.split-with-explicit-correlations', 'source-section.remove-link-unrelated-occurrences',
  'invalid-source.negative-water-depth', 'ambiguity.thickness-target-unspecified',
  'source-water-depth.stable-water-revision',
  'source-observation.move-sample-depth', 'source-observation.remove-sample', 'source-observation.add-spt',
  'source-observation.remove-spt', 'source-observation.sample-display-label', 'source-observation.sample-marker-style',
  'source-observation.clear-observations', 'source-strata.source-backed-description', 'source-strata.boundary-only-display',
  'cad-annotation.model-title-label', 'cad-annotation.batch-label-renaming', 'cad-annotation.mtext-paragraph-replacement',
  'source-query.list-source-recipes', 'source-query.read-exact-hole', 'source-query.read-strata-intervals',
  'source-query.read-two-water-levels', 'source-query.water-depth-to-elevation', 'source-query.read-measured-observations',
  'source-query.read-exact-correlations',
  'invalid-source.inverted-interval', 'invalid-source.interval-gap', 'invalid-source.interval-overlap',
  'invalid-source.duplicate-interval-identity', 'invalid-source.hole-depth-mismatch',
  'invalid-source.observation-outside-hole', 'invalid-source.clear-and-set-same-field',
  'cad-transform.crossing-window-stretch', 'cad-structure.relayer-confirmed-objects',
  'cad-structure.insert-polyline-vertex', 'cad-structure.edit-polyline-bulge', 'cad-structure.edit-polyline-width',
  'source-water-depth.shorten-total-depth', 'source-water-depth.section-station-revision',
  'source-strata.complete-strata-replacement', 'source-observation.replace-observation-list',
  'source-query.read-missing-source-fields', 'source-query.source-cad-unit-separation',
])
const extensionDescriptors = Object.freeze([
  ...NEXT_SCENARIO_DESCRIPTORS, ...ROUND3_SCENARIO_DESCRIPTORS, ...HISTORY_SCENARIO_DESCRIPTORS,
  ...ROUND4_NATIVE_DESCRIPTORS, ...ROUND5_INVENTORY_DESCRIPTORS, ...SUPPLIED_CREATION_DESCRIPTORS,
  ...ROUND6_SOURCE_WORKFLOW_DESCRIPTORS,
  ...ROUND7_POINT_PLAN_DESCRIPTORS,
])
const extensionIntents = extensionDescriptors.map(item => item.intent)
export const NEXT_BATCH_SCENARIO_IDS = Object.freeze([...NEXT_INTENTS, ...extensionIntents]
  .map(intent => frozen.scenarios.find(item => item.expected.intent === intent && item.interaction === 'direct' && item.language === 'zh-CN').id))
const verifiedIntents = new Set([...INITIAL_INTENTS, ...NEXT_INTENTS, ...extensionIntents])
export const VERIFIED_SCENARIO_IDS = Object.freeze(frozen.scenarios.filter(item => !item.sequence && verifiedIntents.has(item.expected.intent)).map(item => item.id))
const verifiedScenarios = new Set(VERIFIED_SCENARIO_IDS)
const prerequisites = new Set([...BUILDABLE_PREREQUISITES,
  ...extensionDescriptors.flatMap(item => item.supportedPrerequisites)])
const readProfiles = new Map([
  ['cad-query.inventory', { id: 'native-inventory-v1', answerKind: 'entity-counts', tools: ['cad_query_drawing', 'cad_read_page'] }],
  ['cad-query.exact-hole-label', { id: 'exact-native-label-v1', answerKind: 'exact-label-matches', tools: ['cad_find_text'] }],
  ['cad-query.partial-label', { id: 'contains-native-label-v1', answerKind: 'contains-label-matches', tools: ['cad_find_text'] }],
  ['cad-query.raw-mtext', { id: 'complete-raw-mtext-v1', answerKind: 'complete-native-mtext', tools: ['cad_query_drawing', 'cad_read_page'] }],
  ...NEXT_INTENTS.filter(intent => intent.startsWith('source-query.')).map(intent => [intent, {
    id: `${intent}-exact-retained-source-v1`, answerKind: intent.slice('source-query.'.length), kind: 'source-read', tools: ['cad_read_geology_source'],
    fixtureBranch: ({ 'source-query.read-missing-source-fields': 'optional-water-and-description-absent',
      'source-query.source-cad-unit-separation': 'explicit-source-page-scale' })[intent],
  }]),
])
const nativeReadTools = new Set(['cad_read_drawing', 'cad_query_drawing', 'cad_read_page', 'cad_find_text'])
const mutationProfiles = new Map([
  ['cad-annotation.replace-native-text', { id: 'exact-text-edit-v1', kind: 'cad', targets: ['TEXT-A'] }],
  ['cad-annotation.printed-depth-only', { id: 'graphic-depth-label-v1', kind: 'cad', targets: ['DEPTH-A'] }],
  ['cad-annotation.printed-water-labels', { id: 'graphic-water-label-pair-v1', kind: 'cad', targets: ['WATER-INITIAL-A', 'WATER-STABLE-A'] }],
  ['cad-annotation.model-title-label', { id: 'exact-model-title-v1', kind: 'cad', targets: ['TITLE-A'] }],
  ['cad-annotation.batch-label-renaming', { id: 'exact-batch-labels-v1', kind: 'cad', targets: ['TEXT-A', 'TEXT-B'] }],
  ['cad-annotation.mtext-paragraph-replacement', { id: 'exact-mtext-paragraphs-v1', kind: 'cad', targets: ['MTEXT-B'], fixtureBranch: 'mtext-awaiting-explicit-replacement' }],
  ['cad-transform.move-exact-objects', { id: 'native-line-text-move-v1', kind: 'cad', targets: ['LINE-A', 'TEXT-A'] }],
  ['cad-transform.rotate-selected-detail', { id: 'native-two-line-rotation-v1', kind: 'cad', targets: ['LINE-A', 'LINE-B'] }],
  ['cad-transform.circle-radius', { id: 'native-circle-radius-v1', kind: 'cad', targets: ['CIRCLE-A'] }],
  ['cad-transform.crossing-window-stretch', { id: 'native-window-stretch-v1', kind: 'cad', targets: ['POLY-A'] }],
  ['cad-structure.relayer-confirmed-objects', { id: 'native-exact-relayer-v1', kind: 'cad', targets: ['LINE-A', 'TEXT-A'], fixtureBranch: 'existing-review-layer' }],
  ...['insert-polyline-vertex', 'edit-polyline-bulge', 'edit-polyline-width'].map(name => [`cad-structure.${name}`, {
    id: `native-${name}-v1`, kind: 'cad', targets: ['POLY-A'],
  }]),
  ...[...INITIAL_INTENTS, ...NEXT_INTENTS].filter(intent => intent.startsWith('source-') && !intent.startsWith('source-query.')).map(intent => [intent, { id: `${intent}-exact-source-v1`, kind: 'source', targets: [],
    fixtureBranch: ({ 'source-strata.merge-supplied-intervals': 'two-contiguous-sand-intervals',
      'source-section.split-with-explicit-correlations': 'complete-split-and-correlation-table',
      'source-observation.sample-marker-style': 'declared-sample-marker-style',
      'source-strata.complete-strata-replacement': 'complete-confirmed-replacement-table',
      'source-observation.replace-observation-list': 'complete-confirmed-observation-list',
      'source-section.remove-link-unrelated-occurrences': 'complete-occurrence-map' })[intent] }]),
])
const failClosedProfiles = new Map([
  ['invalid-source.negative-water-depth', { id: 'negative-water-depth-fail-closed-v1', answerKind: 'explicit-blocker', kind: 'fail-closed' }],
  ['ambiguity.thickness-target-unspecified', { id: 'unspecified-interval-thickness-clarification-v1', answerKind: 'exact-missing-input-fields', kind: 'fail-closed' }],
  ...NEXT_INTENTS.filter(intent => intent.startsWith('invalid-source.') && intent !== 'invalid-source.negative-water-depth').map(intent => [intent, {
    id: `${intent}-native-rejection-v1`, answerKind: 'explicit-blocker', kind: 'fail-closed',
  }]),
])
export const FAIL_CLOSED_ANSWER_FRAME = '{"documentId":"current native document ID","revision":0,"decision":"blocked or clarification-required","issue":{"field":"source field name or exact source interval path","suppliedValue":"actual supplied invalid value or structured values","constraint":{"minimum":0,"maximum":0,"relation":"symbolic source-field relation","unique":false,"mutuallyExclusive":["operation names"],"units":"source units"}},"missingFields":["native schema field path"],"questions":[{"field":"native schema field path","question":"question"}]} (choose the actual decision after reading; issue may be null if no invalid value was supplied. Include only applicable constraint keys. Use cad_propose_geology_revision native field paths such as updates[].initialWaterDepth or updates[].strata[].bottom, never invented verdict names. Preserve actual JSON value types.)'
/** Output protocol only: placeholders never supply an expected decision or target. */
export function scenarioAnswerFrame(value, { answerContractVersion = 'v3' } = {}) {
  const scenario = resolveScenario(value), profile = readProfiles.get(scenario.expected.intent)
  if (['v4', 'v5'].includes(answerContractVersion) && isGeologyAnswerContractV4Scenario(scenario)) return geologyAnswerContractV4Frame(scenario)
  if (nextScenarioDescriptor(scenario)) return nextScenarioAnswerFrame(scenario)
  if (round3ScenarioDescriptor(scenario)) return round3ScenarioAnswerFrame(scenario)
  if (historyScenarioDescriptor(scenario)) return historyScenarioAnswerFrame(scenario)
  if (round4NativeDescriptor(scenario)) return round4NativeAnswerFrame(scenario)
  if (round5InventoryDescriptor(scenario)) return round5InventoryAnswerFrame(scenario)
  if (failClosedProfiles.has(scenario.expected.intent)) return FAIL_CLOSED_ANSWER_FRAME
  if (profile?.kind === 'source-read') return ({
    'list-source-recipes': '{"drawingIds":["actual retained drawing ID"],"sourceBacked":false}',
    'read-exact-hole': '{"holeId":"actual hole ID","collarElevation":0,"depth":0,"units":"source units"}',
    'read-strata-intervals': '{"holeId":"actual hole ID","strata":[{"intervalId":"actual interval ID","code":"source code","name":"source name","lithology":"source lithology","top":0,"bottom":0}]}',
    'read-two-water-levels': '{"holeId":"actual hole ID","initialWaterDepth":0,"stableWaterDepth":0,"units":"source units"}',
    'water-depth-to-elevation': '{"holeId":"actual hole ID","collarElevation":0,"stableWaterDepth":0,"stableWaterElevation":0,"sourceConvention":"exact depthConvention code returned by cad_read_geology_source","units":"source units"}',
    'read-measured-observations': '{"holeId":"actual hole ID","observations":[{"kind":"source kind","id":"source ID","depth":0,"value":0}]} (include only fields actually present in each source record)',
    'read-exact-correlations': '{"correlations":[{"fromHoleId":"source hole ID","toHoleId":"source hole ID","fromIntervalId":"source interval ID","toIntervalId":"source interval ID"}],"uncorrelatedOccurrences":[]}',
    'read-missing-source-fields': '{"holeId":"actual hole ID","missingFields":["actual absent native source field path"]}',
    'source-cad-unit-separation': '{"holeId":"actual hole ID","sourceUnits":"source units","cadUnits":"CAD units","verticalScaleDenominator":0,"sourceDepth":0,"sourceDepthInMillimetres":0,"plottedDepthMillimetres":0}',
  })[profile.answerKind]
  if (profile?.answerKind === 'entity-counts') return '{"entityCounts":{"ENTITY_TYPE":0}}'
  if (profile?.answerKind === 'complete-native-mtext') return '{"id":"native object ID","text":"complete raw text"}'
  if (profile) return '{"matches":[{"id":"native object ID","handle":"native handle","text":"complete raw text","layerId":"native layer ID","layerName":"native layer name","position":[0,0,0]}]}'
  return null
}
export const IMPLEMENTED_ORACLE_CHECKS = Object.freeze([
  'current-document-revision-checked', 'no-success-claim-without-state-or-artifact-evidence', 'read-only-state-unchanged',
  'inventory-complete-or-explicit-pagination', 'literal-exact-text-match', 'all-pages-searched',
  'literal-contains-match', 'case-policy-explicit', 'complete-raw-text-without-truncation',
  'exact-expected-text-match', 'text-position-and-handle-preserved', 'full-before-after-preview',
  'explicit-host-approval-before-commit', 'no-mutation-during-preview', 'graphic-edit-not-source-revision',
  'water-labels-distinguished', 'source-capability-not-fabricated', 'exact-displacement', 'stable-entity-identity',
  'explicit-rotation-center', 'signed-angle-correct', 'radius-positive', 'circle-center-preserved',
  'paired-water-update-atomic', 'read-retained-source-before-revision', 'source-before-after-diff-visible',
  'generated-native-geometry-matches-source', 'collar-change-not-layer-depth-change', 'depth-and-final-bottom-consistent',
  'shared-boundary-updated-on-both-sides', 'name-and-lithology-both-explicit', 'observation-append-preserves-existing',
  'spt-value-not-depth-change', 'unrequested-holes-unchanged', 'multi-hole-update-atomic', 'one-hole-elevation-derived-geometry',
  'only-initial-water-field-changed', 'optional-water-cleared-not-zero', 'cleared-marker-removed-with-source',
  'merge-authorized-not-inferred', 'deleted-interval-coverage-explicit', 'layer-thickness-not-global-scale',
  'correlation-coverage-updated-after-split', 'uncorrelated-occurrence-coverage-explicit',
  'negative-depth-rejected', 'explicit-blocker-reported', 'no-partial-mutation', 'no-fabricated-geology-facts',
  'no-mutation-before-clarification', 'layer-identity-and-coverage-clarified',
  'only-stable-water-field-changed', 'sample-id-stable-depth-only', 'exact-observation-deletion', 'spt-depth-and-value-explicit',
  'spt-source-and-marker-removed-together', 'observation-label-not-identity', 'declared-sample-marker-style',
  'explicit-observation-clear-not-missing-default', 'description-provenance-explicit', 'display-policy-not-lithology-change',
  'title-target-exact', 'unrequested-title-fields-preserved', 'atomic-text-batch', 'all-before-texts-verified',
  'native-mtext-paragraph-semantics', 'recipe-discovery-not-title-inference', 'exact-hole-source-identity',
  'all-source-intervals-preserved', 'initial-stable-water-distinguished', 'elevation-equals-collar-minus-depth',
  'metre-units-explicit', 'missing-observations-not-invented', 'explicit-correlation-identities',
  'interval-bottom-greater-than-top', 'interval-gap-rejected', 'interval-overlap-rejected', 'duplicate-interval-id-rejected',
  'hole-depth-interval-coverage-consistent', 'observation-within-hole-depth', 'clear-set-conflict-rejected',
  'only-hit-vertices-move', 'bulges-widths-and-z-preserved', 'exact-existing-layer-id', 'only-layer-property-changed',
  'zero-based-index', 'segment-split-preserves-shape', 'signed-bulge-semantics', 'per-segment-widths-only',
  'trim-only-explicit-final-interval', 'retained-observations-within-depth', 'station-changes-horizontal-position-only',
  'complete-array-replacement-preserves-unrequested-items', 'complete-observation-array-not-partial-patch',
  'optional-missing-fields-remain-absent', 'source-metres-cad-millimetres-separated',
  ...NEXT_SCENARIO_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...ROUND3_SCENARIO_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...HISTORY_SCENARIO_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...ROUND4_NATIVE_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...ROUND5_INVENTORY_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...SUPPLIED_CREATION_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...ROUND6_SOURCE_WORKFLOW_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
  ...ROUND7_POINT_PLAN_DESCRIPTORS.flatMap(descriptor => descriptor.checks),
])
const mappedChecks = new Set(IMPLEMENTED_ORACLE_CHECKS)
const preservedByExactState = new Set(['untargeted-native-entities', 'untargeted-layers', 'native-handles-and-references', 'drawing-units-and-owner-spaces',
  'unrequested-borehole-facts', 'unchanged-interval-identities', 'unrelated-manual-entities', 'source-recipe-identity', 'source-metre-and-cad-millimetre-units'])
const BASE_ACTIONS = Object.freeze(['load-public-synthetic-document', 'read-native-agent-tools', 'capture-native-document-state', 'collect-structured-model-answer', 'seed-unexecuted-conversation-context',
  'capture-complete-pending-proposal', 'present-preview-for-human-review'])

function resolveScenario(value) {
  if (typeof value !== 'string') return value
  const scenario = frozen.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen scenario ID: ${value}`)
  return scenario
}

function oracleProfile(intent) { return readProfiles.get(intent) ?? mutationProfiles.get(intent) ?? failClosedProfiles.get(intent) ?? nextScenarioDescriptor(intent) ?? round3ScenarioDescriptor(intent) ?? historyScenarioDescriptor(intent) ?? round4NativeDescriptor(intent) ?? round5InventoryDescriptor(intent) ?? suppliedCreationDescriptor(intent) ?? round6SourceWorkflowDescriptor(intent) ?? round7PointPlanDescriptor(intent) }

function fixtureIdFor(scenario) {
  return scenario.prerequisites.findLast(item => PUBLIC_FIXTURE_IDS.some(id => item === `fixture:${id}`))?.slice(8) ?? null
}

function requiredActions(scenario) {
  const actions = ['load-public-synthetic-document', 'read-native-agent-tools', 'capture-native-document-state', 'collect-structured-model-answer']
  if (scenario.prerequisites.some(item => item.startsWith('conversation:'))) actions.push('seed-unexecuted-conversation-context')
  if (scenario.expected.mutation.endsWith('-proposal')) actions.push('capture-complete-pending-proposal', 'present-preview-for-human-review')
  if (scenario.expected.mutation.endsWith('-commit') || scenario.expected.mutation === 'proposal-discard') actions.push('trusted-current-host-approval-or-rejection')
  if (scenario.expected.mutation === 'local-session') actions.push('browser-session-save-refresh-reopen')
  if (scenario.expected.mutation === 'export') actions.push('download-current-artifact-and-reopen')
  if (scenario.sequence) actions.push('independent-multi-turn-sequence-driver')
  return actions
}

/** Execution preparation only. A runnable row is not a passed user question. */
export function assessScenarioReadiness(value, { availableActions = BASE_ACTIONS, fixtureProbes = null } = {}) {
  const scenario = resolveScenario(value), fixtureId = fixtureIdFor(scenario)
  const profile = verifiedScenarios.has(scenario.id) ? oracleProfile(scenario.expected.intent) : null
  const missingPrerequisites = scenario.prerequisites.filter(item => !prerequisites.has(item))
  const unmappedChecks = scenario.expected.checks.filter(item => !mappedChecks.has(item))
  const unmappedPreservation = scenario.expected.mustPreserve.filter(item => !preservedByExactState.has(item))
  const actions = requiredActions(scenario), actionSet = new Set(availableActions)
  const unavailableActions = actions.filter(item => !actionSet.has(item))
  const probe = fixtureProbes?.find(item => item.fixtureId === fixtureId && (item.branch ?? undefined) === profile?.fixtureBranch)
  const fixtureReady = !!fixtureId && (fixtureProbes === null || probe?.status === 'built-and-validated')
  const reasons = []
  if (scenario.expected.intent === 'cad-annotation.printed-water-labels') reasons.push({
    code: 'task-literal-target-semantics-unconfirmed', items: [scenario.expected.intent],
    message: 'The frozen task does not resolve whether 2.50/4.50 replace each entire label or only its numeric depth. The input labels contain prefixes; this needs independently confirmed task scope, not a looser oracle after observing failures.',
  })
  if (!fixtureId) reasons.push({ code: 'fixture-builder-missing', items: scenario.prerequisites.filter(item => item.startsWith('fixture:')), message: '没有匹配的真实 fixture 构建器。' })
  else if (!fixtureReady) reasons.push({ code: 'fixture-builder-probe-failed', items: [fixtureId], message: probe?.error ?? 'fixture 尚未实际构建验证。' })
  if (missingPrerequisites.length) reasons.push({ code: 'prerequisite-branch-not-built', items: missingPrerequisites, message: '前提分支只有文字描述，尚无可验证的构建器。' })
  if (!profile) reasons.push({ code: 'exact-outcome-oracle-not-implemented', items: [scenario.expected.intent], message: '尚无完整期望数据及已验证的实际结果 oracle；不把描述字符串当验收。' })
  if (unmappedChecks.length) reasons.push({ code: 'check-oracle-not-mapped', items: unmappedChecks, message: '这些验收项尚未映射至可执行判据。' })
  if (unmappedPreservation.length) reasons.push({ code: 'preservation-oracle-not-mapped', items: unmappedPreservation, message: '来源或其他状态的精确保留判据尚未实现。' })
  if (unavailableActions.length) reasons.push({ code: 'host-session-export-action-not-available', items: unavailableActions, message: '本地确认、浏览器会话或导出重开动作尚无执行适配器。' })
  if (nextScenarioDescriptor(scenario) && assessNextScenarioReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessNextScenarioReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'The additive next oracle does not implement these scenario-specific prerequisite branches.' })
  }
  if (round3ScenarioDescriptor(scenario) && assessRound3ScenarioReadiness(scenario).status !== 'runnable') {
    const readiness = assessRound3ScenarioReadiness(scenario)
    reasons.push({ code: 'prerequisite-branch-not-built', items: readiness.unsupportedPrerequisites ?? [],
      message: readiness.reason ?? 'The round3 native oracle does not implement these scenario-specific prerequisites.' })
  }
  if (historyScenarioDescriptor(scenario) && assessHistoryScenarioReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessHistoryScenarioReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'The history driver requires actual reviewed native history prerequisites.' })
  }
  if (round4NativeDescriptor(scenario) && assessRound4NativeReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessRound4NativeReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'The round4 driver requires an actually exported and reopened native DXF fixture.' })
  }
  if (round5InventoryDescriptor(scenario) && assessRound5InventoryReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessRound5InventoryReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'The round5 driver requires actually reopened native layer, selection or historical-note inputs.' })
  }
  if (suppliedCreationDescriptor(scenario) && assessSuppliedCreationReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessSuppliedCreationReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'The creation driver requires a real blank millimetre document and complete caller-declared source facts.' })
  }
  if (round6SourceWorkflowDescriptor(scenario) && assessRound6SourceWorkflowReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessRound6SourceWorkflowReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'This source workflow requires complete caller-declared facts and its actual blank or reopened native document.' })
  }
  if (round7PointPlanDescriptor(scenario) && assessRound7PointPlanReadiness(scenario).status !== 'runnable') {
    reasons.push({ code: 'prerequisite-branch-not-built', items: assessRound7PointPlanReadiness(scenario).unsupportedPrerequisites ?? [],
      message: 'Point-plan creation requires an actual blank millimetre host and complete caller-declared metre point, route and scale facts.' })
  }
  return {
    id: scenario.id, intent: scenario.expected.intent, status: reasons.length ? 'not-ready' : 'runnable', reasons,
    readiness: { fixtureBuilder: { ready: fixtureReady, fixtureId, actualProbePerformed: fixtureProbes !== null },
      prerequisites: { ready: !missingPrerequisites.length, missing: missingPrerequisites },
      exactExpectedData: { ready: !!profile, oracleId: profile?.id ?? null, answerKind: profile?.answerKind ?? null },
      oracleChecks: { ready: !unmappedChecks.length && !unmappedPreservation.length, mapped: scenario.expected.checks.filter(item => mappedChecks.has(item)), unmapped: unmappedChecks, unmappedPreservation },
      hostActions: { ready: !unavailableActions.length, required: actions, unavailable: unavailableActions } },
    executionStatus: 'not-run', scenarioPassed: null, modelCalls: 0,
  }
}

export async function buildScenarioFixture(value) {
  const scenario = resolveScenario(value), fixtureId = fixtureIdFor(scenario)
  if (nextScenarioDescriptor(scenario)) return buildNextScenarioFixture(scenario)
  if (round3ScenarioDescriptor(scenario)) return buildRound3ScenarioFixture(scenario)
  if (historyScenarioDescriptor(scenario)) return buildHistoryScenarioFixture(scenario)
  if (round4NativeDescriptor(scenario)) return buildRound4NativeFixture(scenario)
  if (round5InventoryDescriptor(scenario)) return buildRound5InventoryFixture(scenario)
  if (suppliedCreationDescriptor(scenario)) return buildSuppliedCreationFixture(scenario)
  if (round6SourceWorkflowDescriptor(scenario)) return buildRound6SourceWorkflowFixture(scenario)
  if (round7PointPlanDescriptor(scenario)) return buildRound7PointPlanFixture(scenario)
  const missing = scenario.prerequisites.filter(item => !prerequisites.has(item))
  if (missing.length) throw new Error(`Unimplemented prerequisite branches: ${missing.join(', ')}`)
  if (!fixtureId) throw new Error('No implemented fixture builder')
  return buildPublicScenarioFixture(fixtureId, { prerequisites: scenario.prerequisites, branch: oracleProfile(scenario.expected.intent)?.fixtureBranch })
}

export function scenarioFixtureInputBindings(fixture) {
  if (fixture.suppliedCreationOracleId) return suppliedCreationInputBindings(fixture)
  if (fixture.round6SourceWorkflowOracleId) return round6SourceWorkflowInputBindings(fixture)
  if (fixture.round7PointPlanOracleId) return round7PointPlanInputBindings(fixture)
  if (fixture.round5InventoryOracleId) return round5InventoryInputBindings(fixture)
  if (fixture.round4NativeOracleId) return round4NativeInputBindings(fixture)
  if (fixture.historyOracleId) return historyScenarioInputBindings(fixture)
  if (fixture.round3OracleDescriptorId) return round3ScenarioFixtureInputBindings(fixture)
  return fixture.nextOracleDescriptorId ? nextScenarioFixtureInputBindings(fixture) : baseScenarioFixtureInputBindings(fixture)
}

function equality(actual, expected) { return canonicalStringify(actual) === canonicalStringify(expected) }
// The next protocol version compares equivalent unit spellings, not English
// dialects. Only named unit fields are normalized; quantities, names, source
// conventions and every other payload field remain exact. Historical reports
// produced before this protocol change remain untouched.
export function normalizeScenarioAnswerUnits(value) {
  if (Array.isArray(value)) return value.map(normalizeScenarioAnswerUnits)
  if (!value || typeof value !== 'object') return value
  const aliases = new Map([['meter', 'meter'], ['metre', 'meter'], ['m', 'meter'],
    ['millimeter', 'millimeter'], ['millimetre', 'millimeter'], ['mm', 'millimeter']])
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['units', 'sourceUnits', 'cadUnits'].includes(key) && typeof item === 'string'
      ? aliases.get(item) ?? item : normalizeScenarioAnswerUnits(item)]))
}
function sortedMatches(matches) { return [...matches].sort((a, b) => a.id.localeCompare(b.id)) }

/** Independent expected data from declared synthetic facts, bound to real DXF handles. */
export function expectedScenarioAnswer(value, fixture) {
  const scenario = resolveScenario(value)
  if (!verifiedScenarios.has(scenario.id)) throw new Error('Exact answer oracle is not verified for this scenario')
  if (nextScenarioDescriptor(scenario)) return expectedNextScenarioAnswer(scenario, fixture)
  if (round3ScenarioDescriptor(scenario)) return expectedRound3ScenarioAnswer(scenario, fixture)
  if (historyScenarioDescriptor(scenario)) return expectedHistoryScenarioAnswer(scenario, fixture)
  if (round4NativeDescriptor(scenario)) return expectedRound4NativeAnswer(scenario, fixture)
  if (round5InventoryDescriptor(scenario)) return expectedRound5InventoryAnswer(scenario, fixture)
  const profile = readProfiles.get(scenario.expected.intent)
  if (failClosedProfiles.has(scenario.expected.intent)) {
    const detail = ({
      'invalid-source.negative-water-depth': { issue: { field: 'initialWaterDepth', suppliedValue: -2, constraint: { minimum: 0, units: 'metre' } }, missingFields: ['updates[].initialWaterDepth'] },
      'invalid-source.inverted-interval': { issue: { field: 'strata.I-CLAY', suppliedValue: { top: 10, bottom: 3 }, constraint: { relation: 'bottom>top', units: 'metre' } }, missingFields: ['updates[].strata[].top', 'updates[].strata[].bottom'] },
      'invalid-source.interval-gap': { issue: { field: 'strata.I-FILL/I-CLAY', suppliedValue: { previousBottom: 3, nextTop: 4 }, constraint: { relation: 'previousBottom=nextTop', units: 'metre' } }, missingFields: ['updates[].strata[].top', 'updates[].strata[].bottom'] },
      'invalid-source.interval-overlap': { issue: { field: 'strata.I-FILL/I-CLAY', suppliedValue: { previousBottom: 5, nextTop: 3 }, constraint: { relation: 'previousBottom=nextTop', units: 'metre' } }, missingFields: ['updates[].strata[].top', 'updates[].strata[].bottom'] },
      'invalid-source.duplicate-interval-identity': { issue: { field: 'strata.intervalId', suppliedValue: ['I-CLAY', 'I-CLAY'], constraint: { unique: true } }, missingFields: ['updates[].strata[].intervalId'] },
      'invalid-source.hole-depth-mismatch': { issue: { field: 'depth/strata.last.bottom', suppliedValue: { depth: 12, lastBottom: 18 }, constraint: { relation: 'depth=lastBottom', units: 'metre' } }, missingFields: ['updates[].depth', 'updates[].strata[].bottom'] },
      'invalid-source.observation-outside-hole': { issue: { field: 'observations.S-OUT.depth', suppliedValue: 25, constraint: { minimum: 0, maximum: 18, units: 'metre' } }, missingFields: ['updates[].observations[].depth'] },
      'invalid-source.clear-and-set-same-field': { issue: { field: 'stableWaterDepth', suppliedValue: { set: 4.5, clear: true }, constraint: { mutuallyExclusive: ['set', 'clear'] } }, missingFields: ['updates[].stableWaterDepth', 'updates[].clearFields'] },
    })[scenario.expected.intent]
    return { documentId: fixture.document.id, revision: fixture.initialRevision, decision: detail ? 'blocked' : 'clarification-required',
      issue: detail?.issue ?? null, missingFields: detail?.missingFields ?? ['intervalId', 'newDepthOrThickness', 'adjacentIntervalTreatment'] }
  }
  if (!profile) throw new Error('No exact answer oracle')
  if (profile.kind === 'source-read') {
    const input = fixture.source.input, hole = fixture.source.kind === 'column' ? input.hole : input.holes.find(item => item.id === 'TEST-A')
    const holeId = hole.id
    if (profile.answerKind === 'list-source-recipes') return { drawingIds: [fixture.drawingId], sourceBacked: true }
    if (profile.answerKind === 'read-exact-hole') return { holeId, collarElevation: hole.collarElevation, depth: hole.depth, units: 'metre' }
    if (profile.answerKind === 'read-strata-intervals') return { holeId, strata: structuredClone(hole.strata) }
    if (profile.answerKind === 'read-two-water-levels') return { holeId, initialWaterDepth: hole.initialWaterDepth, stableWaterDepth: hole.stableWaterDepth, units: 'metre' }
    if (profile.answerKind === 'water-depth-to-elevation') return { holeId, collarElevation: hole.collarElevation, stableWaterDepth: hole.stableWaterDepth,
      stableWaterElevation: hole.collarElevation - hole.stableWaterDepth, sourceConvention: 'depth-below-collar', units: 'metre' }
    if (profile.answerKind === 'read-measured-observations') return { holeId, observations: structuredClone(hole.observations) }
    if (profile.answerKind === 'read-exact-correlations') return { correlations: structuredClone(input.correlations), uncorrelatedOccurrences: structuredClone(input.uncorrelatedOccurrences ?? []) }
    if (profile.answerKind === 'read-missing-source-fields') return { holeId, missingFields: ['initialWaterDepth', 'stableWaterDepth', ...hole.strata.map(item => `strata.${item.intervalId}.description`)] }
    if (profile.answerKind === 'source-cad-unit-separation') return { holeId, sourceUnits: 'metre', cadUnits: 'millimeter', verticalScaleDenominator: input.verticalScaleDenominator,
      sourceDepth: hole.depth, sourceDepthInMillimetres: hole.depth * 1000, plottedDepthMillimetres: hole.depth * 1000 / input.verticalScaleDenominator }
    throw new Error(`Unknown retained-source read profile: ${profile.answerKind}`)
  }
  if (profile.answerKind === 'entity-counts') return { entityCounts: structuredClone(fixture.manifest.entityCounts) }
  if (profile.answerKind === 'complete-native-mtext') return { id: fixture.identityAliases['MTEXT-A'].nativeId, text: fixture.manifest.completeMtext }
  const aliases = profile.answerKind === 'exact-label-matches' ? fixture.manifest.exactHoleAliases : fixture.manifest.groundwaterAliases
  return { matches: sortedMatches(aliases.map(alias => {
    const identity = fixture.identityAliases[alias], entity = fixture.manifest.entities.find(item => item.alias === alias)
    return { id: identity.nativeId, handle: identity.handle, text: entity.payload.text, layerId: identity.layerId,
      layerName: identity.layerName, position: structuredClone(entity.payload.position) }
  })) }
}

const projectEntity = entity => entity ? ({ id: entity.id, type: entity.type, payload: structuredClone(entity.payload) }) : null
function sortEntities(entities) { return [...entities].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''))) }
function nearlyEqual(actual, expected) {
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected))
  if (actual === expected) return true
  if (Array.isArray(actual) || Array.isArray(expected)) return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, index) => nearlyEqual(item, expected[index]))
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') return false
  const a = Object.keys(actual).filter(key => actual[key] !== undefined).sort(), b = Object.keys(expected).filter(key => expected[key] !== undefined).sort()
  return equality(a, b) && a.every(key => nearlyEqual(actual[key], expected[key]))
}

function sourceWithCanonicalObservationOrder(source) {
  if (!source || typeof source !== 'object') return source
  const value = structuredClone(source)
  const holes = value.kind === 'column' ? [value.input?.hole] : value.input?.holes
  for (const hole of holes ?? []) if (Array.isArray(hole?.observations)) {
    // Sort full records without deduplication: IDs, kinds, depths and every fact
    // must still match; strata/correlations/hole order and other arrays stay exact.
    hole.observations.sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
  }
  return value
}

function publicSourceFacts(source) {
  const { columnStylePack, sectionStylePack, hatchPack, ...facts } = source.input
  return { kind: source.kind, facts }
}

function compileExpectedSourceOutcome(fixture, beforeSource, afterSource) {
  const reference = prepareGeologyDrawingRevision(fixture.oracleBaselineDocument,
    readGeologyDrawingRecipe(fixture.oracleBaselineDocument, fixture.drawingId), afterSource, { expectedRevision: fixture.initialRevision })
  return { kind: 'source', beforeSource: structuredClone(beforeSource), afterSource,
    before: sortEntities(reference.before.map(projectEntity)), after: sortEntities(reference.after.map(projectEntity)),
    unchangedIds: reference.unchangedIds, removedIds: reference.removedIds, createdIds: reference.createdIds,
    nextRecipe: reference.recipe, drawingId: fixture.drawingId }
}

/** Declared gold data only; this never applies a user operation to the document. */
export function expectedScenarioOutcome(value, fixture) {
  const scenario = resolveScenario(value), profile = mutationProfiles.get(scenario.expected.intent)
  if (nextScenarioDescriptor(scenario)) return expectedNextScenarioOutcome(scenario, fixture)
  if (round3ScenarioDescriptor(scenario)) return expectedRound3ScenarioOutcome(scenario, fixture)
  if (historyScenarioDescriptor(scenario)) return expectedHistoryScenarioOutcome(scenario, fixture)
  if (round4NativeDescriptor(scenario)) return expectedRound4NativeOutcome(scenario, fixture)
  if (round5InventoryDescriptor(scenario)) return expectedRound5InventoryOutcome(scenario, fixture)
  if (suppliedCreationDescriptor(scenario)) return expectedSuppliedCreationOutcome(scenario, fixture)
  if (round6SourceWorkflowDescriptor(scenario)) return expectedRound6SourceWorkflowOutcome(scenario, fixture)
  if (round7PointPlanDescriptor(scenario)) return expectedRound7PointPlanOutcome(scenario, fixture)
  if (!verifiedScenarios.has(scenario.id) || !profile) return { kind: 'read-only', answer: expectedScenarioAnswer(scenario, fixture) }
  if (profile.kind === 'cad') {
    const before = profile.targets.map(alias => projectEntity(fixture.initialEntities.find(entity => entity.id === fixture.identityAliases[alias].nativeId)))
    const after = structuredClone(before), intent = scenario.expected.intent
    if (intent === 'cad-annotation.replace-native-text') after[0].payload.text = scenario.language === 'en' ? 'TEST-A reviewed' : 'TEST-A复核'
    else if (intent === 'cad-annotation.model-title-label') after[0].payload.text = scenario.language === 'en' ? 'Synthetic section review' : '测试剖面复核图'
    else if (intent === 'cad-annotation.batch-label-renaming') { after[0].payload.text = scenario.language === 'en' ? 'TEST-A reviewed' : 'TEST-A复核'; after[1].payload.text = scenario.language === 'en' ? 'TEST-B reviewed' : 'TEST-B复核' }
    else if (intent === 'cad-annotation.mtext-paragraph-replacement') after[0].payload.text = scenario.language === 'en' ? 'Synthetic test drawing\\PNot measured survey data' : '合成测试图\\P非实测资料'
    else if (intent === 'cad-annotation.printed-depth-only') after[0].payload.text = '18.50'
    else if (intent === 'cad-annotation.printed-water-labels') { after[0].payload.text = '2.50'; after[1].payload.text = '4.50' }
    else if (intent === 'cad-transform.circle-radius') after[0].payload.radius = 6
    else if (intent === 'cad-transform.crossing-window-stretch') {
      for (const vertex of after[0].payload.vertices) if (vertex.point[0] >= 8 && vertex.point[0] <= 12 && vertex.point[1] >= -1 && vertex.point[1] <= 11) vertex.point[0] += 3
    } else if (intent === 'cad-structure.relayer-confirmed-objects') {
      const layer = fixture.document.listObjects().find(item => item.kind === 'table-record' && item.type === 'LAYER' && item.name === 'REVIEW')
      if (!layer) throw new Error('Declared REVIEW layer fixture is missing')
      for (const entity of after) entity.payload.layerId = layer.id
    } else if (intent === 'cad-structure.insert-polyline-vertex') after[0].payload.vertices.splice(1, 0, { point: [5, 0, 0], bulge: 0, startWidth: 0, endWidth: 0 })
    else if (intent === 'cad-structure.edit-polyline-bulge') after[0].payload.vertices[0].bulge = Math.tan(Math.PI / 16)
    else if (intent === 'cad-structure.edit-polyline-width') { after[0].payload.vertices[0].startWidth = 0.5; after[0].payload.vertices[0].endWidth = 1 }
    else if (intent === 'cad-transform.rotate-selected-detail') {
      after[0].payload.start = [0, 0, 0]; after[0].payload.end = [0, 20, 0]
      after[1].payload.start = [0, 20, 0]; after[1].payload.end = [-10, 20, 0]
    } else if (intent === 'cad-transform.move-exact-objects') {
      after[0].payload.start[0] += 10; after[0].payload.end[0] += 10
      for (const field of ['position', 'alignmentPoint']) if (after[1].payload[field]) after[1].payload[field][0] += 10
    }
    return { kind: 'cad', before: sortEntities(before), after: sortEntities(after), targetIds: before.map(entity => entity.id) }
  }
  const afterSource = structuredClone(fixture.source), holes = afterSource.kind === 'column' ? [afterSource.input.hole] : afterSource.input.holes
  const a = holes.find(hole => hole.id === 'TEST-A'), b = holes.find(hole => hole.id === 'TEST-B'), intent = scenario.expected.intent
  if (intent === 'source-water-depth.initial-water-revision') a.initialWaterDepth = 2.5
  else if (intent === 'source-water-depth.stable-water-revision') a.stableWaterDepth = 4.5
  else if (intent === 'source-water-depth.clear-initial-water') delete a.initialWaterDepth
  else if (intent === 'source-water-depth.clear-stable-water') delete a.stableWaterDepth
  else if (intent === 'source-water-depth.paired-water-revision') { a.initialWaterDepth = 2.5; a.stableWaterDepth = 4.5 }
  else if (intent === 'source-water-depth.collar-elevation-revision') a.collarElevation = 107
  else if (intent === 'source-water-depth.extend-total-depth') { a.depth = 20; a.strata[2].bottom = 20 }
  else if (intent === 'source-water-depth.shorten-total-depth') { a.depth = 15; a.strata[2].bottom = 15 }
  else if (intent === 'source-water-depth.section-station-revision') b.station = 25
  else if (intent === 'source-strata.shift-adjacent-boundary') { a.strata[0].bottom = 4; a.strata[1].top = 4 }
  else if (intent === 'source-strata.rename-and-reclassify') { a.strata[1].name = scenario.language === 'en' ? 'Silty clay' : '粉质黏土'; a.strata[1].lithology = 'silty-clay' }
  else if (intent === 'source-strata.merge-supplied-intervals') a.strata.splice(2, 2, { ...a.strata[2], intervalId: 'I-SAND', bottom: 18 })
  else if (intent === 'source-strata.remove-explicit-stratum') { a.strata.splice(1, 1); a.strata[1].top = 3 }
  else if (intent === 'source-strata.redistribute-layer-thickness') { a.strata[1].bottom = 11; a.strata[2].top = 11 }
  else if (intent === 'source-strata.source-backed-description') { a.strata[1].description = scenario.language === 'en' ? 'Brownish yellow, plastic' : '褐黄色，可塑'; a.strata[1].descriptionSource = 'interval' }
  else if (intent === 'source-strata.boundary-only-display') a.strata[2].patternVisibility = 'boundary-only'
  else if (intent === 'source-strata.complete-strata-replacement') a.strata = structuredClone(fixture.suppliedInputs.confirmedStrataReplacement.strata)
  else if (intent === 'source-observation.add-sample') a.observations.push({ kind: 'sample', id: 'S-B', depth: 6 })
  else if (intent === 'source-observation.revise-spt-value') a.observations.find(item => item.id === 'N-A').value = 20
  else if (intent === 'source-observation.move-sample-depth') a.observations.find(item => item.id === 'S-A').depth = 5.5
  else if (intent === 'source-observation.remove-sample') a.observations = a.observations.filter(item => item.id !== 'S-A')
  else if (intent === 'source-observation.add-spt') a.observations.push({ kind: 'spt', id: 'N-B', depth: 13, value: 18 })
  else if (intent === 'source-observation.remove-spt') a.observations = a.observations.filter(item => item.id !== 'N-A')
  else if (intent === 'source-observation.sample-display-label') a.observations.find(item => item.id === 'S-A').displayLabel = scenario.language === 'en' ? 'Disturbed sample' : '扰动样'
  else if (intent === 'source-observation.sample-marker-style') a.observations.find(item => item.id === 'S-A').sampleMarker = 'open-circle'
  else if (intent === 'source-observation.clear-observations') a.observations = []
  else if (intent === 'source-observation.replace-observation-list') a.observations = structuredClone(fixture.suppliedInputs.confirmedObservationReplacement.observations)
  else if (intent === 'source-section.one-hole-depth') { b.depth = 20; b.strata[2].bottom = 20 }
  else if (intent === 'source-section.multi-hole-water') { a.stableWaterDepth = 4.5; b.stableWaterDepth = 5 }
  else if (intent === 'source-section.one-hole-collar') b.collarElevation = 108
  else if (intent === 'source-section.split-with-explicit-correlations') {
    const table = fixture.suppliedInputs.confirmedSectionSplit
    for (const update of table.updates) holes.find(hole => hole.id === update.holeId).strata = structuredClone(update.strata)
    afterSource.input.correlations = structuredClone(table.correlations)
  } else if (intent === 'source-section.remove-link-unrelated-occurrences') {
    afterSource.input.correlations = afterSource.input.correlations.filter(link => link.fromIntervalId !== 'I-SAND' || link.toIntervalId !== 'B-SAND')
    afterSource.input.uncorrelatedOccurrences = [{ holeId: 'TEST-A', adjacentHoleId: 'TEST-B', intervalId: 'I-SAND' },
      { holeId: 'TEST-B', adjacentHoleId: 'TEST-A', intervalId: 'B-SAND' }]
  }
  return compileExpectedSourceOutcome(fixture, fixture.source, afterSource)
}

function evaluateMutationOracle(scenario, fixture, evidence, profile) {
  if (evidence) evidence = { ...evidence, phase: evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage),
    approval: evidence.approval ?? evidence.approvalReceipt,
    approvedPlanId: evidence.approvedPlanId ?? evidence.approvalReceipt?.planId ?? evidence.approvalReceipt?.value?.planId }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) || !evidence.afterDocument || !evidence.proposal || !['pending', 'committed'].includes(evidence.phase)) {
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-proposal-and-document-evidence-missing' }
  }
  let gold = expectedScenarioOutcome(scenario, fixture)
  const proposal = evidence.proposal, assertions = []
  const check = (id, condition) => assertions.push({ id, satisfied: !!condition })
  if (['source-observation.add-sample', 'source-observation.add-spt'].includes(scenario.expected.intent)) {
    const reported = proposal.engineeringEvidence?.afterSource
    const proposedSource = reported ? { kind: reported.kind, input: reported.facts } : null
    const exactFacts = equality(sourceWithCanonicalObservationOrder(proposedSource), sourceWithCanonicalObservationOrder(gold.afterSource))
    check('observation-facts-exact-order-independent', exactFacts)
    if (exactFacts) {
      // The task does not specify list position. Only the validated permutation
      // is supplied by the proposal; ALL records/fields below come from gold.
      const orderedGold = structuredClone(gold.afterSource)
      const byRecord = new Map(orderedGold.input.hole.observations.map(item => [canonicalStringify(item), item]))
      orderedGold.input.hole.observations = proposedSource.input.hole.observations.map(item => structuredClone(byRecord.get(canonicalStringify(item))))
      gold = compileExpectedSourceOutcome(fixture, gold.beforeSource, orderedGold)
    }
  }
  const expectedTool = gold.kind === 'source' ? 'cad_propose_geology_revision' :
    scenario.expected.intent.startsWith('cad-annotation.') ? 'cad_propose_text_edit' :
    ({ 'cad-transform.move-exact-objects': 'cad_propose_move', 'cad-transform.rotate-selected-detail': 'cad_propose_rotate', 'cad-transform.circle-radius': 'cad_propose_set_circle_radius',
      'cad-transform.crossing-window-stretch': 'cad_propose_stretch', 'cad-structure.relayer-confirmed-objects': 'cad_propose_relayer',
      'cad-structure.insert-polyline-vertex': 'cad_propose_polyline_edit', 'cad-structure.edit-polyline-bulge': 'cad_propose_polyline_edit', 'cad-structure.edit-polyline-width': 'cad_propose_polyline_edit' })[scenario.expected.intent]
  const proposalCallIndex = evidence.toolCalls?.findIndex(call => call.name === expectedTool && call.result?.ok === true &&
    call.args?.expectedRevision === fixture.initialRevision && equality(call.result.value, proposal)) ?? -1
  check('actual-native-proposal-tool-evidence', proposalCallIndex >= 0)
  check('current-document-revision-checked', proposal.documentId === fixture.document.id && (proposal.expectedRevision ?? proposal.preview?.revision) === fixture.initialRevision)
  check('full-before-after-preview', !!proposal.planId && proposal.preview?.documentId === fixture.document.id &&
    nearlyEqual(sortEntities(proposal.preview.before ?? []), gold.before) && nearlyEqual(sortEntities(proposal.preview.after ?? []), gold.after))
  if (evidence.phase === 'pending') {
    check('no-mutation-during-preview', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
    check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval)
  } else {
    const receipt = evidence.approval?.value ?? evidence.approval
    const actualReceipt = (evidence.approval?.ok === true || receipt?.status === 'committed') && receipt?.command === proposal.command &&
      receipt?.beforeRevision === fixture.initialRevision && receipt?.afterRevision === fixture.initialRevision + 1
    check('explicit-host-approval-before-commit', actualReceipt && evidence.approvedPlanId === proposal.planId && evidence.afterDocument.revision === fixture.initialRevision + 1)
    check('exact-approved-document-identity', evidence.afterDocument.id === fixture.document.id)
  }
  if (gold.kind === 'source') {
    const engineering = proposal.engineeringEvidence
    check('source-before-after-diff-visible', equality(engineering?.beforeSource, publicSourceFacts(gold.beforeSource)) && equality(engineering?.afterSource, publicSourceFacts(gold.afterSource)))
    check('read-retained-source-before-revision', evidence.toolCalls?.slice(0, Math.max(0, proposalCallIndex)).some(call => call.name === 'cad_read_geology_source' && call.result?.ok === true && call.args?.drawingId === fixture.drawingId && call.args.expectedRevision === fixture.initialRevision && call.result.value?.documentId === fixture.document.id))
    if (evidence.phase === 'committed') {
      let recipe
      try { recipe = readGeologyDrawingRecipe(evidence.afterDocument, fixture.drawingId) } catch { /* Invalid geometry/source consistency is a failed oracle. */ }
      check('exact-source-facts-and-generated-native-geometry', !!recipe && equality(recipe.source, gold.afterSource))
      const unchanged = new Set(gold.unchangedIds)
      const owned = new Set(readGeologyDrawingRecipe(fixture.oracleBaselineDocument, fixture.drawingId).entityIds)
      for (const entity of fixture.initialEntities.filter(item => unchanged.has(item.id) || !owned.has(item.id))) {
        check(`preserve-native-entity:${entity.id}`, equality(evidence.afterDocument.getObject(entity.id), entity))
      }
      const removed = new Set(gold.removedIds)
      const expectedIds = fixture.initialEntities.filter(item => !removed.has(item.id)).map(item => item.id).concat(gold.createdIds).sort()
      check('no-extra-or-missing-native-entities', equality(evidence.afterDocument.listEntities().map(item => item.id).sort(), expectedIds))
      check('exact-created-native-geometry', nearlyEqual(sortEntities(gold.createdIds.map(id => projectEntity(evidence.afterDocument.getObject(id)))), gold.after))
      const initial = fixture.oracleBaselineDocument.snapshot(), actual = evidence.afterDocument.snapshot()
      const { handseed: initialSeed, ...initialHeader } = initial.header, { handseed: actualSeed, ...actualHeader } = actual.header
      const expectedSeed = (BigInt(`0x${initialSeed}`) + BigInt(gold.createdIds.length)).toString(16).toUpperCase()
      check('source-units-layers-and-owner-spaces-preserved', equality(actualHeader, initialHeader) && equality(actual.tables, initial.tables))
      check('native-handle-allocation-exact', actualSeed === expectedSeed)
      const expectedOpaque = { ...initial.opaquePayloads, [`geology-drawing-recipe:${fixture.drawingId}`]: gold.nextRecipe }
      check('only-the-exact-source-recipe-replaced', equality(actual.opaquePayloads, expectedOpaque))
      for (const object of fixture.oracleBaselineDocument.listObjects().filter(item => !fixture.initialEntities.some(entity => entity.id === item.id))) {
        if (object.id === fixture.oracleBaselineDocument.spaces.modelSpaceId) {
          const before = structuredClone(object), after = structuredClone(evidence.afterDocument.getObject(object.id))
          before.payload.entityIds = []; after.payload.entityIds = []
          check(`preserve-model-owner:${object.id}`, equality(before, after))
        } else check(`preserve-native-resource:${object.id}`, equality(evidence.afterDocument.getObject(object.id), object))
      }
    }
  } else if (evidence.phase === 'committed') {
    check('exact-native-target-records', nearlyEqual(sortEntities(gold.targetIds.map(id => projectEntity(evidence.afterDocument.getObject(id)))), gold.after))
    for (const entity of fixture.initialEntities) {
      if (!gold.targetIds.includes(entity.id)) check(`preserve-native-entity:${entity.id}`, equality(evidence.afterDocument.getObject(entity.id), entity))
      else check(`preserve-id-handle-owner:${entity.id}`, evidence.afterDocument.getObject(entity.id)?.handle === entity.handle && evidence.afterDocument.getObject(entity.id)?.ownerId === entity.ownerId)
      if (gold.targetIds.includes(entity.id)) {
        const expectedRecord = structuredClone(entity)
        expectedRecord.payload = structuredClone(gold.after.find(item => item.id === entity.id).payload)
        check(`preserve-exact-target-record-metadata:${entity.id}`, nearlyEqual(evidence.afterDocument.getObject(entity.id), expectedRecord))
      }
    }
    check('source-capability-not-fabricated', equality(evidence.afterDocument.snapshot().opaquePayloads, fixture.oracleBaselineDocument.snapshot().opaquePayloads))
    check('preserve-layers-and-units', equality(evidence.afterDocument.snapshot().tables, fixture.oracleBaselineDocument.snapshot().tables) && equality(evidence.afterDocument.snapshot().header, fixture.oracleBaselineDocument.snapshot().header))
  }
  const exactOutcome = assertions.every(item => item.satisfied)
  for (const id of scenario.expected.checks.filter(id => !assertions.some(item => item.id === id))) {
    // Exact full-record/source/geometry equality enforces each declared field-level condition.
    check(id, exactOutcome)
  }
  const satisfied = assertions.every(item => item.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', evidenceOrigin: evidence.origin, oracleId: profile.id, phase: evidence.phase,
    scenarioPassed: evidence.origin === 'real-model' ? satisfied : null, scenarioExecuted: evidence.origin === 'real-model', assertions }
}

/**
 * Evaluates collected evidence, never executes a prompt or chooses an edit by keywords.
 * Real-model callers must supply the raw structured final answer, actual tool traces,
 * and the actual post-run KJDocument. Missing evidence yields not-evaluated.
 * Fixture self-tests can exercise this oracle, but never count as model scenario passes.
 */
export function evaluateScenarioOracle(value, fixture, evidence, { answerContractVersion = 'v3', context } = {}) {
  const scenario = resolveScenario(value), readiness = assessScenarioReadiness(scenario)
  if (readiness.status !== 'runnable') return { status: 'not-evaluated', scenarioPassed: null, reason: 'scenario-not-ready', reasons: readiness.reasons }
  if (['v4', 'v5'].includes(answerContractVersion) && isGeologyAnswerContractV4Scenario(scenario)) return evaluateGeologyAnswerContractV4({ scenario, fixture, evidence, context })
  if (nextScenarioDescriptor(scenario)) return evaluateNextScenarioOracle(scenario, fixture, evidence)
  if (round3ScenarioDescriptor(scenario)) return evaluateRound3ScenarioOracle(scenario, fixture, evidence, { answerContractVersion })
  if (historyScenarioDescriptor(scenario)) return evaluateHistoryScenarioOracle(scenario, fixture, evidence)
  if (round4NativeDescriptor(scenario)) return evaluateRound4NativeOracle(scenario, fixture, evidence)
  if (round5InventoryDescriptor(scenario)) return evaluateRound5InventoryOracle(scenario, fixture, evidence)
  if (suppliedCreationDescriptor(scenario)) return evaluateSuppliedCreationOracle(scenario, fixture, evidence)
  if (round6SourceWorkflowDescriptor(scenario)) return evaluateRound6SourceWorkflowOracle(scenario, fixture, evidence)
  if (round7PointPlanDescriptor(scenario)) return evaluateRound7PointPlanOracle(scenario, fixture, evidence)
  const mutationProfile = mutationProfiles.get(scenario.expected.intent)
  if (mutationProfile) return evaluateMutationOracle(scenario, fixture, evidence, mutationProfile)
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) || !evidence.afterDocument || !Array.isArray(evidence.toolCalls) || !evidence.toolCalls.length || !evidence.answer) {
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-execution-evidence-missing' }
  }
  if (evidence.origin === 'real-model') {
    try {
      if (typeof evidence.rawFinalAnswer !== 'string' || !equality(JSON.parse(evidence.rawFinalAnswer), evidence.answer)) {
        return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-structured-model-answer-missing-or-mismatched' }
      }
    } catch { return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-is-not-valid-structured-json' } }
  }
  const profile = readProfiles.get(scenario.expected.intent) ?? failClosedProfiles.get(scenario.expected.intent), assertions = []
  const check = (id, condition, detail) => assertions.push({ id, satisfied: !!condition, ...(detail ? { detail } : {}) })
  const calls = evidence.toolCalls
  if (profile.kind === 'source-read') {
    check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id && calls.every(call =>
      (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision) && call.result?.ok === true &&
      call.result.value.documentId === fixture.document.id && call.result.value.revision === fixture.initialRevision))
    check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
    check('native-read-tools-only', calls.every(call => nativeReadTools.has(call.name) || call.name === 'cad_read_geology_source'))
    const sourceReads = calls.filter(call => call.name === 'cad_read_geology_source' && call.result?.ok === true)
    check('retained-source-facts-actually-read', sourceReads.some(call => profile.answerKind === 'list-source-recipes' ?
      !call.args.drawingId && equality(call.result.value.drawingIds, [fixture.drawingId]) :
      call.args.drawingId === fixture.drawingId && call.result.value.kind === fixture.source.kind && equality(call.result.value.facts, fixture.source.input)))
    check('exact-answer-equals-independent-fixture-facts', equality(normalizeScenarioAnswerUnits(evidence.answer), normalizeScenarioAnswerUnits(expectedScenarioAnswer(scenario, fixture))))
    const allSatisfied = assertions.every(item => item.satisfied)
    for (const id of scenario.expected.checks) check(id, allSatisfied)
    return { status: allSatisfied ? 'satisfied' : 'failed', evidenceOrigin: evidence.origin, oracleId: profile.id,
      scenarioPassed: evidence.origin === 'real-model' ? allSatisfied : null, scenarioExecuted: evidence.origin === 'real-model', assertions }
  }
  if (failClosedProfiles.has(scenario.expected.intent)) {
    const expected = expectedScenarioAnswer(scenario, fixture), answer = evidence.answer
    const { questions, ...facts } = answer
    check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id &&
      calls.every(call => (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision) &&
        call.result?.ok === true && call.result.value.documentId === fixture.document.id && call.result.value.revision === fixture.initialRevision))
    check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
    check('read-retained-source-before-revision', calls.some(call => call.name === 'cad_read_geology_source' &&
      call.args.drawingId === fixture.drawingId && equality(call.result?.value?.source?.facts ?? call.result?.value?.facts, fixture.source.input)))
    check('native-read-tools-only', calls.every(call => nativeReadTools.has(call.name) || call.name === 'cad_read_geology_source'))
    check('exact-answer-equals-independent-fixture-facts', equality(normalizeScenarioAnswerUnits(facts), normalizeScenarioAnswerUnits(expected)))
    check('clarification-covers-exact-missing-fields', Array.isArray(questions) && questions.length === expected.missingFields.length &&
      equality(questions.map(item => item.field).sort(), [...expected.missingFields].sort()) &&
      questions.every(item => Object.keys(item).sort().join(',') === 'field,question' && typeof item.question === 'string' && item.question.trim().length > 0))
    const allSatisfied = assertions.every(item => item.satisfied)
    for (const id of scenario.expected.checks) check(id, allSatisfied)
    return { status: allSatisfied ? 'satisfied' : 'failed', evidenceOrigin: evidence.origin, oracleId: profile.id,
      scenarioPassed: evidence.origin === 'real-model' ? allSatisfied : null, scenarioExecuted: evidence.origin === 'real-model', assertions }
  }
  const validCalls = calls.filter(call => call?.result?.ok === true && nativeReadTools.has(call.name))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id && calls.every(call => (call.name === 'cad_read_drawing' || call?.args?.expectedRevision === fixture.initialRevision) && call?.result?.value?.revision === fixture.initialRevision && call.result.value.documentId === fixture.document.id))
  check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
  check('native-read-tools-only', calls.every(call => nativeReadTools.has(call.name)) && validCalls.length > 0)
  const expected = expectedScenarioAnswer(scenario, fixture)
  const actualAnswer = structuredClone(evidence.answer)
  if (Array.isArray(actualAnswer.matches)) actualAnswer.matches = sortedMatches(actualAnswer.matches)
  check('exact-answer-equals-independent-fixture-facts', equality(actualAnswer, expected))
  const allEntities = validCalls.flatMap(call => call.result.value.entities ?? [])
  const allMatches = validCalls.flatMap(call => call.result.value.matches ?? [])
  if (profile.answerKind === 'entity-counts') {
    const actualCounts = {}, seen = new Set()
    for (const entity of allEntities) if (!seen.has(entity.id)) { seen.add(entity.id); actualCounts[entity.type] = (actualCounts[entity.type] ?? 0) + 1 }
    check('inventory-complete-or-explicit-pagination', equality(actualCounts, fixture.manifest.entityCounts) && seen.size === fixture.manifest.entities.length && validCalls.some(call => call.result.value.nextOffset === null))
  } else if (profile.answerKind === 'complete-native-mtext') {
    const target = fixture.identityAliases['MTEXT-A'].nativeId
    check('complete-raw-text-without-truncation', allEntities.some(entity => entity.id === target && entity.type === 'MTEXT' && entity.geometry?.text === fixture.manifest.completeMtext))
  } else {
    const matchingIds = new Set(allMatches.map(match => match.id))
    check('all-pages-searched', matchingIds.size === expected.matches.length && expected.matches.every(match => matchingIds.has(match.id)) && validCalls.some(call => call.result.value.nextOffset === null))
    const searches = validCalls.filter(call => call.name === 'cad_find_text')
    if (profile.answerKind === 'exact-label-matches') check('literal-exact-text-match', searches.length > 0 && searches.every(call => call.args.search === 'TEST-A' && call.args.match === 'exact') && allMatches.every(match => match.text === 'TEST-A'))
    else {
      const literal = scenario.language === 'en' ? 'groundwater' : '地下水'
      check('literal-contains-match', searches.length > 0 && searches.every(call => call.args.search?.toLowerCase() === literal && (call.args.match ?? 'contains') === 'contains') && allMatches.every(match => match.text.toLowerCase().includes(literal)))
      check('case-policy-explicit', searches.every(call => call.args.caseSensitive !== true && call.result.value.caseSensitive === false))
    }
  }
  check('no-success-claim-without-state-or-artifact-evidence', assertions.every(item => item.satisfied))
  const satisfied = assertions.every(item => item.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', evidenceOrigin: evidence.origin, oracleId: profile.id,
    scenarioPassed: evidence.origin === 'real-model' ? satisfied : null, scenarioExecuted: evidence.origin === 'real-model', assertions }
}

export async function runGeologyScenarioPreflight({ corpus = frozen, availableActions = BASE_ACTIONS } = {}) {
  validateGeologyUserScenarios(corpus)
  const fixtureProbes = []
  const branches = PUBLIC_FIXTURE_IDS.map(fixtureId => ({ fixtureId, branch: undefined, prerequisites: [] }))
  for (const id of VERIFIED_SCENARIO_IDS) {
    const scenario = resolveScenario(id), branch = oracleProfile(scenario.expected.intent)?.fixtureBranch
    if (branch && !branches.some(item => item.fixtureId === fixtureIdFor(scenario) && item.branch === branch))
      branches.push({ fixtureId: fixtureIdFor(scenario), branch, prerequisites: scenario.prerequisites })
  }
  for (const { fixtureId, branch, prerequisites: branchPrerequisites } of branches) {
    let fixture
    try {
      const nextScenario = branch && frozen.scenarios.find(scenario => NEXT_ORACLE_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && nextScenarioDescriptor(scenario)?.fixtureBranch === branch)
      const round3Scenario = branch && frozen.scenarios.find(scenario => ROUND3_ORACLE_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && round3ScenarioDescriptor(scenario)?.fixtureBranch === branch)
      const historyScenario = branch && frozen.scenarios.find(scenario => HISTORY_ORACLE_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && historyScenarioDescriptor(scenario)?.fixtureBranch === branch)
      const round4Scenario = branch && frozen.scenarios.find(scenario => ROUND4_NATIVE_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && round4NativeDescriptor(scenario)?.fixtureBranch === branch)
      const round5Scenario = branch && frozen.scenarios.find(scenario => ROUND5_INVENTORY_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && round5InventoryDescriptor(scenario)?.fixtureBranch === branch)
      const creationScenario = branch && frozen.scenarios.find(scenario => SUPPLIED_CREATION_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && suppliedCreationDescriptor(scenario)?.fixtureBranch === branch)
      const round6Scenario = branch && frozen.scenarios.find(scenario => ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && round6SourceWorkflowDescriptor(scenario)?.fixtureBranch === branch)
      const round7Scenario = branch && frozen.scenarios.find(scenario => ROUND7_POINT_PLAN_SCENARIO_IDS.includes(scenario.id) &&
        fixtureIdFor(scenario) === fixtureId && round7PointPlanDescriptor(scenario)?.fixtureBranch === branch)
      fixture = round7Scenario ? await buildRound7PointPlanFixture(round7Scenario) : round6Scenario ? await buildRound6SourceWorkflowFixture(round6Scenario) : creationScenario ? await buildSuppliedCreationFixture(creationScenario) : round5Scenario ? await buildRound5InventoryFixture(round5Scenario) : round4Scenario ? await buildRound4NativeFixture(round4Scenario) : historyScenario ? await buildHistoryScenarioFixture(historyScenario) : round3Scenario ? await buildRound3ScenarioFixture(round3Scenario) : nextScenario ? await buildNextScenarioFixture(nextScenario) :
        await buildPublicScenarioFixture(fixtureId, { branch, prerequisites: branchPrerequisites })
      fixtureProbes.push({ fixtureId, ...(branch ? { branch } : {}), status: 'built-and-validated', actualReadFormat: fixture.artifact.format,
        entityCount: fixture.document.listEntities().length, sourceRecipePresent: fixture.sourceRecipePresent,
        builtFeatures: fixture.builtFeatures, unbuiltContractFeatures: fixture.unbuiltContractFeatures })
    } catch (error) { fixtureProbes.push({ fixtureId, ...(branch ? { branch } : {}), status: 'build-failed', error: error.message }) }
    finally { fixture?.dispose() }
  }
  const scenarios = corpus.scenarios.map(scenario => assessScenarioReadiness(scenario, { availableActions, fixtureProbes }))
  const reasonCounts = {}
  for (const item of scenarios) for (const reason of item.reasons) reasonCounts[reason.code] = (reasonCounts[reason.code] ?? 0) + 1
  return { schemaVersion: '1.0.0', purpose: 'read-only-execution-readiness-preflight', total: scenarios.length,
    runnable: scenarios.filter(item => item.status === 'runnable').length, notReady: scenarios.filter(item => item.status === 'not-ready').length,
    fixtureProbes, reasonCounts, initialBatchIds: [...INITIAL_BATCH_SCENARIO_IDS], verifiedScenarioIds: [...VERIFIED_SCENARIO_IDS],
    executionAdapterScope: 'native-sdk-read-tools-and-reviewed-pending-proposals; browser-session-export-adapters-not-implemented',
    modelCalls: 0, userScenarioExecutions: 0, userScenarioPasses: null, executionStatus: 'not-run', scenarios }
}

async function main(args) {
  if (args.length > 1 || (args.length && args[0] !== '--json')) throw new Error('Usage: node scripts/testing/preflight-geology-user-scenarios.mjs [--json]')
  const report = await runGeologyScenarioPreflight()
  console.log(JSON.stringify(args[0] === '--json' ? report : {
    purpose: report.purpose, total: report.total, runnable: report.runnable, notReady: report.notReady,
    fixtureProbes: report.fixtureProbes, reasonCounts: report.reasonCounts, initialBatchIds: report.initialBatchIds,
    modelCalls: 0, userScenarioExecutions: 0, userScenarioPasses: null, executionStatus: 'not-run',
  }, null, 2))
  if (report.runnable < 20) process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
