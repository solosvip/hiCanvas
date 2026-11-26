import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {launchDesktopProcess} from './content-host/desktop-process.mjs'

test('第二个进程无法启动时错误可回收，已启动服务仍由finally停止',async()=>{
  const service=launchDesktopProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
  await once(service.child,'spawn')
  let failed
  try{
    failed=launchDesktopProcess('/hicanvas-synthetic-no-such-executable',[],{stdio:'ignore'})
    await failed.closed
    assert.throws(()=>failed.check(),{code:'ENOENT'})
  }finally{
    await Promise.all([service.stop(),failed?.stop()])
  }
  assert.ok(service.child.signalCode||service.child.exitCode!==null)
  await service.stop()
})
