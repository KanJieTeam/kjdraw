import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    .replace(/[`*_>#|{}\[\]-]/g, ' ')
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
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}<a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeHtml(title)}">#</a></h${level}>`)
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
  const headingLinks = page.rendered[locale].headings
    .filter(heading => heading.level <= 3)
    .map(heading => `<a class="toc-level-${heading.level}" href="#${heading.id}">${escapeHtml(heading.title)}</a>`)
    .join('')
  return `<div class="lang-${locale}">${headingLinks}</div>`
}

function renderPage(page, index) {
  const atRoot = page.slug === 'introduction'
  const rootPrefix = atRoot ? './' : '../'
  const docsAssetPrefix = atRoot ? '../assets/' : '../../assets/'
  const previous = orderedPages[index - 1]
  const next = orderedPages[index + 1]
  const canonical = `https://kanjieteam.github.io/kjdraw/docs/latest/${atRoot ? '' : `${page.slug}/`}`
  const navLink = target => target.slug === 'introduction' ? rootPrefix : `${rootPrefix}${target.slug}/`
  const pager = target => target ? `<a href="${navLink(target)}">${localized(target.title.en, target.title.zh, 'strong')}</a>` : '<span></span>'
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
    <a class="brand" href="${rootPrefix}"><img src="${docsAssetPrefix}mark.svg" alt=""><b>KJDraw</b><span>Docs</span></a>
    <button id="search-button" class="search-button" type="button" aria-keyshortcuts="Control+K Meta+K"><span aria-hidden="true">⌕</span><span class="lang-en">Search guides and API</span><span class="lang-zh">搜索指南与 API</span><kbd>Ctrl K</kbd></button>
    <nav class="top-links"><a href="${rootPrefix}api/">API</a><a href="https://kanjieteam.github.io/kjdraw/">${localized('Demo', '演示')}</a><a href="https://github.com/KanJieTeam/kjdraw">GitHub</a><button id="language" type="button">中文</button></nav>
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
          <p class="eyebrow">KJDRAW / ${escapeHtml(page.title.en.toUpperCase())}</p>
          <h1>${escapeHtml(page.title.en)}</h1>
          <p class="lead">${escapeHtml(page.summary.en)}</p>
          ${page.rendered.en.html}
        </article>
        <article class="lang-zh" lang="zh-CN" id="zh-${page.slug}">
          <p class="eyebrow">KJDRAW / ${escapeHtml(page.title.zh)}</p>
          <h1>${escapeHtml(page.title.zh)}</h1>
          <p class="lead">${escapeHtml(page.summary.zh)}</p>
          ${page.rendered.zh.html}
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
`

const outputs = new Map()
orderedPages.forEach((page, index) => outputs.set(pageOutput(page.slug), renderPage(page, index)))
outputs.set('style.css', `${style}\n`)
outputs.set('app.js', clientScript)
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
