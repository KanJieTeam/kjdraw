import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { KJDRAW_THEME_CSS, kjdrawIcon } from '../src/theme.js'

test('hosted and embedded workbenches share the Precision token source',async()=>{
  const root=new URL('../../../',import.meta.url)
  const css=await readFile(new URL('apps/playground/theme-tokens.css',root),'utf8')
  assert.equal(css,`/* Generated from src/theme.ts. Do not edit directly. */\n${KJDRAW_THEME_CSS.trim()}\n`)
  const html=await readFile(new URL('apps/playground/index.html',root),'utf8')
  assert.match(html,/theme-tokens\.css/)
  assert.match(html,/precision\.css/)
  assert.doesNotMatch(html,/href="\.\/apps\/playground\/(?:style|classic|studio|workbench)\.css"/)
  assert.doesNotMatch(html,/PUBLIC SDK/)
  assert.match(KJDRAW_THEME_CSS,/--kj-action: #2863df/)
  assert.match(KJDRAW_THEME_CSS,/--kj-brand: #bdf878/)
})

test('shared icons are deterministic, decorative SVG rather than font glyphs',()=>{
  for(const name of ['logo','select','line','circle','rectangle','layers','panel','save','open','undo','redo']){
    const svg=kjdrawIcon(name)
    assert.match(svg,/viewBox="0 0 24 24"/)
    assert.match(svg,/aria-hidden="true"/)
    assert.match(svg,/fill="none"/)
    assert.doesNotMatch(svg,/<(?:script|foreignObject|text)\b/)
  }
  assert.equal(kjdrawIcon('<script>'),kjdrawIcon('select'))
})
