import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { planCommunitySkillCheck } from '../scripts/check-community-skill.mjs'

const runner = fileURLToPath(new URL('../scripts/check-community-skill.mjs', import.meta.url))
async function fixture(t, { behavior = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kjdraw-skill-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pack = join(root, 'skills/kjdraw-test-domain')
  await mkdir(pack, { recursive: true }); await mkdir(join(root, 'tests'))
  await writeFile(join(pack, 'SKILL.md'), '---\nname: kjdraw-test-domain\ndescription: Check supplied drawing facts against explicit caller rules.\n---\nRead the supplied drawing and compare its declared rules without changing any entity.\n')
  await writeFile(join(pack, 'README.zh-CN.md'), '# 示例\n\n对比调用方给定的图层规则，输出只读核对报告。\n')
  if (behavior) await writeFile(join(root, 'tests/community-test-domain.spec.mjs'), "import test from 'node:test';test('synthetic behavior',()=>{});\n")
  return root
}

test('one command selects one pack and its behavior test; Chinese-only docs pass', async t => {
  const root = await fixture(t)
  const result = await planCommunitySkillCheck(['skills/kjdraw-test-domain'], { repositoryRoot: root })
  assert.equal(result.ok, true)
  assert.deepEqual(result.tests, [join(root, 'tests/community-test-domain.spec.mjs')])
  assert.equal(result.behavioralValidationPerformed, false)
  assert.deepEqual(result.validation.packs[0].translationNeeded, ['README.md'])
})
test('no argument checks every community pack, not the full CAD suite', async t => {
  const root = await fixture(t)
  const result = await planCommunitySkillCheck([], { repositoryRoot: root })
  assert.equal(result.ok, true); assert.equal(result.tests.length, 1)
})
test('malformed programmatic arguments reject before traversing a repository', async () => {
  for (const args of [null, {}, 'skills/kjdraw-test-domain', [null], [''], ['   ']])
    await assert.rejects(planCommunitySkillCheck(args), /nonempty directory-path strings/)
  for (const options of [null, [], { install: true }, { repositoryRoot: '' }, { repositoryRoot: 22 }])
    await assert.rejects(planCommunitySkillCheck([], options), /repositoryRoot/)
})
test('missing behavior tests cannot be described as tested', async t => {
  const root = await fixture(t, { behavior: false })
  const result = await planCommunitySkillCheck([], { repositoryRoot: root })
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, 'BEHAVIOR_TEST_REQUIRED')
  assert.equal(result.errors[0].expected, 'tests/community-test-domain.spec.mjs')
})
test('missing pack and invalid out-of-repo path have actionable failures', async t => {
  const root = await fixture(t)
  assert.equal((await planCommunitySkillCheck(['skills/kjdraw-not-here'], { repositoryRoot: root })).ok, false)
  for (const args of [['../outside'], ['skills/kjdraw-test-domain/SKILL.md'], ['--install'], ['one', 'two']])
    await assert.rejects(planCommunitySkillCheck(args, { repositoryRoot: root }))
})
test('a test-directory junction cannot escape the repository', async t => {
  const root = await fixture(t, { behavior: false })
  const outside = await mkdtemp(join(tmpdir(), 'kjdraw-skill-check-external-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'community-test-domain.spec.mjs'), "throw new Error('must not execute');\n")
  await rm(join(root, 'tests'), { recursive: true })
  await symlink(outside, join(root, 'tests'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(planCommunitySkillCheck([], { repositoryRoot: root }), /Test root escapes/)
})
test('CLI help and invalid selection do not install clients or call models', () => {
  const run = args => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' })
  const help = run(['--help'])
  assert.equal(help.status, 0); assert.match(help.stdout, /No model calls/)
  assert.equal(run(['--install']).status, 1)
  assert.equal(run(['../outside']).status, 1)
  assert.equal(run(['skills/kjdraw-does-not-exist']).status, 1)
})
