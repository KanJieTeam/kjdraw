import { mountKJDrawWorkbench } from '@kanjieteam/kjdraw/workbench'

const container = document.querySelector<HTMLElement>('#kjdraw')
if (!container) throw new Error('Add an element with id="kjdraw" to the page')

const workbench = mountKJDrawWorkbench(container, {
  document: 'sample',
  locale: 'en',
  theme: 'dark',
  layout: 'classic',
})

await workbench.ready

// Commands target this workbench's drawing and keep its undo history intact.
const created = await workbench.execute<{ id: string }>('CREATE', {
  type: 'LINE',
  payload: { start: [0, 0, 0], end: [100, 0, 0] },
})
if (created.result) {
  await workbench.execute('MOVE', { id: created.result.id, dx: 25, dy: 10 })
}

// Layout changes only the chrome; it does not replace the drawing.
workbench.setLayout('compact')

// Keep this in your application teardown path.
export function disposeKJDraw(): void {
  workbench.dispose()
}
