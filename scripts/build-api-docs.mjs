import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')
const docsRoot = join(repositoryRoot, 'docs', 'latest', 'api')
const check = process.argv.includes('--check')

const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const declarationsRoot = join(packageRoot, 'types')

function typesTarget(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  if (typeof value.types === 'string') return value.types
  for (const child of Object.values(value)) {
    const target = typesTarget(child)
    if (target) return target
  }
  return null
}

function moduleLabel(exportPath) {
  return exportPath === '.' ? packageJson.name : `${packageJson.name}/${exportPath.slice(2)}`
}

function slug(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'root'
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function declarationKind(statement) {
  return statement.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?(class|interface|type|function|const|let|var|enum|namespace)\b/)?.[1]
    ?? (statement.startsWith('export default') ? 'default' : 'export')
}

function declarationName(statement) {
  return statement.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|function|const|let|var|enum|namespace)\s+([A-Za-z_$][\w$]*)/)?.[1]
    ?? statement.match(/^export\s+default\s+(?:declare\s+)?(?:class|function)?\s*([A-Za-z_$][\w$]*)?/)?.[1]
    ?? 'default'
}

function topLevelExports(source) {
  const positions = []
  let braces = 0
  let quote = ''
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1 }
      continue
    }
    if (quote) {
      if (char === '\\') { index += 1; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{') { braces += 1; continue }
    if (char === '}') { braces -= 1; continue }
    if (braces !== 0 || !source.startsWith('export', index)) continue
    const before = source[index - 1]
    const after = source[index + 6]
    if ((!before || !/[\w$]/.test(before)) && (!after || !/[\w$]/.test(after))) positions.push(index)
  }
  return positions
}

function exportedStatements(source) {
  const starts = topLevelExports(source)
  return starts.map(start => source.slice(start, exportStatementEnd(source, start)).trim()).filter(Boolean)
}

function exportStatementEnd(source, start) {
  const prefix = source.slice(start, start + 160)
  const blockDeclaration = /^export\s+(?:(?:default|declare|abstract)\s+)*(?:class|interface|enum|namespace)\b/.test(prefix)
  let curly = 0
  let round = 0
  let square = 0
  let sawBlock = false
  let quote = ''
  let lineComment = false
  let blockComment = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1 }
      continue
    }
    if (quote) {
      if (char === '\\') { index += 1; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{') { curly += 1; sawBlock = true; continue }
    if (char === '}') {
      curly -= 1
      if (blockDeclaration && sawBlock && curly === 0 && round === 0 && square === 0) return index + 1 + (source[index + 1] === ';' ? 1 : 0)
      continue
    }
    if (char === '(') { round += 1; continue }
    if (char === ')') { round -= 1; continue }
    if (char === '[') { square += 1; continue }
    if (char === ']') { square -= 1; continue }
    if (!blockDeclaration && char === ';' && curly === 0 && round === 0 && square === 0) return index + 1
  }
  return source.length
}

function resolveDeclaration(fromFile, specifier) {
  const direct = resolve(dirname(fromFile), specifier.replace(/\.js$/i, '.d.ts'))
  const candidates = [direct, `${direct}.d.ts`, join(direct, 'index.d.ts')]
  const match = candidates.find(candidate => existsSync(candidate))
  if (!match) throw new Error(`Cannot resolve declaration re-export ${specifier} from ${relative(repositoryRoot, fromFile)}`)
  if (relative(declarationsRoot, match).startsWith('..')) throw new Error(`Declaration re-export escapes types/: ${match}`)
  return match
}

const parsedFiles = new Map()
async function parseFile(filePath, stack = []) {
  const absolute = normalize(filePath)
  if (parsedFiles.has(absolute)) return parsedFiles.get(absolute)
  if (stack.includes(absolute)) throw new Error(`Circular declaration export: ${[...stack, absolute].join(' -> ')}`)
  const source = await readFile(absolute, 'utf8')
  const records = []
  for (const statement of exportedStatements(source)) {
    const star = statement.match(/^export\s+\*\s+from\s+['"]([^'"]+)['"]\s*;/)
    if (star) {
      records.push(...await parseFile(resolveDeclaration(absolute, star[1]), [...stack, absolute]))
      continue
    }
    const named = statement.match(/^export\s*{([\s\S]*?)}\s*(?:from\s+['"]([^'"]+)['"])?\s*;/)
    if (named) {
      const upstream = named[2] ? await parseFile(resolveDeclaration(absolute, named[2]), [...stack, absolute]) : []
      for (const item of named[1].split(',').map(value => value.trim()).filter(Boolean)) {
        const match = item.replace(/^type\s+/, '').match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
        if (!match) continue
        const sourceName = match[1]
        const name = match[2] ?? sourceName
        const original = upstream.find(record => record.name === sourceName)
        records.push(original ? { ...original, name } : { name, kind: 'export', declaration: statement, source: relative(declarationsRoot, absolute).replaceAll('\\', '/') })
      }
      continue
    }
    const name = declarationName(statement)
    records.push({
      name,
      kind: declarationKind(statement),
      declaration: statement,
      source: relative(declarationsRoot, absolute).replaceAll('\\', '/'),
    })
  }
  const deduplicated = []
  for (const record of records) {
    const existing = deduplicated.find(candidate => candidate.name === record.name)
    if (existing) existing.declaration = `${existing.declaration}\n${record.declaration}`
    else deduplicated.push(record)
  }
  parsedFiles.set(absolute, deduplicated)
  return deduplicated
}

const modules = []
for (const [exportPath, exportValue] of Object.entries(packageJson.exports ?? {})) {
  const target = typesTarget(exportValue)
  if (!target) throw new Error(`Package export ${exportPath} has no TypeScript declaration target`)
  const declarationPath = resolve(packageRoot, target)
  if (!existsSync(declarationPath)) throw new Error(`Missing declaration target for ${exportPath}: ${target}`)
  const id = exportPath === '.' ? 'root' : slug(exportPath.slice(2))
  const symbols = (await parseFile(declarationPath)).map(symbol => ({
    ...symbol,
    anchor: `${id}-${slug(symbol.kind)}-${slug(symbol.name)}`,
  })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
  if (!symbols.length) throw new Error(`Package export ${exportPath} exposes no documented symbols`)
  modules.push({
    exportPath,
    packageName: moduleLabel(exportPath),
    declaration: target.replace(/^\.\//, ''),
    anchor: `module-${id}`,
    symbols,
  })
}

const sourceFiles = [...new Set(modules.flatMap(module => module.symbols.map(symbol => symbol.source)))].sort()
const sourceHash = createHash('sha256')
for (const source of sourceFiles) sourceHash.update(source).update('\0').update(await readFile(join(declarationsRoot, source))).update('\0')
const api = {
  schema: 'com.kanjie.kjdraw.api-reference@1',
  package: packageJson.name,
  version: packageJson.version,
  source: 'packages/kjdraw-sdk/types',
  sourceDigest: `sha256:${sourceHash.digest('hex')}`,
  modules,
}

const searchIndex = {
  schema: 'com.kanjie.kjdraw.api-search-index@1',
  package: api.package,
  version: api.version,
  sourceDigest: api.sourceDigest,
  entries: modules.flatMap(module => module.symbols.map(symbol => ({
    name: symbol.name,
    kind: symbol.kind,
    module: module.packageName,
    href: `./api/#${symbol.anchor}`,
    anchor: symbol.anchor,
    summary: symbol.declaration.replace(/\s+/g, ' ').slice(0, 220),
  }))),
}

const moduleNavigation = modules.map(module => `<a href="#${module.anchor}"><code>${escapeHtml(module.packageName.replace(`${packageJson.name}/`, './'))}</code><span>${module.symbols.length}</span></a>`).join('\n')
const moduleSections = modules.map(module => `
<section class="api-module" id="${module.anchor}" data-module="${escapeHtml(module.packageName)}">
  <header class="module-header"><div><p class="eyebrow">PACKAGE EXPORT</p><h2><code>${escapeHtml(module.packageName)}</code></h2></div><a class="permalink" href="#${module.anchor}" aria-label="Link to ${escapeHtml(module.packageName)}">#</a></header>
  <p class="module-source"><span data-copy="generatedFrom">Generated from</span> <code>${escapeHtml(module.declaration)}</code> · ${module.symbols.length} <span data-copy="symbols">symbols</span></p>
  <div class="api-symbols">
    ${module.symbols.map(symbol => `<article class="api-symbol" id="${symbol.anchor}" data-search="${escapeHtml(`${symbol.name} ${symbol.kind} ${module.packageName} ${symbol.declaration}`.toLowerCase())}">
      <header><div><span class="kind">${escapeHtml(symbol.kind)}</span><h3>${escapeHtml(symbol.name)}</h3></div><a class="permalink" href="#${symbol.anchor}" aria-label="Link to ${escapeHtml(symbol.name)}">#</a></header>
      <pre><button class="copy" data-copy-code>Copy</button><code>${escapeHtml(symbol.declaration)}</code></pre>
      <p class="source-path">${escapeHtml(symbol.source)}</p>
    </article>`).join('\n')}
  </div>
</section>`).join('\n')

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Generated API reference for ${escapeHtml(packageJson.name)} ${escapeHtml(packageJson.version)}.">
  <title>API Reference · KJDraw</title>
  <link rel="icon" href="../../assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../style.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="../"><img src="../../assets/mark.svg" alt=""><b>KJDraw</b><span>API</span></a>
    <label class="api-search"><span aria-hidden="true">⌕</span><input id="api-search" type="search" autocomplete="off" placeholder="Search ${escapeHtml(String(searchIndex.entries.length))} exported symbols" aria-label="Search API reference"><kbd>/</kbd></label>
    <nav><a href="../" data-copy="guides">Guides</a><a href="../../../" data-copy="demo">Live Demo</a><a href="https://github.com/KanJieTeam/kjdraw">GitHub</a><button id="language">中文</button></nav>
  </header>
  <div class="layout api-layout">
    <aside class="sidebar api-sidebar">
      <div class="version"><span data-copy="apiReference">API Reference</span><strong>v${escapeHtml(packageJson.version)}</strong></div>
      <p class="sidebar-summary">${modules.length} <span data-copy="entrypoints">entry points</span> · ${searchIndex.entries.length} <span data-copy="exports">exports</span></p>
      <nav>${moduleNavigation}</nav>
    </aside>
    <main class="api-main">
      <article>
        <section class="api-intro" id="api-reference">
          <p class="eyebrow">GENERATED / SHA-256 VERIFIED</p>
          <h1 data-copy="title">TypeScript API Reference</h1>
          <p class="lead" data-copy="lead">Every entry below is generated from the declarations shipped in the npm package. The generator covers every public package export and CI rejects stale documentation.</p>
          <div class="api-metrics"><span><b>${modules.length}</b><small data-copy="entrypoints">entry points</small></span><span><b>${searchIndex.entries.length}</b><small data-copy="exportedSymbols">exported symbols</small></span><span><b>${escapeHtml(api.sourceDigest.slice(-12))}</b><small>source digest</small></span></div>
        </section>
        <div id="empty-state" hidden><h2 data-copy="noResults">No matching API</h2><p data-copy="noResultsBody">Try a symbol, type, command, file format or package path.</p></div>
        ${moduleSections}
      </article>
    </main>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
`

const appJs = `const zh={guides:'指南',demo:'在线 Demo',apiReference:'API 参考',entrypoints:'入口',exports:'导出',exportedSymbols:'导出符号',title:'TypeScript API 参考',lead:'下方每一项均由 npm 包实际发布的类型声明自动生成。生成器覆盖全部公开入口，CI 会阻止声明与文档发生漂移。',generatedFrom:'生成自',symbols:'个符号',noResults:'未找到匹配 API',noResultsBody:'请尝试符号名、类型、命令、文件格式或包路径。',searchPlaceholder:'搜索 ${escapeHtml(String(searchIndex.entries.length))} 个导出符号'}
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
const english=new Map([...document.querySelectorAll('[data-copy]')].map(element=>[element,element.textContent]))
const input=document.getElementById('api-search'),defaultSearchPlaceholder=input.placeholder
function applyLanguage(){document.documentElement.lang=locale==='zh'?'zh-CN':'en';for(const [element,value]of english)element.textContent=locale==='zh'?(zh[element.dataset.copy]??value):value;input.placeholder=locale==='zh'?zh.searchPlaceholder:defaultSearchPlaceholder;document.getElementById('language').textContent=locale==='zh'?'EN':'中文'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage()}
for(const button of document.querySelectorAll('[data-copy-code]'))button.onclick=async()=>{await navigator.clipboard.writeText(button.nextElementSibling.textContent);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)}
const modules=[...document.querySelectorAll('.api-module')],empty=document.getElementById('empty-state')
function search(){const terms=input.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);let visible=0;for(const module of modules){let moduleVisible=0;for(const symbol of module.querySelectorAll('.api-symbol')){const show=terms.every(term=>symbol.dataset.search.includes(term));symbol.hidden=!show;if(show)moduleVisible+=1}module.hidden=moduleVisible===0;visible+=moduleVisible}empty.hidden=visible!==0;const url=new URL(location.href);if(input.value)url.searchParams.set('q',input.value);else url.searchParams.delete('q');history.replaceState(null,'',url)}
input.value=new URL(location.href).searchParams.get('q')??'';input.addEventListener('input',search);search()
window.addEventListener('keydown',event=>{if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName)){event.preventDefault();input.focus()}})
for(const link of document.querySelectorAll('.permalink'))link.addEventListener('click',()=>{history.replaceState(null,'',link.hash);document.getElementById(link.hash.slice(1))?.focus({preventScroll:true})})
applyLanguage()
`

const css = `.api-layout{grid-template-columns:285px minmax(0,1fr)}.api-sidebar{width:285px}.api-sidebar .version strong{display:block;font:13px Consolas;color:#26334a}.sidebar-summary{margin:-12px 0 18px;color:#858d99;font-size:11px}.api-sidebar nav a{display:flex;align-items:center;gap:8px}.api-sidebar nav code{overflow:hidden;text-overflow:ellipsis}.api-sidebar nav span{margin-left:auto;min-width:23px;padding:2px 5px;border-radius:10px;background:#eef2f8;color:#687385;text-align:center;font:10px Consolas}.api-search{width:min(520px,42vw);height:34px;display:flex;align-items:center;gap:9px;padding:0 10px;border:1px solid #d8dce2;border-radius:6px;background:#f7f8fa;color:#737b87}.api-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;font:13px inherit}.api-search kbd{padding:2px 6px;border:1px solid #d9dde3;border-radius:4px;background:#fff;font:10px Consolas}.api-main{grid-column:2;display:block;max-width:1120px;margin:0 auto;padding:54px 54px 100px}.api-intro{padding-bottom:44px;margin-bottom:44px}.api-intro h1{font-size:45px}.api-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:28px}.api-metrics span{padding:15px;border:1px solid var(--line);border-radius:6px;background:linear-gradient(145deg,#fff,#f8faff)}.api-metrics b,.api-metrics small{display:block}.api-metrics b{overflow:hidden;color:#184cb6;font:16px Consolas;text-overflow:ellipsis}.api-metrics small{margin-top:5px;color:#747d89;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.api-module{scroll-margin-top:82px}.module-header,.api-symbol>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.module-header h2{margin:0}.module-header h2 code{font-size:22px}.module-source{margin-top:7px;font-size:12px}.api-symbols{display:grid;gap:12px;margin-top:25px}.api-symbol{scroll-margin-top:82px;padding:18px 18px 12px;border:1px solid var(--line);border-radius:7px;background:#fff}.api-symbol:target{border-color:#78a0ff;box-shadow:0 0 0 3px #2863f014}.api-symbol>header>div{display:flex;align-items:center;gap:9px}.api-symbol h3{margin:0;font:600 16px Consolas;color:#1d2736}.kind{padding:3px 6px;border-radius:3px;background:#eef3ff;color:#2454b7;font:9px Consolas;text-transform:uppercase}.permalink{color:#a5acb6;font:16px Consolas}.permalink:hover{color:var(--blue)}.api-symbol pre{max-height:360px;margin:14px 0 8px;font-size:12px;white-space:pre-wrap}.source-path{margin:0;color:#9299a3;font:10px Consolas}#empty-state{padding:60px 20px;text-align:center}.api-symbol[hidden],.api-module[hidden]{display:none}@media(max-width:860px){.api-layout{display:block}.api-sidebar{display:none}.api-main{padding:38px 20px 70px}.api-search{margin-left:auto;width:42px}.api-search input,.api-search kbd{display:none}.api-search:focus-within{position:absolute;left:12px;right:12px;width:auto;background:#fff}.api-search:focus-within input,.api-search:focus-within kbd{display:block}.api-metrics{grid-template-columns:1fr}.api-intro h1{font-size:37px}.topbar nav a{display:none}}`

const outputs = new Map([
  ['api-reference.json', `${JSON.stringify(api, null, 2)}\n`],
  ['search-index.json', `${JSON.stringify(searchIndex, null, 2)}\n`],
  ['index.html', html],
  ['app.js', appJs],
  ['style.css', css],
])

if (check) {
  const stale = []
  for (const [name, content] of outputs) {
    const committed = await readFile(join(docsRoot, name), 'utf8').catch(() => null)
    if (committed !== content) stale.push(name)
  }
  const existing = existsSync(docsRoot) ? await import('node:fs/promises').then(({ readdir }) => readdir(docsRoot)) : []
  for (const name of existing) if (!outputs.has(name)) stale.push(name)
  if (stale.length) {
    console.error(`Generated API documentation is stale:\n${[...new Set(stale)].sort().map(name => `- docs/latest/api/${name}`).join('\n')}\nRun: npm run build:docs`)
    process.exitCode = 1
  } else {
    console.log(`Verified API docs for ${modules.length} package exports and ${searchIndex.entries.length} exported symbols.`)
  }
} else {
  await rm(docsRoot, { recursive: true, force: true })
  await mkdir(docsRoot, { recursive: true })
  await Promise.all([...outputs].map(([name, content]) => writeFile(join(docsRoot, name), content)))
  console.log(`Built API docs for ${modules.length} package exports and ${searchIndex.entries.length} exported symbols.`)
}
