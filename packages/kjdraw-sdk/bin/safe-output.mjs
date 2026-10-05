import { randomUUID } from 'node:crypto'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value
const identity = info => {
  if (info.ino === 0n) throw new Error('Filesystem does not provide a safe file identity for output checks')
  return `${info.dev}:${info.ino}`
}

async function item(file) {
  try { return await lstat(file, { bigint: true }) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function checkTargets(files, protectedInputs) {
  const inputIds = new Set(protectedInputs.map(input => identity(input.info)))
  const inputPaths = new Set(protectedInputs.map(input => pathKey(input.path)))
  const outputIds = new Set(), outputPaths = new Set()
  for (const file of files) {
    const key = pathKey(file.path)
    if (inputPaths.has(key)) throw new Error('Output target aliases an input drawing')
    if (outputPaths.has(key)) throw new Error('Output targets alias one another')
    outputPaths.add(key)
    const info = await item(file.path)
    if (!info) continue
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Output target must be a regular file, not a symbolic link or directory')
    const id = identity(info)
    if (inputIds.has(id)) throw new Error('Output target aliases an input drawing')
    if (outputIds.has(id)) throw new Error('Output targets alias one another')
    outputIds.add(id)
  }
}

/** Host-only output: check the complete set before replacing any destination.
 * Temporary files are opened exclusively and written through their file handles.
 * rename replaces a destination directory entry, never truncating its inode or
 * following a leaf symlink inserted after the checks. A set of files is not a
 * filesystem transaction; a late I/O failure can leave some new report files.
 * The host must own the parent directories; portable Node APIs cannot lock them
 * against an external process moving directories or rewriting the inputs.
 */
export async function writeOutputFiles(files, { protectedInputs = [], renameImpl = rename } = {}) {
  const targets = await Promise.all(files.map(async file => {
    const absolute = resolve(file.path)
    return { ...file, path: join(await realpath(dirname(absolute)), basename(absolute)) }
  }))
  await checkTargets(targets, protectedInputs)
  const staged = []
  try {
    for (const target of targets) {
      const temporary = join(dirname(target.path), `.kjdraw-output-${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try {
        staged.push({ temporary, target: target.path, info: await handle.stat({ bigint: true }) })
        await handle.writeFile(target.data); await handle.sync()
      }
      finally { await handle.close() }
    }
    // Catch links or aliases added during rendering/staging before any publish.
    await checkTargets(targets, protectedInputs)
    for (const stage of staged) await renameImpl(stage.temporary, stage.target)
  } finally {
    for (const stage of staged) {
      const current = await item(stage.temporary)
      if (current?.isFile() && !current.isSymbolicLink() && identity(current) === identity(stage.info)) await unlink(stage.temporary)
    }
  }
}
