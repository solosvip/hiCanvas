import {MAX_FILM_TASK_TIMEOUT} from './film-export-protocol.js'
// Browser timers overflow beyond signed int32. Keep an absolute deadline and
// schedule bounded pieces, including custom taskTimeout at its maximum value.
export function armDeadline(callback,milliseconds){
  const deadline=Date.now()+milliseconds
  let timer,stopped=false
  const tick=()=>{
    if(stopped)return
    const left=deadline-Date.now()
    const expire=()=>{if(!stopped){stopped=true;callback()}}
    if(left<=0){expire();return}
    timer=setTimeout(left<=MAX_FILM_TASK_TIMEOUT?expire:tick,Math.min(left,MAX_FILM_TASK_TIMEOUT))
  }
  tick()
  return()=>{stopped=true;clearTimeout(timer)}
}
