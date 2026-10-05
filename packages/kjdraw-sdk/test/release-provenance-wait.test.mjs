import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../../../.github/workflows/release-provenance.yml', import.meta.url), 'utf8')
const step = workflow.split('      - name: Bind this audit to the exact current main checks')[1]?.split('      - name:')[0]
assert.ok(step, 'the exact-main binding step must exist')
const run = step.split('        run: |')[1]?.trimEnd().split(/\r?\n/).slice(1).map(line => line.replace(/^ {10}/, '')).join('\n')
assert.ok(run, 'execute the actual workflow script, not a copied polling implementation')
const bash = process.env.KJDRAW_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash')
assert.ok(existsSync(bash), `Bash is required to validate the real workflow (override KJDRAW_BASH): ${bash}`)
const sha = 'a'.repeat(40)
const waitBudget = Number(/poll_wait_seconds=(\d+)/.exec(run)?.[1])
assert.ok(Number.isSafeInteger(waitBudget) && waitBudget >= 3600 && waitBudget <= 5400,
  'the finite queue-aware window must allow one hour without exceeding 90 minutes')
const maxWaits = waitBudget / 30
assert.ok(Number.isInteger(maxWaits))

// Shell function fixtures replace GitHub, Git, time and sleep only. The actual
// workflow body runs unchanged, with a deterministic clock and no network/sleep.
const fixtures = String.raw`
set -euo pipefail
mock_clock=0
date() {
  [[ "$*" == '+%s' ]]
  printf '%s\n' "$mock_clock"
}
sleep() {
  printf 'SLEEP:%s\n' "$1" >&2
  mock_clock=$((mock_clock + $1 + MOCK_WAIT_OVERHEAD))
}
git() {
  case "$*" in
    'rev-parse HEAD') printf '%s\n' "$MOCK_HEAD_SHA" ;;
    'fetch --no-tags origin main') ;;
    'rev-parse refs/remotes/origin/main') printf '%s\n' "$MOCK_MAIN_SHA" ;;
    *) printf 'Unexpected git command: %s\n' "$*" >&2; return 2 ;;
  esac
}
gh() {
  [[ "$1" == 'api' && "$3" == '--jq' ]]
  [[ "$2" == *"head_sha=$GITHUB_SHA&event=push&per_page=20" ]]
  [[ "$4" == *'.head_sha == "'"$GITHUB_SHA"'"'* ]]
  [[ "$4" == *'.head_branch == "main"'* && "$4" == *'.event == "push"'* ]]
  [[ "$4" == *'.status'* && "$4" == *'.conclusion'* ]]
  printf 'QUERY:%s:%s\n' "$mock_clock" "$2" >&2
  case "$2" in
    */ci.yml/*)
      if (( mock_clock >= MOCK_CI_FINISH_AT )); then printf '%s\n' "$MOCK_CI_AFTER"; else printf '%s\n' "$MOCK_CI_BEFORE"; fi ;;
    */pages.yml/*)
      if (( mock_clock >= MOCK_PAGES_FINISH_AT )); then printf '%s\n' "$MOCK_PAGES_AFTER"; else printf '%s\n' "$MOCK_PAGES_BEFORE"; fi ;;
    *) return 2 ;;
  esac
}
`

function poll(overrides = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'kjdraw-provenance-wait-'))
  const output = join(scratch, 'github-output.txt')
  try {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', `${fixtures}\n${run}`], {
      encoding: 'utf8', windowsHide: true, timeout: 60000,
      env: {
        ...process.env,
        GITHUB_SHA: sha, GITHUB_REPOSITORY: 'fixture/repository', GITHUB_OUTPUT: output.replaceAll('\\', '/'),
        MOCK_HEAD_SHA: sha, MOCK_MAIN_SHA: sha,
        MOCK_CI_FINISH_AT: '0', MOCK_CI_AFTER: 'completed:success', MOCK_CI_BEFORE: 'in_progress:',
        MOCK_PAGES_FINISH_AT: '0', MOCK_PAGES_AFTER: 'completed:success', MOCK_PAGES_BEFORE: 'queued:',
        MOCK_WAIT_OVERHEAD: '0', ...overrides,
      },
    })
    if (existsSync(output)) result.stdout += readFileSync(output, 'utf8')
    return result
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const waits = result => [...result.stderr.matchAll(/^SLEEP:(\d+)$/gm)].map(match => Number(match[1]))
const queries = result => [...result.stderr.matchAll(/^QUERY:(\d+):(.+)$/gm)]
const successful = result => {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`)
  assert.match(result.stdout, new RegExp(`^sha=${sha}$`, 'm'))
  assert.match(result.stdout, /^ci=success$/m)
  assert.match(result.stdout, /^pages=success$/m)
}

test('provenance accepts completed exact-SHA checks immediately without sleeping', () => {
  const result = poll()
  successful(result)
  assert.equal(queries(result).length, 2)
  assert.deepEqual(waits(result), [])
})

test('provenance re-queries checks that complete during the previous final sleep', () => {
  const result = poll({ MOCK_CI_FINISH_AT: '1500' })
  successful(result)
  assert.equal(queries(result).length, 102)
  assert.equal(queries(result).at(-2)[1], '1500')
  assert.equal(waits(result).length, 50)
})

test('provenance accepts queued CI completing after the previous 35-minute window', () => {
  const result = poll({ MOCK_CI_FINISH_AT: '3600', MOCK_PAGES_FINISH_AT: '2400' })
  successful(result)
  assert.equal(queries(result).length, 242)
  assert.equal(queries(result).at(-1)[1], '3600')
  assert.equal(waits(result).length, 120)
})

test('provenance performs a fresh successful terminal query at the finite deadline', () => {
  const result = poll({ MOCK_CI_FINISH_AT: String(waitBudget), MOCK_PAGES_FINISH_AT: String(waitBudget) })
  successful(result)
  assert.equal(queries(result).length, (maxWaits + 1) * 2)
  assert.equal(queries(result).at(-1)[1], String(waitBudget))
  assert.equal(waits(result).length, maxWaits)
  assert.equal(waits(result).reduce((sum, seconds) => sum + seconds, 0), waitBudget)
  assert.match(result.stderr.trimEnd(), new RegExp(`^QUERY:${waitBudget}:.*pages\\.yml`, 'm'))
})

test('provenance times out explicitly after its last fresh query, never sleeping afterward', () => {
  const result = poll({ MOCK_CI_FINISH_AT: '9999', MOCK_CI_BEFORE: 'missing:' })
  assert.equal(result.status, 1)
  assert.equal(queries(result).length, (maxWaits + 1) * 2)
  assert.equal(waits(result).length, maxWaits)
  assert.match(result.stdout, new RegExp(`Timed out waiting for exact-main checks for ${sha} after ${waitBudget} seconds`))
  assert.match(result.stdout, new RegExp(`attempt=${maxWaits + 1}; CI status=missing conclusion=pending; Pages status=completed conclusion=success`))
  assert.doesNotMatch(result.stdout, /^sha=/m)
  assert.match(result.stderr.trimEnd().split('\n').at(-1), new RegExp(`^QUERY:${waitBudget}:.*pages\\.yml`))
})

test('provenance bounds elapsed time rather than adding the wait budget after delays', () => {
  const result = poll({ MOCK_CI_FINISH_AT: '9999', MOCK_WAIT_OVERHEAD: '11' })
  assert.equal(result.status, 1)
  const fullWaits = Math.floor(waitBudget / 41)
  const remainder = waitBudget % 41
  assert.equal(waits(result).at(-1), Math.min(30, remainder), 'the last wait must be clipped to the remaining deadline')
  assert.equal(waits(result).length, fullWaits + 1)
  assert.equal(queries(result).length, (fullWaits + 2) * 2)
  assert.match(result.stdout, /Timed out waiting for exact-main checks/)
})

test('provenance rejects all terminal non-success conclusions without another sleep', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale']) {
    const result = poll({ MOCK_CI_AFTER: `completed:${conclusion}` })
    assert.equal(result.status, 1, conclusion)
    assert.deepEqual(waits(result), [], conclusion)
    assert.match(result.stdout, new RegExp(`Exact-main CI concluded ${conclusion} for ${sha}`))
    assert.doesNotMatch(result.stdout, /^sha=/m)
  }
})

test('provenance does not accept a success conclusion on an unfinished workflow', () => {
  const result = poll({ MOCK_CI_AFTER: 'in_progress:success' })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /CI status=in_progress conclusion=success/)
  assert.doesNotMatch(result.stdout, /^sha=/m)
})

test('provenance requires both checkout and current main to equal the triggering SHA', () => {
  for (const variable of ['MOCK_HEAD_SHA', 'MOCK_MAIN_SHA']) {
    const result = poll({ [variable]: 'b'.repeat(40) })
    assert.equal(result.status, 1)
    assert.deepEqual(waits(result), [])
    assert.equal(queries(result).length, 0)
  }
})
