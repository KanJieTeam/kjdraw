import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

test('file-backed child stdin preserves a multi-megabyte payload through EOF', () => {
  const payload = `${'0\nLINE\n'.repeat(700_000)}0\nEOF\n`
  const expected = createHash('sha256').update(payload).digest('hex')
  const child = spawnSyncWithFileStdin(process.execPath, ['-e', "const c=require('node:crypto'),b=require('node:fs').readFileSync(0);process.stdout.write(JSON.stringify({bytes:b.length,hash:c.createHash('sha256').update(b).digest('hex'),tail:b.subarray(-6).toString()}))"], payload, {
    encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true,
  })
  assert.equal(child.status, 0, child.stderr || child.error?.message)
  assert.deepEqual(JSON.parse(child.stdout), { bytes: Buffer.byteLength(payload), hash: expected, tail: '0\nEOF\n' })
})
