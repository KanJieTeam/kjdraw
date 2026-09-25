import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShowcasePortal, renderShowcasePortal, SHOWCASE_GENERATION_SOURCES } from './lib/showcase-portal.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceRoot = resolve(repositoryRoot, 'docs/site')
const pagesRoot = resolve(sourceRoot, 'pages')
const outputRoot = resolve(repositoryRoot, 'docs/latest')
const checkOnly = process.argv.includes('--check')

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function parseFrontmatter(source, filename) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  invariant(match, `${filename} must start with a --- frontmatter block`)
  const metadata = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    invariant(separator > 0, `${filename} has invalid frontmatter: ${line}`)
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return { metadata, body: match[2] }
}

function parseLocales(body, filename) {
  const locales = {}
  const pattern = /:::(en|zh)\r?\n([\s\S]*?)\r?\n:::/g
  let match
  let consumed = body
  while ((match = pattern.exec(body))) {
    invariant(!locales[match[1]], `${filename} contains duplicate :::${match[1]} content`)
    locales[match[1]] = match[2].trim()
    consumed = consumed.replace(match[0], '')
  }
  invariant(!consumed.trim(), `${filename} has content outside :::en / :::zh blocks`)
  invariant(locales.en && locales.zh, `${filename} must provide both :::en and :::zh content`)
  return locales
}

function safeHref(value) {
  const href = String(value).trim()
  invariant(!/^[a-z][a-z\d+.-]*:/i.test(href) || /^(?:https?:|mailto:)/i.test(href), `Unsafe documentation link: ${href}`)
  return href
}

function renderInline(source) {
  const tokens = []
  const token = html => {
    const index = tokens.push(html) - 1
    return `\u0000${index}\u0000`
  }
  let value = String(source)
  value = value.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`))
  value = value.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label, href) => token(`<a href="${escapeHtml(safeHref(href))}">${escapeHtml(label)}</a>`))
  value = escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return value.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)])
}

function plainText(source) {
  return String(source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    // Keep inline API/tool identifiers intact; underscores and hyphens are
    // meaningful in code, not Markdown emphasis or list markers.
    .replace(/`([^`]+)`|[`*_>#|{}\[\]-]/g, (_, code) => code ?? ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
}

function isTableDivider(line) {
  const cells = parseTableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function renderMarkdown(source, { locale, slug, filename }) {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const html = []
  const headings = []
  const usedAnchors = new Set()
  let paragraph = []
  let listType = null
  let code = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const closeList = () => {
    if (!listType) return
    html.push(`</${listType}>`)
    listType = null
  }
  const openList = type => {
    if (listType === type) return
    closeList()
    html.push(`<${type}>`)
    listType = type
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = line.match(/^```([\w-]*)\s*$/)
    if (fence) {
      flushParagraph()
      closeList()
      if (code) {
        html.push(`<pre data-language="${escapeHtml(code.language || 'text')}"><button class="copy" type="button">Copy</button><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`)
        code = null
      } else {
        code = { language: fence[1], lines: [] }
      }
      continue
    }
    if (code) {
      code.lines.push(line)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      closeList()
      continue
    }

    const heading = line.match(/^(#{2,4})\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/)
    if (heading) {
      flushParagraph()
      closeList()
      invariant(heading[3], `${filename} heading requires an explicit stable {#anchor}: ${line}`)
      invariant(!usedAnchors.has(heading[3]), `${filename} repeats heading anchor ${heading[3]} in ${locale}`)
      usedAnchors.add(heading[3])
      const level = heading[1].length
      const id = `${locale}-${slug}-${heading[3]}`
      const title = plainText(heading[2])
      headings.push({ id, title, level })
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`)
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph()
      closeList()
      const header = parseTableCells(line)
      index += 2
      const rows = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(parseTableCells(lines[index]))
        index += 1
      }
      index -= 1
      html.push(`<div class="table-wrap"><table><thead><tr>${header.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }

    const unordered = line.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      flushParagraph()
      openList('ul')
      html.push(`<li>${renderInline(unordered[1])}</li>`)
      continue
    }
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      openList('ol')
      html.push(`<li>${renderInline(ordered[1])}</li>`)
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      closeList()
      const quoteLines = [quote[1]]
      while (index + 1 < lines.length && /^>\s?/.test(lines[index + 1])) {
        quoteLines.push(lines[index + 1].replace(/^>\s?/, ''))
        index += 1
      }
      html.push(`<aside class="callout">${renderInline(quoteLines.join(' '))}</aside>`)
      continue
    }
    if (/^---+$/.test(line.trim())) {
      flushParagraph()
      closeList()
      html.push('<hr>')
      continue
    }
    paragraph.push(line.trim())
  }
  invariant(!code, `${filename} has an unclosed code fence in ${locale}`)
  flushParagraph()
  closeList()
  return { html: html.join('\n'), headings, text: plainText(source) }
}

const navigationSource = await readFile(join(sourceRoot, 'navigation.json'), 'utf8')
const navigation = JSON.parse(navigationSource)
invariant(navigation.schema === 'com.kanjie.kjdraw.docs-navigation@1', 'Unexpected docs navigation schema')
const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'packages/kjdraw-sdk/package.json'), 'utf8'))

const filenames = (await readdir(pagesRoot)).filter(name => name.endsWith('.md')).sort()
const pages = []
const sources = [['navigation.json', navigationSource]]
for (const filename of filenames) {
  const source = await readFile(join(pagesRoot, filename), 'utf8')
  sources.push([`pages/${filename}`, source])
  const { metadata, body } = parseFrontmatter(source, filename)
  const locales = parseLocales(body, filename)
  const slug = metadata.slug
  invariant(/^[a-z0-9-]+$/.test(slug), `${filename} has an invalid slug`)
  invariant(filename === `${slug}.md`, `${filename} must match its slug ${slug}`)
  for (const field of ['title.en', 'title.zh', 'summary.en', 'summary.zh']) invariant(metadata[field], `${filename} is missing ${field}`)
  pages.push({
    slug,
    source: `docs/site/pages/${filename}`,
    title: { en: metadata['title.en'], zh: metadata['title.zh'] },
    summary: { en: metadata['summary.en'], zh: metadata['summary.zh'] },
    body: locales,
  })
}

const pageBySlug = new Map(pages.map(page => [page.slug, page]))
invariant(pageBySlug.size === pages.length, 'Documentation page slugs must be unique')
const navigationSlugs = navigation.groups.flatMap(group => group.pages)
invariant(new Set(navigationSlugs).size === navigationSlugs.length, 'Navigation cannot repeat a page')
invariant(navigationSlugs.length === pages.length, 'Every source page must appear in navigation exactly once')
for (const slug of navigationSlugs) invariant(pageBySlug.has(slug), `Navigation references missing page: ${slug}`)
invariant(navigationSlugs[0] === 'introduction', 'Introduction must be the first documentation route')

const orderedPages = navigationSlugs.map(slug => pageBySlug.get(slug))
for (const page of orderedPages) {
  page.rendered = {
    en: renderMarkdown(page.body.en, { locale: 'en', slug: page.slug, filename: page.source }),
    zh: renderMarkdown(page.body.zh, { locale: 'zh', slug: page.slug, filename: page.source }),
  }
}

const showcasePortal = await buildShowcasePortal(repositoryRoot)
for (const sourcePath of SHOWCASE_GENERATION_SOURCES) {
  sources.push([sourcePath, await readFile(resolve(repositoryRoot, sourcePath), 'utf8')])
}

const generatorSource = await readFile(fileURLToPath(import.meta.url), 'utf8')
const digest = `sha256:${createHash('sha256')
  .update(`package:${packageJson.name}@${packageJson.version}\n`)
  .update(sources.map(([name, source]) => `${name}\n${source.replaceAll('\r\n', '\n')}\n`).join(''))
  .update(`generator:build-docs-site.mjs\n${generatorSource.replaceAll('\r\n', '\n')}\n`)
  .digest('hex')}`
const assetRevision = digest.slice('sha256:'.length, 'sha256:'.length + 16)

const localized = (en, zh, tag = 'span') => `<${tag} class="lang-en">${escapeHtml(en)}</${tag}><${tag} class="lang-zh">${escapeHtml(zh)}</${tag}>`
const routeFromRoot = slug => slug === 'introduction' ? './' : `./${slug}/`
const pageOutput = slug => slug === 'introduction' ? 'index.html' : `${slug}/index.html`

function renderSidebar(page, rootPrefix) {
  return navigation.groups.map(group => `
        <section class="nav-group">
          ${localized(group.title.en, group.title.zh, 'h3')}
          ${group.pages.map(slug => {
            const target = pageBySlug.get(slug)
            const href = slug === 'introduction' ? rootPrefix : `${rootPrefix}${slug}/`
            const current = slug === page.slug ? ' class="active" aria-current="page"' : ''
            return `<a href="${href}"${current}>${localized(target.title.en, target.title.zh)}</a>`
          }).join('\n          ')}
        </section>`).join('')
}

function renderToc(page, locale) {
  // Showcase has its own category and search controls; it does not render the
  // source-page headings, so a second TOC would only point at empty anchors.
  if (page.slug === 'showcase') return ''
  const headingLinks = page.rendered[locale].headings
    .filter(heading => heading.level <= 3)
    .map(heading => `<a class="toc-level-${heading.level}" href="#${heading.id}">${escapeHtml(heading.title)}</a>`)
    .join('')
  return `<div class="lang-${locale}">${headingLinks}</div>`
}

function renderPage(page, index) {
  const atRoot = page.slug === 'introduction'
  const showcasePage = page.slug === 'showcase'
  const rootPrefix = atRoot ? './' : '../'
  const docsAssetPrefix = atRoot ? '../assets/' : '../../assets/'
  const previous = orderedPages[index - 1]
  const next = orderedPages[index + 1]
  const canonical = `https://kanjieteam.github.io/kjdraw/docs/latest/${atRoot ? '' : `${page.slug}/`}`
  const navLink = target => target.slug === 'introduction' ? rootPrefix : `${rootPrefix}${target.slug}/`
  const pager = target => target ? `<a href="${navLink(target)}">${localized(target.title.en, target.title.zh, 'strong')}</a>` : '<span></span>'
  const portal = locale => page.slug === 'showcase' ? renderShowcasePortal(showcasePortal.manifest, locale) : ''
  // Showcase is rendered by the dedicated portal below. Do not append the
  // source Markdown sections after the cards: that duplicated the old
  // catalogue copy below the interactive grid on the published site.
  // Keep stable deep-link targets for the search index, but do not render the
  // Showcase source prose below the dedicated portal.
  const pageBody = locale => showcasePage
    ? page.rendered[locale].headings.map(heading => `<span class=\"showcase-anchor\" id=\"${heading.id}\" aria-hidden=\"true\"></span>`).join('')
    : page.rendered[locale].html
  const homeActions = atRoot ? `<div class="home-actions"><a class="primary" href="./quickstart/">${localized('Start building', '开始构建')}</a><a href="./showcase/">${localized('Explore the model', '查看模型')}</a></div>` : ''
  const homeModelCanvas = atRoot ? `<div class="home-model-canvas" role="img" aria-label="Abstract editable document model"><div class="home-model-layers"><b>${localized('Layers', '图层')}</b><span class="active">◉ ${localized('Geometry', '几何')}</span><span>◉ ${localized('Constraints', '约束')}</span><span>◉ ${localized('Annotations', '标注')}</span><span>◉ ${localized('References', '引用')}</span></div><svg viewBox="0 0 860 360" aria-hidden="true"><g class="construction"><path d="M30 174H820M428 28V332"/><path d="M105 86H300M560 92H786M110 262H312M550 270H790"/></g><g class="geometry"><circle cx="238" cy="172" r="74"/><path d="M238 98V246M164 172H312"/><path d="M392 86H590V254H392Z"/><path d="M435 212L690 72"/><path d="M630 210A72 72 0 0 0 770 142"/><circle cx="690" cy="72" r="8"/><circle cx="770" cy="142" r="8"/></g><g class="handles"><rect x="230" y="90" width="16" height="16"/><rect x="304" y="164" width="16" height="16"/><rect x="384" y="78" width="16" height="16"/><rect x="582" y="78" width="16" height="16"/></g><g class="labels"><text x="416" y="172">=</text><text x="645" y="296">${localized('Editable object', '可编辑对象')}</text></g></svg></div>` : ''
  const homePreview = atRoot ? `<section class="home-model-section"><div class="home-model-heading"><p class="eyebrow">KJDRAW / DOCUMENT MODEL</p><h2>${localized('One document model, every engineering workflow.', '一份图档模型，贯穿每个工程工作流。')}</h2><p>${localized('Geometry, constraints and agent actions stay together — inspectable, editable and ready to exchange.', '几何、约束与智能体操作保持在一起，可检查、可编辑、可交换。')}</p></div>${homeModelCanvas}<div class="home-model-facts"><span>${localized('Native geometry', '原生几何')}</span><span>${localized('Deterministic edits', '确定性编辑')}</span><span>${localized('Open integrations', '开放集成')}</span></div></section>` : ''
  const homeCard = (en, zh, descEn, descZh, tone) => `<article class="home-capability home-capability-${tone}"><span class="home-capability-mark" aria-hidden="true"></span><h3>${localized(en, zh)}</h3><p>${localized(descEn, descZh)}</p></article>`
  const homeAgentMatrix = atRoot
    ? `<section class="home-section home-agent-matrix"><div class="home-section-heading"><p class="eyebrow">KJDRAW / AGENT ENTRY POINTS</p><h2>${localized('One document model, every agent entry point', '同一套图档模型，适配不同智能体入口')}</h2><p>${localized('Choose the surface that fits your workflow. Every path points back to the same editable KJD document and verification loop.', '按你的工作流选择入口。所有路径最终都回到同一份可编辑 KJD 图档和同一套核验闭环。')}</p></div><div class="home-agent-table-wrap"><table class="home-agent-table"><thead><tr><th>${localized('Entry point', '入口')}</th><th>${localized('Best for', '适合场景')}</th><th>${localized('Start here', '从这里开始')}</th><th>${localized('Availability', '状态')}</th></tr></thead><tbody><tr><th scope="row">TypeScript SDK</th><td>${localized('Embedding the editor or building a typed workflow', '嵌入编辑器或构建类型化工作流')}</td><td><a href="./quickstart/">${localized('Five-minute guide', '五分钟上手')}</a></td><td><span class="home-status home-status-ready">${localized('Ready', '可用')}</span></td></tr><tr><th scope="row">MCP</th><td>${localized('Connecting an AI agent to propose and verify drawing changes', '让 AI 智能体提出并核验图纸修改')}</td><td><a href="./mcp/">${localized('MCP integration', 'MCP 集成')}</a></td><td><span class="home-status home-status-ready">${localized('Documented', '已文档化')}</span></td></tr><tr><th scope="row">React / Vue</th><td>${localized('Adding a CAD surface to an existing application', '在现有应用中加入 CAD 工作台')}</td><td><a href="./react/">React</a> · <a href="./vue/">Vue</a></td><td><span class="home-status home-status-ready">${localized('Ready', '可用')}</span></td></tr><tr><th scope="row">Browser Playground</th><td>${localized('Trying public, editable engineering examples', '直接试用公开可编辑工程案例')}</td><td><a href="./showcase/">${localized('Browse examples', '浏览案例')}</a></td><td><span class="home-status home-status-preview">${localized('Preview', '预览')}</span></td></tr><tr><th scope="row">Model protocols</th><td>${localized('OpenAI Codex, Claude, Gemini, Doubao, DeepSeek or a custom bridge', 'OpenAI Codex、Claude、Gemini、豆包、DeepSeek 或自定义桥接')}</td><td><a href="./models/">${localized('Model guide', '模型接入')}</a></td><td><span class="home-status home-status-ready">${localized('Documented', '已文档化')}</span></td></tr><tr><th scope="row">KJD / DXF</th><td>${localized('Keeping an editable source and exchanging drawings', '保留可编辑源图并交换图纸')}</td><td><a href="./files/">${localized('File workflow', '文件工作流')}</a></td><td><span class="home-status home-status-ready">${localized('Supported', '支持')}</span></td></tr></tbody></table></div></section>`
    : ''
      const homeSections = atRoot
    ? `<section class="home-section home-capabilities"><div class="home-section-heading"><p class="eyebrow">KJDRAW / PLATFORM</p><h2>${localized('One CAD runtime, several ways to build', '一套 CAD 运行时，多种构建方式')}</h2><p>${localized('Compose the browser workbench, typed SDK and agent workflow around the same editable document.', '围绕同一份可编辑图档，组合浏览器工作台、类型化 SDK 与智能体工作流。')}</p></div><div class="home-capability-grid">${homeCard('Browser editor', '浏览器编辑器', 'Mount a complete engineering workbench with layers, properties, tools and history.', '挂载完整工程工作台，包含图层、属性、工具和编辑历史。', 'editor')}${homeCard('TypeScript SDK', 'TypeScript SDK', 'Create, inspect and save drawings with typed commands and predictable document state.', '使用类型化命令创建、检查和保存图纸，图档状态可预测。', 'sdk')}${homeCard('Agent workflow', '智能体工作流', 'Prepare proposed changes, review the candidate, then execute and keep an audit trail.', '先生成候选修改，再检查并执行，同时保留可追溯回执。', 'agent')}${homeCard('Native files', '原生文件', 'Keep KJD as the editable source and use DXF for controlled drawing exchange.', '以 KJD 保存可编辑源图，并用 DXF 进行受控图纸交换。', 'files')}${homeCard('Industry examples', '行业案例', 'Explore mechanical, geology, architecture, site and road drawings in the public catalog.', '在公开案例库中浏览机械、勘察、建筑、总平和道路图纸。', 'examples')}${homeCard('Framework ready', '框架接入', 'Start from vanilla browser, React, Vue, Node TypeScript or MCP starter projects.', '从原生浏览器、React、Vue、Node TypeScript 或 MCP 起步工程开始。', 'framework')}</div></section>`
      + `<section class="home-section home-steps"><div class="home-section-heading"><p class="eyebrow">KJDRAW / BUILD FLOW</p><h2>${localized('From intent to an editable drawing', '从意图到可编辑图纸')}</h2></div><ol class="home-step-grid"><li><b>01</b><h3>${localized('Choose a starting point', '选择起点')}</h3><p>${localized('Open the five-minute guide or an editable public example.', '打开五分钟快速上手或一份可编辑公开案例。')}</p></li><li><b>02</b><h3>${localized('Compose the document', '组织图档')}</h3><p>${localized('Use native entities, layers, dimensions and layouts that remain inspectable.', '使用可检查的原生图元、图层、标注和布局。')}</p></li><li><b>03</b><h3>${localized('Connect your workflow', '接入工作流')}</h3><p>${localized('Call the same document and command model from your app or agent.', '在自己的应用或智能体中调用同一套图档与命令模型。')}</p></li><li><b>04</b><h3>${localized('Review and exchange', '检查与交换')}</h3><p>${localized('Save, reopen, undo, export and verify the result before delivery.', '在交付前保存、重开、撤销、导出并核验结果。')}</p></li></ol></section>`
    : ''
  return `<!doctype html>
<!-- Generated by scripts/build-docs-site.mjs from ${page.source}. Do not edit. -->
<html lang="en" data-locale="en" data-docs-root="${rootPrefix}" data-page="${page.slug}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(page.summary.en)}">
  <meta name="theme-color" content="#0b1220">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="${docsAssetPrefix}mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${rootPrefix}style.css?v=${assetRevision}">
  <title>${escapeHtml(page.title.en)} · KJDraw Docs</title>
</head>
<body>
  <header class="topbar">
    <button id="menu-button" class="icon-button menu-button" type="button" aria-label="Open navigation">☰</button>
    <a class="brand" href="${rootPrefix}"><img src="${docsAssetPrefix}mark.svg" alt=""><b>KJDraw</b><span>${showcasePage ? 'Showcase' : 'Docs'}</span></a>
    <nav class="product-nav" aria-label="KJDraw products"><a href="${rootPrefix}"${page.slug === 'introduction' ? ' class="active" aria-current="page"' : ''}>${localized('Overview', '概览')}</a><a href="${rootPrefix}quickstart/"${!atRoot && !showcasePage ? ' class="active"' : ''}>${localized('Guides', '指南')}</a><a href="${rootPrefix}showcase/"${showcasePage ? ' class="active" aria-current="page"' : ''}>${localized('Showcase', '案例')}</a><a href="${rootPrefix}api/">API</a></nav>
    <button id="search-button" class="search-button" type="button" aria-keyshortcuts="Control+K Meta+K"><span aria-hidden="true">⌕</span><span class="lang-en">Search guides and API</span><span class="lang-zh">搜索指南与 API</span><kbd>Ctrl K</kbd></button>
    <nav class="top-links"><a href="https://kanjieteam.github.io/kjdraw/">Playground</a><a href="https://github.com/KanJieTeam/kjdraw">GitHub</a><button id="language" type="button">中文</button></nav>
  </header>
  <div class="shell">
    <aside id="sidebar" class="sidebar">
      <div class="version"><span>${localized('Current documentation', '当前文档')}</span><select id="docs-version" aria-label="Documentation version"><option>v${escapeHtml(packageJson.version)} · current</option></select></div>
      <nav>${renderSidebar(page, rootPrefix)}
        <section class="nav-group reference-group">
          ${localized('Reference', '参考', 'h3')}
          <a class="api-nav" href="${rootPrefix}api/"><b>API</b>${localized('Editor API and type reference', 'Editor API 与类型参考')}</a>
        </section>
      </nav>
      <footer><a href="https://github.com/KanJieTeam/kjdraw/blob/main/${page.source}">${localized('Edit this page', '编辑此页')} ↗</a><span>${escapeHtml(packageJson.version)}</span></footer>
    </aside>
    <main>
      <div class="content">
        <article class="lang-en" lang="en" id="en-${page.slug}">
          ${atRoot ? `<header class="home-hero"><p class="eyebrow">KJDraw · Open-source engineering CAD</p><h1>${localized('One editable model for every engineering workflow.', '一份可编辑模型，贯穿每个工程工作流。', 'span')}</h1><p class="lead">${localized('Geometry, constraints, and agent actions — kept together.', '几何、约束与智能体操作，保持在同一份图档中。')}</p>${homeActions}</header>${homePreview}` : `<header class="page-hero"><p class="eyebrow">KJDRAW / ${escapeHtml(page.title.en.toUpperCase())}</p><h1>${escapeHtml(page.title.en)}</h1><p class="lead">${escapeHtml(page.summary.en)}</p></header>`}${homeSections}${homeAgentMatrix}${portal('en') ? `\n          ${portal('en')}` : ''}
          ${pageBody('en')}
        </article>
        <article class="lang-zh" lang="zh-CN" id="zh-${page.slug}">
          ${atRoot ? `<header class="home-hero"><p class="eyebrow">KJDraw · 开源工程 CAD</p><h1>${localized('One editable model for every engineering workflow.', '一份可编辑模型，贯穿每个工程工作流。', 'span')}</h1><p class="lead">${localized('Geometry, constraints, and agent actions — kept together.', '几何、约束与智能体操作，保持在同一份图档中。')}</p>${homeActions}</header>${homePreview}` : `<header class="page-hero"><p class="eyebrow">KJDRAW / ${escapeHtml(page.title.zh)}</p><h1>${escapeHtml(page.title.zh)}</h1><p class="lead">${escapeHtml(page.summary.zh)}</p></header>`}${homeSections}${homeAgentMatrix}${portal('zh') ? `\n          ${portal('zh')}` : ''}
          ${pageBody('zh')}
        </article>
        <nav class="pager" aria-label="Adjacent documentation">${pager(previous)}${pager(next)}</nav>
      </div>
      <aside class="toc"><b>${localized('On this page', '本页目录')}</b>${renderToc(page, 'en')}${renderToc(page, 'zh')}</aside>
    </main>
  </div>
  <dialog id="search-dialog"><form method="dialog"><div class="search-head"><span aria-hidden="true">⌕</span><input id="search" type="search" autocomplete="off" placeholder="Search KJDraw docs"><button aria-label="Close">Esc</button></div><div id="results" role="listbox"></div><p id="search-stats" class="search-foot">${localized('Guides, Editor API and complete type reference', '指南、Editor API 与完整类型参考')}</p></form></dialog>
  <script type="module" src="${rootPrefix}app.js?v=${assetRevision}"></script>
</body>
</html>
`
}

const searchEntries = []
for (const page of orderedPages) {
  for (const locale of ['en', 'zh']) {
    const rendered = page.rendered[locale]
    const baseHref = routeFromRoot(page.slug)
    searchEntries.push({
      locale,
      kind: 'guide',
      page: page.slug,
      title: page.title[locale],
      summary: page.summary[locale],
      href: `${baseHref}#${locale}-${page.slug}`,
      text: rendered.text,
    })
    for (const heading of rendered.headings) searchEntries.push({
      locale,
      kind: 'section',
      page: page.slug,
      title: heading.title,
      summary: page.title[locale],
      href: `${baseHref}#${heading.id}`,
      text: rendered.text,
    })
  }
}

const style = `:root{--blue:#2863f0;--blue-dark:#1748b7;--ink:#121722;--muted:#5f6978;--line:#e2e7ef;--soft:#f6f8fb;--code:#0b1220;--sidebar:260px;--toc:190px;font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--ink);font-synthesis:none;scroll-behavior:smooth}*{box-sizing:border-box}html[data-locale="zh"] .lang-en,html:not([data-locale="zh"]) .lang-zh{display:none!important}body{margin:0;background:#fff}a{color:inherit;text-decoration:none}button,input,select{font:inherit}.topbar{position:fixed;z-index:30;inset:0 0 auto;height:60px;display:flex;align-items:center;padding:0 24px;border-bottom:1px solid var(--line);background:#fffffff2;backdrop-filter:blur(14px)}.brand{width:var(--sidebar);display:flex;align-items:center;gap:9px}.brand img{width:29px;height:29px}.brand b{font-size:17px;letter-spacing:-.02em}.brand>span{padding-left:10px;border-left:1px solid var(--line);color:#7c8593;font-size:12px}.top-links{margin-left:auto;display:flex;align-items:center;gap:20px;font-size:13px}.top-links>a:hover{color:var(--blue)}.top-links button,.icon-button{border:0;background:transparent;color:var(--ink);cursor:pointer}.search-button{width:min(460px,38vw);height:36px;display:flex;align-items:center;gap:9px;padding:0 11px;border:1px solid #d7dde7;border-radius:7px;background:var(--soft);color:#6d7787;text-align:left;cursor:pointer}.search-button>span:nth-of-type(2),.search-button>span:nth-of-type(3){flex:1}.search-button kbd{padding:2px 6px;border:1px solid #d8dee7;border-radius:4px;background:#fff;font:10px Consolas,monospace}.menu-button{display:none;font-size:18px}.shell{padding-top:60px}.sidebar{position:fixed;z-index:20;top:60px;bottom:0;width:var(--sidebar);padding:19px 20px 26px;border-right:1px solid var(--line);background:#fff;overflow:auto}.version{margin-bottom:16px}.version>span{display:block;margin:0 0 7px;color:#8b94a2;font-size:10px;text-transform:uppercase;letter-spacing:.09em}.version select{width:100%;height:34px;padding:0 9px;border:1px solid var(--line);border-radius:6px;background:#fff;color:#343b47;font-size:12px}.nav-group{display:flex;flex-direction:column;margin-top:20px}.nav-group h3{margin:0 0 6px;padding:0 9px;color:#8b94a2;font-size:10px;text-transform:uppercase;letter-spacing:.1em}.nav-group>a{min-height:31px;display:flex;align-items:center;padding:6px 9px;border-left:2px solid transparent;color:#4f5968;font-size:13px}.nav-group>a:hover,.nav-group>a.active{border-left-color:var(--blue);background:#f1f5ff;color:#174dbd}.reference-group{padding-top:7px;border-top:1px solid var(--line)}.nav-group .api-nav{display:grid;grid-template-columns:auto 1fr;gap:7px;border:1px solid #dbe4fb;border-left:2px solid var(--blue);border-radius:0 6px 6px 0;background:#f5f8ff}.api-nav span{overflow:hidden;color:#6d7790;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.sidebar footer{display:flex;justify-content:space-between;margin-top:30px;padding:16px 8px 0;border-top:1px solid var(--line);color:#8992a0;font-size:10px}.sidebar footer a:hover{color:var(--blue)}main{margin-left:var(--sidebar);display:grid;grid-template-columns:minmax(0,780px) var(--toc);gap:64px;justify-content:center;padding:64px 48px 110px}.content{min-width:0}article{min-height:620px}.eyebrow{margin:0 0 17px;color:var(--blue);font:11px Consolas,monospace;letter-spacing:.12em}.eyebrow+ h1,h1{max-width:760px;margin:0 0 18px;font-size:48px;line-height:1.06;letter-spacing:-.045em}.lead{margin:0 0 42px;padding-bottom:32px;border-bottom:1px solid var(--line);color:#4d5868;font-size:18px;line-height:1.65}h2,h3,h4{position:relative;scroll-margin-top:88px;letter-spacing:-.02em}h2{margin:48px 0 15px;font-size:29px}h3{margin:34px 0 12px;font-size:20px}h4{margin:28px 0 10px;font-size:16px}.heading-anchor{margin-left:8px;color:transparent;font-weight:400}.heading-anchor:focus,.heading-anchor:hover,h2:hover .heading-anchor,h3:hover .heading-anchor,h4:hover .heading-anchor{color:#9ab3ec}p,li{color:#4d5868;font-size:15px;line-height:1.75}p{margin:12px 0}ul,ol{padding-left:24px}li{margin:6px 0}strong{color:#252c37}article a{color:#1c55cb;text-decoration:underline;text-decoration-color:#bdd0ff;text-underline-offset:3px}article a:hover{color:var(--blue-dark)}article p code,article li code,td code{padding:2px 5px;border-radius:4px;background:#eff3f8;color:#174dbd;font:12px Consolas,monospace}.table-wrap{margin:22px 0;overflow:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}tr:last-child td{border-bottom:0}th{background:var(--soft);color:#5d6675;font-size:11px;text-transform:uppercase;letter-spacing:.04em}pre{position:relative;margin:20px 0;padding:22px;border:1px solid #1c2a40;border-radius:9px;background:var(--code);color:#d7e3f4;overflow:auto;font:13px/1.7 Consolas,"SFMono-Regular",monospace;box-shadow:0 10px 30px #0b12200d}pre:before{content:attr(data-language);display:block;margin:0 70px 12px 0;color:#74839a;font-size:10px;text-transform:uppercase;letter-spacing:.1em}pre .copy{position:absolute;right:9px;top:9px;padding:5px 9px;border:1px solid #34445c;border-radius:5px;background:#162236;color:#aebcd0;font-size:11px;cursor:pointer}.callout{margin:22px 0;padding:16px 18px;border-left:3px solid var(--blue);background:#f2f6ff;color:#46536a;font-size:14px;line-height:1.7}.pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:70px;padding-top:25px;border-top:1px solid var(--line)}.pager a{min-height:58px;display:flex;align-items:center;padding:13px;border:1px solid var(--line);border-radius:7px;color:#364153}.pager a:last-child{justify-content:flex-end;text-align:right}.pager a:hover{border-color:#a9c0f8;background:#f7f9ff;color:var(--blue)}.toc{position:sticky;top:92px;height:max-content;max-height:calc(100vh - 120px);overflow:auto;color:#7b8593;font-size:11px}.toc>b{display:block;margin-bottom:13px;color:#303846}.toc>div{display:flex;flex-direction:column;gap:9px}.toc a:hover{color:var(--blue)}.toc-level-3{padding-left:10px}dialog{width:min(660px,calc(100vw - 28px));padding:0;border:1px solid #cbd3df;border-radius:10px;box-shadow:0 30px 100px #09112052}dialog::backdrop{background:#13213a66;backdrop-filter:blur(4px)}.search-head{height:54px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--line)}.search-head input{flex:1;border:0;outline:0;font-size:15px}.search-head button{border:1px solid var(--line);border-radius:5px;background:#fff;color:#6f7987}.search-foot{margin:0;padding:9px 14px;border-top:1px solid var(--line);color:#8b94a0;font-size:10px}#results{max-height:430px;overflow:auto;padding:8px}#results a{display:grid;grid-template-columns:1fr auto;gap:3px 12px;padding:11px;border-radius:6px}#results a:hover,#results a.active{background:#eff4ff}#results b,#results span{display:block}#results span{color:#788290;font-size:12px}#results em{grid-row:1/3;grid-column:2;align-self:center;padding:3px 6px;border-radius:4px;background:#edf1f6;color:#77808c;font:normal 9px Consolas,monospace}@media(max-width:1080px){main{grid-template-columns:minmax(0,760px);padding-right:42px}.toc{display:none}}@media(max-width:780px){.topbar{padding:0 12px}.menu-button{display:block}.brand{width:auto;margin-left:6px}.brand>span,.top-links>a{display:none}.search-button{margin-left:auto;width:42px;padding:0;justify-content:center}.search-button>span:not(:first-child),.search-button kbd{display:none}.top-links{margin-left:5px;gap:3px}.sidebar{transform:translateX(-100%);transition:transform .18s;box-shadow:20px 0 50px #10182820}.sidebar.open{transform:translateX(0)}main{margin-left:0;display:block;padding:42px 20px 80px}h1{font-size:39px}.lead{font-size:17px}.pager{grid-template-columns:1fr}.pager a:last-child{justify-content:flex-start;text-align:left}}`

const homeStyle = `
.home-hero{min-height:500px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:76px 24px 64px;text-align:center;background:#fff;border-bottom:1px solid var(--line)}
.home-hero .eyebrow{margin-bottom:22px;color:#5f6f87;font:12px/1.4 Inter,"Segoe UI",Arial,sans-serif;letter-spacing:.02em;text-transform:none}
.home-hero h1{max-width:900px;margin:0 0 18px;font-size:56px;line-height:1.08;letter-spacing:-.055em}
.home-hero .lead{max-width:760px;margin:0;padding:0;border:0;color:#66758a;font-size:20px;line-height:1.55}
.home-hero .home-actions{margin-top:31px}
.home-model-section{width:min(1232px,calc(100% - 64px));margin:0 auto;padding:82px 0 94px}
.home-model-heading{max-width:780px;margin:0 auto 28px;text-align:center}
.home-model-heading .eyebrow{margin-bottom:12px}
.home-model-heading h2{margin:0 0 13px;font-size:36px;line-height:1.15}
.home-model-heading p:last-child{margin:0;color:#687486;font-size:16px;line-height:1.7}
.home-model-canvas{position:relative;min-height:420px;overflow:hidden;padding:30px 30px 28px;border:1px solid #dbe3ef;border-radius:14px;background:#fbfcfe;box-shadow:0 20px 60px #0f2a4d0d}
.home-model-canvas:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#eaf0f7 1px,transparent 1px),linear-gradient(90deg,#eaf0f7 1px,transparent 1px);background-size:32px 32px;opacity:.8;pointer-events:none}
.home-model-layers{position:absolute;z-index:1;top:28px;left:28px;display:flex;flex-direction:column;gap:8px;width:154px;padding:13px 14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#67758a;font-size:12px;box-shadow:0 6px 22px #172b4d0a}
.home-model-layers b{margin-bottom:3px;color:#34435a;font-size:11px}.home-model-layers span{padding:5px 7px;border-radius:5px}.home-model-layers span.active{background:#eff6df;color:#2e751d}
.home-model-canvas svg{position:relative;z-index:0;display:block;width:100%;height:360px;margin-top:9px}.home-model-canvas .construction{fill:none;stroke:#b9c8dc;stroke-width:1;stroke-dasharray:7 7}.home-model-canvas .geometry{fill:none;stroke:#203653;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.home-model-canvas .handles{fill:#b4f33f;stroke:#4a971b;stroke-width:1}.home-model-canvas .labels{fill:#53647a;font-size:16px}.home-model-facts{display:flex;justify-content:center;gap:0;margin-top:28px;color:#52627a;font-size:14px}.home-model-facts span{padding:0 34px;border-right:1px solid #dfe5ec}.home-model-facts span:last-child{border-right:0}
@media(max-width:780px){.home-hero{min-height:440px;padding:58px 20px 48px}.home-hero h1{font-size:42px}.home-hero .lead{font-size:17px}.home-model-section{width:calc(100% - 40px);padding:60px 0 70px}.home-model-heading h2{font-size:30px}.home-model-canvas{min-height:320px;padding:20px}.home-model-layers{position:relative;top:auto;left:auto;width:100%;flex-direction:row;flex-wrap:wrap;margin-bottom:12px}.home-model-layers b{width:100%}.home-model-canvas svg{height:250px}.home-model-facts{flex-wrap:wrap;gap:12px}.home-model-facts span{padding:0 12px}}
`
const showcaseStyle = `
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
html[data-page="showcase"] main{grid-template-columns:minmax(0,1120px);max-width:1440px;margin-left:var(--sidebar)}
html[data-page="showcase"] .toc{display:none}
.showcase-portal{margin:0 0 52px;color:var(--ink)}
.showcase-toolbar{position:sticky;z-index:8;top:60px;display:grid;grid-template-columns:minmax(260px,1fr) 190px auto;gap:10px;padding:14px 0;background:#fff;border-bottom:1px solid var(--line)}
.showcase-toolbar input,.showcase-toolbar select{width:100%;height:40px;padding:0 12px;border:1px solid #d7dde7;border-radius:7px;background:#fff;color:var(--ink);outline:none}
.showcase-toolbar input:focus,.showcase-toolbar select:focus{border-color:#7da3fa;box-shadow:0 0 0 3px #2863f019}
.showcase-view{display:flex;padding:3px;border:1px solid #d7dde7;border-radius:7px;background:var(--soft)}
.showcase-view button{min-width:70px;border:0;border-radius:5px;background:transparent;color:#667085;cursor:pointer}
.showcase-view button.active{background:#fff;color:#174dbd;box-shadow:0 1px 4px #1018281a}
.showcase-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:26px;margin-top:22px}
.showcase-categories{position:sticky;top:132px;height:max-content;display:flex;flex-direction:column;gap:5px}
.showcase-category{display:flex;align-items:center;justify-content:space-between;min-height:39px;padding:8px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:#525c6b;text-align:left;cursor:pointer}
.showcase-category b{min-width:24px;padding:2px 6px;border-radius:10px;background:#eef1f5;color:#758091;font-size:11px;text-align:center}
.showcase-category:hover,.showcase-category.active{border-color:#d8e3ff;background:#f1f5ff;color:#174dbd}
.showcase-category.active b{background:#2863f0;color:#fff}
.showcase-result-head{display:flex;align-items:center;justify-content:space-between;min-height:35px;margin-bottom:11px;color:#7b8593;font-size:12px}
.showcase-result-head output b{color:#222b39;font-size:15px}
.showcase-result-head a{color:#64748b;text-decoration:none}
.showcase-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.showcase-card{min-width:0;overflow:hidden;border:1px solid #dfe5ee;border-radius:10px;background:#fff;box-shadow:0 4px 16px #13213a08;transition:border-color .16s,box-shadow .16s,transform .16s}
.showcase-card:hover{border-color:#b8c9ec;box-shadow:0 12px 28px #13213a14;transform:translateY(-2px)}
.showcase-card[hidden]{display:none!important}
.showcase-thumb{display:block;aspect-ratio:12/7;overflow:hidden;border-bottom:1px solid #e2e7ef;background:#f8fafc;text-decoration:none}
.showcase-thumb img{display:block;width:100%;height:100%;object-fit:contain}
.showcase-card-body{padding:14px}
.showcase-card .showcase-discipline{margin:0 0 5px;color:#2863f0;font:600 10px/1.3 Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}
.showcase-card h3{margin:0;font-size:18px;line-height:1.25;letter-spacing:-.02em}
.showcase-card .showcase-type{margin:3px 0 9px;color:#687386;font-size:12px;line-height:1.4}
.showcase-card .showcase-summary{display:-webkit-box;min-height:58px;margin:0;color:#4f5b6d;font-size:12px;line-height:1.6;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.showcase-facts{display:flex;flex-wrap:wrap;gap:5px 12px;margin:12px 0 9px;padding-top:10px;border-top:1px solid #edf0f4;color:#697587;font-size:10px}
.showcase-facts b{color:#253046;font-size:12px}
.showcase-details{margin:8px 0;border:1px solid #e5e9f0;border-radius:6px;background:#fafbfc}
.showcase-details summary{padding:6px 8px;color:#536176;font-size:10px;cursor:pointer}
.showcase-details[open] summary{border-bottom:1px solid #e5e9f0;color:#174dbd}
.showcase-details>p,.showcase-details>div{margin:0;padding:6px 8px;color:#697587;font-size:9px;line-height:1.5}
.showcase-details>div{display:flex;flex-wrap:wrap;gap:4px 8px}.showcase-details>div>b{width:100%;color:#344054}.showcase-details code{font-size:9px}
.showcase-tags{display:flex;flex-wrap:wrap;gap:5px;min-height:25px}
.showcase-tag{padding:3px 7px;border:0;border-radius:10px;background:#f0f3f7;color:#5f6b7c;font-size:9px;cursor:pointer}
.showcase-tag:hover{background:#e5ecfb;color:#174dbd}
.showcase-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:13px}
article .showcase-actions a{padding:6px 8px;border:1px solid #dce2eb;border-radius:6px;color:#445066;font-size:10px;text-decoration:none}
article .showcase-actions a:hover{border-color:#9db8f5;color:#174dbd}
article .showcase-actions a.primary{margin-left:auto;border-color:#2863f0;background:#2863f0;color:#fff}
.showcase-grid.list{grid-template-columns:1fr}
.showcase-grid.list .showcase-card{display:grid;grid-template-columns:260px minmax(0,1fr)}
.showcase-grid.list .showcase-thumb{height:100%;aspect-ratio:auto;border-right:1px solid #e2e7ef;border-bottom:0}
.showcase-grid.list .showcase-summary{min-height:0;-webkit-line-clamp:2}
.showcase-empty{padding:40px;border:1px dashed #cad3df;border-radius:9px;text-align:center}
@media(max-width:1200px){.showcase-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){html[data-page="showcase"] main{margin-left:var(--sidebar)}.showcase-layout{grid-template-columns:1fr}.showcase-categories{position:static;display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.showcase-grid.list .showcase-card{grid-template-columns:210px minmax(0,1fr)}}
@media(max-width:780px){html[data-page="showcase"] main{margin-left:0}.showcase-toolbar{top:60px;grid-template-columns:1fr 130px}.showcase-view{grid-column:1/-1;width:max-content}.showcase-categories{grid-template-columns:repeat(2,minmax(0,1fr))}.showcase-grid{grid-template-columns:1fr}.showcase-grid.list .showcase-card{display:block}.showcase-grid.list .showcase-thumb{height:auto;aspect-ratio:12/7;border-right:0;border-bottom:1px solid #e2e7ef}}
`

const layoutStyle = `
:root{--header:49px;--sidebar:280px;--toc:272px;--frame:1536px;font-family:"Inter Variable",Inter,"Noto Sans SC","Microsoft YaHei UI","Segoe UI",Arial,sans-serif}
.topbar{height:var(--header);padding:0 max(20px,calc((100vw - var(--frame))/2 + 20px));background:#fffffffa;box-shadow:none}
.brand{width:146px;flex:0 0 146px;gap:8px}.brand img{width:25px;height:25px}.brand b{font-size:15px}.brand>span{font-size:11px}
.product-nav{display:flex;align-items:center;gap:2px}.product-nav a{padding:6px 10px;border-radius:8px;color:#505a68;font-size:13px}.product-nav a:hover,.product-nav a.active{background:#f0f3f8;color:#111827}
.search-button{width:208px;height:34px;margin-left:auto;background:#f8fafc}.top-links{margin-left:18px;gap:18px;font-size:13px}
.shell{max-width:var(--frame);margin:0 auto;padding-top:var(--header)}
.sidebar{top:var(--header);left:max(0px,calc((100vw - var(--frame))/2));width:var(--sidebar);padding:20px 12px 20px 8px;background:#f8f9fb}
.version{padding:0 8px}.nav-group{margin-top:18px}.nav-group h3{padding:0 8px}.nav-group>a{min-height:29px;padding:5px 10px;border-left:0;border-radius:6px;font-size:12px}
.nav-group>a:hover,.nav-group>a.active{border-left:0;background:#eaf0ff;color:#174dbd}.reference-group{margin-top:20px}
main{width:calc(100% - 320px);margin-left:296px;display:grid;grid-template-columns:minmax(0,1fr) var(--toc);gap:16px;justify-content:stretch;padding:0}
.content{max-width:none;min-width:0;padding:32px 24px 96px}.toc{top:var(--header);height:calc(100vh - var(--header));max-height:none;padding:35px 16px 28px;border-left:1px solid #eef0f4;overflow:auto}
article{min-height:0;max-width:800px;margin:0 auto}.page-hero{margin-bottom:34px}.eyebrow{margin:0 0 14px;font-size:10px}.page-hero h1{max-width:800px;margin:0 0 14px;font-size:28px;font-weight:600;line-height:36px;letter-spacing:-.025em}.page-hero .lead{max-width:800px;margin:0;padding:0;border:0;font-size:15px;line-height:26px}
h2{margin-top:44px;font-size:27px}h3{font-size:19px}.pager{margin-top:56px}

html[data-page="introduction"] .sidebar,html[data-page="introduction"] .toc{display:none}
html[data-page="introduction"] main{width:100%;margin:0;display:block}
html[data-page="introduction"] .content{padding:0;max-width:none}
html[data-page="introduction"] article{max-width:none;overflow:hidden}
html[data-page="introduction"] .page-hero{min-height:549px;display:flex;flex-direction:column;justify-content:center;margin:0;padding:96px 20%;background:linear-gradient(180deg,#fff 0%,#f7f9fc 100%);border-bottom:1px solid var(--line)}
html[data-page="introduction"] .page-hero .eyebrow{font-size:11px}
html[data-page="introduction"] .page-hero h1{font-size:60px;line-height:1;letter-spacing:-.055em}
html[data-page="introduction"] .page-hero .lead{max-width:850px;margin-top:8px;font-size:20px;line-height:1.65}
.home-actions{display:flex;gap:10px;margin-top:28px}.home-actions a{padding:10px 16px;border:1px solid #cfd7e3;border-radius:7px;background:#fff;color:#273244;font-size:13px;font-weight:600;text-decoration:none}.home-actions a.primary{border-color:var(--blue);background:var(--blue);color:#fff}
html[data-page="introduction"] article>h2,html[data-page="introduction"] article>h3,html[data-page="introduction"] article>h4,html[data-page="introduction"] article>.table-wrap,html[data-page="introduction"] article>pre,html[data-page="introduction"] article>.callout,html[data-page="introduction"] article>ul,html[data-page="introduction"] article>ol,html[data-page="introduction"] article>p{width:min(1232px,calc(100% - 64px));margin-left:auto;margin-right:auto}
html[data-page="introduction"] article>h2{margin-top:0;padding-top:86px;font-size:36px}
html[data-page="introduction"] article>h2:not(:first-of-type){margin-top:72px;border-top:1px solid var(--line)}
html[data-page="introduction"] article>p,html[data-page="introduction"] article>ul,html[data-page="introduction"] article>ol{max-width:850px}
html[data-page="introduction"] article>.table-wrap,html[data-page="introduction"] article>pre{margin-top:26px;margin-bottom:26px}
html[data-page="introduction"] .pager{display:none}

html[data-page="showcase"] .sidebar,html[data-page="showcase"] .toc,html[data-page="showcase"] .search-button{display:none}
html[data-page="showcase"] .topbar{padding:0 28px}
html[data-page="showcase"] .brand{width:236px;flex-basis:236px}
html[data-page="showcase"] .shell{max-width:none;margin:0}
html[data-page="showcase"] main{width:auto;max-width:none;margin-left:236px;display:block;padding:0 clamp(24px,2.5vw,56px) 56px}
html[data-page="showcase"] .content{width:100%;max-width:none;padding:36px 0 0}
html[data-page="showcase"] article{max-width:none}
html[data-page="showcase"] .page-hero{margin:0 0 28px}
html[data-page="showcase"] .page-hero .eyebrow{display:none}
html[data-page="showcase"] .page-hero h1{margin-bottom:9px;font-size:31px;line-height:1.2}
html[data-page="showcase"] .page-hero .lead{max-width:900px;font-size:14px}
html[data-page="showcase"] .pager{display:none}
html[data-page="showcase"] .showcase-portal{margin:0}
html[data-page="showcase"] .showcase-toolbar{top:var(--header);grid-template-columns:minmax(300px,1fr) 180px auto;padding:12px 0 16px}
html[data-page="showcase"] .showcase-layout{display:block;margin-top:16px}
html[data-page="showcase"] .showcase-categories{position:fixed;z-index:12;left:0;top:var(--header);bottom:0;width:236px;height:auto;padding:35px 18px 24px;border-right:1px solid var(--line);background:#fff;overflow:auto}
html[data-page="showcase"] .showcase-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:34px 24px}
html[data-page="showcase"] .showcase-card{border-radius:6px;box-shadow:none}
html[data-page="showcase"] .showcase-thumb{aspect-ratio:16/10}
html[data-page="showcase"] .showcase-card-body{padding:13px}
html[data-page="showcase"] .showcase-card .showcase-summary{min-height:42px;-webkit-line-clamp:2}
html[data-page="showcase"] .showcase-card .showcase-type,html[data-page="showcase"] .showcase-details,html[data-page="showcase"] .showcase-tags{display:none}
html[data-page="showcase"] .showcase-facts{margin:9px 0 7px;padding-top:8px}
html[data-page="showcase"] .showcase-actions{margin-top:8px}
html[data-page="showcase"] .showcase-grid.list{grid-template-columns:1fr}
html[data-page="showcase"] .showcase-grid.list .showcase-card{grid-template-columns:360px minmax(0,1fr)}
html[data-page="showcase"] .showcase-grid.list .showcase-card .showcase-type,html[data-page="showcase"] .showcase-grid.list .showcase-details,html[data-page="showcase"] .showcase-grid.list .showcase-tags{display:flex}
html[data-page="showcase"] .showcase-grid.list .showcase-details{display:block}

@media(min-width:1800px) and (max-width:2299px){html[data-page="showcase"] .showcase-grid:not(.list){grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:1279px){main{grid-template-columns:minmax(0,1fr)}.toc{display:none}}
@media(max-width:1000px) and (min-width:721px){html[data-page="showcase"] main{margin-left:200px;padding:0 24px 40px}html[data-page="showcase"] .brand{width:200px}html[data-page="showcase"] .showcase-categories{width:200px;padding:28px 14px 22px}}
@media(max-width:1023px){.sidebar{transform:translateX(-100%);transition:transform .18s;box-shadow:20px 0 50px #10182820}.sidebar.open{transform:translateX(0)}.menu-button{display:block}main{width:auto;margin-left:0;padding:0 16px}.content{padding:32px 8px 80px}}
@media(max-width:780px){.topbar{height:89px;display:grid;grid-template-columns:auto auto 1fr auto auto;grid-template-rows:48px 40px;align-items:center;padding:0 16px}.shell{padding-top:89px}.menu-button{grid-column:1}.brand{grid-column:2;width:auto;flex-basis:auto;margin-left:6px}.product-nav{grid-row:2;grid-column:1/-1;align-self:stretch;overflow-x:auto;border-top:1px solid var(--line)}.product-nav a{display:flex!important;align-items:center;flex:0 0 auto;padding:0 10px}.search-button{grid-column:4;width:32px;height:32px;margin:0;padding:0;justify-content:center}.search-button>span:not(:first-child),.search-button kbd{display:none}.top-links{grid-column:5;margin:0}.top-links>a{display:none}.sidebar{top:89px}main{padding:0 16px}.content{padding:24px 0 64px}.page-hero .lead{font-size:15px}html[data-page="introduction"] .menu-button{visibility:hidden}html[data-page="introduction"] .page-hero{min-height:430px;padding:64px 20px}html[data-page="introduction"] .page-hero h1{font-size:48px}html[data-page="introduction"] article>h2,html[data-page="introduction"] article>h3,html[data-page="introduction"] article>h4,html[data-page="introduction"] article>.table-wrap,html[data-page="introduction"] article>pre,html[data-page="introduction"] article>.callout,html[data-page="introduction"] article>ul,html[data-page="introduction"] article>ol,html[data-page="introduction"] article>p{width:calc(100% - 40px)}html[data-page="showcase"] .topbar{height:49px;display:flex;padding:0 14px}html[data-page="showcase"] .brand{width:auto;flex-basis:auto}html[data-page="showcase"] .product-nav,html[data-page="showcase"] .search-button,html[data-page="showcase"] .top-links a{display:none}html[data-page="showcase"] .top-links{margin-left:auto}html[data-page="showcase"] .shell{padding-top:49px}html[data-page="showcase"] main{margin:0;padding:0 18px 40px}html[data-page="showcase"] .content{padding-top:26px}html[data-page="showcase"] .showcase-toolbar{top:49px;grid-template-columns:1fr 130px}html[data-page="showcase"] .showcase-categories{position:static;width:auto;display:flex;padding:8px 0 4px;border:0;overflow:auto}html[data-page="showcase"] .showcase-category{flex:0 0 auto}html[data-page="showcase"] .showcase-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:32px 18px}}
html[data-page="introduction"] .page-hero{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(420px,1.15fr);column-gap:54px;align-content:center;padding:70px max(32px,calc((100vw - 1280px)/2 + 32px))}
html[data-page="introduction"] .page-hero .eyebrow{display:none}
html[data-page="introduction"] .hero-copy{min-width:0;align-self:center}
html[data-page="introduction"] .home-preview{grid-column:2;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-self:center}
.home-preview a{display:block;min-width:0;padding:7px;border:1px solid #dce3ed;border-radius:9px;background:#fff;box-shadow:0 12px 35px #1422380c;color:#364153;text-decoration:none}
.home-preview a:hover{border-color:#9eb7ef}.home-preview img{display:block;width:100%;height:auto;aspect-ratio:12/7;object-fit:contain;background:#f8fafc}.home-preview a span{display:block;padding:6px 4px 2px;font-size:11px}.home-preview-main{grid-column:1/-1}
.home-section{width:min(1232px,calc(100% - 64px));margin:0 auto;padding:84px 0 0}.home-section-heading{max-width:820px;margin-bottom:28px}.home-section-heading .eyebrow{margin-bottom:10px}.home-section-heading h2{margin:0 0 12px;font-size:36px;line-height:1.15}.home-section-heading>p:last-child{margin:0;color:#5d6878;font-size:16px;line-height:1.7}.home-capability-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.home-capability{min-height:176px;padding:22px;border:1px solid #e2e7ee;border-radius:10px;background:#fff;box-shadow:0 10px 28px #14223808}.home-capability:hover{border-color:#a9bff2;box-shadow:0 14px 36px #14223812;transform:translateY(-2px)}.home-capability-mark{display:block;width:10px;height:10px;margin-bottom:22px;border-radius:3px;background:#2863f0}.home-capability-sdk .home-capability-mark{background:#1eb58a}.home-capability-agent .home-capability-mark{background:#8c63e8}.home-capability-files .home-capability-mark{background:#e98a3b}.home-capability-examples .home-capability-mark{background:#d95272}.home-capability-framework .home-capability-mark{background:#16a0c8}.home-capability h3{margin:0 0 8px;font-size:18px}.home-capability p{margin:0;color:#687486;font-size:13px;line-height:1.65}.home-steps{padding-bottom:90px}.home-step-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin:0;padding:0;list-style:none}.home-step-grid li{min-width:0;padding:20px 0;border-top:1px solid #dfe5ec}.home-step-grid b{color:#2863f0;font:600 12px Consolas,monospace}.home-step-grid h3{margin:18px 0 7px;font-size:17px}.home-step-grid p{margin:0;color:#687486;font-size:13px;line-height:1.65}@media(max-width:980px){.home-section{width:calc(100% - 40px);padding-top:64px}.home-capability-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.home-step-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.home-section{width:calc(100% - 40px)}.home-section-heading h2{font-size:30px}.home-capability-grid,.home-step-grid{grid-template-columns:1fr}}@media(max-width:980px){html[data-page="introduction"] .page-hero{display:flex;align-items:stretch;gap:20px;padding:48px 24px}html[data-page="introduction"] .home-preview{width:100%;max-width:720px}}
@media(max-width:600px){html[data-page="introduction"] .page-hero{padding:42px 20px}html[data-page="introduction"] .page-hero h1{font-size:44px}html[data-page="introduction"] .home-preview{gap:7px}.home-preview a{padding:5px}.home-preview a span{font-size:10px}}
.home-agent-matrix{padding-bottom:92px}.home-agent-table-wrap{overflow-x:auto;border:1px solid #e2e7ee;border-radius:10px;background:#fff;box-shadow:0 10px 28px #14223808}.home-agent-table{width:100%;border-collapse:collapse;min-width:720px}.home-agent-table th,.home-agent-table td{padding:16px 18px;border-bottom:1px solid #edf0f4;text-align:left;font-size:13px;line-height:1.55}.home-agent-table thead th{background:#f8fafc;color:#687486;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}.home-agent-table tbody tr:last-child th,.home-agent-table tbody tr:last-child td{border-bottom:0}.home-agent-table tbody th{color:#1d2736;font-weight:600}.home-agent-table tbody td{color:#687486}.home-agent-table a{color:#2863f0;text-decoration:none}.home-agent-table a:hover{text-decoration:underline}.home-status{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:11px;white-space:nowrap}.home-status-ready{background:#eaf8f1;color:#13764b}.home-status-preview{background:#fff5df;color:#9a6500}@media(max-width:980px){.home-agent-matrix{padding-bottom:72px}}@media(max-width:600px){.home-agent-table th,.home-agent-table td{padding:13px 14px}}`

const clientScript = `const html=document.documentElement
const docsRoot=html.dataset.docsRoot||'./'
const docsBase=new URL(docsRoot,location.href)
const searchRevision=${JSON.stringify(assetRevision)}
const languageButton=document.getElementById('language')
const searchButton=document.getElementById('search-button')
const dialog=document.getElementById('search-dialog')
const input=document.getElementById('search')
const results=document.getElementById('results')
const sidebar=document.getElementById('sidebar')
let locale=localStorage.getItem('kjdraw.docs.language')||(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')
let guideEntries=[]
let apiEntries=[]
let indexesPending=2
let searchReturnFocus=null
function updateSearchStats(){const stats=document.getElementById('search-stats');if(!stats)return;stats.textContent=locale==='zh'?'指南、Editor API 与完整类型参考':'Guides, Editor API and complete type reference'}
function applyLanguage(){
  html.dataset.locale=locale
  html.lang=locale==='zh'?'zh-CN':'en'
  languageButton.textContent=locale==='zh'?'EN':'中文'
  input.placeholder=locale==='zh'?'搜索 KJDraw 指南与 API':'Search KJDraw guides and API'
  const option=document.querySelector('#docs-version option')
  if(option)option.textContent=option.textContent.replace(/ · (?:current|当前)$/,locale==='zh'?' · 当前':' · current')
  updateSearchStats()
}
function normalizeGuide(entry){return{...entry,href:new URL(entry.href,docsBase).href}}
function normalizeApi(entry){return{...entry,kind:'api',locale:null,title:entry.name,summary:entry.module+' · '+entry.kind,href:new URL(entry.href,docsBase).href,text:entry.summary}}
function score(entry,query){const haystack=(entry.title+' '+entry.summary+' '+entry.text).toLowerCase();if(entry.title.toLowerCase()===query)return 100;if(entry.title.toLowerCase().startsWith(query))return 80;if(entry.title.toLowerCase().includes(query))return 60;return haystack.includes(query)?20:0}
function renderSearch(){
  const query=input.value.trim().toLowerCase()
  const entries=[...guideEntries.filter(entry=>entry.locale===locale),...apiEntries]
  const matches=entries.map(entry=>({entry,rank:query?score(entry,query):entry.kind==='guide'?10:1})).filter(row=>row.rank>0).sort((a,b)=>b.rank-a.rank||a.entry.title.localeCompare(b.entry.title)).slice(0,60)
  results.replaceChildren(...matches.map(({entry})=>{
    const link=document.createElement('a');const title=document.createElement('b');const summary=document.createElement('span');const kind=document.createElement('em')
    link.href=entry.href;title.textContent=entry.title;summary.textContent=entry.summary;kind.textContent=entry.kind
    link.append(title,summary,kind);link.onclick=()=>dialog.close();return link
  }))
  if(!matches.length){const empty=document.createElement('p');empty.textContent=indexesPending?(locale==='zh'?'正在加载搜索索引…':'Loading search index…'):(locale==='zh'?'没有找到匹配结果。':'No matching documentation.');results.replaceChildren(empty)}
}
function restoreSearchFocus(){const target=searchReturnFocus;searchReturnFocus=null;if(target&&target.isConnected)target.focus()}
function closeSearch(){if(dialog.open)dialog.close();else restoreSearchFocus()}
function openSearch(){if(!dialog.open){searchReturnFocus=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:searchButton;dialog.showModal()}renderSearch();setTimeout(()=>input.focus())}
searchButton.onclick=openSearch
input.oninput=renderSearch
languageButton.onclick=()=>{locale=locale==='zh'?'en':'zh';localStorage.setItem('kjdraw.docs.language',locale);applyLanguage();renderSearch()}
document.getElementById('menu-button').onclick=()=>sidebar.classList.toggle('open')
for(const link of sidebar.querySelectorAll('a'))link.addEventListener('click',()=>sidebar.classList.remove('open'))
for(const button of document.querySelectorAll('.copy'))button.onclick=async()=>{await navigator.clipboard.writeText(button.nextElementSibling.textContent);const old=button.textContent;button.textContent=locale==='zh'?'已复制':'Copied';setTimeout(()=>button.textContent=old,1200)}
dialog.addEventListener('close',restoreSearchFocus)
dialog.addEventListener('cancel',event=>{event.preventDefault();closeSearch()})
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();closeSearch();return}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch()}if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement&&document.activeElement.tagName)){event.preventDefault();openSearch()}})
if(location.hash.startsWith('#zh-'))locale='zh';if(location.hash.startsWith('#en-'))locale='en';applyLanguage()
async function fetchSearchEntries(path,label){
  let failure
  for(let attempt=0;attempt<2;attempt++){
    const url=new URL(path,docsBase);url.searchParams.set('v',searchRevision);if(attempt)url.searchParams.set('retry',String(attempt))
    try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(label+' index '+response.status);const value=await response.json();if(!Array.isArray(value.entries))throw new Error(label+' index has no entries');return value.entries}
    catch(error){failure=error;if(!attempt)await new Promise(resolve=>setTimeout(resolve,250))}
  }
  console.warn('KJDraw documentation '+label.toLowerCase()+' search is unavailable.',failure)
  return []
}
function finishIndex(){indexesPending=Math.max(0,indexesPending-1);updateSearchStats();renderSearch()}
void fetchSearchEntries('search-index.json','Guide').then(entries=>{guideEntries=entries.map(normalizeGuide);finishIndex()})
void fetchSearchEntries('api/search-index.json','API').then(entries=>{apiEntries=entries.map(normalizeApi);finishIndex()})
function initializeShowcase(portal){
  const query=portal.querySelector('.showcase-query'),tag=portal.querySelector('.showcase-tag-filter'),grid=portal.querySelector('.showcase-grid'),output=portal.querySelector('.showcase-result-head output'),empty=portal.querySelector('.showcase-empty'),cards=[...portal.querySelectorAll('.showcase-card')]
  let category='all',view='grid'
  const apply=()=>{const needles=query.value.trim().toLocaleLowerCase().split(/\\s+/).filter(Boolean);let count=0;for(const card of cards){const haystack=card.dataset.search||'';const matchesCategory=category==='all'||card.dataset.category===category;const matchesTag=tag.value==='all'||(card.dataset.tags||'').split('|').includes(tag.value);const matchesQuery=needles.every(needle=>haystack.includes(needle));card.hidden=!(matchesCategory&&matchesTag&&matchesQuery);if(!card.hidden)count++}output.querySelector('b').textContent=String(count);empty.hidden=count!==0;grid.classList.toggle('list',view==='list')}
  query.addEventListener('input',apply);tag.addEventListener('change',apply)
  for(const button of portal.querySelectorAll('.showcase-category'))button.addEventListener('click',()=>{category=button.dataset.category;for(const item of portal.querySelectorAll('.showcase-category')){const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))}apply()})
  for(const button of portal.querySelectorAll('.showcase-view button'))button.addEventListener('click',()=>{view=button.dataset.view;for(const item of portal.querySelectorAll('.showcase-view button')){const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))}apply()})
  for(const button of portal.querySelectorAll('.showcase-tag'))button.addEventListener('click',()=>{tag.value=button.dataset.tag;apply();query.focus()})
  apply()
}
for(const portal of document.querySelectorAll('.showcase-portal'))initializeShowcase(portal)
`

const outputs = new Map()
orderedPages.forEach((page, index) => outputs.set(pageOutput(page.slug), renderPage(page, index)))
outputs.set('style.css', `${style}\n${homeStyle}\n${showcaseStyle}\n${layoutStyle.trim()}\n`)
outputs.set('app.js', clientScript)
for (const [path, content] of showcasePortal.outputs) outputs.set(path, content)
outputs.set('search-index.json', `${JSON.stringify({
  schema: 'com.kanjie.kjdraw.docs-search-index@1',
  package: packageJson.name,
  version: packageJson.version,
  sourceDigest: digest,
  entries: searchEntries,
}, null, 2)}\n`)

const manifest = {
  schema: 'com.kanjie.kjdraw.docs-site@1',
  package: packageJson.name,
  version: packageJson.version,
  sourceDigest: digest,
  locales: ['en', 'zh'],
  pages: orderedPages.map(page => ({
    slug: page.slug,
    output: pageOutput(page.slug),
    source: page.source,
    title: page.title,
    anchors: {
      en: [`en-${page.slug}`, ...page.rendered.en.headings.map(heading => heading.id)],
      zh: [`zh-${page.slug}`, ...page.rendered.zh.headings.map(heading => heading.id)],
    },
  })),
  outputs: [...outputs.keys(), 'site-manifest.json'].sort(),
}
outputs.set('site-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)

const stale = []
for (const [relativePath, expected] of outputs) {
  const absolutePath = resolve(outputRoot, relativePath)
  invariant(!relative( outputRoot, absolutePath).startsWith(`..${sep}`), `Generated path escapes docs/latest: ${relativePath}`)
  if (checkOnly) {
    let actual = null
    try { actual = await readFile(absolutePath, 'utf8') } catch {}
    if (actual !== expected) stale.push(relativePath)
  } else {
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, expected)
  }
}

if (stale.length) {
  console.error(`Generated documentation portal is stale:\n${stale.sort().map(path => `- docs/latest/${path}`).join('\n')}\nRun: node scripts/build-docs-site.mjs`)
  process.exit(1)
}

console.log(`${checkOnly ? 'Verified' : 'Generated'} ${orderedPages.length} bilingual documentation pages, ${searchEntries.length} guide search records and ${manifest.outputs.length} portal artifacts.`)
