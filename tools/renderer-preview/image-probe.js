import { createCanvasStore } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createImageGallery } from './image-fixtures.js'

export async function runImagePlayingProbe() {
  const initial = executeCanvasCommands(createImageGallery(undefined, true).snapshot, [{ type: 'update', id: 'shape:image-0', changes: { props: { assetId: 'asset:image-animation', playing: false } } }]).snapshot
  const store = createCanvasStore(); store.loadStoreSnapshot(initial)
  const host = document.createElement('div'); host.hidden = true; document.body.append(host)
  let renderer
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)) }
    throw new Error('图片播放探针等待超时。')
  }
  try {
    const children = host.children.length
    try { mountCanvasRenderer(host, { store, reduceMotion: 'invalid' }); throw new Error('非法偏好未被拒绝') } catch (error) { if (!error.message.includes('布尔')) throw error }
    if (host.children.length !== children) throw new Error('非法图片偏好遗留挂载元素')
    renderer = mountCanvasRenderer(host, { store })
    const canvas = await wait(() => host.querySelector('[data-image-static="ready"]'))
    const colors = []
    for (let i = 0; i < 4; i++) {
      colors.push([...canvas.getContext('2d').getImageData(0, 0, 1, 1).data])
      await new Promise(resolve => setTimeout(resolve, 113))
    }
    if (colors.some(rgb => rgb.join(',') !== '255,0,0,255')) throw new Error(`playing=false 未显示静态首帧：${JSON.stringify(colors)}`)
    const before = JSON.stringify(store.getStoreSnapshot())
    renderer.setReduceMotion(true); renderer.setReduceMotion(false)
    if (JSON.stringify(store.getStoreSnapshot()) !== before) throw new Error('播放偏好写入了画板')
    const image = store.get('shape:image-0')
    store.put([{ ...image, props: { ...image.props, playing: true } }])
    await wait(() => host.querySelector('img'))
    renderer.setReduceMotion(true)
    const reduced = await wait(() => host.querySelector('[data-image-static="ready"]'))
    if ([...reduced.getContext('2d').getImageData(0,0,1,1).data].join(',') !== '255,0,0,255') throw new Error('减少动画未显示首帧')
    renderer.setReduceMotion(false); await wait(() => host.querySelector('img'))
    renderer.setReduceMotion(true)
    const priorCanvas = await wait(() => host.querySelector('[data-image-static="ready"]'))
    const asset = store.get('asset:image-animation')
    store.put([{...asset,props:{...asset.props,src:'data:image/gif;base64,AA=='}}])
    await wait(() => host.querySelector('[data-image-error]'))
    if (priorCanvas.width || priorCanvas.height) throw new Error('换源后遗留上一张图片像素')
    if (!host.textContent.includes('图片加载失败')) throw new Error('失效动图没有错误提示')
    store.put([asset]); await wait(() => host.querySelector('[data-image-static="ready"]'))
    const fractional = executeCanvasCommands(createImageGallery(undefined,true).snapshot,[{type:'crop_image',id:'shape:image-0',operation:'zoom',value:99}]).snapshot
    store.loadStoreSnapshot(fractional)
    const fractionalImage = await wait(() => host.querySelector('img'))
    if (Math.abs(parseFloat(getComputedStyle(fractionalImage).width)-715.2)>.01) throw new Error('小数取景缩放丢失源图亚像素尺寸')
    return { pausedFrames: colors, reduceMotionToggle: true, preferencesNeverWrite: true, sourceFailureClearsAndRecovers:true, fractionalCrop:true }
  } finally { renderer?.unmount(); host.remove(); store.dispose() }
}
