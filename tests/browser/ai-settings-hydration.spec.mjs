// OFFLINE browser/storage fixtures. These never call a model or use provider credentials.
import { expect, test } from '@playwright/test'

const connection = {
  endpoint: 'https://public-settings-hydration.invalid/v1/chat/completions',
  model: 'offline-settings-hydration-fixture',
  apiKey: 'public-synthetic-settings-fixture-not-a-provider-key',
  provider: 'custom', protocol: 'chat-completions',
}

async function installNativeSettingsGate(page, { abortInitialRead = false } = {}) {
  await page.addInitScript(({ abortInitialRead }) => {
    const gate = window.__settingsHydrationGate = {
      firstReadSeen: false, initialReleased: false, writesReleased: false,
      actualInitialCommits: 0, actualWriteCommits: 0, actualWriteAborts: 0, actualInitialAborts: 0,
      initialDeliveries: [], writeDeliveries: [], abortNextWrite: false,
    }
    const nativeTransaction = IDBDatabase.prototype.transaction
    const nativePut = IDBObjectStore.prototype.put
    const nativeGet = IDBObjectStore.prototype.get
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = nativeTransaction.apply(this, args)
      if (this.name !== 'kjdraw-ai-local') return transaction
      const firstRead = transaction.mode === 'readonly' && !gate.firstReadSeen
      if (firstRead) { gate.firstReadSeen = true; gate.initialTransaction = transaction }
      if (!firstRead && transaction.mode !== 'readwrite') return transaction
      let owner = transaction, descriptor
      while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, 'oncomplete')
        owner = Object.getPrototypeOf(owner)
      }
      if (!descriptor?.set) throw new Error('Native IndexedDB completion setter unavailable')
      Object.defineProperty(transaction, 'oncomplete', {
        configurable: true,
        get() { return descriptor.get.call(transaction) },
        set(handler) {
          descriptor.set.call(transaction, event => {
            const deliver = () => handler.call(transaction, event)
            if (firstRead) {
              gate.actualInitialCommits++
              if (gate.initialReleased) deliver(); else gate.initialDeliveries.push(deliver)
            } else {
              gate.actualWriteCommits++
              if (gate.writesReleased) deliver(); else gate.writeDeliveries.push(deliver)
            }
          })
        },
      })
      return transaction
    }
    IDBObjectStore.prototype.put = function (...args) {
      const request = nativePut.apply(this, args), transaction = this.transaction
      if (transaction.db.name === 'kjdraw-ai-local' && transaction.mode === 'readwrite' && gate.abortNextWrite) {
        gate.abortNextWrite = false
        request.addEventListener('success', () => { gate.actualWriteAborts++; transaction.abort() }, { once: true })
      }
      return request
    }
    IDBObjectStore.prototype.get = function (...args) {
      const request = nativeGet.apply(this, args), transaction = this.transaction
      if (abortInitialRead && transaction === gate.initialTransaction) {
        request.addEventListener('success', () => { gate.actualInitialAborts++; transaction.abort() }, { once: true })
      }
      return request
    }
  }, { abortInitialRead })
  // The browser must not send any external request, including this deliberately invalid model endpoint.
  await page.route('https://**/*', route => route.abort())
}

async function fillSettings(page) {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption(connection.provider)
  await page.getByTestId('settings-endpoint').fill(connection.endpoint)
  await page.getByTestId('settings-model').fill(connection.model)
  await page.getByTestId('settings-key').fill(connection.apiKey)
}

async function savedConnection(page) {
  return page.evaluate(async () => (await (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())?.connection ?? null)
}

async function releaseInitialRead(page) {
  await page.evaluate(() => {
    const gate = window.__settingsHydrationGate
    gate.initialReleased = true
    gate.initialDeliveries.splice(0).forEach(deliver => deliver())
  })
}

test('settings Save waits for actual initial hydration and closes only after real durable write completion', async ({ page }) => {
  await installNativeSettingsGate(page)
  await page.goto('/ai/')
  await expect.poll(() => page.evaluate(() => window.__settingsHydrationGate.initialDeliveries.length)).toBe(1)
  await fillSettings(page)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.locator('#settings-error')).toBeHidden()
  expect(await page.evaluate(() => window.__settingsHydrationGate.actualWriteCommits)).toBe(0)
  await releaseInitialRead(page)
  await expect.poll(() => page.evaluate(() => window.__settingsHydrationGate.writeDeliveries.length)).toBe(1)
  expect(await page.evaluate(() => window.__settingsHydrationGate.actualWriteCommits)).toBe(1)
  // The native transaction really committed. Holding only callback delivery proves the app's awaited barrier.
  expect(await savedConnection(page)).toEqual(connection)
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.locator('#settings-error')).toBeHidden()
  await page.evaluate(() => {
    const gate = window.__settingsHydrationGate
    gate.writesReleased = true
    gate.writeDeliveries.splice(0).forEach(deliver => deliver())
  })
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  // Reload immediately: visible closure itself is the durability boundary, not a later poll or sleep.
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.__settingsHydrationGate.initialDeliveries.length)).toBe(1)
  await releaseInitialRead(page)
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-model')).toHaveValue(connection.model)
  await expect(page.getByTestId('settings-endpoint')).toHaveValue(connection.endpoint)
  await expect(page.getByTestId('settings-key')).toHaveValue('')
  await expect(page.getByTestId('settings-key')).toHaveAttribute('placeholder', /leave blank|留空/)
  expect(await savedConnection(page)).toEqual(connection)
})

test('settings Save leaves the dialog open and reports a real aborted storage write', async ({ page }) => {
  await installNativeSettingsGate(page)
  await page.goto('/ai/')
  await expect.poll(() => page.evaluate(() => window.__settingsHydrationGate.initialDeliveries.length)).toBe(1)
  await releaseInitialRead(page)
  await fillSettings(page)
  await page.evaluate(() => { window.__settingsHydrationGate.abortNextWrite = true })
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-error')).toBeVisible()
  await expect(page.locator('#settings-error')).toContainText(/Could not save|保存失败/)
  await expect(page.locator('#settings-dialog')).toBeVisible()
  expect(await page.evaluate(() => ({ commits: window.__settingsHydrationGate.actualWriteCommits,
    aborts: window.__settingsHydrationGate.actualWriteAborts }))).toEqual({ commits: 0, aborts: 1 })
  expect(await savedConnection(page)).toBeNull()
})

test('settings Save cannot report success after real initial-storage hydration aborts', async ({ page }) => {
  await installNativeSettingsGate(page, { abortInitialRead: true })
  await page.goto('/ai/')
  await expect.poll(() => page.evaluate(() => window.__settingsHydrationGate.actualInitialAborts)).toBe(1)
  await fillSettings(page)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-error')).toBeVisible()
  await expect(page.locator('#settings-error')).toContainText(/Could not save|保存失败/)
  await expect(page.locator('#settings-dialog')).toBeVisible()
  expect(await page.evaluate(() => window.__settingsHydrationGate.actualWriteCommits)).toBe(0)
  expect(await savedConnection(page)).toBeNull()
})
