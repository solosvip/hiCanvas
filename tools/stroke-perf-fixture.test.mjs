import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {b64Vecs} from '@tldraw/tlschema'
import {createCanvasStore} from '../model/index.js'
import {createStrokeFixture,strokeCases} from './perf/strokes-fixture.mjs'

test('笔迹样本可载入真实记录模型，四组规模和画笔荧光各半且拖动目标为笔迹',()=>{
  for(const count of strokeCases){
    const fixture=createStrokeFixture(count),store=createCanvasStore();store.loadStoreSnapshot(fixture.snapshot)
    const shapes=store.allRecords().filter(record=>record.typeName==='shape'),strokes=shapes.filter(record=>['draw','highlight'].includes(record.type))
    assert.equal(shapes.length,count)
    assert.equal(strokes.length,count===1000?500:count)
    assert.equal(strokes.filter(record=>record.type==='draw').length,strokes.length/2)
    assert.equal(strokes.filter(record=>record.type==='highlight').length,strokes.length/2)
    const target=strokes.find(record=>record.id===fixture.targetId)
    assert.ok(target)
    const targetPoints=b64Vecs.decodePoints(target.props.segments[0].path)
    assert.ok((targetPoints.at(-1).x-targetPoints[0].x)*fixture.viewState.camera.z>=64)
    assert.ok((targetPoints.at(-1).y-targetPoints[0].y)*fixture.viewState.camera.z>=64)
    assert.ok(strokes.every(record=>b64Vecs.decodePoints(record.props.segments[0].path).length===129))
    const camera=fixture.viewState.camera
    assert.ok(Math.abs((fixture.targetPoint.x+camera.x)*camera.z-640)<1e-6)
    assert.ok(Math.abs((fixture.targetPoint.y+camera.y)*camera.z-400)<1e-6)
    assert.equal(fixture.counts.image,count===1000?100:0)
    store.dispose?.()
  }
})
