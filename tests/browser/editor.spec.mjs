import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

async function mount(page, options = {}) {
  await page.goto('/')
  await page.evaluate(async options => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.id = 'editor'
    host.style.cssText = 'width:1100px;height:720px'
    document.body.append(host)
    const { createKJDrawEditor } = await import('/packages/kjdraw-sdk/src/index.js')
    const changes = [], selections = [], errors = []
    const editor = createKJDrawEditor('#editor', {
      document: 'blank', ...options,
      onChange: event => changes.push(event.revision),
      onSelectionChange: event => selections.push([...event.ids]),
      onError: error => errors.push(String(error)),
    })
    await editor.ready
    window.editorTest = { editor, changes, selections, errors, createKJDrawEditor }
  }, options)
}

test('editor public entry opens files, edits, selects, saves and restores history', async ({ page }) => {
  await mount(page, { title: 'Mechanical detail', toolbar: false, layers: false, properties: false })
  await expect(page.locator('.ribbon')).toBeHidden()
  await expect(page.locator('[data-document-name]')).toHaveText('Mechanical detail')
  const result = await page.evaluate(async () => {
    const { editor, changes, selections } = window.editorTest
    await editor.execute('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 40] } })
    const entity = editor.document.listEntities()[0]
    await editor.setSelection([entity.id])
    await editor.execute('MOVE', { id: entity.id, dx: 10, dy: 5 })
    const moved = editor.document.getObject(entity.id).payload.start
    await editor.undo()
    const undone = editor.document.getObject(entity.id).payload.start
    await editor.redo()
    const fingerprint = editor.document.fingerprint()
    const data = await editor.save({ format: 'KJD', download: false })
    await editor.open(new File([data], 'detail.kjd'))
    editor.setLocale('zh-CN').setTheme('light').fit()
    return { moved, undone, fingerprint, reopened: editor.document.fingerprint(), changes: [...changes], selections: [...selections], selected: editor.getSelection(), locale: editor.locale, theme: editor.theme }
  })
  expect(result.moved).toEqual([10, 5, 0])
  expect(result.undone).toEqual([0, 0, 0])
  expect(result.reopened).toBe(result.fingerprint)
  expect(result.changes.length).toBeGreaterThanOrEqual(4)
  expect(result.selections[0]).toHaveLength(1)
  expect(result.locale).toBe('zh-CN')
  expect(result.theme).toBe('light')
  await expect(page.locator('[data-document-name]')).toHaveText('Mechanical detail')
})

test('typing in command input never invokes canvas shortcuts or erases a selection', async ({ page }) => {
  await mount(page)
  await page.evaluate(async () => {
    const { editor } = window.editorTest
    await editor.execute('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [20, 0] } })
    await editor.setSelection([editor.document.listEntities()[0].id])
  })
  const command = page.locator('[data-command]')
  await command.fill('OFFSET 2')
  await command.press('Backspace')
  await expect(command).toHaveValue('OFFSET ')
  expect(await page.evaluate(() => window.editorTest.editor.document.listEntities().length)).toBe(1)
  await command.fill('MOVE 2 0')
  await command.press('Enter')
  await expect.poll(() => page.evaluate(() => window.editorTest.editor.document.listEntities()[0].payload.start[0])).toBe(2)
})

test('two editors sharing an SDK keep drawings, selections and file identity isolated', async ({ page }) => {
  await mount(page)
  const result = await page.evaluate(async () => {
    const { editor: first, createKJDrawEditor } = window.editorTest
    const host = document.createElement('div')
    host.style.cssText = 'width:800px;height:600px'
    document.body.append(host)
    const second = createKJDrawEditor(host, { sdk: first.sdk, document: 'blank' })
    await second.ready
    const firstId = first.document.id, secondId = second.document.id
    await first.execute('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
    const lineId = first.document.listEntities()[0].id
    await first.setSelection([lineId])
    await second.execute('CREATE', { type: 'CIRCLE', payload: { center: [40, 20], radius: 5 } })
    await first.execute('MOVE', { id: lineId, dx: 3, dy: 0 })
    const file = await second.save({ download: false })
    let collision = ''
    try { await first.open(file, { format: 'KJD' }) } catch (error) { collision = error.message }
    second.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await first.sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [80, 20] } })
    first.element.focus()
    await first.sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [20, 20] } })
    const snapshot = {
      firstId, secondId, firstAfter: first.document.id, secondAfter: second.document.id,
      firstTypes: first.document.listEntities().map(entity => entity.type), secondTypes: second.document.listEntities().map(entity => entity.type),
      moved: first.document.getObject(lineId).payload.start,
      firstSelection: first.getSelection(), secondSelection: second.getSelection(), lineId, collision,
      secondStillAttached: first.sdk.documents.get(secondId) === second.document,
    }
    second.dispose()
    return {
      ...snapshot,
      secondReleased: !first.sdk.documents.has(secondId),
      firstStillAttached: first.sdk.documents.get(firstId) === first.document,
    }
  })
  expect(result.firstId).not.toBe(result.secondId)
  expect(result.firstAfter).toBe(result.firstId)
  expect(result.secondAfter).toBe(result.secondId)
  expect(result.firstTypes).toEqual(['LINE', 'POINT'])
  expect(result.secondTypes).toEqual(['CIRCLE', 'POINT'])
  expect(result.moved).toEqual([3, 0, 0])
  expect(result.firstSelection).toEqual([result.lineId])
  expect(result.secondSelection).toEqual([])
  expect(result.collision).toContain('already open')
  expect(result.secondStillAttached).toBe(true)
  expect(result.secondReleased).toBe(true)
  expect(result.firstStillAttached).toBe(true)
})

test('shared document leases reject destructive reopen and preserve host-owned drawings', async ({ page }) => {
  await mount(page)
  const result = await page.evaluate(async () => {
    const { editor: fixture, createKJDrawEditor } = window.editorTest
    fixture.dispose()
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const sdk = createKJDrawSDK()
    const mountEditor = documentOption => {
      const host = document.createElement('div')
      host.style.cssText = 'width:800px;height:600px'
      document.body.append(host)
      return createKJDrawEditor(host, { sdk, document: documentOption })
    }

    const hostDocument = sdk.createDocument({ documentId: 'host-owned-drawing' })
    const hostEditor = mountEditor(hostDocument)
    await hostEditor.ready
    sdk.closeDocument(hostDocument.id)
    const hostReplacement = sdk.createDocument({ documentId: hostDocument.id })
    await hostEditor.setDocument(hostReplacement)
    await hostEditor.execute('CREATE', { type: 'POINT', payload: { position: [5, 5] } })
    const recoveredSameId = hostEditor.document === hostReplacement && hostReplacement.listEntities().length === 1
    hostEditor.dispose()
    const hostPreserved = sdk.documents.get(hostReplacement.id) === hostReplacement

    const first = mountEditor('blank')
    await first.ready
    const generated = first.document
    const second = mountEditor(generated)
    await second.ready
    await first.execute('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [12, 0] } })
    const lineId = generated.listEntities()[0].id
    await first.setSelection([lineId])
    const fingerprint = generated.fingerprint()
    const file = await first.save({ download: false })
    let reopenError = ''
    try { await first.open(file, { format: 'KJD' }) } catch (error) { reopenError = error.message }
    const reopenPreserved = first.document === generated
      && second.document === generated
      && sdk.documents.get(generated.id) === generated
      && generated.fingerprint() === fingerprint
      && first.getSelection()[0] === lineId
      && second.getSelection()[0] === lineId
    await first.execute('CREATE', { type: 'POINT', payload: { position: [4, 4] } })
    await second.execute('CREATE', { type: 'CIRCLE', payload: { center: [8, 8], radius: 2 } })
    const continuedAfterRejection = generated.listEntities().length === 3
      && first.getSelection()[0] === lineId
      && second.getSelection()[0] === lineId
    first.dispose()
    const keptForSecondView = sdk.documents.get(generated.id) === generated
    second.dispose()
    const releasedAfterLastView = !sdk.documents.has(generated.id)
    return { recoveredSameId, hostPreserved, reopenError, reopenPreserved, continuedAfterRejection, keptForSecondView, releasedAfterLastView }
  })
  expect(result.recoveredSameId).toBe(true)
  expect(result.hostPreserved).toBe(true)
  expect(result.reopenError).toContain('shared by another KJDraw workbench')
  expect(result.reopenError).toContain('separate document')
  expect(result.reopenPreserved).toBe(true)
  expect(result.continuedAfterRejection).toBe(true)
  expect(result.keptForSecondView).toBe(true)
  expect(result.releasedAfterLastView).toBe(true)
})

test('editor readonly and disposal apply to the public methods and async initialization', async ({ page }) => {
  await mount(page, { readonly: true })
  const result = await page.evaluate(async () => {
    const { editor, createKJDrawEditor, errors } = window.editorTest
    let readonlyError = ''
    try { await editor.execute('CREATE', { type: 'POINT', payload: { position: [0, 0] } }) } catch (error) { readonlyError = error.message }
    const count = editor.document.listEntities().length
    editor.dispose()
    editor.dispose()
    let disposedError = ''
    try { await editor.save({ download: false }) } catch (error) { disposedError = error.message }
    const pending = createKJDrawEditor('#editor', { document: 'sample' })
    pending.dispose()
    await pending.ready

    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const sharedSDK = createKJDrawSDK()
    let releaseWrite, markWriteStarted
    const writeStarted = new Promise(resolve => { markWriteStarted = resolve })
    sharedSDK.fileAdapters.register({
      id: 'test.delayed-writer',
      priority: 10_000,
      formats: { KJD: { write: ['*'] } },
      write: () => {
        markWriteStarted()
        return new Promise(resolve => { releaseWrite = () => resolve('{"late":true}') })
      },
    })
    const slowHost = document.createElement('div')
    slowHost.style.cssText = 'width:800px;height:600px'
    document.body.append(slowHost)
    const slow = createKJDrawEditor(slowHost, { sdk: sharedSDK, document: 'blank' })
    await slow.ready
    let downloads = 0
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () { downloads += 1 }
    const saving = slow.save()
    await writeStarted
    slow.dispose()
    releaseWrite()
    let inFlightSaveError = ''
    try { await saving } catch (error) { inFlightSaveError = error.message }
    HTMLAnchorElement.prototype.click = click

    return {
      count, readonlyError, disposedError, errors,
      mounted: document.querySelectorAll('.kjwb').length,
      orphanDocuments: pending.sdk.documents.size,
      inFlightSaveError,
      downloads,
    }
  })
  expect(result.readonlyError).toContain('read only')
  expect(result.count).toBe(0)
  expect(result.disposedError).toContain('disposed')
  expect(result.mounted).toBe(0)
  expect(result.orphanDocuments).toBe(0)
  expect(result.errors).toHaveLength(1)
  expect(result.inFlightSaveError).toContain('disposed')
  expect(result.downloads).toBe(0)
})
