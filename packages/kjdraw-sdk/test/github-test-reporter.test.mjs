import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import githubReporter, { failureAnnotation } from '../../../scripts/github-test-reporter.mjs'

test('GitHub reporter identifies the failing test and preserves the assertion cause', () => {
  const root = resolve('reporter-fixture')
  const output = failureAnnotation({
    name: 'preserves CAD geometry', file: resolve(root, 'test/drawing.test.mjs'), line: 41, column: 7,
    details: { error: { message: 'test failed', cause: { stack: 'AssertionError: coordinates differ\n    at drawing.test.mjs:42:3' } } },
  }, root)
  assert.equal(output, '::error title=Test failed%3A preserves CAD geometry,file=test/drawing.test.mjs,line=41,col=7::AssertionError: coordinates differ%0A    at drawing.test.mjs:42:3\n')
})

test('GitHub reporter escapes workflow commands in names, paths and error text', () => {
  const root = resolve('reporter-fixture')
  const output = failureAnnotation({
    name: 'comma, percent%\r\n::notice::injected',
    file: resolve(root, 'test/comma,percent%.mjs'),
    line: -1, column: '1::notice',
    details: { error: { message: 'failed%\n::warning::not a separate command' } },
  }, root)
  assert.equal(output.split('\n').length, 2)
  assert.match(output, /comma%2C percent%25%0D%0A%3A%3Anotice%3A%3Ainjected/)
  assert.match(output, /file=test\/comma%2Cpercent%25\.mjs/)
  assert.match(output, /::failed%25%0A::warning::not a separate command\n$/)
  assert.doesNotMatch(output, /,line=|,col=/)
})

test('GitHub reporter emits only failures and handles missing error details', async () => {
  const output = []
  const events = [
    { type: 'test:pass', data: { name: 'passing test' } },
    { type: 'test:diagnostic', data: { message: 'summary' } },
    { type: 'test:fail', data: { name: 'failing test' } },
  ]
  for await (const chunk of githubReporter(events)) output.push(chunk)
  assert.deepEqual(output, ['::error title=Test failed%3A failing test::Test failed without error details\n'])
})
