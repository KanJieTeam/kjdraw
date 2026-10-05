// A small, local Markdown renderer. Model output is always text, never HTML.
const MAX_NESTING = 24
const WORD_CHARACTER = /[\p{L}\p{N}]/u
const ESCAPABLE = /[\\`*{}\[\]()#+\-.!_>|~]/

function element(parent, tag) {
  const node = parent.ownerDocument.createElement(tag)
  parent.appendChild(node)
  return node
}

function appendText(parent, text) {
  if (text) parent.appendChild(parent.ownerDocument.createTextNode(text))
}

function indentation(line) {
  let width = 0
  for (const character of line) {
    if (character === ' ') width++
    else if (character === '\t') width += 4 - width % 4
    else break
  }
  return width
}

function removeIndent(line, width) {
  let position = 0, removed = 0
  while (position < line.length && removed < width) {
    if (line[position] === ' ') removed++
    else if (line[position] === '\t') removed += 4 - removed % 4
    else break
    position++
  }
  return ' '.repeat(Math.max(0, removed - width)) + line.slice(position)
}

function isEscaped(text, position) {
  let slashes = 0
  while (position > 0 && text[--position] === '\\') slashes++
  return slashes % 2 === 1
}

function closingDelimiter(text, marker, start) {
  let position = start
  while ((position = text.indexOf(marker, position)) !== -1) {
    if (isEscaped(text, position)) { position += marker.length; continue }
    let end = position + marker.length
    while (text[end] === marker[0]) end++
    const length = end - position
    if (marker.length === 1 && length === 2) { position = end; continue }
    const closing = end - marker.length
    if (!/\s/.test(text[closing - 1] ?? '') &&
        !(marker[0] === '_' && WORD_CHARACTER.test(text[end] ?? '') && WORD_CHARACTER.test(text[closing - 1] ?? ''))) return closing
    position = end
  }
  return -1
}

function readLink(text, start) {
  let position = start + 1, brackets = 1
  for (; position < text.length; position++) {
    if (text[position] === '\\') { position++; continue }
    if (text[position] === '[') brackets++
    if (text[position] === ']' && --brackets === 0) break
  }
  if (brackets !== 0 || text[position + 1] !== '(') return null
  const label = text.slice(start + 1, position)
  const targetStart = position + 2
  let parentheses = 1
  for (position = targetStart; position < text.length; position++) {
    if (text[position] === '\\') { position++; continue }
    if (text[position] === '(') parentheses++
    if (text[position] === ')' && --parentheses === 0) break
  }
  if (parentheses !== 0) return null
  const target = text.slice(targetStart, position).trim()
  const match = /^(?:<([^<>]+)>|(\S+?))(?:\s+"([^"]*)"|\s+'([^']*)')?$/.exec(target)
  return { label, destination: match ? (match[1] ?? match[2]) : '', title: match?.[3] ?? match?.[4], end: position + 1 }
}

function safeLink(destination) {
  const value = destination.replace(/\\([\\()[\]<>])/g, '$1')
  if (/[\u0000-\u0020\u007f-\u009f]/.test(value) || !/^(?:https?:\/\/|mailto:)/i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname ? url.href : null
    if (url.protocol === 'mailto:' && url.pathname) return url.href
  } catch { /* A malformed destination stays visible as ordinary text. */ }
  return null
}

function rawHtmlEnd(text, start) {
  if (text.startsWith('<!--', start)) {
    const closing = text.indexOf('-->', start + 4)
    return closing === -1 ? text.length : closing + 3
  }
  const tag = /^<\/?([a-z][a-z0-9-]*)\b/i.exec(text.slice(start, start + 128))
  if (!tag) return -1
  let quote = null, end = start + tag[0].length
  for (; end < text.length; end++) {
    const character = text[end]
    if (quote) { if (character === quote) quote = null }
    else if (character === '"' || character === "'") quote = character
    else if (character === '>') break
  }
  if (end === text.length) return text.length
  end++
  if (text[start + 1] === '/' || /\/\s*>$/.test(text.slice(start, end))) return end
  const name = tag[1].toLowerCase()
  if (['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(name)) return end
  const closing = text.toLowerCase().indexOf(`</${name}`, end)
  if (closing !== -1) {
    const closeEnd = text.indexOf('>', closing)
    if (closeEnd !== -1) return closeEnd + 1
  }
  return ['script', 'style', 'iframe', 'textarea'].includes(name) ? text.length : end
}

function appendInline(parent, text, depth = 0, insideLink = false) {
  if (depth >= MAX_NESTING) { appendText(parent, text); return }
  let plain = ''
  const flush = () => { appendText(parent, plain); plain = '' }
  for (let position = 0; position < text.length;) {
    const character = text[position]
    if (character === '<') {
      const end = rawHtmlEnd(text, position)
      if (end !== -1) { plain += text.slice(position, end); position = end; continue }
    }
    if (character === '\\' && ESCAPABLE.test(text[position + 1] ?? '')) {
      plain += text[position + 1]; position += 2; continue
    }
    if (character === '\n') { flush(); element(parent, 'br'); position++; continue }
    if (character === '`') {
      let length = 1
      while (text[position + length] === '`') length++
      const marker = '`'.repeat(length)
      let end = text.indexOf(marker, position + length)
      while (end !== -1 && (text[end - 1] === '`' || text[end + length] === '`')) end = text.indexOf(marker, end + length)
      if (end !== -1) {
        flush()
        element(parent, 'code').textContent = text.slice(position + length, end).replace(/\n/g, ' ')
        position = end + length; continue
      }
      plain += marker; position += length; continue
    }
    if ((character === '[' && !insideLink) || (character === '!' && text[position + 1] === '[')) {
      const image = character === '!'
      const link = readLink(text, position + (image ? 1 : 0))
      if (link) {
        const href = image ? null : safeLink(link.destination)
        if (href) {
          flush()
          const anchor = element(parent, 'a')
          anchor.setAttribute('href', href)
          if (/^https?:/i.test(href)) {
            anchor.setAttribute('target', '_blank')
            anchor.setAttribute('rel', 'noopener noreferrer')
          }
          if (link.title) anchor.setAttribute('title', link.title)
          appendInline(anchor, link.label, depth + 1, true)
        } else plain += text.slice(position, link.end)
        position = link.end; continue
      }
    }
    if (character === '*' || character === '_') {
      let length = 1
      while (text[position + length] === character && length < 3) length++
      const marker = character.repeat(length)
      const intraword = character === '_' && WORD_CHARACTER.test(text[position - 1] ?? '') && WORD_CHARACTER.test(text[position + length] ?? '')
      if (!intraword && text[position + length] && !/\s/.test(text[position + length])) {
        const end = closingDelimiter(text, marker, position + length)
        if (end > position + length) {
          flush()
          const emphasis = element(parent, length === 1 ? 'em' : 'strong')
          const target = length === 3 ? element(emphasis, 'em') : emphasis
          appendInline(target, text.slice(position + length, end), depth + 1, insideLink)
          position = end + length; continue
        }
      }
      plain += marker; position += length; continue
    }
    plain += character; position++
  }
  flush()
}

function tableCells(line) {
  const text = line.trim(), cells = []
  let cell = '', codeMarker = 0
  for (let position = 0; position < text.length; position++) {
    const character = text[position]
    if (character === '\\' && position + 1 < text.length) {
      cell += character + text[++position]; continue
    }
    if (character === '`') {
      let length = 1
      while (text[position + length] === '`') length++
      if (codeMarker === length) codeMarker = 0
      else if (!codeMarker) codeMarker = length
      cell += '`'.repeat(length); position += length - 1; continue
    }
    if (character === '|' && !codeMarker) { cells.push(cell.trim()); cell = '' }
    else cell += character
  }
  cells.push(cell.trim())
  if (text.startsWith('|')) cells.shift()
  if (text.endsWith('|') && !isEscaped(text, text.length - 1) && !codeMarker) cells.pop()
  return cells
}

function tableHeader(lines, position) {
  if (!lines[position]?.includes('|') || !lines[position + 1]) return null
  const headers = tableCells(lines[position]), delimiters = tableCells(lines[position + 1])
  if (!headers.length || headers.length !== delimiters.length || !delimiters.every(cell => /^:?-{3,}:?$/.test(cell))) return null
  return { headers, alignments: delimiters.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left') }
}

const fence = line => /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line)
const closesFence = (line, marker) => {
  const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
  return !!closing && closing[1][0] === marker[0] && closing[1].length >= marker.length
}
const heading = line => /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line)
const listItem = line => /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line)
const quote = line => /^ {0,3}>[ \t]?(.*)$/.exec(line)
const rule = line => /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)

function startsBlock(lines, position) {
  const line = lines[position] ?? ''
  const item = listItem(line)
  return !!(fence(line) || heading(line) || quote(line) || rule(line) || (item && indentation(item[1]) <= 3) || tableHeader(lines, position))
}

function appendList(parent, lines, position, depth) {
  const first = listItem(lines[position]), baseIndent = indentation(first[1]), ordered = /^\d/.test(first[2])
  const list = element(parent, ordered ? 'ol' : 'ul')
  if (ordered && parseInt(first[2], 10) !== 1) list.setAttribute('start', String(parseInt(first[2], 10)))
  while (position < lines.length) {
    const item = listItem(lines[position])
    if (!item || indentation(item[1]) !== baseIndent || /^\d/.test(item[2]) !== ordered) break
    const contentIndent = indentation(item[1] + item[2] + item[3])
    const content = [item[4]]
    position++
    while (position < lines.length) {
      const line = lines[position]
      if (!line.trim()) {
        let next = position + 1
        while (next < lines.length && !lines[next].trim()) next++
        const nextItem = listItem(lines[next] ?? '')
        if (nextItem && indentation(nextItem[1]) === baseIndent) { position = next; break }
        if (next < lines.length && indentation(lines[next]) >= contentIndent) { content.push(''); position = next; continue }
        break
      }
      const nextItem = listItem(line)
      if (nextItem && indentation(nextItem[1]) <= baseIndent) break
      if (indentation(line) >= contentIndent) content.push(removeIndent(line, contentIndent))
      else if (!startsBlock(lines, position)) content.push(line.trimStart())
      else break
      position++
    }
    appendBlocks(element(list, 'li'), content, depth + 1)
  }
  return position
}

function appendTable(parent, lines, position, header) {
  const scroll = element(parent, 'div')
  scroll.className = 'message-table-scroll'
  scroll.setAttribute('tabindex', '0')
  scroll.setAttribute('role', 'region')
  scroll.setAttribute('aria-label', 'Table')
  const table = element(scroll, 'table'), head = element(element(table, 'thead'), 'tr')
  header.headers.forEach((text, index) => {
    const cell = element(head, 'th')
    cell.setAttribute('scope', 'col')
    cell.setAttribute('data-align', header.alignments[index])
    appendInline(cell, text)
  })
  const body = element(table, 'tbody')
  position += 2
  while (position < lines.length && lines[position].trim() && lines[position].includes('|') && !startsBlock(lines, position)) {
    const cells = tableCells(lines[position++]), row = element(body, 'tr')
    header.headers.forEach((_text, index) => {
      const cell = element(row, 'td')
      cell.setAttribute('data-align', header.alignments[index])
      appendInline(cell, index === header.headers.length - 1 ? cells.slice(index).join(' | ') : (cells[index] ?? ''))
    })
  }
  return position
}

function appendBlocks(parent, lines, depth = 0) {
  if (depth >= MAX_NESTING) { appendInline(element(parent, 'p'), lines.join('\n')); return }
  for (let position = 0; position < lines.length;) {
    const line = lines[position]
    if (!line.trim()) { position++; continue }
    const codeFence = fence(line)
    if (codeFence && !(codeFence[1][0] === '`' && codeFence[2].includes('`'))) {
      const content = [], marker = codeFence[1]
      position++
      while (position < lines.length && !closesFence(lines[position], marker)) content.push(lines[position++])
      if (position < lines.length) position++
      const pre = element(parent, 'pre'), code = element(pre, 'code')
      pre.setAttribute('tabindex', '0')
      const language = codeFence[2].trim().split(/\s+/)[0]
      if (/^[\w+-]{1,32}$/.test(language)) code.setAttribute('data-language', language)
      code.textContent = content.join('\n')
      continue
    }
    const title = heading(line)
    if (title) { appendInline(element(parent, `h${title[1].length}`), title[2].replace(/[ \t]+#+[ \t]*$/, '')); position++; continue }
    if (rule(line)) { element(parent, 'hr'); position++; continue }
    const quotation = quote(line)
    if (quotation) {
      const content = []
      while (position < lines.length) {
        const part = quote(lines[position])
        if (!part) break
        content.push(part[1]); position++
      }
      appendBlocks(element(parent, 'blockquote'), content, depth + 1)
      continue
    }
    const header = tableHeader(lines, position)
    if (header) { position = appendTable(parent, lines, position, header); continue }
    const item = listItem(line)
    if (item && indentation(item[1]) <= 3) { position = appendList(parent, lines, position, depth); continue }
    const paragraph = [line]
    position++
    while (position < lines.length && lines[position].trim() && !startsBlock(lines, position)) paragraph.push(lines[position++])
    appendInline(element(parent, 'p'), paragraph.join('\n'))
  }
}

export function renderMessageMarkdown(container, text) {
  container.replaceChildren()
  container.classList.add('message-markdown')
  appendBlocks(container, String(text ?? '').replace(/\r\n?/g, '\n').split('\n'))
  return container
}
