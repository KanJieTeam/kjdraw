import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')
const declarationsRoot = join(packageRoot, 'types')
const docsRoot = join(repositoryRoot, 'docs', 'latest', 'api')
const guideSourcePath = join(repositoryRoot, 'docs', 'site', 'api', 'editor-api.json')
const check = process.argv.includes('--check')

const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const guideSource = await readFile(guideSourcePath, 'utf8')
const editorGuide = JSON.parse(guideSource)

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

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
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'root'
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  return topLevelExports(source)
    .map(start => source.slice(start, exportStatementEnd(source, start)).trim())
    .filter(Boolean)
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
      if (blockDeclaration && sawBlock && curly === 0 && round === 0 && square === 0) {
        return index + 1 + (source[index + 1] === ';' ? 1 : 0)
      }
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
        records.push(original
          ? { ...original, name }
          : { name, kind: 'export', declaration: statement, source: relative(declarationsRoot, absolute).replaceAll('\\', '/') })
      }
      continue
    }
    records.push({
      name: declarationName(statement),
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
  invariant(target, `Package export ${exportPath} has no TypeScript declaration target`)
  const declarationPath = resolve(packageRoot, target)
  invariant(existsSync(declarationPath), `Missing declaration target for ${exportPath}: ${target}`)
  const id = exportPath === '.' ? 'root' : slug(exportPath.slice(2))
  const symbols = (await parseFile(declarationPath)).map(symbol => ({
    ...symbol,
    anchor: `${id}-${slug(symbol.kind)}-${slug(symbol.name)}`,
  })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
  invariant(symbols.length, `Package export ${exportPath} exposes no documented symbols`)
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
for (const source of sourceFiles) {
  sourceHash.update(source).update('\0').update(await readFile(join(declarationsRoot, source))).update('\0')
}
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
    href: `./api/reference/#${symbol.anchor}`,
    anchor: symbol.anchor,
    summary: symbol.declaration.replace(/\s+/g, ' ').slice(0, 220),
  }))),
}

invariant(editorGuide.schema === 'com.kanjie.kjdraw.editor-api-guide@1', 'Unexpected Editor API guide schema')
for (const field of ['title', 'lead']) {
  invariant(editorGuide[field]?.en && editorGuide[field]?.zh, `Editor API guide is missing bilingual ${field}`)
}
for (const collection of ['options', 'properties', 'methods', 'events']) {
  invariant(Array.isArray(editorGuide[collection]) && editorGuide[collection].length, `Editor API guide has no ${collection}`)
  const names = editorGuide[collection].map(entry => entry.name)
  invariant(new Set(names).size === names.length, `Editor API guide repeats a ${collection} name`)
  for (const entry of editorGuide[collection]) {
    invariant(entry.en && entry.zh, `${collection}.${entry.name} needs English and Chinese descriptions`)
  }
}

const editorModule = modules.find(module => module.exportPath === './editor')
const rootModule = modules.find(module => module.exportPath === '.')
invariant(editorModule, 'The package must export ./editor')
invariant(rootModule?.symbols.some(symbol => symbol.name === editorGuide.symbol), `${editorGuide.symbol} must be exported from the package root`)
const findEditorSymbol = name => editorModule.symbols.find(symbol => symbol.name === name)?.declaration ?? ''
const optionsDeclaration = findEditorSymbol('KJDrawEditorOptions')
const classDeclaration = findEditorSymbol(editorGuide.class)
const eventsDeclaration = findEditorSymbol('KJDrawEditorEvents')
invariant(optionsDeclaration && classDeclaration && eventsDeclaration, 'Editor declarations are incomplete')
for (const option of editorGuide.options) {
  invariant(new RegExp(`\\b${escapeRegExp(option.name)}\\?\\s*:`).test(optionsDeclaration), `Documented option ${option.name} is missing from KJDrawEditorOptions`)
  invariant(option.type && option.default, `Documented option ${option.name} needs a type and default`)
}
for (const property of editorGuide.properties) {
  invariant(new RegExp(`\\b(?:get\\s+|readonly\\s+)?${escapeRegExp(property.name)}\\b`).test(classDeclaration), `Documented property ${property.name} is missing from KJDrawEditor`)
  invariant(property.type, `Documented property ${property.name} needs a type`)
}
for (const method of editorGuide.methods) {
  invariant(new RegExp(`\\b${escapeRegExp(method.name)}(?:<[^\\n(]*>)?\\s*\\(`).test(classDeclaration), `Documented method ${method.name} is missing from KJDrawEditor`)
  invariant(method.signature && method.parameters && method.returns, `Documented method ${method.name} is incomplete`)
}
for (const event of editorGuide.events) {
  invariant(new RegExp(`\\b${escapeRegExp(event.name)}\\s*:`).test(eventsDeclaration), `Documented event ${event.name} is missing from KJDrawEditorEvents`)
  invariant(event.payload && event.callback, `Documented event ${event.name} is incomplete`)
}

const editorGuideDigest = `sha256:${createHash('sha256')
  .update(guideSource.replaceAll('\r\n', '\n'))
  .update('\0')
  .update(api.sourceDigest)
  .digest('hex')}`
const editorApi = {
  ...editorGuide,
  package: packageJson.name,
  version: packageJson.version,
  source: 'docs/site/api/editor-api.json',
  sourceDigest: editorGuideDigest,
}

const localized = (en, zh, tag = 'span') => `<${tag} class="lang-en">${escapeHtml(en)}</${tag}><${tag} class="lang-zh">${escapeHtml(zh)}</${tag}>`
const permalink = (anchor, label) => `<a class="permalink" href="#${anchor}" aria-label="Link to ${escapeHtml(label)}">#</a>`
const codeBlock = (code, language = 'ts') => `<pre data-language="${escapeHtml(language)}"><button class="copy" type="button" data-copy-code>Copy</button><code>${escapeHtml(code)}</code></pre>`

const optionRows = editorGuide.options.map(option => {
  const anchor = `option-${slug(option.name)}`
  return `<tr id="${anchor}" data-api-entry data-name="${escapeHtml(option.name)}" data-kind="option" data-search="${escapeHtml(`${option.name} ${option.type} ${option.en} ${option.zh}`.toLowerCase())}"><td><a href="#${anchor}"><code>${escapeHtml(option.name)}</code></a></td><td><code>${escapeHtml(option.type)}</code></td><td><code>${escapeHtml(option.default)}</code></td><td>${localized(option.en, option.zh)}</td></tr>`
}).join('\n')

const propertyRows = editorGuide.properties.map(property => {
  const anchor = `property-${slug(property.name)}`
  return `<tr id="${anchor}" data-api-entry data-name="${escapeHtml(property.name)}" data-kind="property" data-search="${escapeHtml(`${property.name} ${property.type} ${property.en} ${property.zh}`.toLowerCase())}"><td><a href="#${anchor}"><code>${escapeHtml(property.name)}</code></a></td><td><code>${escapeHtml(property.type)}</code></td><td>${localized(property.en, property.zh)}</td></tr>`
}).join('\n')

const methodRows = editorGuide.methods.map(method => {
  const anchor = `method-${slug(method.name)}`
  return `<tr id="${anchor}" data-api-entry data-name="${escapeHtml(method.name)}" data-kind="method" data-search="${escapeHtml(`${method.name} ${method.signature} ${method.parameters} ${method.returns} ${method.en} ${method.zh}`.toLowerCase())}"><td><a href="#${anchor}"><code>${escapeHtml(method.signature)}</code></a></td><td><code>${escapeHtml(method.parameters)}</code></td><td><code>${escapeHtml(method.returns)}</code></td><td>${localized(method.en, method.zh)}</td></tr>`
}).join('\n')

const eventRows = editorGuide.events.map(event => {
  const anchor = `event-${slug(event.name)}`
  return `<tr id="${anchor}" data-api-entry data-name="${escapeHtml(event.name)}" data-kind="event" data-search="${escapeHtml(`${event.name} ${event.payload} ${event.callback} ${event.en} ${event.zh}`.toLowerCase())}"><td><a href="#${anchor}"><code>${escapeHtml(event.name)}</code></a></td><td><code>${escapeHtml(event.payload)}</code></td><td><code>${escapeHtml(event.callback)}</code></td><td>${localized(event.en, event.zh)}</td></tr>`
}).join('\n')

const editorHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="KJDraw Editor API: mount a complete CAD editor and control drawings, files, commands and selection.">
  <title>Editor API · KJDraw</title>
  <link rel="icon" href="../../assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../style.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="../"><img src="../../assets/mark.svg" alt=""><b>KJDraw</b><span>Editor API</span></a>
    <div class="api-search-wrap">
      <label class="api-search"><span aria-hidden="true">⌕</span><input id="api-search" type="search" autocomplete="off" placeholder="Search Editor API" aria-label="Search Editor API"><kbd>/</kbd></label>
      <div id="api-results" class="api-results" hidden></div>
    </div>
    <nav class="top-links"><a href="../">${localized('Guides', '指南')}</a><a href="../../../">Demo</a><a href="https://github.com/KanJieTeam/kjdraw">GitHub</a><button id="language" type="button">中文</button></nav>
  </header>
  <div class="api-shell">
    <aside class="api-sidebar">
      <div class="version"><span>${localized('RECOMMENDED API', '推荐 API')}</span><strong>v${escapeHtml(packageJson.version)}</strong></div>
      <nav>
        <a href="#overview">${localized('Overview', '概览')}</a>
        <a href="#quickstart">${localized('Quickstart', '快速接入')}</a>
        <a href="#options">Options</a>
        <a href="#properties">Properties</a>
        <a href="#methods">Methods</a>
        <a href="#events">Events</a>
        <a href="#frameworks">React / Vue</a>
        <a href="#advanced">${localized('Advanced access', '高级入口')}</a>
        <a class="reference-link" href="./reference/">${localized('All package exports', '全部包导出')} <span>→</span></a>
      </nav>
    </aside>
    <main class="api-main">
      <article>
        <section class="api-hero" id="overview">
          <p class="eyebrow">@kanjieteam/kjdraw</p>
          <h1>${localized(editorGuide.title.en, editorGuide.title.zh)}</h1>
          <p class="lead">${localized(editorGuide.lead.en, editorGuide.lead.zh)}</p>
          <div class="install"><code>npm install ${escapeHtml(packageJson.name)}@${escapeHtml(packageJson.version)}</code><button type="button" data-copy-value="npm install ${escapeHtml(packageJson.name)}@${escapeHtml(packageJson.version)}">Copy</button></div>
        </section>

        <section id="quickstart">
          <h2>${localized('Quickstart', '快速接入')}${permalink('quickstart', 'Quickstart')}</h2>
          <p>${localized('Give the host element a height, create the editor, then wait for ready before using the current drawing.', '先给容器设置高度，创建编辑器，再等待 ready 完成后操作当前图档。')}</p>
          ${codeBlock(editorGuide.containerCode, 'html')}
          ${codeBlock(editorGuide.quickstartCode, 'ts')}
        </section>

        <section id="options">
          <h2>Options${permalink('options', 'Options')}</h2>
          <p>${localized('Pass these values as the second argument to createKJDrawEditor().', '将这些选项作为 createKJDrawEditor() 的第二个参数传入。')}</p>
          <div class="table-wrap"><table><thead><tr><th>${localized('Option', '选项')}</th><th>Type</th><th>${localized('Default', '默认值')}</th><th>${localized('Purpose', '用途')}</th></tr></thead><tbody>${optionRows}</tbody></table></div>
        </section>

        <section id="properties">
          <h2>Properties${permalink('properties', 'Properties')}</h2>
          <p>${localized('Read current editor state and reach lower-level integration points when needed.', '读取当前编辑器状态，并在需要时进入更底层的集成入口。')}</p>
          <div class="table-wrap"><table><thead><tr><th>Property</th><th>Type</th><th>${localized('Purpose', '用途')}</th></tr></thead><tbody>${propertyRows}</tbody></table></div>
        </section>

        <section id="methods">
          <h2>Methods${permalink('methods', 'Methods')}</h2>
          <p>${localized('File operations and edits that return promises can be awaited in application workflows.', '文件操作与返回 Promise 的编辑方法可直接纳入应用异步流程。')}</p>
          <div class="table-wrap wide-table"><table><thead><tr><th>Method</th><th>${localized('Parameters', '参数')}</th><th>${localized('Returns', '返回')}</th><th>${localized('Purpose', '用途')}</th></tr></thead><tbody>${methodRows}</tbody></table></div>
        </section>

        <section id="events">
          <h2>Events${permalink('events', 'Events')}</h2>
          <p>${localized('Use constructor callbacks for common events or editor.on() for every event.', '常用事件可通过初始化回调处理，全部事件都可用 editor.on() 订阅。')}</p>
          ${codeBlock(`const off = editor.on('selectionchange', ({ ids }) => {\n  console.log(ids)\n})\n\n// Later\noff()`, 'ts')}
          <div class="table-wrap"><table><thead><tr><th>Event</th><th>Payload</th><th>${localized('Callback', '快捷回调')}</th><th>${localized('When', '触发时机')}</th></tr></thead><tbody>${eventRows}</tbody></table></div>
        </section>

        <section id="frameworks">
          <h2>React / Vue${permalink('frameworks', 'React and Vue')}</h2>
          <div class="framework-grid">
            <div><h3>React</h3>${codeBlock(editorGuide.reactCode, 'tsx')}<p><a href="../react/">${localized('React guide', 'React 指南')} →</a></p></div>
            <div><h3>Vue</h3>${codeBlock(editorGuide.vueCode, 'vue')}<p><a href="../vue/">${localized('Vue guide', 'Vue 指南')} →</a></p></div>
          </div>
        </section>

        <section id="advanced">
          <h2>${localized('Advanced access', '高级入口')}${permalink('advanced', 'Advanced access')}</h2>
          <div class="advanced-grid">
            <a href="./reference/#editor-class-kjdraweditor"><strong>KJDrawEditor</strong><span>${localized('Full generated class declaration', '完整自动生成类声明')}</span></a>
            <a href="./reference/#editor-interface-kjdraweditoroptions"><strong>KJDrawEditorOptions</strong><span>${localized('Exact option declaration', '精确选项声明')}</span></a>
            <a href="./reference/#core-class-kjdrawsdk"><strong>Core / headless</strong><span>${localized('Documents, commands and automation', '图档、命令与自动化')}</span></a>
            <a href="./reference/"><strong>${localized('Complete reference', '完整 API 参考')}</strong><span>${localized('Every public package export', '全部公开包导出')}</span></a>
          </div>
        </section>
      </article>
    </main>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
`

const editorAppJs = `const legacyAnchors=new Set(${JSON.stringify(searchIndex.entries.map(entry => entry.anchor))})
if(location.hash&&legacyAnchors.has(location.hash.slice(1)))location.replace('./reference/'+location.hash)
const html=document.documentElement,input=document.getElementById('api-search'),results=document.getElementById('api-results')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function applyLanguage(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文';input.placeholder=locale==='zh'?'搜索 Editor API':'Search Editor API'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage()}
for(const button of document.querySelectorAll('[data-copy-code]'))button.onclick=async()=>copy(button,button.nextElementSibling.textContent)
for(const button of document.querySelectorAll('[data-copy-value]'))button.onclick=async()=>copy(button,button.dataset.copyValue)
async function copy(button,value){await navigator.clipboard.writeText(value);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)}
const curated=[...document.querySelectorAll('[data-api-entry]')].map(element=>({name:element.dataset.name,kind:element.dataset.kind,module:'Editor API',href:'#'+element.id,summary:element.dataset.search}))
let reference=[]
fetch('./search-index.json').then(response=>response.json()).then(data=>{reference=data.entries.map(entry=>({...entry,href:entry.href.replace(/^\\.\\/api\\//,'./')}));render()}).catch(()=>{})
function render(){const terms=input.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);if(!terms.length){results.hidden=true;results.replaceChildren();return}const matches=[...curated,...reference].filter(entry=>terms.every(term=>(entry.name+' '+entry.kind+' '+entry.module+' '+entry.summary).toLowerCase().includes(term))).slice(0,18);results.innerHTML=matches.length?matches.map(entry=>'<a href="'+entry.href+'"><span><b>'+escape(entry.name)+'</b><small>'+escape(entry.module)+'</small></span><em>'+escape(entry.kind)+'</em></a>').join(''):'<p>'+(locale==='zh'?'未找到匹配 API':'No matching API')+'</p>';results.hidden=false}
function escape(value){const span=document.createElement('span');span.textContent=value;return span.innerHTML}
input.addEventListener('input',render);input.addEventListener('focus',render);document.addEventListener('click',event=>{if(!event.target.closest('.api-search-wrap'))results.hidden=true});window.addEventListener('keydown',event=>{if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName)){event.preventDefault();input.focus()}if(event.key==='Escape')results.hidden=true})
results.addEventListener('click',event=>{if(event.target.closest('a'))results.hidden=true})
applyLanguage()
`

const editorCss = `.api-shell{padding-top:60px}.api-sidebar{position:fixed;top:60px;bottom:0;width:260px;padding:24px 20px;border-right:1px solid var(--line);background:#fff;overflow:auto}.api-sidebar .version strong{display:block;font:13px Consolas,monospace;color:#26334a}.api-sidebar nav{display:flex;flex-direction:column;gap:2px}.api-sidebar nav a{padding:8px 9px;border-left:2px solid transparent;color:#505b6b;font-size:13px}.api-sidebar nav a:hover{border-left-color:var(--blue);background:#f2f6ff;color:#174dbd}.api-sidebar .reference-link{display:flex;justify-content:space-between;margin-top:14px;padding-top:13px;border-top:1px solid var(--line);color:#174dbd}.api-main{display:block;max-width:1220px;margin-left:260px;padding:58px 58px 110px}.api-main article{max-width:1100px;margin:auto}.api-hero{padding-bottom:38px;border-bottom:1px solid var(--line)}.api-hero .lead{max-width:820px;margin-bottom:22px;padding:0;border:0}.install{width:max-content;max-width:100%;display:flex;align-items:center;gap:24px;padding:12px 13px 12px 17px;border:1px solid #cad7f5;border-radius:8px;background:#f3f7ff}.install code{overflow:auto;color:#174dbd;font:13px Consolas,monospace}.install button{border:0;background:transparent;color:#2863f0;cursor:pointer}.api-main section{scroll-margin-top:85px}.api-main section>h2{display:flex;align-items:center}.permalink{margin-left:9px;color:transparent}.api-main section>h2:hover .permalink,.permalink:focus{color:#9ab3ec}.table-wrap tr{scroll-margin-top:82px}.table-wrap tr:target{background:#eff5ff;box-shadow:inset 3px 0 #2863f0}.table-wrap td:first-child{white-space:nowrap}.wide-table{width:calc(100vw - 380px);max-width:1100px}.framework-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.framework-grid>div{min-width:0}.framework-grid pre{height:390px}.advanced-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.advanced-grid>a{display:flex;flex-direction:column;gap:6px;padding:17px;border:1px solid var(--line);border-radius:8px;text-decoration:none}.advanced-grid>a:hover{border-color:#9db8f5;background:#f7f9ff}.advanced-grid span{color:#6d7786;font-size:12px}.api-search-wrap{position:relative;width:min(460px,38vw)}.api-search{height:36px;display:flex;align-items:center;gap:9px;padding:0 11px;border:1px solid #d7dde7;border-radius:7px;background:var(--soft);color:#6d7787}.api-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;font-size:13px}.api-search kbd{padding:2px 6px;border:1px solid #d8dee7;border-radius:4px;background:#fff;font:10px Consolas,monospace}.api-results{position:absolute;z-index:50;top:42px;left:0;right:0;max-height:430px;padding:7px;border:1px solid #cbd3df;border-radius:8px;background:#fff;overflow:auto;box-shadow:0 20px 55px #10182826}.api-results a{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-radius:6px}.api-results a:hover{background:#eff4ff}.api-results b,.api-results small{display:block}.api-results small{max-width:300px;margin-top:3px;color:#7a8492;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.api-results em{padding:3px 6px;border-radius:4px;background:#edf1f6;color:#6f7988;font:normal 9px Consolas,monospace}.api-results p{padding:4px 8px}@media(max-width:920px){.api-sidebar{display:none}.api-main{margin-left:0;padding:42px 24px 80px}.wide-table{width:100%}.framework-grid{grid-template-columns:1fr}.framework-grid pre{height:auto}.api-search-wrap{margin-left:auto;width:42px}.api-search{justify-content:center;padding:0}.api-search input,.api-search kbd{display:none}.api-search-wrap:focus-within{position:absolute;left:12px;right:12px;width:auto}.api-search-wrap:focus-within .api-search{background:#fff}.api-search-wrap:focus-within input,.api-search-wrap:focus-within kbd{display:block}.api-results{top:42px}.advanced-grid{grid-template-columns:1fr}}@media(max-width:620px){.api-main{padding-left:18px;padding-right:18px}.advanced-grid{grid-template-columns:1fr}.top-links>a{display:none}}@media(max-width:920px){.api-search-wrap{width:min(180px,46vw)}.api-search-wrap .api-search input{display:block}.api-search-wrap .api-search kbd{display:none}}`

const referenceNavigation = modules.map(module => `<a href="#${module.anchor}"><code>${escapeHtml(module.packageName.replace(`${packageJson.name}/`, './'))}</code></a>`).join('\n')
const referenceSections = modules.map(module => `<section class="api-module" id="${module.anchor}" data-module="${escapeHtml(module.packageName)}">
  <header class="module-header"><div><p class="eyebrow">PACKAGE EXPORT</p><h2><code>${escapeHtml(module.packageName)}</code></h2></div>${permalink(module.anchor, module.packageName)}</header>
  <p class="module-source">${localized('Declaration', '类型声明')} <code>${escapeHtml(module.declaration)}</code></p>
  <div class="api-symbols">
    ${module.symbols.map(symbol => `<article class="api-symbol" id="${symbol.anchor}" data-search="${escapeHtml(`${symbol.name} ${symbol.kind} ${module.packageName} ${symbol.declaration}`.toLowerCase())}">
      <header><div><span class="kind">${escapeHtml(symbol.kind)}</span><h3>${escapeHtml(symbol.name)}</h3></div>${permalink(symbol.anchor, symbol.name)}</header>
      ${codeBlock(symbol.declaration, 'ts')}
      <p class="source-path">${escapeHtml(symbol.source)}</p>
    </article>`).join('\n')}
  </div>
</section>`).join('\n')

const referenceHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Complete generated TypeScript API reference for ${escapeHtml(packageJson.name)}.">
  <title>Complete API Reference · KJDraw</title>
  <link rel="icon" href="../../../assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../../style.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="../"><img src="../../../assets/mark.svg" alt=""><b>KJDraw</b><span>Reference</span></a>
    <label class="api-search"><span aria-hidden="true">⌕</span><input id="api-search" type="search" autocomplete="off" placeholder="Search package exports" aria-label="Search complete API reference"><kbd>/</kbd></label>
    <nav class="top-links"><a href="../">Editor API</a><a href="../../">${localized('Guides', '指南')}</a><a href="https://github.com/KanJieTeam/kjdraw">GitHub</a><button id="language" type="button">中文</button></nav>
  </header>
  <div class="reference-shell">
    <aside class="reference-sidebar"><div class="version"><span>TYPE REFERENCE</span><strong>v${escapeHtml(packageJson.version)}</strong></div><nav>${referenceNavigation}</nav></aside>
    <main class="reference-main"><article>
      <section class="reference-intro" id="api-reference"><p class="eyebrow">TYPESCRIPT</p><h1>${localized('Complete API reference', '完整 API 参考')}</h1><p class="lead">${localized('Browse the declarations for the root package and every public subpath. Start with the Editor API for application integration.', '浏览根包及每个公开子路径的类型声明；应用接入请先从 Editor API 开始。')}</p><a class="primary-link" href="../">${localized('Open Editor API', '打开 Editor API')} →</a></section>
      <div id="empty-state" hidden><h2>${localized('No matching API', '未找到匹配 API')}</h2></div>
      ${referenceSections}
    </article></main>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
`

const referenceAppJs = `const html=document.documentElement,input=document.getElementById('api-search'),modules=[...document.querySelectorAll('.api-module')],empty=document.getElementById('empty-state')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
function applyLanguage(){html.dataset.locale=locale;html.lang=locale==='zh'?'zh-CN':'en';document.getElementById('language').textContent=locale==='zh'?'EN':'中文';input.placeholder=locale==='zh'?'搜索全部包导出':'Search package exports'}
document.getElementById('language').onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage()}
for(const button of document.querySelectorAll('[data-copy-code]'))button.onclick=async()=>{await navigator.clipboard.writeText(button.nextElementSibling.textContent);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)}
function search(){const terms=input.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);let visible=0;for(const module of modules){let moduleVisible=0;for(const symbol of module.querySelectorAll('.api-symbol')){const show=terms.every(term=>symbol.dataset.search.includes(term));symbol.hidden=!show;if(show)moduleVisible+=1}module.hidden=moduleVisible===0;visible+=moduleVisible}empty.hidden=visible!==0;const url=new URL(location.href);if(input.value)url.searchParams.set('q',input.value);else url.searchParams.delete('q');history.replaceState(null,'',url)}
input.value=new URL(location.href).searchParams.get('q')??'';input.addEventListener('input',search);search();window.addEventListener('keydown',event=>{if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName)){event.preventDefault();input.focus()}});applyLanguage()
`

const referenceCss = `.reference-shell{padding-top:60px}.reference-sidebar{position:fixed;top:60px;bottom:0;width:285px;padding:24px 20px;border-right:1px solid var(--line);background:#fff;overflow:auto}.reference-sidebar .version strong{display:block;font:13px Consolas,monospace;color:#26334a}.reference-sidebar nav{display:flex;flex-direction:column}.reference-sidebar nav a{padding:7px 9px;border-left:2px solid transparent;color:#526071;font-size:12px}.reference-sidebar nav a:hover{border-left-color:var(--blue);background:#f2f6ff;color:#174dbd}.reference-sidebar nav code{font-size:11px}.reference-main{display:block;max-width:1240px;margin-left:285px;padding:58px 54px 100px}.reference-main article{max-width:1060px;margin:auto}.reference-intro{padding-bottom:42px;margin-bottom:44px;border-bottom:1px solid var(--line)}.reference-intro .lead{margin-bottom:20px;padding:0;border:0}.primary-link{display:inline-flex;padding:10px 13px;border:1px solid #adc3f5;border-radius:6px;background:#f3f7ff;text-decoration:none}.api-search{width:min(500px,42vw);height:36px;display:flex;align-items:center;gap:9px;padding:0 11px;border:1px solid #d7dde7;border-radius:7px;background:var(--soft);color:#6d7787}.api-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;font-size:13px}.api-search kbd{padding:2px 6px;border:1px solid #d8dee7;border-radius:4px;background:#fff;font:10px Consolas,monospace}.api-module{scroll-margin-top:82px}.module-header,.api-symbol>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.module-header h2{margin:0}.module-header h2 code{font-size:22px}.module-source{margin-top:7px;font-size:12px}.api-symbols{display:grid;gap:12px;margin-top:25px}.api-symbol{scroll-margin-top:82px;padding:18px 18px 12px;border:1px solid var(--line);border-radius:7px;background:#fff}.api-symbol:target{border-color:#78a0ff;box-shadow:0 0 0 3px #2863f014}.api-symbol>header>div{display:flex;align-items:center;gap:9px}.api-symbol h3{margin:0;font:600 16px Consolas,monospace;color:#1d2736}.kind{padding:3px 6px;border-radius:3px;background:#eef3ff;color:#2454b7;font:9px Consolas,monospace;text-transform:uppercase}.permalink{color:#a5acb6}.api-symbol pre{max-height:360px;margin:14px 0 8px;font-size:12px;white-space:pre-wrap}.source-path{margin:0;color:#9299a3;font:10px Consolas,monospace}#empty-state{padding:60px 20px;text-align:center}.api-symbol[hidden],.api-module[hidden]{display:none}@media(max-width:880px){.reference-sidebar{display:none}.reference-main{margin-left:0;padding:40px 20px 70px}.api-search{margin-left:auto;width:42px;justify-content:center}.api-search input,.api-search kbd{display:none}.api-search:focus-within{position:absolute;left:12px;right:12px;width:auto;background:#fff}.api-search:focus-within input,.api-search:focus-within kbd{display:block}}@media(max-width:880px){.api-search{width:min(180px,46vw)}.api-search input{display:block}.api-search kbd{display:none}}`

const outputs = new Map([
  ['api-reference.json', `${JSON.stringify(api, null, 2)}\n`],
  ['editor-api.json', `${JSON.stringify(editorApi, null, 2)}\n`],
  ['search-index.json', `${JSON.stringify(searchIndex, null, 2)}\n`],
  ['index.html', editorHtml],
  ['app.js', editorAppJs],
  ['style.css', editorCss],
  ['reference/api-reference.json', `${JSON.stringify(api, null, 2)}\n`],
  ['reference/index.html', referenceHtml],
  ['reference/app.js', referenceAppJs],
  ['reference/style.css', referenceCss],
])

async function listRelativeFiles(root, current = root) {
  if (!existsSync(current)) return []
  const files = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, absolute))
    else files.push(relative(root, absolute).replaceAll('\\', '/'))
  }
  return files
}

if (check) {
  const stale = []
  for (const [name, content] of outputs) {
    const committed = await readFile(join(docsRoot, name), 'utf8').catch(() => null)
    if (committed !== content) stale.push(name)
  }
  for (const name of await listRelativeFiles(docsRoot)) if (!outputs.has(name)) stale.push(name)
  if (stale.length) {
    console.error(`Generated API documentation is stale:\n${[...new Set(stale)].sort().map(name => `- docs/latest/api/${name}`).join('\n')}\nRun: npm run build:docs`)
    process.exitCode = 1
  } else {
    console.log(`Verified Editor API and complete reference for ${modules.length} package exports.`)
  }
} else {
  await rm(docsRoot, { recursive: true, force: true })
  for (const [name, content] of outputs) {
    const destination = join(docsRoot, name)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
  }
  console.log(`Built Editor API and complete reference for ${modules.length} package exports.`)
}
