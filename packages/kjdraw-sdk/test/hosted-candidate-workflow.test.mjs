import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

test('CI exposes each browser engine as an independently auditable job and release workflows require hosted evidence', async () => {
  const [ci, release, npm] = await Promise.all([
    read('.github/workflows/ci.yml'), read('.github/workflows/release.yml'), read('.github/workflows/npm-publish.yml'),
  ])
  assert.match(ci, /name: Browser \/ \$\{\{ matrix\.engine \}\}/)
  assert.match(ci, /engine: \[chromium, firefox, webkit\]/)
  assert.match(ci, /npx playwright install --with-deps \$\{\{ matrix\.engine \}\}/)
  assert.match(ci, /name: Run \$\{\{ matrix\.engine \}\} acceptance/)
  assert.match(ci, /npm run test:browser -- --project=\$\{\{ matrix\.engine \}\}/)
  for (const workflow of [release, npm]) {
    const hosted = workflow.indexOf('node scripts/audits/verify-hosted-candidate.mjs')
    const readiness = workflow.indexOf('node scripts/audits/release-readiness.mjs --require-ready')
    assert.ok(hosted >= 0 && readiness > hosted)
  }
})
