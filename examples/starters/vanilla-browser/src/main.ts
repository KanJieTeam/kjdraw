import { createKJDrawEditor } from '@kanjieteam/kjdraw'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = '<div id="cad"></div>'
const host = document.querySelector<HTMLElement>('#cad')!
host.style.cssText = 'width:100%;height:720px'
const editor = createKJDrawEditor(host, { document: 'blank', locale: 'en', theme: 'dark' })
await editor.ready
await editor.execute('CREATE', { type: 'CIRCLE', payload: { center: [20, 20, 0], radius: 5 } })
editor.fit()
