import assert from 'node:assert/strict'
import test from 'node:test'
import { safeConnectError } from '../bin/connect-error.mjs'
import { inspected } from '../bin/kjdraw-connect-apply.mjs'

test('connection errors identify recoverable filesystem failures without exposing a profile path', () => {
  for (const [code, phrase] of [['EACCES', 'Access denied'], ['EPERM', 'Access denied'], ['ENOENT', 'disappeared'], ['ENOTDIR', 'wrong file/directory type'], ['ENOSPC', 'out of space'], ['EBUSY', 'temporarily unavailable']]) {
    const error = Object.assign(new Error('private C:\\Users\\Administrator\\secret'), { code, path: 'C:\\Users\\Administrator\\secret' })
    const message = safeConnectError(error)
    assert.match(message, new RegExp(phrase))
    assert.doesNotMatch(message, /Administrator|secret/u)
  }
  assert.equal(safeConnectError(new Error('Existing KJDraw Skill conflicts')), 'Existing KJDraw Skill conflicts')
})

test('connection preflight names the failing component but never prints a private path', async () => {
  const error = Object.assign(new Error('C:\\Users\\Administrator\\.workbuddy\\mcp.json'), { code: 'EACCES' })
  await assert.rejects(inspected('WorkBuddy configuration', async () => { throw error }), failure => {
    assert.match(failure.message, /WorkBuddy configuration: Access denied/u)
    assert.doesNotMatch(failure.message, /Administrator|mcp\.json/u)
    return true
  })
})
