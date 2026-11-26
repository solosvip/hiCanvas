import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeCanvasCommands } from '../engine/index.js'
import { createImageGallery, imageGrid } from './renderer-preview/image-fixtures.js'

const id = 'shape:image-0'
const fixture = changes => { const snapshot = createImageGallery(undefined, true).snapshot; return changes ? executeCanvasCommands(snapshot, [{ type: 'update', id, changes }]).snapshot : snapshot }
const run = (snapshot, command) => executeCanvasCommands(snapshot, [{ type: 'crop_image', id, ...command }]).snapshot.store[id]

// 2026-11-26, old tldraw 5.1.1, offscreen Electron native mouse input,
// synthetic 240×180 grid at (100,120), zoom 1: left edge +60 → x160,
// width180, crop.x=.25..1. Double-clicking that edge restores x100,width240.
// Moving the image right20 before resetting instead restores x120,width240.
test('F32 裁剪复位恢复完整尺寸和图像原点，保留形状身份与镜像', () => {
  const snapshot = fixture({ x: 160, props: { w: 180, h: 180, flipX: true, crop: { topLeft: { x: .25, y: 0 }, bottomRight: { x: 1, y: 1 } } } })
  const shape = run(snapshot, { operation: 'reset' })
  assert.equal(shape.id, id); assert.equal(shape.x, 100); assert.equal(shape.y, 120)
  assert.equal(shape.props.w, 240); assert.equal(shape.props.h, 180)
  assert.equal(shape.props.flipX, true)
  assert.deepEqual(shape.props.crop, { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } })
})

// Same native crop toolbar: Square/Circle → (130,120,180,180), Portrait →
// (152.5,120,135,180), Wide → (100,142.5,240,135), original/landscape unchanged.
test('F15 六种比例按旧版测得的中心和尺寸取景；圆形标记单独保留', () => {
  for (const [preset, x, y, w, h, circle] of [['original',100,120,240,180,false], ['square',130,120,180,180,false], ['circle',130,120,180,180,true], ['landscape',100,120,240,180,false], ['portrait',152.5,120,135,180,false], ['wide',100,142.5,240,135,false]]) {
    const shape = run(fixture(), { operation: 'aspect', preset })
    assert.deepEqual([shape.x, shape.y, shape.props.w, shape.props.h], [x,y,w,h], preset)
    assert.equal(Boolean(shape.props.crop.isCircle), circle, preset)
  }
})

test('F13 移图不移动裁剪框，保持取景大小并限制在原图内', () => {
  const snapshot = fixture({ x: 160, props: { w: 180, crop: { topLeft: { x: .25, y: 0 }, bottomRight: { x: 1, y: 1 } } } })
  const moved = run(snapshot, { operation: 'move', delta: { x: 20, y: 10 } })
  assert.deepEqual([moved.x, moved.y, moved.props.w, moved.props.h], [160,120,180,180])
  assert.ok(Math.abs(moved.props.crop.topLeft.x - 1 / 6) < 1e-12)
  assert.equal(moved.props.crop.topLeft.y, 0)
  const bounded = run(snapshot, { operation: 'move', delta: { x: 10000, y: -10000 } })
  assert.deepEqual(bounded.props.crop, { topLeft: { x: 0, y: 0 }, bottomRight: { x: .75, y: 1 } })
})

// Native old slider Home/End: 0 → full image; 100 → central third of each
// source axis, with the same viewport. New UI labels an explicit 1–3× scale.
test('F14 缩放取景保持画框，最大三倍；复位保留放大的原图尺寸', () => {
  const zoomed = run(fixture(), { operation: 'zoom', value: 100 })
  assert.deepEqual([zoomed.x,zoomed.y,zoomed.props.w,zoomed.props.h], [100,120,240,180])
  assert.ok(Math.abs(zoomed.props.crop.topLeft.x - 1 / 3) < 1e-12)
  const base = fixture(), reset = run({ ...base, store: { ...base.store, [id]: zoomed } }, { operation: 'reset' })
  assert.ok(Math.abs(reset.x + 140) < 1e-10); assert.ok(Math.abs(reset.props.w - 720) < 1e-10)
})

test('F12 替换图片保留形状身份、画框和描述；新资产等比居中填满，不改旧资产', () => {
  const snapshot = fixture({ rotation: .3, props: { altText: '颜色分区', flipX: true, crop: { topLeft: { x: .2, y: .2 }, bottomRight: { x: .8, y: .8 } } }, meta: { owner: 'synthetic' } })
  const result = executeCanvasCommands(snapshot, [{ type: 'replace_image', id, assetId: 'asset:replacement', image: { src: imageGrid, name: 'replacement', w: 400, h: 100, mimeType: 'image/svg+xml', isAnimated: false } }])
  const shape = result.snapshot.store[id]
  assert.deepEqual([shape.id,shape.x,shape.y,shape.rotation,shape.props.w,shape.props.h,shape.props.altText,shape.props.flipX,shape.meta], [id,100,120,.3,240,180,'颜色分区',true,{owner:'synthetic'}])
  assert.equal(shape.props.assetId,'asset:replacement')
  assert.ok(Math.abs(shape.props.crop.topLeft.x - 1 / 3) < 1e-12)
  assert.equal(shape.props.crop.topLeft.y,0); assert.equal(shape.props.crop.bottomRight.y,1)
  assert.deepEqual(result.snapshot.store['asset:image-grid'],snapshot.store['asset:image-grid'])
})

test('C14/C15 镜像只翻转显示标记，裁剪框与取景保持，重复同轴操作恢复', () => {
  const snapshot=fixture({props:{crop:{topLeft:{x:.25,y:0},bottomRight:{x:1,y:1}}}})
  const commands=['x','y'].map(axis=>({type:'flip_shapes',ids:[id],axis}))
  const reflected=executeCanvasCommands(snapshot,commands).snapshot.store[id]
  assert.equal(reflected.props.flipX,true); assert.equal(reflected.props.flipY,true)
  assert.deepEqual([reflected.x,reflected.y,reflected.props.w,reflected.props.h,reflected.props.crop],[100,120,240,180,snapshot.store[id].props.crop])
  assert.deepEqual(executeCanvasCommands(snapshot,[...commands,...commands]).snapshot.store[id],snapshot.store[id])
})

test('无效取景和锁定容器中的图片拒绝修改，不留下新资产或部分改动', () => {
  const snapshot=fixture(), before=structuredClone(snapshot)
  assert.throws(()=>run(snapshot,{operation:'set',crop:{topLeft:{x:.8,y:0},bottomRight:{x:.2,y:1}}}),/裁剪范围/)
  assert.deepEqual(snapshot,before)
  const locked=executeCanvasCommands(snapshot,[{type:'create_shape',id:'shape:locked',shapeType:'frame'},{type:'update',id:'shape:locked',changes:{isLocked:true}},{type:'update',id,changes:{parentId:'shape:locked'}}]).snapshot
  assert.throws(()=>run(locked,{operation:'reset'}),/锁定/)
  assert.throws(()=>executeCanvasCommands(locked,[{type:'replace_image',id,assetId:'asset:blocked',image:{src:imageGrid,w:240,h:180,mimeType:'image/svg+xml'}}]),/锁定/)
  assert.ok(!Object.hasOwn(locked.store,'asset:blocked'))
})
