import { mountKJDrawWorkbench } from '@kanjieteam/kjdraw/workbench'

const container = document.querySelector<HTMLElement>('#kjdraw')
if (!container) throw new Error('Add an element with id="kjdraw" to the page')

const workbench = mountKJDrawWorkbench(container, {
  document: 'sample',
  locale: 'en',
  theme: 'dark',
})

await workbench.ready

// Keep this in your application teardown path.
export function disposeKJDraw(): void {
  workbench.dispose()
}
