import {spawn} from 'node:child_process'

// Cancellation completes only after the owned process exits, so callers may
// safely close its services and delete its isolated profile in their finally.
export async function runStrokeProcess({command,args,env=process.env,signal,timeoutMs=120000,onStdout=()=>{},onStderr=()=>{}}){
  signal?.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']})
    let failure,forceTimer
    const stop=error=>{failure ||= error;child.kill('SIGTERM');forceTimer ||= setTimeout(()=>child.kill('SIGKILL'),2000)}
    const abort=()=>stop(signal.reason||new Error('笔迹测量已取消。'))
    signal?.addEventListener('abort',abort,{once:true})
    const timeout=setTimeout(()=>stop(new Error('笔迹测量超时。')),timeoutMs)
    child.stdout.on('data',onStdout);child.stderr.on('data',onStderr)
    child.once('error',error=>{failure ||= error})
    child.once('close',(code,status)=>{
      clearTimeout(timeout);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort)
      if(failure)reject(failure)
      else if(code!==0)reject(new Error(`笔迹浏览器测量失败：${code??status}`))
      else resolve()
    })
    if(signal?.aborted)abort()
  })
}
