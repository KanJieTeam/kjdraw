import { relative } from 'node:path'

const escapeData = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const escapeProperty = value => escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C')

export function failureAnnotation(data, root = process.cwd()) {
  const properties = [`title=${escapeProperty(`Test failed: ${data.name ?? 'unnamed test'}`)}`]
  if (data.file) properties.push(`file=${escapeProperty(relative(root, data.file).replaceAll('\\', '/'))}`)
  if (Number.isInteger(data.line) && data.line > 0) properties.push(`line=${data.line}`)
  if (Number.isInteger(data.column) && data.column > 0) properties.push(`col=${data.column}`)
  const error = data.details?.error
  // Node wraps assertion errors; keep the assertion stack rather than only "test failed".
  const cause = error?.cause ?? error
  const message = cause?.stack ?? cause?.message ?? cause ?? 'Test failed without error details'
  return `::error ${properties.join(',')}::${escapeData(message)}\n`
}

export default async function * githubReporter(events) {
  for await (const event of events) {
    if (event.type === 'test:fail') yield failureAnnotation(event.data)
  }
}
