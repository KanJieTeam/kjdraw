import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, sep, isAbsolute, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validateCommunitySkills } from './validate-community-skills.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const contained = (root, target) => {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** One contribution check: structure plus the selected package's real tests.
 * No installation, model transport, broad test suite or automatic CAD edits.
 * A conventional tests/community-<topic>.spec.mjs owns the package's behavior.
 */
export async function planCommunitySkillCheck(args = [], options = {}) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || !value.trim()))
    throw new TypeError('Arguments must be nonempty directory-path strings')
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
    Object.keys(options).some(key => key !== 'repositoryRoot') ||
    options.repositoryRoot !== undefined && (typeof options.repositoryRoot !== 'string' || !options.repositoryRoot.trim()))
    throw new TypeError('Use only a nonempty repositoryRoot path')
  const root = resolve(options.repositoryRoot ?? repositoryRoot)
  const skillRoot = resolve(root, 'skills')
  const testsRoot = resolve(root, 'tests')
  if (args.length > 1 || args[0]?.startsWith('-')) throw new Error('Provide at most one skills/kjdraw-<topic> directory')
  let pack
  if (args.length) {
    const target = resolve(root, args[0])
    if (dirname(target) !== skillRoot || !/^kjdraw-[a-z0-9-]+$/.test(basename(target)))
      throw new Error('Select an immediate skills/kjdraw-<topic> directory inside this repository')
    pack = basename(target)
  }
  const validation = await validateCommunitySkills({ root: skillRoot, ...(pack ? { pack } : {}) })
  if (!validation.ok) return { ok: false, validation, behavioralValidationPerformed: false, tests: [], errors: validation.errors }
  const errors = [], tests = []
  const realRepositoryRoot = await realpath(root)
  const realTestsRoot = await realpath(testsRoot)
  const realSkillsRoot = await realpath(skillRoot)
  if (!contained(realRepositoryRoot, realTestsRoot)) throw new Error('Test root escapes the repository')
  if (!contained(realRepositoryRoot, realSkillsRoot)) throw new Error('Skill root escapes the repository')
  for (const item of validation.packs) {
    const actual = await realpath(join(skillRoot, item.name))
    if (!contained(realSkillsRoot, actual)) throw new Error('Skill directory escapes the repository')
    const file = `community-${item.name.slice('kjdraw-'.length)}.spec.mjs`
    try {
      const target = resolve(testsRoot, file), actualTest = await realpath(target)
      if (!contained(realTestsRoot, actualTest) || !(await stat(actualTest)).isFile())
        throw new Error('Invalid behavioral test path')
      tests.push(target)
    } catch {
      errors.push({ pack: item.name, code: 'BEHAVIOR_TEST_REQUIRED', expected: `tests/${file}` })
    }
  }
  if (!validation.packs.length) errors.push({ code: 'NO_COMMUNITY_SKILLS_FOUND' })
  return { ok: errors.length === 0, validation, behavioralValidationPerformed: false,
    tests, errors, testNaming: 'tests/community-<topic>.spec.mjs' }
}

async function cli(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run check:skill [-- skills/kjdraw-<topic>]\nChecks structure and runs tests/community-<topic>.spec.mjs. No model calls or client installation.')
    return
  }
  const plan = await planCommunitySkillCheck(args)
  if (!plan.ok) {
    console.error(JSON.stringify({ ok: false, errors: plan.errors }, null, 2))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ phase: 'structure-passed', packs: plan.validation.packs.map(pack => ({
    name: pack.name, translationNeeded: pack.translationNeeded,
  })), tests: plan.tests.map(path => relative(repositoryRoot, path).replaceAll(sep, '/')), modelCalls: 0 }))
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...plan.tests], {
    cwd: repositoryRoot, stdio: 'inherit',
  })
  if (result.error) throw new Error('Cannot start the package behavioral tests')
  process.exitCode = result.status ?? 1
  console.log(JSON.stringify({ phase: 'behavior-tests-finished', ok: process.exitCode === 0,
    behavioralValidationPerformed: true, modelAcceptancePerformed: false }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await cli(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
