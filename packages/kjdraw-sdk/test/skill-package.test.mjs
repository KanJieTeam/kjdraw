import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skill = join(root, 'skills', 'kjdraw-cad')

test('published package carries one canonical KJDraw agent skill with no scaffold placeholders', async () => {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const source = await readFile(join(skill, 'SKILL.md'), 'utf8')
  assert.equal(packageJson.files.includes('skills'), true)
  assert.match(source, /^---\nname: kjdraw-cad\ndescription: .+\n---\n/)
  assert.doesNotMatch(source, /\bTODO\b|\[TODO:/)
  assert.match(source, /仅生成待审核提案/)
  assert.match(source, /references\/routes\.json/)
  assert.match(source, /references\/acceptance\.md/)
})

test('skill routes reference only real MCP tools and prefer every production drawing compiler', async () => {
  const manifest = JSON.parse(await readFile(join(skill, 'references', 'routes.json'), 'utf8'))
  const available = new Set(KJDRAW_AGENT_TOOLS.map(tool => tool.name))
  const referenced = new Set()
  for (const route of manifest.routes) {
    for (const field of ['start', 'tools', 'relationshipChecks', 'eraseImpactCheck', 'preferredCompilers', 'boundedFallbacks']) {
      for (const name of route[field] ?? []) referenced.add(name)
    }
  }
  assert.deepEqual(manifest.routes.map(route => route.id), ['inspect', 'create', 'modify'])
  for (const name of referenced) assert.equal(available.has(name), true, `unknown routed tool ${name}`)
  assert.deepEqual(manifest.routes[2].relationshipChecks, ['cad_query_topology'])
  assert.deepEqual(manifest.routes[2].eraseImpactCheck, ['cad_query_impact'])
  assert.deepEqual(manifest.routes[1].preferredCompilers, [
    'cad_propose_geology_column',
    'cad_propose_geology_section_example',
    'cad_propose_geology_section',
    'cad_propose_manufacturing_sheet',
    'cad_propose_architecture_plan',
    'cad_propose_site_plan',
    'cad_propose_road_drawing',
    'cad_propose_cartesian_chart',
  ])
})

test('skill UI metadata is localized and invokes the canonical skill explicitly', async () => {
  const source = await readFile(join(skill, 'agents', 'openai.yaml'), 'utf8')
  assert.match(source, /display_name: "KJDraw CAD"/)
  assert.match(source, /short_description: "自然语言读取、生成、修改并验证可编辑 CAD 图纸"/)
  assert.match(source, /default_prompt: "使用 \$kjdraw-cad /)
})
