import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { validateCommunitySkills, parseCommunitySkillFrontmatter, COMMUNITY_SKILLS_CONTRACT } from '../scripts/validate-community-skills.mjs'

const script = fileURLToPath(new URL('../scripts/validate-community-skills.mjs', import.meta.url))
const defaults = name => ({
  'SKILL.md': `---\nname: ${name}\ndescription: Audit user-selected native drawing text without changing it.\n---\n# Text audit\nRead [acceptance](references/acceptance.md) for the observable checks.\n`,
  'README.md': '# Text audit\n\nInstall this independent pack and request a read-only text inventory.\n',
  'README.zh-CN.md': '# 文字审核\n\n安装独立技能包，读取选定图纸文字，并说明尚未验证的边界。\n',
  'references/acceptance.md': '# Acceptance\n\nRead a current drawing, compare its source bytes before and after, and retain any failed read receipt.\n',
})
async function fixture(t, name = 'kjdraw-text-audit', changes = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'kjdraw-community-skill-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'skills'), pack = join(root, name)
  await mkdir(pack, { recursive: true })
  for (const [file, content] of Object.entries({ ...defaults(name), ...changes })) {
    if (content === null) continue
    await mkdir(dirname(join(pack, file)), { recursive: true }); await writeFile(join(pack, file), content)
  }
  return { workspace, root, pack, name }
}
const codes = result => result.errors.map(row => row.code)

test('contract is structural-only, zero external probing, and reserves the foundation', () => {
  assert.equal(COMMUNITY_SKILLS_CONTRACT.structuralOnly, true)
  assert.equal(COMMUNITY_SKILLS_CONTRACT.behavioralValidationPerformed, false)
  assert.deepEqual(COMMUNITY_SKILLS_CONTRACT.reservedNames, ['kjdraw-cad'])
  assert.equal(COMMUNITY_SKILLS_CONTRACT.acceptanceReferenceOptional, true)
  assert.deepEqual(COMMUNITY_SKILLS_CONTRACT.requiredFiles, ['SKILL.md'])
  assert.deepEqual(COMMUNITY_SKILLS_CONTRACT.humanReadmeAnyOf, ['README.md', 'README.zh-CN.md'])
})
test('valid independent pack passes with bilingual human docs and acceptance, not a model pass', async t => {
  const { root } = await fixture(t)
  const result = await validateCommunitySkills({ root })
  assert.equal(result.ok, true); assert.deepEqual(result.errors, [])
  assert.equal(result.packs.length, 1); assert.equal(result.packs[0].valid, true)
  assert.equal(result.structuralOnly, true); assert.equal(result.behavioralValidationPerformed, false)
  assert.equal(result.packs[0].checkedMarkdownFiles, 4)
})
test('root index README is not mistaken for a skill', async t => {
  const { root } = await fixture(t); await writeFile(join(root, 'README.md'), '# Community index\n')
  assert.equal((await validateCommunitySkills({ root })).packs.length, 1)
})
for (const missing of ['README.md', 'README.zh-CN.md'])
  test('first contribution accepts either human documentation language: missing ' + missing, async t => {
    const { root } = await fixture(t, 'kjdraw-text-audit', { [missing]: null })
    const result = await validateCommunitySkills({ root })
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    assert.deepEqual(result.packs[0].translationNeeded, [missing])
    assert.equal(result.packs[0].humanReadmes.length, 1)
  })
test('a human README in at least one language remains mandatory', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'README.md': null, 'README.zh-CN.md': null })
  assert.ok(codes(await validateCommunitySkills({ root })).includes('HUMAN_README_REQUIRED'))
})
test('an included empty translation is not ignored because another language exists', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'README.md': '# Translation\n\nTODO\n' })
  assert.ok(codes(await validateCommunitySkills({ root })).includes('EMPTY_OR_PLACEHOLDER_DOCUMENT'))
})
test('selected package validation is exact and a missing package never passes vacuously', async t => {
  const { root } = await fixture(t)
  assert.equal((await validateCommunitySkills({ root, pack: 'kjdraw-text-audit' })).ok, true)
  const missing = await validateCommunitySkills({ root, pack: 'kjdraw-not-here' })
  assert.equal(missing.ok, false)
  assert.ok(codes(missing).includes('SKILL_PACK_NOT_FOUND'))
  await assert.rejects(validateCommunitySkills({ root, pack: '../outside' }), /valid pack name/)
})
test('short self-contained three-file skill needs no references directory', async t => {
  const { root, pack } = await fixture(t, 'kjdraw-text-audit', {
    'SKILL.md': '---\nname: kjdraw-text-audit\ndescription: Read selected native text without changing the drawing.\n---\nRead the user-selected drawing; report text and retain failed read receipts. Never edit it.\n',
    'README.md': '# Text audit\n\nRequest a native text inventory. Acceptance: compare original source bytes before and after; they must match.\n',
    'README.zh-CN.md': '# 文字审核\n\n读取图纸文字。验收：对比操作前后原图文件内容，必须完全一致；记录失败的读取请求。\n',
    'references/acceptance.md': null,
  })
  await rm(join(pack, 'references'), { recursive: true, force: true })
  const result = await validateCommunitySkills({ root })
  assert.equal(result.ok, true, JSON.stringify(result.errors)); assert.equal(result.packs[0].checkedMarkdownFiles, 3)
})
for (const body of ['', '# Text audit\n', 'TODO\n', 'TBD\n'])
  test('SKILL body cannot be empty, heading-only or an obvious placeholder: ' + JSON.stringify(body), async t => {
    const { root } = await fixture(t, 'kjdraw-text-audit', {
      'SKILL.md': '---\nname: kjdraw-text-audit\ndescription: Read selected native text without changing the drawing.\n---\n' + body,
    })
    const result = await validateCommunitySkills({ root })
    assert.equal(result.ok, false)
    assert.ok(codes(result).includes('EMPTY_OR_PLACEHOLDER_SKILL_BODY'))
  })
test('optional acceptance reference becomes a real resource requirement when linked', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'references/acceptance.md': null })
  const result = await validateCommunitySkills({ root })
  assert.ok(codes(result).includes('MISSING_LOCAL_RESOURCE'))
  assert.equal(codes(result).includes('MISSING_REQUIRED_FILE'), false)
})
for (const name of ['kjdraw-multi--hyphen', 'kjdraw-part-2', 'kjdraw-trailing-', 'kjdraw-' + 'a'.repeat(56)])
  test('documented lowercase/digits/hyphens including consecutive hyphens accepted: ' + name, async t => {
    const { root } = await fixture(t, name); assert.equal((await validateCommunitySkills({ root })).ok, true)
  })
for (const name of ['TextAudit', 'text-audit', 'kjdraw_foo', 'kjdraw-', 'kjdraw-' + 'a'.repeat(57)])
  test('invalid namespace/characters/length rejected: ' + name, async t => {
    const { root } = await fixture(t, name); assert.ok(codes(await validateCommunitySkills({ root })).includes('INVALID_COMMUNITY_SKILL_NAME'))
  })
test('reserved foundation name cannot be contributed as a community pack', async t => {
  const { root } = await fixture(t, 'kjdraw-cad')
  assert.ok(codes(await validateCommunitySkills({ root })).includes('RESERVED_FOUNDATION_SKILL_NAME'))
})
test('frontmatter name must equal the actual immediate directory', async t => {
  const { root } = await fixture(t, 'kjdraw-audit', { 'SKILL.md': defaults('kjdraw-different')['SKILL.md'] })
  assert.ok(codes(await validateCommunitySkills({ root })).includes('NAME_DIRECTORY_MISMATCH'))
})
for (const frontmatter of ['---\nname: kjdraw-text-audit\n---\nBody.',
  '---\nname: kjdraw-text-audit\ndescription: ""\n---\nBody.',
  '---\nname: kjdraw-text-audit\ndescription: # comment only\n---\nBody.',
  '---\nname: kjdraw-text-audit\ndescription: false\n---\nBody.',
  '---\nname: kjdraw-text-audit\ndescription: *alias\n---\nBody.'])
  test('missing/empty/non-string/alias description cannot pass: ' + frontmatter.split('\n')[2], async t => {
    const { root } = await fixture(t, 'kjdraw-text-audit', { 'SKILL.md': frontmatter })
    assert.ok(codes(await validateCommunitySkills({ root })).includes('NONEMPTY_DESCRIPTION_REQUIRED'))
  })
test('limited frontmatter supports scalar quoting, BOM/CRLF, block description, optional nested metadata', async t => {
  const name = 'kjdraw-text-audit'
  for (const description of ['"Audit: labels" # comment', "'Audit ''native'' labels'", '|\n  Audit selected labels.\n  Preserve original bytes.', '>\n  Audit native labels.\n  No edits.']) {
    const parsed = parseCommunitySkillFrontmatter(`---\nname: "${name}"\ndescription: ${description}\nmetadata:\n  short-description: Independent pack\nallowed-tools: Read\n---\nInstructions.`)
    assert.deepEqual(parsed.errors, []); assert.equal(parsed.name, name); assert.ok(parsed.description.trim())
  }
  const { root } = await fixture(t, name, { 'SKILL.md': '\uFEFF' + defaults(name)['SKILL.md'].replaceAll('\n', '\r\n') })
  assert.equal((await validateCommunitySkills({ root })).ok, true)
})
test('duplicate YAML fields and duplicate declared names are explicit errors', async t => {
  const { root, pack } = await fixture(t)
  await writeFile(join(pack, 'SKILL.md'), defaults('kjdraw-text-audit')['SKILL.md'].replace('description:', 'name: kjdraw-text-audit\ndescription:'))
  assert.ok(codes(await validateCommunitySkills({ root })).includes('DUPLICATE_FRONTMATTER_FIELD'))
  const other = join(root, 'kjdraw-other'); await mkdir(other)
  for (const [file, text] of Object.entries(defaults('kjdraw-text-audit'))) {
    await mkdir(dirname(join(other, file)), { recursive: true }); await writeFile(join(other, file), text)
  }
  assert.ok(codes(await validateCommunitySkills({ root })).includes('DUPLICATE_SKILL_NAME'))
})
for (const file of COMMUNITY_SKILLS_CONTRACT.requiredFiles) test('missing required human/skill/acceptance file rejected: ' + file, async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { [file]: null })
  assert.ok(codes(await validateCommunitySkills({ root })).includes('MISSING_REQUIRED_FILE'))
})
for (const body of ['', '# Acceptance\n', '# Acceptance\n\nTODO\n', '# Acceptance\n\n待补充。\n', '# Acceptance\n\n<PLACEHOLDER>\n'])
  test('empty or obvious scaffold acceptance rejected: ' + JSON.stringify(body), async t => {
    const { root } = await fixture(t, 'kjdraw-text-audit', { 'references/acceptance.md': body })
    assert.ok(codes(await validateCommunitySkills({ root })).includes('EMPTY_OR_PLACEHOLDER_DOCUMENT'))
  })
test('meaningful minimum is not a wording requirement or TODO ban in actual prose', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'references/acceptance.md': '# Acceptance\n\nReject a TODO placeholder; verify source bytes remain unchanged.\n' })
  assert.equal((await validateCommunitySkills({ root })).ok, true)
})
test('ordinary local inline/image/angle/reference/nested-parenthesis resources exist', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', {
    'README.md': '# Resources\n\n[acceptance](references/acceptance.md "Checks")\n![plot](assets/plot.svg)\n[spaced](<references/with space.md>)\n[nested](references/a(b).md)\n[linked][defs]\n[defs]: references/other.md\n',
    'assets/plot.svg': '<svg/>', 'references/with space.md': 'Check source bytes.', 'references/a(b).md': 'Check finite data.', 'references/other.md': 'Check native identities.',
  })
  assert.equal((await validateCommunitySkills({ root })).ok, true)
})
test('fragment and query suffixes are not filenames; references may go up while remaining inside pack', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'references/acceptance.md': '# Acceptance\n\nRead [entry](../SKILL.md#workflow) and [guide](../README.md?view=plain).\n' })
  assert.equal((await validateCommunitySkills({ root })).ok, true)
})
test('missing referenced file fails even when all mandatory docs exist', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'README.md': '# Resources\n\nRead [missing](references/missing.md).\n' })
  assert.ok(codes(await validateCommunitySkills({ root })).includes('MISSING_LOCAL_RESOURCE'))
})
for (const target of ['../outside.md', '%2e%2e/outside.md', 'references/%2e%2e/%2e%2e/outside.md', '/outside.md', 'C:/outside.md', 'file:///outside.md'])
  test('lexical escaped/absolute local resource rejected: ' + target, async t => {
    const { root } = await fixture(t, 'kjdraw-text-audit', { 'README.md': '# Resources\n\nRead [outside](' + target + ').\n' })
    assert.ok(codes(await validateCommunitySkills({ root })).includes('RESOURCE_ESCAPES_PACK'))
  })
test('external URLs are neither fetched nor checked for accessibility', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'README.md': '# Resources\n\n[external](https://invalid.example.test/not-present) [mail](mailto:maintainer@example.test).\n' })
  const result = await validateCommunitySkills({ root }); assert.equal(result.ok, true); assert.equal(result.packs[0].externalLinksNotProbed, 2)
})
test('fenced and inline code links are examples, not resource requirements', async t => {
  const { root } = await fixture(t, 'kjdraw-text-audit', { 'README.md': '# Examples\n\nUse `[example](missing.md)` syntax.\n```md\n[example](missing.md)\n```\n~~~md\n[example](missing2.md)\n~~~\nActual instructions stay read-only.\n' })
  assert.equal((await validateCommunitySkills({ root })).ok, true)
})
test('resource directory symlink outside pack rejected, contained symlink allowed', async t => {
  const { root, pack, workspace } = await fixture(t)
  const outside = join(workspace, 'outside-resources'); await mkdir(outside)
  await writeFile(join(outside, 'external.md'), 'Outside source.')
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  await symlink(outside, join(pack, 'references/external-assets'), linkType)
  await writeFile(join(pack, 'README.md'), '# Resources\n\n[resource](references/external-assets/external.md).\n')
  assert.ok(codes(await validateCommunitySkills({ root })).includes('RESOURCE_ESCAPES_PACK'))
  await rm(join(pack, 'references/external-assets'), { recursive: true })
  const inside = join(pack, 'internal-resources'); await mkdir(inside)
  await writeFile(join(inside, 'inside.md'), 'Check the native source without editing it.')
  await symlink(inside, join(pack, 'references/internal-assets'), linkType)
  await writeFile(join(pack, 'README.md'), '# Resources\n\n[resource](references/internal-assets/inside.md).\n')
  assert.equal((await validateCommunitySkills({ root })).ok, true)
})
test('pack directory aliases cannot bypass root/name isolation', async t => {
  const { root, pack } = await fixture(t)
  await symlink(pack, join(root, 'kjdraw-alias'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.ok(codes(await validateCommunitySkills({ root })).includes('PACK_SYMLINK_NOT_ALLOWED'))
})
test('CLI --root has actual exit success/failure and no hidden install or behavioral claim', async t => {
  const { root, pack } = await fixture(t), before = await readFile(join(pack, 'SKILL.md'))
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  const good = run(['--root', root]); assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).behavioralValidationPerformed, false)
  await rm(join(pack, 'README.zh-CN.md')); await rm(join(pack, 'README.md'))
  const bad = run(['--root', root]); assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).ok, false)
  assert.equal(run(['--unknown']).status, 1); assert.equal(run(['--root']).status, 1)
  assert.equal(run(['--help']).status, 0)
  assert.equal(createHash('sha256').update(await readFile(join(pack, 'SKILL.md'))).digest('hex'), createHash('sha256').update(before).digest('hex'))
})
test('missing root has a structured error, and malformed options cannot change validation scope', async t => {
  const { workspace } = await fixture(t)
  assert.deepEqual((await validateCommunitySkills({ root: join(workspace, 'missing') })).errors, [{ code: 'SKILLS_ROOT_NOT_DIRECTORY' }])
  await assert.rejects(validateCommunitySkills({ root: '', install: true }), /root path/)
})
test('actual repository community packs pass using the default root independently of cwd', async () => {
  const result = await validateCommunitySkills(); assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.ok(result.packs.some(pack => pack.name === 'kjdraw-text-audit'))
  const child = spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: 'utf8' })
  assert.equal(child.status, 0); assert.equal(JSON.parse(child.stdout).ok, true)
})
