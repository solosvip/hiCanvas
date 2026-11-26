import {spawn} from 'node:child_process'

// Every owned process has an error listener before callers wait for readiness.
// A failed second launch can then unwind through the same cleanup as a failure
// in the running app, without leaving the already-started service behind.
export function launchDesktopProcess(executable,args,options){
  const child=spawn(executable,args,options)
  let failure,finished=false,stopping
  child.once('error',error=>{failure=error})
  const closed=new Promise(resolve=>child.once('close',()=>{finished=true;resolve()}))
  return {child,closed,
    check(){
      if(failure)throw failure
      if(finished)throw new Error(`桌面测试进程提前结束：${child.exitCode??child.signalCode}`)
    },
    stop(){
      return stopping ||= (async()=>{
        if(finished)return
        child.kill('SIGTERM')
        const force=setTimeout(()=>child.kill('SIGKILL'),5000)
        try{await closed}finally{clearTimeout(force)}
      })()
    },
  }
}
