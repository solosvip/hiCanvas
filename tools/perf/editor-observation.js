// Small read-only observation of one record; never snapshot/scan the board.
export function observeEditorTarget(session, interaction, transport, targetId, snapshotReads = 0) {
  const state = interaction.state.get(), record = session.store.get(targetId), runtime = session.state.get()
  return { camera: { ...state.camera }, selectedIds: [...state.selectedIds], mode: state.mode,
    shape: record ? { x: record.x, y: record.y, w: record.props.w, h: record.props.h, rotation: record.rotation } : null,
    revision: runtime.revision, submitting: runtime.isSubmitting, commitCalls: transport.getCommitCount?.() ?? null,
    transport: transport.getCommitCount ? 'memory' : 'http', snapshotReads, lastError: state.lastError || runtime.lastError }
}
