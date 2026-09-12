import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Run a child synchronously with input backed by a regular-file descriptor.
 * This avoids platform-specific truncation observed with spawnSync's stdin pipe
 * while retaining the child's normal stdin interface.
 */
export function spawnSyncWithFileStdin(command, args, input, options = {}) {
  if (options.input !== undefined || options.stdio !== undefined) throw new TypeError('File-backed stdin owns the input and stdio options')
  if (input === undefined) return spawnSync(command, args, options)
  const folder = mkdtempSync(join(tmpdir(), 'kjdraw-stdin-'))
  const path = join(folder, 'stdin.bin')
  let descriptor
  try {
    writeFileSync(path, input)
    descriptor = openSync(path, 'r')
    return spawnSync(command, args, { ...options, stdio: [descriptor, 'pipe', 'pipe'] })
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    try { unlinkSync(path) } catch {}
    try { rmdirSync(folder) } catch {}
  }
}
