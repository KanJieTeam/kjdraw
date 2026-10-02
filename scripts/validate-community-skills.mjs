import { readdir, readFile, realpath, lstat, stat } from 'node:fs/promises'
import { resolve, join, relative, dirname, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Zero-dependency structural checks, not a YAML/Markdown parser or a model
 * behavior test. Community packs are immediate children of skills/<name>.
 * Frontmatter supports unquoted or single/double-quoted one-line strings and
 * description: | / > blocks (optional +/- chomping). Optional top-level fields
 * and indented metadata are allowed but never interpreted or executed.
 * Markdown resources: ordinary inline/image links and reference definitions,
 * including angle-bracket destinations and escaped punctuation. Fenced/inline
 * code is ignored. Fragments/query suffixes are not resource filenames. External
 * URLs are not requested; local lexical and real paths must remain in the pack.
 */
export const COMMUNITY_SKILLS_CONTRACT = Object.freeze({
  version: 'community-skills-structure-v1', structuralOnly: true,
  namePattern: 'kjdraw- followed by lowercase letters, digits or hyphens; max 63 characters',
  reservedNames: Object.freeze(['kjdraw-cad']),
  requiredFiles: Object.freeze(['SKILL.md', 'README.md', 'README.zh-CN.md']),
  acceptanceReferenceOptional: true,
  behavioralValidationPerformed: false, externalLinksProbed: false,
})
const defaultRoot = fileURLToPath(new URL('../skills/', import.meta.url))
const nameValid = value => typeof value === 'string' && value.length <= 63 && /^kjdraw-[a-z0-9-]+$/.test(value)
const inside = (boundary, target) => { const rel = relative(boundary, target); return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }

function stringScalar(raw) {
  raw = raw.trim()
  if (!raw || raw.startsWith('#')) return null
  if (raw[0] === '"') {
    let end = 1
    while (end < raw.length) { if (raw[end] === '\\') end += 2; else if (raw[end++] === '"') break }
    const token = raw.slice(0, end), trailing = raw.slice(end).trim()
    if (trailing && !trailing.startsWith('#')) return null
    try { const value = JSON.parse(token); return typeof value === 'string' ? value : null } catch { return null }
  }
  if (raw[0] === "'") {
    let value = '', end = 1, closed = false
    for (; end < raw.length; end++) {
      if (raw[end] !== "'") value += raw[end]
      else if (raw[end + 1] === "'") { value += "'"; end++ }
      else { end++; closed = true; break }
    }
    return closed && (!raw.slice(end).trim() || raw.slice(end).trim().startsWith('#')) ? value : null
  }
  const value = raw.replace(/\s+#.*$/, '').trim()
  // Required strings must not be YAML aliases/tags, collections or implicit
  // booleans/numbers/null. Quote strings whose syntax would be ambiguous.
  if (/^[\[\]{&*!|>]/.test(value) || /:\s/.test(value) || /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)$/i.test(value)) return null
  return value || null
}
export function parseCommunitySkillFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n'), errors = []
  if (lines[0] !== '---') return { errors: ['FRONTMATTER_REQUIRED'] }
  const close = lines.findIndex((line, index) => index > 0 && line === '---')
  if (close < 0) return { errors: ['FRONTMATTER_UNCLOSED'] }
  const fields = new Map(); let current
  for (const line of lines.slice(1, close)) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    if (/^[ \t]/.test(line)) {
      if (!current || line.startsWith('\t')) errors.push('UNSUPPORTED_FRONTMATTER_SYNTAX')
      else current.continuation.push(line)
      continue
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line)
    if (!match) { errors.push('UNSUPPORTED_FRONTMATTER_SYNTAX'); current = undefined; continue }
    current = { raw: match[2] ?? '', continuation: [] }
    if (fields.has(match[1])) errors.push('DUPLICATE_FRONTMATTER_FIELD')
    else fields.set(match[1], current)
  }
  const required = key => {
    const field = fields.get(key)
    if (!field) return null
    const block = /^([|>])[+-]?(?:\s+#.*)?$/.exec(field.raw.trim())
    if (key === 'description' && block) return field.continuation.map(line => line.trim()).join(block[1] === '>' ? ' ' : '\n').trim()
    if (field.continuation.length || block) { errors.push('UNSUPPORTED_REQUIRED_FIELD_SYNTAX'); return null }
    return stringScalar(field.raw)
  }
  return { name: required('name'), description: required('description'), body: lines.slice(close + 1).join('\n'), errors }
}
function meaningful(text) {
  const content = text.split(/\r?\n/).filter(line => line.trim() && !/^\s{0,3}#{1,6}(?:\s|$)/.test(line) &&
    !/^\s*(?:[-*_]\s*){3,}$/.test(line)).map(line => line.replace(/^\s*[-*>]\s*/, '').trim())
  return content.some(line => !/^(?:\[|<)?(?:TODO|TBD|FIXME|PLACEHOLDER|COMING SOON|REPLACE ME|待补充|待完善|稍后补充)(?:\]|>)?[.!。！\s]*$/i.test(line))
}
function proseOnly(text) {
  let fence
  return text.split(/\r?\n/).map(line => {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (match) {
      if (!fence) fence = { char: match[1][0], length: match[1].length }
      else if (match[1][0] === fence.char && match[1].length >= fence.length) fence = undefined
      return ''
    }
    if (fence) return ''
    return line.replace(/(`+)([\s\S]*?)\1(?!`)/g, '')
  }).join('\n')
}
function markdownDestinations(text) {
  const clean = proseOnly(text), destinations = []
  const openings = /!?\[[^\]\n]*\]\(/g
  for (let match; (match = openings.exec(clean));) {
    let index = openings.lastIndex
    while (/\s/.test(clean[index] ?? '') && index < clean.length) index++
    if (clean[index] === '<') {
      const end = clean.indexOf('>', index + 1)
      if (end >= 0 && !clean.slice(index, end).includes('\n')) destinations.push(clean.slice(index + 1, end))
      continue
    }
    let destination = '', depth = 0
    for (; index < clean.length; index++) {
      const char = clean[index]
      if (char === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(clean[index + 1] ?? '')) { destination += clean[++index]; continue }
      if (char === '(') depth++
      if (char === ')') { if (!depth) break; depth-- }
      if (/\s/.test(char) && !depth) break
      destination += char
    }
    if (destination) destinations.push(destination)
  }
  for (const line of clean.split('\n')) {
    const definition = /^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/.exec(line)
    if (definition) destinations.push(definition[1] ?? definition[2])
  }
  return destinations
}
async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(path)
  }
  return files
}

export async function validateCommunitySkills(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'root') ||
    options.root !== undefined && (typeof options.root !== 'string' || !options.root.trim())) throw new TypeError('Use only a nonempty root path')
  const root = resolve(options.root ?? defaultRoot), errors = [], packs = [], discoveredNames = new Map()
  const error = (pack, file, code) => errors.push({ ...(pack ? { pack } : {}), ...(file ? { file } : {}), code })
  let entries
  try { if (!(await stat(root)).isDirectory()) throw Error(); entries = await readdir(root, { withFileTypes: true }) }
  catch { return { ok: false, structuralOnly: true, behavioralValidationPerformed: false, packs, errors: [{ code: 'SKILLS_ROOT_NOT_DIRECTORY' }] } }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue // e.g. skills/README.md is an index, not a pack.
    const name = entry.name, boundary = join(root, name), before = errors.length
    const pack = { name, valid: false, checkedMarkdownFiles: 0, checkedLocalResources: 0, externalLinksNotProbed: 0 }
    packs.push(pack)
    if (!nameValid(name)) error(name, undefined, 'INVALID_COMMUNITY_SKILL_NAME')
    if (COMMUNITY_SKILLS_CONTRACT.reservedNames.includes(name)) error(name, undefined, 'RESERVED_FOUNDATION_SKILL_NAME')
    if (entry.isSymbolicLink()) { error(name, undefined, 'PACK_SYMLINK_NOT_ALLOWED'); continue }
    const packReal = await realpath(boundary), content = new Map()
    for (const file of COMMUNITY_SKILLS_CONTRACT.requiredFiles) {
      try {
        const path = join(boundary, file), actual = await realpath(path)
        if (!inside(packReal, actual)) { error(name, file, 'RESOURCE_ESCAPES_PACK'); continue }
        if (!(await stat(actual)).isFile()) { error(name, file, 'REQUIRED_MARKDOWN_NOT_FILE'); continue }
        const text = await readFile(path, 'utf8'); content.set(file, text)
        if (file !== 'SKILL.md' && !meaningful(text)) error(name, file, 'EMPTY_OR_PLACEHOLDER_DOCUMENT')
      } catch { error(name, file, 'MISSING_REQUIRED_FILE') }
    }
    if (content.has('SKILL.md')) {
      const frontmatter = parseCommunitySkillFrontmatter(content.get('SKILL.md'))
      frontmatter.errors.forEach(code => error(name, 'SKILL.md', code))
      if (typeof frontmatter.body !== 'string' || !meaningful(frontmatter.body)) error(name, 'SKILL.md', 'EMPTY_OR_PLACEHOLDER_SKILL_BODY')
      if (!nameValid(frontmatter.name)) error(name, 'SKILL.md', 'INVALID_FRONTMATTER_NAME')
      if (frontmatter.name !== name) error(name, 'SKILL.md', 'NAME_DIRECTORY_MISMATCH')
      if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) error(name, 'SKILL.md', 'NONEMPTY_DESCRIPTION_REQUIRED')
      if (typeof frontmatter.name === 'string') {
        if (discoveredNames.has(frontmatter.name)) error(name, 'SKILL.md', 'DUPLICATE_SKILL_NAME')
        else discoveredNames.set(frontmatter.name, name)
      }
    }
    const paths = await markdownFiles(boundary), queue = [...new Set([...paths,
      ...[...content.keys()].map(file => join(boundary, file))])], visited = new Set()
    while (queue.length) {
      const path = queue.shift(), file = relative(boundary, path).replaceAll(sep, '/')
      if (visited.has(path)) continue
      visited.add(path)
      let actual, text
      try { actual = await realpath(path); if (!inside(packReal, actual)) { error(name, file, 'RESOURCE_ESCAPES_PACK'); continue }
        text = await readFile(path, 'utf8') } catch { error(name, file, 'UNREADABLE_MARKDOWN_RESOURCE'); continue }
      pack.checkedMarkdownFiles++
      if (file === 'references/acceptance.md' && !meaningful(text)) error(name, file, 'EMPTY_OR_PLACEHOLDER_DOCUMENT')
      for (const destination of markdownDestinations(text)) {
        if (!destination || destination.startsWith('#') || destination.startsWith('?')) continue
        if (/^(?:https?:|mailto:|data:|\/\/)/i.test(destination) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) &&
          !/^(?:file:|[A-Za-z]:[\\/])/i.test(destination)) { pack.externalLinksNotProbed++; continue }
        let local
        try { local = decodeURIComponent(destination.split(/[?#]/)[0]) } catch { error(name, file, 'INVALID_RESOURCE_ENCODING'); continue }
        if (!local) continue
        if (/^(?:file:|[A-Za-z]:[\\/]|[\\/])/i.test(local)) { error(name, file, 'RESOURCE_ESCAPES_PACK'); continue }
        const target = resolve(dirname(path), local.replaceAll('\\', '/'))
        if (!inside(boundary, target)) { error(name, file, 'RESOURCE_ESCAPES_PACK'); continue }
        try {
          const targetReal = await realpath(target)
          if (!inside(packReal, targetReal)) { error(name, file, 'RESOURCE_ESCAPES_PACK'); continue }
          await lstat(target); pack.checkedLocalResources++
          if (/\.md$/i.test(target) && (await stat(targetReal)).isFile()) queue.push(target)
        } catch { error(name, file, 'MISSING_LOCAL_RESOURCE') }
      }
    }
    pack.valid = errors.length === before
  }
  return { ok: errors.length === 0, structuralOnly: true, behavioralValidationPerformed: false, packs, errors }
}
async function cli(args) {
  if (args.length === 1 && args[0] === '--help') { console.log('Usage: node scripts/validate-community-skills.mjs [--root <skills-directory>]\nStructural checks only; no model behavior, installation or external requests.'); return }
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1]?.trim())) {
    console.error('Usage: node scripts/validate-community-skills.mjs [--root <skills-directory>]'); process.exitCode = 1; return
  }
  const result = await validateCommunitySkills(args.length ? { root: args[1] } : {})
  console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli(process.argv.slice(2))
