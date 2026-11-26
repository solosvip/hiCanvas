import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {attachCowartFilmController} from '../src/filmPlayback.js'

test('继承播放控制的暂停、静音、30fps定位、结束再播放与卸载保持不变',()=>{
  let clock=0,sequence=0
  const pending=new Map(),calls=[],statuses=[]
  const host=new EventTarget()
  Object.assign(host,{
    performance:{now:()=>clock},
    requestAnimationFrame(callback){const id=++sequence;pending.set(id,callback);return id},
    cancelAnimationFrame(id){pending.delete(id)},setTimeout,clearTimeout,
  })
  const frame=new EventTarget()
  frame.CowartFilm={duration:2,
    play(){calls.push(['play'])},pause(){calls.push(['pause'])},
    seek(value){calls.push(['seek',value])},setMuted(value){calls.push(['mute',value])},
  }
  const iframe={ownerDocument:{defaultView:host},contentWindow:frame}
  const controller=attachCowartFilmController(iframe,{muted:true,onStatus:status=>statuses.push(status)})
  try{
    assert.deepEqual(calls,[['pause'],['mute',true],['seek',0]])
    assert.equal(statuses.at(-1).ready,true)
    assert.equal(controller.command('seek',.051),true)
    assert.deepEqual(calls.at(-1),['seek',2/30])
    assert.equal(statuses.at(-1).playing,false)
    assert.equal(controller.command('mute',false),true)
    assert.deepEqual(calls.at(-1),['mute',false])
    controller.command('play')
    clock=500
    for(const [id,callback] of [...pending]){pending.delete(id);callback(clock)}
    assert.ok(statuses.at(-1).currentTime>.5)
    controller.command('pause')
    assert.equal(statuses.at(-1).playing,false)
    controller.command('seek',2)
    controller.command('play')
    assert.deepEqual(calls.slice(-2),[['seek',0],['play']])
    assert.equal(controller.command('fetch','/api/canvas'),false)
  }finally{controller.dispose()}
  assert.deepEqual(calls.at(-1),['pause'])
  assert.equal(pending.size,0)
  assert.equal(controller.command('play'),false)
})
