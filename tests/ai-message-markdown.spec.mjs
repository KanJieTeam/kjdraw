import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMessageMarkdown } from '../apps/playground/ai/message-markdown.js'

// The fixture deliberately rejects HTML sinks so security regressions fail in Node too.
function documentFixture() {
  const document = {
    createElement: tag => new Element(tag),
    createTextNode: text => ({ nodeType: 3, textContent: String(text), ownerDocument: document }),
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase()
      this.nodeType = 1
      this.ownerDocument = document
      this.childNodes = []
      this.attributes = new Map()
      this.className = ''
      this.classList = { add: value => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), value])].join(' ') } }
    }
    appendChild(child) { this.childNodes.push(child); return child }
    replaceChildren(...children) { this.childNodes = children }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    get textContent() { return this.childNodes.map(child => child.textContent).join('') }
    set textContent(text) { this.childNodes = text === '' ? [] : [document.createTextNode(text)] }
    set innerHTML(_value) { throw new Error('Untrusted HTML sink used') }
    insertAdjacentHTML() { throw new Error('Untrusted HTML sink used') }
  }
  return document.createElement('div')
}

function descendants(parent, tag) {
  return parent.childNodes.flatMap(child => child.nodeType === 1 ? [
    ...(child.tagName === tag.toUpperCase() ? [child] : []), ...descendants(child, tag),
  ] : [])
}

test('assistant Markdown renders Chinese headings, emphasis, paragraphs and original line breaks', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, '# 工程说明\r\n\r\n**加粗**、*斜体*、***共同强调***，`LINE`。\r\n第二行\r\n\r\n普通段落。')
  assert.equal(descendants(container, 'h1')[0].textContent, '工程说明')
  assert.deepEqual(descendants(container, 'strong').map(node => node.textContent), ['加粗', '共同强调'])
  assert.deepEqual(descendants(container, 'em').map(node => node.textContent), ['斜体', '共同强调'])
  assert.equal(descendants(container, 'code')[0].textContent, 'LINE')
  assert.equal(descendants(container, 'br').length, 1)
  assert.equal(descendants(container, 'p').length, 2)
  assert.ok(container.className.includes('message-markdown'))
})

test('lists retain item order, nesting, continuation lines and block quotes', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, '3. 先检查\n4. 再绘制\n   - 图层\n   - 尺寸\n     延续说明\n\n> 引用 **规则**\n>\n> 下一段')
  assert.equal(descendants(container, 'ol')[0].getAttribute('start'), '3')
  assert.equal(descendants(container, 'ul').length, 1)
  assert.equal(descendants(container, 'li').length, 4)
  assert.ok(descendants(container, 'li')[3].textContent.includes('延续说明'))
  assert.equal(descendants(container, 'blockquote').length, 1)
  assert.equal(descendants(container, 'blockquote')[0].childNodes.length, 2)
  assert.equal(descendants(container, 'strong')[0].textContent, '规则')
})

test('pipe tables use semantic headers, alignments and an accessible local scroll region', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, '| 名称 | 类型 | 数量 |\n| :--- | :---: | ---: |\n| **边界** | `A|B` | 2 |\n| 管线\\|辅助 | LINE | 3 |')
  const region = container.childNodes[0]
  assert.equal(region.className, 'message-table-scroll')
  assert.equal(region.getAttribute('tabindex'), '0')
  assert.equal(region.getAttribute('role'), 'region')
  assert.ok(region.getAttribute('aria-label'))
  assert.equal(descendants(container, 'table').length, 1)
  assert.equal(descendants(container, 'thead').length, 1)
  assert.equal(descendants(container, 'tbody').length, 1)
  assert.deepEqual(descendants(container, 'th').map(node => node.getAttribute('scope')), ['col', 'col', 'col'])
  assert.deepEqual(descendants(container, 'th').map(node => node.getAttribute('data-align')), ['left', 'center', 'right'])
  assert.deepEqual(descendants(container, 'td').map(node => node.textContent), ['边界', 'A|B', '2', '管线|辅助', 'LINE', '3'])
})

test('fenced code preserves literal HTML, Markdown, indentation and an unfinished stream', () => {
  const container = documentFixture()
  const code = '<script>alert(1)</script>\n  **literal**\n\tconst value = "a|b"'
  renderMessageMarkdown(container, `\`\`\`javascript\n${code}\n\`\`\`\n\n~~~text\nunfinished`)
  assert.equal(descendants(container, 'pre').length, 2)
  assert.deepEqual(descendants(container, 'code').map(node => node.textContent), [code, 'unfinished'])
  assert.equal(descendants(container, 'code')[0].getAttribute('data-language'), 'javascript')
  assert.equal(descendants(container, 'pre')[0].getAttribute('tabindex'), '0')
  assert.equal(descendants(container, 'strong').length, 0)
  assert.equal(descendants(container, 'script').length, 0)
})

test('only explicit HTTP, HTTPS and mailto links become anchors', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, '[文档](https://example.com/docs_(v1) "查看文档") [HTTP](http://example.com) [邮箱](mailto:cad@example.com)\n' +
    '[脚本](javascript:alert(1)) [文件](file:///C:/secret) [数据](data:text/html,test) [相对](/api) [网络](//example.com) [控制](java\tscript:alert(1))')
  const links = descendants(container, 'a')
  assert.equal(links.length, 3)
  assert.deepEqual(links.map(node => node.getAttribute('href')), ['https://example.com/docs_(v1)', 'http://example.com/', 'mailto:cad@example.com'])
  assert.equal(links[0].getAttribute('title'), '查看文档')
  assert.equal(links[0].getAttribute('target'), '_blank')
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer')
  assert.ok(container.textContent.includes('[脚本](javascript:alert(1))'))
})

test('HTML, event attributes and remote images remain visible text without executable elements', () => {
  const container = documentFixture()
  const input = '<img src="https://example.com/pixel" onerror="alert(1)">\n<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>\n![跟踪图片](https://example.com/pixel)\n[安全](HTTPS://example.com/" onmouseover="alert(1))'
  renderMessageMarkdown(container, input)
  for (const tag of ['img', 'script', 'iframe', 'object', 'style']) assert.equal(descendants(container, tag).length, 0)
  assert.equal(descendants(container, 'a').length, 0)
  assert.ok(container.textContent.includes('<img src='))
  assert.ok(container.textContent.includes('![跟踪图片](https://example.com/pixel)'))
})

test('escaped punctuation, unmatched markers and nested emphasis preserve the visible message', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, '\\*不是斜体\\* snake_case 中文_名称_\n**外层 *内层***，*外层 **内层***\n未闭合 **内容 [标签](无效链接) `code')
  assert.ok(container.textContent.includes('*不是斜体* snake_case 中文_名称_'))
  assert.deepEqual(descendants(container, 'strong').map(node => node.textContent), ['外层 内层', '内层'])
  assert.deepEqual(descendants(container, 'em').map(node => node.textContent), ['内层', '外层 内层'])
  assert.ok(container.textContent.includes('未闭合 **内容 [标签](无效链接) `code'))
})

test('raw HTML with Markdown-like attribute and script contents stays opaque visible text', () => {
  const container = documentFixture()
  const input = '<img onerror="window.__aiMarkdownXss=true" src="https://example.com/pixel">\n<script>window.__aiMarkdownXss=true; **literal**</script>\n\n**正常加粗**'
  renderMessageMarkdown(container, input)
  assert.ok(container.textContent.includes('<script>window.__aiMarkdownXss=true; **literal**</script>'))
  assert.deepEqual(descendants(container, 'strong').map(node => node.textContent), ['正常加粗'])
  assert.equal(descendants(container, 'script').length, 0)
  assert.equal(descendants(container, 'img').length, 0)
})

test('repeated streaming renders replace earlier content without duplicating DOM nodes', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, '**旧内容**')
  renderMessageMarkdown(container, '**新内容**\n\n- 结果')
  assert.equal(descendants(container, 'strong').length, 1)
  assert.equal(descendants(container, 'strong')[0].textContent, '新内容')
  assert.equal(descendants(container, 'li').length, 1)
  assert.equal(container.className, 'message-markdown')
  renderMessageMarkdown(container, '')
  assert.equal(container.childNodes.length, 0)
})

test('deeply nested model output stays bounded and preserves content', () => {
  const container = documentFixture()
  renderMessageMarkdown(container, `${'> '.repeat(200)}最终内容`)
  assert.equal(descendants(container, 'blockquote').length, 24)
  assert.ok(container.textContent.endsWith('最终内容'))
})
