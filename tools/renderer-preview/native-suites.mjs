import { focusSmoke } from './focus-smoke.mjs'
import { prepareSlidesProbe, slidesSmoke } from './slides-smoke.mjs'
import { frameSmoke } from './frame-smoke.mjs'
import { prepareVideoProbe, videoSmoke } from './video-smoke.mjs'
import { mediaCleanupSmoke } from './media-cleanup-smoke.mjs'
import { snappingSmoke } from './snapping-smoke.mjs'
import { noteSmoke } from './note-smoke.mjs'
import { connectionSmoke } from './connection-smoke.mjs'
import { textEditingSmoke } from './text-editing-smoke.mjs'
import { actionsSmoke } from './actions-smoke.mjs'
import { duplicateSmoke } from './duplicate-smoke.mjs'
import { laserSmoke } from './laser-smoke.mjs'
import { eraserSmoke } from './eraser-smoke.mjs'
import { drawSmoke } from './draw-smoke.mjs'
import { creationSmoke } from './creation-smoke.mjs'
import { selectionSemanticsSmoke } from './selection-semantics-smoke.mjs'
import { keyboardSmoke } from './keyboard-smoke.mjs'
import { handleSmoke } from './handle-smoke.mjs'
import { cameraSmoke } from './camera-smoke.mjs'
import { createGistFixtureAdapter } from './gist-fixtures.mjs'
import { gistSecuritySmoke } from './gist-security-smoke.mjs'

const sample = (key, run, args = () => []) => ({
  [key]: context => run(context.window, context.manifest.output, ...args(context)),
})
const suite = (flag, key, query, samples, options = {}) => ({ flag, key, query, samples, report: ['runtime'], ...options })
const legacy = flag => ({ flag, legacy: true })
const source = { report: ['runtime', 'sourceHash'] }

// Keep legacy anchors in the same ordered table: selecting only registered
// entries would let cameraOnly leapfrog contentFilmOnly in a mixed manifest.
const suites = [
  suite('resourceConflictsOnly', 'resource-conflicts', 'gallery=image-import&edgeScrolling=0&reduceMotion=1&resourceConflicts=1', [{
    resourceConflicts: async context => (await import('./resource-conflicts-smoke.mjs')).resourceConflictsSmoke(context.window, context.manifest.output, context.prepared, context.manifest.url),
  }], {
    open: async context => {
      const { prepareResourceConflictsProbe } = await import('./resource-conflicts-smoke.mjs')
      const prepared = await prepareResourceConflictsProbe({ createWindow: context.createWindow, errors: context.errors })
      return { window: prepared.window, prepared }
    },
    reportBefore: ['pid', 'fingerprint'], guardKey: 'native', guardCalls: context => context.prepared.blocked,
  }),
  suite('recordConflictsOnly', 'record-conflicts', 'gallery=image-import&edgeScrolling=0&reduceMotion=1', [{
    recordConflicts: async context => (await import('./record-conflicts-smoke.mjs')).recordConflictsSmoke(context.window, context.manifest.output, context.prepared, context.manifest.url),
  }], {
    open: async context => {
      const { prepareRecordConflictsProbe } = await import('./record-conflicts-smoke.mjs')
      const prepared = await prepareRecordConflictsProbe({ createWindow: context.createWindow, errors: context.errors })
      return { window: prepared.window, prepared }
    },
    reportBefore: ['pid', 'fingerprint'], guardKey: 'native',
    guardCalls: context => context.prepared.blocked,
  }),
  suite('flattenOnly', 'flatten', 'gallery=flatten&case=static&edgeScrolling=0', [{ flatten: async context => (await import('./flatten-smoke.mjs')).flattenSmoke(context.window, context.manifest.output, context.prepared) }], {
    open: async context => (await import('./flatten-smoke.mjs')).prepareFlattenProbe(context),
    ...source, guardCalls: context => context.prepared.blocked,
  }),
  suite('shapeLinksOnly', 'shape-links', 'gallery=shape-links&edgeScrolling=0', [{
    shapeLinks: async context => (await import('./shape-links-smoke.mjs')).shapeLinksSmoke(context.window, context.manifest.output, context.prepared),
  }], {
    // Its native guards must precede the first window. Keep this module lazy:
    // selecting a suite in Node must not import Electron or install its guards.
    open: async context => {
      const { prepareShapeLinksProbe } = await import('./shape-links-smoke.mjs')
      const prepared = await prepareShapeLinksProbe({ createWindow: context.createWindow, errors: context.errors })
      return { window: prepared.window, prepared }
    },
    reportBefore: ['pid', 'fingerprint'], guardKey: 'native',
    guardCalls: context => context.prepared.blocked,
  }),
  // Its existing branch owns clipboard proofs and its richer report. Register
  // the optional Gist extension here without migrating that control flow.
  { ...legacy('embedsOnly'), windowAdapter: createGistFixtureAdapter, gist: gistSecuritySmoke },
  suite('focusOnly', 'focus-keys', 'gallery=focus-keys&edgeScrolling=0', [sample('focus', focusSmoke)], source),
  suite('slidesOnly', 'slides', 'gallery=slides&edgeScrolling=0', [{
    ...sample('slides', slidesSmoke), guards: context => context.prepared.negative,
  }], {
    ...source, prepare: context => prepareSlidesProbe(context.window, context.clipboard),
    guardCalls: context => context.prepared.calls,
  }),
  suite('framesOnly', 'frames', 'gallery=frame-interaction&edgeScrolling=0', [sample('frames', frameSmoke)]),
  legacy('imagesOnly'),
  suite('videosOnly', 'videos', 'gallery=videos&edgeScrolling=0', [
    sample('videos', videoSmoke, context => [context.manifest.videoFiles]),
    sample('mediaCleanup', mediaCleanupSmoke, context => [context.manifest.videoFiles, 'video']),
  ], { prepare: context => prepareVideoProbe(context.window) }),
  suite('snappingOnly', 'snapping', 'gallery=snapping&snapping=1&edgeScrolling=0', [sample('snapping', snappingSmoke)]),
  suite('notesOnly', 'note-editing', 'gallery=note-editing&edgeScrolling=0', [sample('notes', noteSmoke)]),
  suite('connectionsOnly', 'connection-editing', 'gallery=connection-editing&edgeScrolling=0', [sample('connections', connectionSmoke)]),
  suite('textEditingOnly', 'text-editing', 'gallery=text-editing&edgeScrolling=0', [sample('textEditing', textEditingSmoke)]),
  suite('actionsOnly', 'selection-actions', 'gallery=selection-actions&edgeScrolling=0&reduceMotion=1', [sample('actions', actionsSmoke), sample('duplicates', duplicateSmoke)]),
  suite('lasersOnly', 'laser', 'gallery=laser&edgeScrolling=0', [sample('laser', laserSmoke)], source),
  suite('erasersOnly', 'eraser', 'gallery=eraser&edgeScrolling=0', [sample('eraser', eraserSmoke, context => [context.manifest.eraserColorOnly])]),
  suite('drawOnly', 'draw-input', 'gallery=draw-input', [sample('draw', drawSmoke)]),
  suite('creationOnly', 'creation', 'gallery=creation&edgeScrolling=0', [sample('creation', creationSmoke)]),
  // The original shared branch prefers selectionSemanticsOnly when both flags
  // are truthy. Their adjacent rows preserve that choice and all other ranks.
  suite('selectionSemanticsOnly', 'selection-semantics', 'gallery=selection-semantics', [sample('selectionSemantics', selectionSemanticsSmoke)]),
  suite('keyboardOnly', 'keyboard', 'count=500', [sample('keyboard', keyboardSmoke)]),
  suite('handlesOnly', 'handles', 'count=500', [{
    ...sample('handles', handleSmoke), cameraLayout: context => context.cameraLayoutProbe(true),
  }]),
  legacy('contentFilmOnly'),
  legacy('contentCaptureOnly'),
  legacy('contentChannelOnly'),
  legacy('contentSecurityOnly'),
  suite('cameraOnly', 'camera', 'count=500', [sample('camera', cameraSmoke, () => [{ persistent: true }])], { report: [] }),
  legacy('selectionOnly'),
]

export function selectNativeSuite(manifest) {
  return suites.find(entry => manifest[entry.flag])
}
