import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClickCounter } from '../engine/interaction/click-count.js'

function fixture() {
  const count = createClickCounter()
  const input = (type,time,x=0,y=0,extra={}) => count({type,time,point:{x,y},pointerId:1,pointerType:'mouse',button:0,...extra})
  const pair = (time,x=0,y=0,extra={}) => [input('pointer_down',time,x,y,extra).clickCount,input('pointer_up',time+1,x,y,extra).clickCount]
  return {input,pair}
}

test('完整按下松开序列连续计数，按下与对应松开的次数一致', () => {
  const f=fixture()
  assert.deepEqual([f.pair(0),f.pair(100),f.pair(200),f.pair(300)],[[1,1],[2,2],[3,3],[4,4]])
})

test('400ms以内且严格不到16屏幕像素；超时、超距、换按钮或指针类型重新从1数', () => {
  const f=fixture()
  assert.deepEqual(f.pair(0),[1,1])
  assert.deepEqual(f.pair(400,15),[2,2])
  assert.deepEqual(f.pair(801,15),[1,1])
  assert.deepEqual(f.pair(802,31),[1,1])
  assert.deepEqual(f.pair(803,33,0,{button:1}),[1,1])
  assert.deepEqual(f.pair(804,33,0,{button:1,pointerType:'pen'}),[1,1])
  assert.deepEqual(f.pair(805,33,0,{button:1,pointerType:'pen'}),[2,2])
})

test('按住曾达到16px即清零，拖回原位后普通点击不算第二击；15px仍可连击', () => {
  for (const [x,y,expected] of [[640,340,1],[636,320,1],[635,320,2]]) {
    const f=fixture()
    assert.equal(f.input('pointer_down',0,620,320).clickCount,1)
    f.input('pointer_move',10,x,y)
    f.input('pointer_move',20,620,320)
    assert.equal(f.input('pointer_up',30,620,320).clickCount,1)
    assert.deepEqual(f.pair(100,620,320),[expected,expected])
  }
})

test('指针取消清除按压和连续点击；触控换接触编号仍按同类点击计数', () => {
  const f=fixture()
  assert.deepEqual(f.pair(0),[1,1])
  assert.equal(f.input('pointer_down',10).clickCount,2)
  f.input('pointer_cancel',11)
  assert.equal(f.input('pointer_up',12).clickCount,1)
  assert.deepEqual(f.pair(20),[1,1])
  assert.deepEqual(f.pair(100,0,0,{pointerType:'touch',pointerId:7}),[1,1])
  assert.deepEqual(f.pair(200,0,0,{pointerType:'touch',pointerId:8}),[2,2])
})

test('装饰后的输入是新对象，调用方输入和点坐标不被修改', () => {
  const count=createClickCounter(), original=Object.freeze({type:'pointer_down',time:0,pointerId:1,pointerType:'mouse',button:0,point:Object.freeze({x:1,y:2})})
  const decorated=count(original)
  assert.notEqual(decorated,original); assert.equal(decorated.clickCount,1)
  assert.ok(!Object.hasOwn(original,'clickCount'))
  const frame=Object.freeze({type:'frame',time:1})
  assert.deepEqual(count(frame),frame); assert.notEqual(count(frame),frame)
})
