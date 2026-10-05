/** Keep filesystem diagnostics actionable without printing private user paths. */
export function safeConnectError(error) {
  if (error instanceof Error && !('code' in error)) return error.message
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code === 'EACCES' || code === 'EPERM') return `Access denied (${code}) while inspecting or updating the current user's KJDraw configuration. Run the installer in a normal PowerShell under the same Windows account as the AI client, and check that account's profile-folder permissions. No conflicting client entry was intentionally overwritten.`
  if (code === 'ENOENT') return 'A configuration or drawing path disappeared during KJDraw connection (ENOENT). Check the current account profile and retry; existing client entries were not intentionally overwritten.'
  if (code === 'ENOTDIR' || code === 'EISDIR') return `A KJDraw configuration path has the wrong file/directory type (${code}). Inspect the current account's .kjdraw and client configuration folders before retrying; nothing was forcibly replaced.`
  if (code === 'ENOSPC') return 'The target profile drive is out of space (ENOSPC). Free space and retry the installer; no client entry was intentionally overwritten.'
  if (code === 'EBUSY' || code === 'EMFILE') return `A configuration file is temporarily unavailable (${code}). Close the affected AI client and retry; no conflicting entry was forcibly replaced.`
  return code ? `KJDraw could not safely inspect or update user configuration (${code}). No conflicting client entry was intentionally overwritten.` : 'KJDraw could not safely inspect or update user configuration. No conflicting client entry was intentionally overwritten.'
}
