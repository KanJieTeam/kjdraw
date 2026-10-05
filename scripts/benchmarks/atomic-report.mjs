import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname, resolve } from 'node:path'

/** Retry only a transient same-directory file replacement; never delete the old report. */
export async function replaceReportFile(source, target, { renameImpl = rename, sleep = delay, attempts = 7 } = {}) {
  source = resolve(source); target = resolve(target)
  if (source === target || dirname(source) !== dirname(target) || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 7) {
    throw new Error('Invalid bounded atomic report replacement')
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { await renameImpl(source, target); return }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === attempts - 1) throw error
      await sleep(50 * (attempt + 1))
    }
  }
}
