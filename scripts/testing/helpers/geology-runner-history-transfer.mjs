import assert from 'node:assert/strict'

const archiveOptions = Object.freeze({ limit: 50, maxBytes: 16 * 1024 * 1024 })
const targetMetadata = target => target === null ? null : { label: target.label, revision: target.revision, source: target.source }
export function geologyHistoryMetadata(history) {
  return { ...history, undoTarget: targetMetadata(history.undoTarget), redoTarget: targetMetadata(history.redoTarget) }
}

/** Only declared history fixtures transfer their real reviewed seed history.
 * Other fixtures retain their prior opened-document baseline; compiling a
 * public source fixture does not silently create user undo prerequisites.
 */
export async function createGeologyScenarioRuntimeState(fixture) {
  return { drawing: await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }),
    ...(fixture.historyOracleId ? { drawingHistory: fixture.document.exportHistory(archiveOptions) } : {}),
    sourceFormat: fixture.artifact.format, committed: false,
    history: fixture.conversationSeed.map(item => ({ user: item.content, assistant: '' })) }
}

/** Independently reopen the actual returned KJD and validate its actual archive.
 * Fresh SDK history identities intentionally differ after every restoration.
 */
export async function reopenGeologyScenarioRuntimeState(fixture, state, liveHistory) {
  const document = await fixture.sdk.readDocument(state.drawing, { format: 'KJD' })
  assert.deepEqual(document.snapshot(), JSON.parse(state.drawing), 'KJD reopening must preserve the complete actual native state')
  // Every actual runtime export carries its real archive, including new edits
  // on ordinary imported baselines. Reopening KJD alone deliberately clears
  // history and would hide or mis-score the actual approved host operation.
  assert.ok(state.drawingHistory, 'Actual runtime postcondition requires its real local history archive')
  const before = document.snapshot()
  await document.restoreHistory(state.drawingHistory, { expectedRevision: document.revision })
  assert.deepEqual(document.snapshot(), before, 'Restoring history cannot change geometry, source, IDs, handles or revision')
  assert.deepEqual(document.exportHistory(archiveOptions), state.drawingHistory, 'The complete real archive chain must survive independent restoration')
  assert.deepEqual(geologyHistoryMetadata(document.history), geologyHistoryMetadata(liveHistory), 'Actual runtime and independently restored archive history metadata must agree')
  if (!fixture.historyOracleId) return { document }
  return { document, liveHistory: structuredClone(liveHistory), historyArchive: structuredClone(state.drawingHistory) }
}

/** Bind ephemeral IDs before model execution, never from model answers.
 * Engineering expectations, snapshots, fingerprints and target metadata stay
 * unchanged. SDK restoreHistory renews IDs to invalidate stale pending plans.
 */
export async function bindGeologyScenarioRuntimeHistory(fixture, chat, initialState) {
  if (!fixture.historyOracleId) return
  assert.equal(chat.historyRestoreWarning, false, 'Actual runtime rejected the seed history archive')
  const liveHistory = structuredClone(chat.drawingHistory)
  assert.deepEqual(geologyHistoryMetadata(liveHistory), geologyHistoryMetadata(fixture.initialHistory), 'Restoration must preserve all seeded history facts except ephemeral IDs')
  const exported = await chat.exportLocalState()
  assert.deepEqual(JSON.parse(exported.drawing), JSON.parse(initialState.drawing), 'Runtime seed restoration cannot alter the current drawing')
  assert.deepEqual(exported.drawingHistory, initialState.drawingHistory, 'Runtime seed restoration cannot alter the real history archive')
  await reopenGeologyScenarioRuntimeState(fixture, exported, liveHistory)
  if (fixture.oracleHistoryTarget) {
    const key = fixture.initialHistory.undoTarget?.id === fixture.oracleHistoryTarget.id ? 'undoTarget' :
      fixture.initialHistory.redoTarget?.id === fixture.oracleHistoryTarget.id ? 'redoTarget' : null
    assert.ok(key, 'Expected history action must refer to a real seeded top target')
    assert.deepEqual(targetMetadata(liveHistory[key]), targetMetadata(fixture.oracleHistoryTarget))
    fixture.oracleHistoryTarget = { ...fixture.oracleHistoryTarget, id: liveHistory[key].id }
  }
  fixture.initialHistory = liveHistory
}

/** Normalize only a real applied host receipt, never a provider claim. */
export function geologyHistoryApprovalReceipt(approval, fixture, proposal) {
  assert.equal(approval.status, 'applied')
  const receipt = approval.receipt
  assert.ok(receipt && receipt.status === 'committed' && receipt.command === proposal.command &&
    proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
    (receipt.documentId === undefined || receipt.documentId === fixture.document.id) && receipt.beforeRevision === fixture.initialRevision &&
    receipt.afterRevision === fixture.initialRevision + 1, 'History approval requires its actual bound native committed receipt')
  return { ok: true, value: structuredClone(receipt) }
}
