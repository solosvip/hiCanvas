import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {runStrokeProcess} from './perf/strokes-process.mjs'

test('预置结束前已取消就不启动子进程；启动后取消会等待退出再返回',async()=>{
  const before=new AbortController();before.abort(new Error('cancel before spawn'))
  let output=''
  await assert.rejects(runStrokeProcess({command:process.execPath,args:['-e','console.log("should not start")'],signal:before.signal,onStdout:bytes=>output+=bytes}),/cancel before spawn/)
  assert.equal(output,'')
  const during=new AbortController()
  const running=runStrokeProcess({command:process.execPath,args:['-e','console.log("started");setInterval(()=>{},1000)'],signal:during.signal,onStdout:bytes=>{output+=bytes;during.abort(new Error('cancel after start'))}})
  await assert.rejects(running,/cancel after start/)
  assert.match(output,/started/)
})
