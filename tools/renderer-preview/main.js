import './style.css'
import { handleCornerHitSize, handleEdgeHitSize, handleRotationOffset, handleRotationRadius } from '../../src/styles/tokens.js'
import { react } from '@tldraw/state'
import { createEditorSession, createCanvasInteraction, canvasToolRegistry } from '../../engine/index.js'
import { mountCanvasRenderer, prepareCanvasFonts, loadGeneratedFrame, measureFrameTitle } from '../../renderer/index.js'
import { createGallery } from './gallery.js'
import { createConnectionGallery } from './arrow-gallery.js'
import { createStrokeGallery, addStrokeLoad } from './stroke-fixtures.js'
import { createNoteGallery } from './note-fixtures.js'
import { createSelectionGallery } from './selection-fixture.js'
import { createFrameTitleFixture } from './frame-title-fixture.js'
import { createCreationFixture } from './creation-fixture.js'
import { createTextEditingFixture } from './text-editing-fixture.js'
import { createConnectionEditingFixture } from './connection-fixture.js'
import { createNoteEditingFixture } from './note-editing-fixture.js'
import { createSnappingFixture } from './snapping-fixture.js'
import { attachCreationUi } from './creation-ui.js'
import { attachTextUi } from './text-ui.js'
import { attachPreviewInput } from './input.js'
import { attachNavigationUi } from './navigation-ui.js'
import { attachMinimapUi } from './minimap-ui.js'
import { createImageGallery } from './image-fixtures.js'
import { attachImageUi } from './image-ui.js'
import { addVideoLoad } from './video-fixtures.js'
import { attachVideoUi } from './video-ui.js'
import { createMediaUpload } from './media-upload.js'
import { createDrawGallery } from './draw-fixture.js'
import { createActionsGallery } from './actions-fixture.js'
import { createFrameFixture } from './frame-fixture.js'
import { attachActionsUi } from './actions-ui.js'
import { memoryTransport, previewTransport } from './transport.js'
import { getShapeTextLayout, createConnectionContext } from '../../renderer/geometry.js'
import { createPreviewClipboard } from './clipboard.js'
import { observeEditorTarget } from '../perf/editor-observation.js'

let ready = false, renderer, controls, metadata, interaction, session, transport, clipboardAdapter, cameraTimer, failure = null, decodedImages = 0, snapshotReads = 0
const disposers = []
const cleanup = () => { clearTimeout(cameraTimer); for (const dispose of disposers.splice(0).reverse()) { try { dispose() } catch { /* Continue releasing remaining preview resources. */ } } }
const host = document.querySelector('#canvas'), status = document.querySelector('#status')
const getState = () => {
  const state = interaction?.state.get()
  const textShapes = metadata?.textEditingFixture ? session.store.allRecords().filter(record => record.typeName === 'shape') : null
  const textContext = textShapes && createConnectionContext(textShapes)
  return Object.freeze({ ready, error: failure, count: metadata?.count || 0, counts: metadata ? Object.freeze({ ...metadata.counts }) : null, camera: state ? { ...state.camera } : null,
    focusedGroupId: state?.focusedGroupId, isWrapMode: state?.isWrapMode, selectedIds: state ? [...state.selectedIds] : [], hoveredId: state?.hoveredId || null, mode: state?.mode || 'idle', toolId: state?.toolId, temporaryTool: state?.temporaryTool, contentOffscreen: state?.contentOffscreen, needsFrame: state?.needsFrame, edgeScrolling: state?.edgeScrolling, shortcutsEnabled: state?.shortcutsEnabled, inputContext: state ? { ...state.inputContext } : null,
    creation: state?.creation && structuredClone(state.creation),
    snappingPreferences: state?.snappingPreferences && { ...state.snappingPreferences },
    textEditing: state?.textEditing && structuredClone(state.textEditing),
    imageAltEditing: state?.imageAltEditing && structuredClone(state.imageAltEditing),
    ...(metadata?.imageImportFixture && session && { imageRecords: structuredClone(session.store.allRecords().filter(r => ['shape', 'asset'].includes(r.typeName))) }),
    ...(metadata?.connectionEditingFixture && { connectionRecords: structuredClone(session.store.allRecords().filter(record => ['shape', 'binding'].includes(record.typeName))) }),
    ...(metadata?.noteEditingFixture && { noteRecords: structuredClone(session.store.allRecords().filter(record => ['shape', 'user'].includes(record.typeName))) }),
    ...(textShapes && { textShapes: structuredClone(textShapes), textLayouts: Object.fromEntries(textShapes.filter(shape => shape.type !== 'frame').map(shape => [shape.id, getShapeTextLayout(shape, textContext)])) }),
    interactingVideoId: state?.interactingVideoId || null, videoPlayback: state?.videoPlayback && structuredClone(state.videoPlayback),
    ...(metadata?.videoFixture && metadata.videoGallery && session && { videoRecords: session.store.allRecords().filter(r => r.typeName === 'shape' || r.typeName === 'asset').map(r => structuredClone(r)) }),
    croppingId: state?.croppingId || null, cropZoom: state?.cropZoom || 0, isPenMode: state?.isPenMode || false,
    ...(metadata?.drawInput && { strokes: session ? session.store.allRecords().filter(r => ['draw', 'highlight'].includes(r.type)).map(r => structuredClone(r)) : [] }),
    ...(metadata?.selectionActions && { actionShapes: session.store.allRecords().filter(r => r.typeName === 'shape').map(r => structuredClone(r)), actions: interaction.getActions() }),
    ...(metadata?.frameInteractionFixture && { frameRecords: structuredClone(session.store.allRecords().filter(r => r.typeName === 'shape')) }),
    selectedShapes: (state?.selectedIds || []).map(id => { const r = session.store.get(id); return r && { id, type: r.type, parentId: r.parentId, x: r.x, y: r.y, rotation: r.rotation, w: r.props.w, h: r.props.h, props: structuredClone(r.props), meta: structuredClone(r.meta), ...(r.type === 'image' && { crop: structuredClone(r.props.crop), flipX: r.props.flipX, flipY: r.props.flipY, assetId: r.props.assetId }) } }).filter(Boolean),
    revision: session?.state.get().revision, commitCalls: transport?.getCommitCount?.() ?? null, submitting: session?.state.get().isSubmitting || false, pasteAtCursor: state?.pasteAtCursor, clipboardBusy: state?.clipboardBusy || false, privateClipboard: clipboardAdapter?.inspect(), lastError: state?.lastError || session?.state.get().lastError || null,
    minimap: state?.minimap ? structuredClone(state.minimap) : null,
    overlays: state ? structuredClone(state.overlays) : [], snapshotReads, renderedShapes: host.querySelectorAll('[data-shape-id]').length, imageCount: host.querySelectorAll('img').length, decodedImages })
}
Object.defineProperty(window, '__HICANVAS_RENDERER_PREVIEW__', { value: Object.freeze({ getState, inspectTarget: id => observeEditorTarget(session, interaction, transport, id, snapshotReads), getCamera: () => controls?.getCamera() || null, resetCamera: (camera, { clearSelection = false } = {}) => {
  if (!controls) throw new Error('预览尚未挂载。')
  controls.resetCamera(camera)
  if (clearSelection) interaction.select('clear')
} }), writable: false, configurable: false })

try {
  await prepareCanvasFonts(document, { onWarning: async diagnostic => {
    const response = await fetch('/__renderer_font_warning', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify(diagnostic) })
    if (!response.ok) throw new Error('本机校准日志写入失败。')
  } })
  const params = new URLSearchParams(location.search), gallery = params.get('gallery')
  if (['videos', 'image-import'].includes(gallery)) { const response = await fetch(`/__renderer_fixture?gallery=${gallery}`); if (!response.ok) throw new Error('媒体夹具不可用。'); metadata = await response.json() }
  else if (gallery === 'clipboard') metadata = await (await fetch(`/__clipboard_fixture?board=${params.get('board') === 'target' ? 'target' : 'source'}`)).json()
  else if (gallery === 'draw-input') metadata = createDrawGallery()
  else if (gallery === 'selection-actions') metadata = createActionsGallery()
  else if (gallery === 'frame-interaction') metadata = createFrameFixture(params.get('frameCase') || 'drag')
  else if (gallery === 'creation') metadata = createCreationFixture()
  else if (gallery === 'connection-editing') metadata = createConnectionEditingFixture()
  else if (gallery === 'note-editing') metadata = createNoteEditingFixture()
  else if (gallery === 'snapping') metadata = createSnappingFixture(params.get('snapCase'))
  else if (['text-editing', 'text-formatted'].includes(gallery)) metadata = createTextEditingFixture(gallery === 'text-formatted')
  else if (gallery === 'selection-semantics') metadata = createSelectionGallery()
  else if (['frame-performance', 'frame-performance-plain'].includes(gallery)) metadata = createFrameTitleFixture(await (await fetch('/__renderer_fixture?count=5000')).json(), gallery === 'frame-performance')
  else if (['arrows', 'routes', 'lines', 'bindings', 'bound-elbows'].includes(gallery)) metadata = createConnectionGallery(gallery)
  else if (gallery === 'images') metadata = createImageGallery()
  else if (gallery?.startsWith('note-') || gallery === 'frame-titles') metadata = createNoteGallery(gallery)
  else if (gallery) metadata = gallery.startsWith('stroke-') ? createStrokeGallery(gallery) : createGallery(gallery)
  else {
    const response = await fetch(`/__renderer_fixture?count=${encodeURIComponent(params.get('count') || '500')}&dash=${encodeURIComponent(params.get('dash') || 'solid')}`)
    if (!response.ok) throw new Error('合成规模仅支持 500、2000、5000。')
    metadata = await response.json()
    if (params.get('strokes') === '500') metadata = addStrokeLoad(metadata)
  }
  if (params.get('videos') === '3') metadata = addVideoLoad(metadata)
  if (gallery === 'videos') metadata.videoGallery = true
  transport = metadata.persistent ? previewTransport(metadata.conversationId) : memoryTransport(metadata.snapshot)
  if (metadata.textEditingFixture && params.get('slowTextSave') === '1') {
    const commit = transport.commit
    transport.commit = async request => { await new Promise(resolve => setTimeout(resolve, 400)); return commit(request) }
  }
  const actorKey = `preview-actor:${metadata.conversationId || gallery || metadata.count}`
  const actor = sessionStorage.getItem(actorKey) || `preview:${crypto.randomUUID()}`
  sessionStorage.setItem(actorKey, actor)
  const camera = await transport.loadCamera?.() || metadata.viewState.camera
  let hostError = null, wasSubmitting = false
  const showError = error => { hostError = error; status.textContent = `操作失败：${error.message}` }
  clipboardAdapter = createPreviewClipboard({ host, transport, sandbox: metadata.clipboardFixture === true, onError: showError })
  session = await createEditorSession({ transport, actor })
  disposers.push(() => session.dispose())
  if (metadata.persistent) { const records = session.store.allRecords(); metadata.count = records.filter(r => r.typeName === 'shape').length; metadata.counts = records.filter(r => r.typeName === 'shape').reduce((counts, r) => ({ ...counts, [r.type]: (counts[r.type] || 0) + 1 }), {}); metadata.assetCount = records.filter(r => r.typeName === 'asset').length }
  // Observation counter proves pointer hit queries do not serialize the board.
  const originalSnapshot = session.store.getStoreSnapshot.bind(session.store)
  session.store.getStoreSnapshot = (...args) => { snapshotReads++; return originalSnapshot(...args) }
  interaction = createCanvasInteraction({ session, clipboard: clipboardAdapter.port, boardId: metadata.conversationId || '', snapping: { enabled: params.get('snapping') === '1', grid: params.get('grid') === '1' }, displayName: params.get('displayName'), toolIds: gallery === 'creation' || metadata.textEditingFixture || metadata.connectionEditingFixture || metadata.noteEditingFixture ? Object.keys(canvasToolRegistry) : ['select', 'hand', 'draw', 'highlight'], camera, pageId: metadata.viewState.currentPageId, viewport: { w: host.clientWidth, h: host.clientHeight }, inputDevice: params.get('device') || null, invertZoom: params.get('invertZoom') === '1', reduceMotion: params.get('reduceMotion') === '1', edgeScrolling: params.get('edgeScrolling') !== '0', shortcutsEnabled: params.get('shortcuts') !== '0', controlPointSnapping: params.get('controlSnapping') === '1', measureFrameTitle, handleMetrics: { cornerHit: handleCornerHitSize / 2, edgeHit: handleEdgeHitSize / 2, rotationOffset: handleRotationOffset, rotationRadius: handleRotationRadius } })
  disposers.push(() => interaction.dispose())
  renderer = mountCanvasRenderer(host, { store: session.store, camera, pageId: metadata.viewState.currentPageId, loadGeneratedFrame, reduceMotion: params.get('reduceMotion') === '1', onVideoInput: value => interaction.videoInput(value), textEditing: {
    onChange: (content, selection) => interaction.editText({ type: 'update', content, selection }),
    onSelection: selection => interaction.editText({ type: 'selection', selection }),
    onInputContext: value => interaction.setInputContext(value),
    onError: error => { failure = error.message; status.textContent = `文字视图失败：${error.message}` },
  } })
  disposers.push(() => renderer.unmount())
  const instructions = `${metadata.count} 个合成元素 · D/B/X 画笔 · ⇧D 荧光笔 · Shift 接直线 · Shift 点击增减／框选追加 · Ctrl 反转框选 · Alt 涂抹 · Shift 拖动锁轴 · Enter/Esc 组导航 · Tab 顺序选择 · 拖动移动 · 角点／边线缩放 · 角外旋转 · Shift 等比／15° · Alt 中心缩放 · H 手形／空格平移 · Z 缩放 · ⇧0/1/2 · ⌘/Ctrl Z 撤销 · Esc 取消${metadata.persistent ? ' · 松手保存' : ' · 临时预览，刷新还原'}`
  const navigation = attachNavigationUi(host, interaction, showError, (...args) => controls.navigate(...args))
  disposers.push(() => navigation.dispose())
  controls = attachPreviewInput(host, interaction, { onError: showError })
  disposers.push(() => controls.dispose())
  const minimap = attachMinimapUi(navigation.element, host, interaction, { store: session.store, pageId: metadata.viewState.currentPageId, dispatch: input => controls.dispatch(input), onError: showError })
  disposers.push(() => minimap.dispose())
  const videos = gallery === 'videos' ? attachVideoUi(host, interaction, session, metadata, showError) : null
  if (videos) disposers.push(() => videos.dispose())
  const images = ['images', 'image-import'].includes(gallery) ? attachImageUi(host, interaction, session, renderer, showError, params.get('reduceMotion') === '1', metadata) : null
  if (images) disposers.push(() => images.dispose())
  const videoPaste = videos ? createMediaUpload({ session, interaction, metadata, document, onError: showError }) : null
  if (videoPaste) disposers.push(() => videoPaste.dispose())
  disposers.push(clipboardAdapter.attach(interaction, { onFiles: images?.importFiles || videoPaste?.importFiles }))
  const creationUi = gallery === 'creation' || metadata.textEditingFixture || metadata.connectionEditingFixture || metadata.noteEditingFixture ? attachCreationUi(host, interaction, () => controls, showError) : null
  if (creationUi) disposers.push(() => creationUi.dispose())
  const actionsUi = gallery === 'selection-actions' || metadata.clipboardFixture ? attachActionsUi(navigation.element, host, interaction, showError, metadata.clipboardFixture) : null
  if (actionsUi) disposers.push(() => actionsUi.dispose())
  const textUi = metadata.textEditingFixture ? attachTextUi(creationUi.element, interaction, session.store, showError) : null
  if (textUi) disposers.push(() => textUi.dispose())
  const stop = react('preview interaction view', () => {
    const state = interaction.state.get()
    renderer.setCamera(state.camera); renderer.setOverlays(state.overlays); renderer.setTextEditing(state.textEditing); renderer.setVideoInteraction(state)
    navigation.update(state); videos?.update(state); images?.update(state); creationUi?.update(state, session.state.get().isSubmitting); textUi?.update(state, session.state.get().isSubmitting); actionsUi?.update(); controls?.wake()
    minimap.update(state)
    // File I/O feedback must survive the background refresh for the same save.
    const submitting = session.state.get().isSubmitting
    if (submitting && !wasSubmitting) hostError = null
    wasSubmitting = submitting
    const error = state.lastError || session.state.get().lastError || hostError
    const message = error ? `操作失败：${error.message}` : ready ? instructions : status.textContent
    if (status.textContent !== message) status.textContent = message
    clearTimeout(cameraTimer)
    if (metadata.persistent) cameraTimer = setTimeout(() => { void transport.saveCamera({ ...metadata.viewState, camera: state.camera }).catch(showError) }, 200)
  })
  disposers.push(stop)
  window.addEventListener('pagehide', cleanup, { once: true })
  // Only this synthetic performance workload requests playback explicitly.
  // Saved autoplay flags never start real or synthetic boards on their own.
  if (params.get('videos') === '3') {
    const video = session.store.allRecords().find(r => r.typeName === 'shape' && r.type === 'video' && r.props.assetId === 'asset:video-perf')
    interaction.videoInput({ type: 'playback', event: 'play', id: video.id, assetId: video.props.assetId, time: 0, playing: true })
  }
  await document.fonts.ready
  await Promise.all([...host.querySelectorAll('img')].map(async image => { await image.decode(); decodedImages++ }))
  await Promise.all([...host.querySelectorAll('video')].map(video => video.readyState >= 1 || video.error ? null : new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('合成视频未就绪。')), 10000); const done = () => { clearTimeout(timer); video.removeEventListener('loadedmetadata', done); video.removeEventListener('error', done); resolve() }; video.addEventListener('loadedmetadata', done); video.addEventListener('error', done) })))
  if (params.get('videos') === '3') {
    const end = performance.now() + 10000
    while (true) {
      const videos = [...host.querySelectorAll('video')]
      if (videos.length === 3 && videos.every(video => video.readyState >= 2) && videos.filter(video => !video.paused && video.currentTime > .05).length === 1 && videos.filter(video => video.paused).length === 2) break
      if (performance.now() >= end) throw new Error('性能夹具必须三条已解帧、恰好一条在播，拒绝无效样本。')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (getState().renderedShapes !== metadata.count) throw new Error('渲染元素数量与合成快照不一致。')
  ready = true
  status.textContent = instructions
} catch (error) { cleanup(); failure = error.message; status.textContent = `预览失败：${failure}` }
