import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'acorn'

const ownPath = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(ownPath, '../../..')
const ignored = new Set(['node_modules', '.git', '.cache', 'dist', 'target', 'test-results', 'playwright-report'])

function relativeDependencies(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const dependencies = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) &&
      node.source?.type === 'Literal' && typeof node.source.value === 'string') dependencies.push(node.source.value)
    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'URL' &&
      node.arguments?.[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string' &&
      node.arguments?.[1]?.type === 'MemberExpression' && node.arguments[1].property?.name === 'url' &&
      node.arguments[1].object?.type === 'MetaProperty' && node.arguments[1].object.meta?.name === 'import') {
      const url = node.arguments[0].value
      if (/\.(?:m?js)(?:[?#]|$)/.test(url)) dependencies.push(url)
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(ast)
  return [...new Set(dependencies)].filter(value => value.startsWith('.') || value.startsWith('/') && !value.startsWith('//'))
}

async function publicScripts(root, directory) {
  const scripts = []
  let entries
  try { entries = await readdir(resolve(root, directory), { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return scripts; throw error }
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) scripts.push(...await publicScripts(root, path))
    else if (entry.isFile() && /\.(?:m?js)$/.test(path)) scripts.push(path)
  }
  return scripts
}

/** Parse, but never execute, the complete static browser module graph. */
export async function auditBrowserModuleGraph({ root = repositoryRoot, entryPoints, publishedPaths } = {}) {
  const entries = entryPoints ?? [
    ...await publicScripts(root, 'apps/playground'), ...await publicScripts(root, 'docs/latest'),
  ]
  const queue = [...entries], visited = new Set(), missing = [], parseErrors = [], edges = []
  const knownPublication = publishedPaths == null ? null : new Set(publishedPaths)
  while (queue.length) {
    const path = queue.shift()
    if (visited.has(path)) continue
    visited.add(path)
    let source
    try { source = await readFile(resolve(root, path), 'utf8') }
    catch (error) { if (error.code === 'ENOENT') { missing.push({ importer: null, specifier: path, target: path, reason: 'entry-not-delivered' }); continue }; throw error }
    let dependencies
    try { dependencies = relativeDependencies(source) }
    catch (error) { parseErrors.push({ path, message: error.message }); continue }
    for (const specifier of dependencies) {
      const url = new URL(specifier, `https://publication.invalid/${path}`)
      const target = decodeURIComponent(url.pathname).slice(1)
      const absolute = resolve(root, target), relation = relative(root, absolute)
      const edge = { importer: path, specifier, target }
      edges.push(edge)
      if (relation === '..' || relation.startsWith(`..${sep}`)) { missing.push({ ...edge, reason: 'outside-publication' }); continue }
      if (knownPublication && !knownPublication.has(target)) {
        missing.push({ ...edge, reason: 'not-in-published-tree' })
        // The candidate may have been repaired after its publication. Still
        // traverse any available copy so secondary missing imports cannot hide.
      }
      let exists
      try { exists = (await stat(absolute)).isFile() } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false }
      if (!exists) {
        if (!knownPublication || knownPublication.has(target)) missing.push({ ...edge, reason: 'file-not-delivered' })
        continue
      }
      if (/\.(?:m?js)$/.test(target)) queue.push(target)
    }
  }
  return { entryPointCount: entries.length, moduleCount: visited.size, edgeCount: edges.length,
    missing: missing.sort((a, b) => `${a.importer}/${a.target}`.localeCompare(`${b.importer}/${b.target}`)), parseErrors }
}

if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  const report = await auditBrowserModuleGraph({ root: process.argv[2] ? resolve(process.argv[2]) : repositoryRoot })
  console.log(JSON.stringify(report, null, 2))
  if (report.missing.length || report.parseErrors.length) process.exitCode = 1
}
