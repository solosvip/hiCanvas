import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (condition, message) => { if (!condition) throw new Error(message) }
export async function mediaCleanupSmoke(window, output, files, kind = 'image') {
  const wc = window.webContents, debug = wc.debugger, evaluate = code => wc.executeJavaScript(code)
  if (!debug.isAttached()) debug.attach('1.3')
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const records = value => kind === 'image' ? value.imageRecords : value.videoRecords
  const shapes = value => records(value).filter(r => r.typeName === 'shape')
  const until = async (predicate, message) => {
    const end = Date.now() + 15000
    while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(30) }
    throw new Error('媒体清理原生检查超时：' + message)
  }
  const origin = new URL(wc.getURL()).origin, gallery = kind === 'image' ? 'image-import' : 'videos'
  const board = await (await fetch(origin + '/__renderer_fixture?gallery=' + gallery)).json()
  const actor = 'native-cleanup:other', key = kind === 'image' ? 'png' : 'mp4', mimeType = kind === 'image' ? 'image/png' : 'video/mp4'
  const dataUrl = `data:${mimeType};base64,${(await readFile(files[key])).toString('base64')}`
  const api = async (path, body) => {
    const response = await fetch(origin + path + '?conversation=' + board.conversationId, { method: 'POST', headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', 'x-hicanvas-actor': actor }, body: JSON.stringify(body) })
    const value = await response.json(); check(response.ok, JSON.stringify(value)); return value
  }
  // A real second client saves its resource and shape. A's failure must not
  // remove B's same-content file, even though both uploads share one board.
  const { importToken } = await api('/api/canvas/reference', { purpose: 'file-import-begin' })
  const other = await api('/api/canvas/reference', { dataUrl, importToken, ...(kind === 'image' && { purpose: 'file-import' }) })
  const current = await (await fetch(origin + '/api/canvas?conversation=' + board.conversationId, { headers: { 'x-hicanvas-client': '1' } })).json()
  const saved = await api('/__interaction/commit', { expectedRevision: current.revision, commands: [{ type: 'insert_' + kind, [kind]: { src: other.src, mimeType, name: 'concurrent synthetic', w: 320, h: 180 }, args: {} }] })
  await until(async () => (await state()).revision === saved.revision, '并发保存广播')
  const initial = await state(), count = shapes(initial).length
  const drop = async paths => {
    for (const type of ['dragEnter', 'dragOver', 'drop']) await debug.sendCommand('Input.dispatchDragEvent', { type, x: 550, y: 420, data: { items: [], files: paths, dragOperationsMask: 1 } })
  }
  await evaluate(`(() => {
    const real=window.fetch;window.__cleanupRealFetch=real;
    window.__cleanupProbe={uploads:0,created:[],aborts:0,finished:false};
    window.fetch=async(url,options)=>{
      if(new URL(url,location.href).pathname!=='/api/canvas/reference')return real(url,options);
      const body=JSON.parse(options.body),p=window.__cleanupProbe;
      const final=body.dataUrl&&body.purpose!=='file-import-prepare';
      if(final&&++p.uploads===2)return Response.json({error:'第二个合成媒体上传失败'},{status:503});
      if(body.purpose==='file-import-abort'&&p.refuseCleanup){
        p.abortRequest={url:String(url),headers:options.headers,body:options.body};
        return Response.json({error:'合成清理网络失败'},{status:503});
      }
      const response=await real(url,options);
      if(final&&response.ok)p.created.push((await response.clone().json()).src);
      if(body.purpose==='file-import-abort'){p.aborts++;p.result=await response.clone().json();p.finished=true}
      return response;
    };
  })();void 0`)
  let probe
  try {
    await drop([files[key], files[key]])
    await until(() => evaluate('window.__cleanupProbe.finished'), '失败后清理完成')
    probe = await evaluate('window.__cleanupProbe')
    check(probe.uploads === 2 && probe.created.length === 1 && probe.aborts === 1 && probe.result.remaining === 0, '没有在第一项落盘后清理本次尝试')
    check(shapes(await state()).length === count, '清理失败流程留下半批形状')
    check(await evaluate("document.querySelector('#status').textContent.includes('第二个合成媒体上传失败')"), '清理遮住了原始上传错误')
    await writeFile(join(output, `media-cleanup-${kind}-error.png`), (await wc.capturePage()).toPNG())
    for (const src of probe.created) check((await fetch(origin + src)).status === 404, '本次失败素材仍可读取')
    check((await fetch(origin + other.src)).status === 200, '并发成功素材被误删')
    await api('/api/canvas/reference', { purpose: 'file-import-abort', importToken })
    check((await fetch(origin + other.src)).status === 200, '已提交素材收到迟到取消后被误删')
    await evaluate('window.__cleanupProbe={uploads:0,created:[],aborts:0,refuseCleanup:true};void 0')
    await drop([files[key], files[key]])
    await until(() => evaluate("document.querySelector('#status').textContent.includes('未完全清理')"), '清理失败附加提示')
    const failed = await evaluate('window.__cleanupProbe')
    check(failed.uploads === 2 && failed.created.length === 1 && failed.abortRequest, '没有真实进入清理失败分支')
    check(await evaluate("document.querySelector('#status').textContent.includes('第二个合成媒体上传失败')"), '附加提示吞掉原错误')
    check(shapes(await state()).length === count, '清理网络失败留下半批形状')
    await writeFile(join(output, `media-cleanup-${kind}-warning.png`), (await wc.capturePage()).toPNG())
    for (const src of failed.created) check((await fetch(origin + src)).status === 200, '取消未送到时错误地宣称文件已经删除')
    const retried = await evaluate(`(async()=>{const p=window.__cleanupProbe.abortRequest;const response=await window.__cleanupRealFetch(p.url,{method:'POST',headers:p.headers,body:p.body});return {ok:response.ok,...await response.json()}})()`)
    check(retried.ok && retried.remaining === 0, '同一凭证真实重试未完成清理')
    for (const src of failed.created) check((await fetch(origin + src)).status === 404, '恢复后重试没有清理本次文件')
    check((await fetch(origin + other.src)).status === 200, '清理重试误删并发文件')
  } finally { await evaluate('window.fetch=window.__cleanupRealFetch;delete window.__cleanupRealFetch;void 0') }
  // The previous native suites already assert batch undo/redo. Recheck the
  // successful same-content second-client file after its own history roundtrip.
  const undo = await api('/api/canvas/undo', { expectedRevision: (await state()).revision })
  const redo = await api('/api/canvas/redo', { expectedRevision: undo.revision })
  await until(async () => (await state()).revision === redo.revision, '并发素材重做广播')
  check((await fetch(origin + other.src)).status === 200, '撤销重做丢失已保护文件')
  const result = { kind, actualSecondUploadFailed: true, failedUrls404: probe.created, concurrentUrl200: other.src, aborts: probe.aborts, undoRedoPreserved: true, cleanupFailureKeptOriginalError: true, cleanupRetry404: true }
  await writeFile(join(output, `media-cleanup-${kind}.json`), JSON.stringify(result, null, 2))
  return result
}
