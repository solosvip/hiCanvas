// Native Chromium observation on ea42c48 (2026-11-26): 29 click cases and
// five keyboard contexts per old app/Play.html, 63 assertions each. The app
// additionally excludes cancelled/modifier/pointer clicks; old Play does not.
// Empty/plaintext-only contenteditable, property onclick and addEventListener
// still advance. Only literal contenteditable=true / onclick attributes and
// these four roles exclude clicks. Preserve those inherited boundaries.
export const SLIDE_INTERACTIVE_SELECTOR='a[href],button,input,select,textarea,summary,video,audio,canvas,[contenteditable="true"],[onclick],[role="button"],[role="link"],[role="menuitem"],[role="tab"]'
export function isInteractiveSlideClick(event,profile='app'){
  if(profile==='app'&&(event.defaultPrevented||event.cancelBubble||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey))return true
  const target=event.target
  if(target?.closest?.(SLIDE_INTERACTIVE_SELECTOR))return true
  if(profile==='app'){
    const document=target?.ownerDocument,host=document?.defaultView
    let element=target?.nodeType===1?target:target?.parentElement
    while(element&&element!==document?.documentElement){if(host?.getComputedStyle(element).cursor==='pointer')return true;element=element.parentElement}
  }
  return false
}
export function installSlideNavigation(host,send,profile='app'){
  const document=host.document,timers=new Set()
  const click=event=>{
    const run=()=>{if(!isInteractiveSlideClick(event,profile))send('next')}
    if(profile==='offline')run()
    else{const timer=host.setTimeout(()=>{timers.delete(timer);run()},0);timers.add(timer)}
  }
  // Observed: child arrows/space (including inside an input) advance only in
  // old Play.html; app keyboard handling remains exclusively in the parent.
  const key=event=>{const direction=event.key==='ArrowLeft'?'previous':event.key==='ArrowRight'||event.key===' '?'next':null;if(direction){event.preventDefault();send(direction)}}
  document.addEventListener('click',click)
  if(profile==='offline')document.addEventListener('keydown',key)
  return ()=>{document.removeEventListener('click',click);document.removeEventListener('keydown',key);for(const timer of timers)host.clearTimeout(timer);timers.clear()}
}
export function createSlideGate(accept){
  let used=false
  return direction=>{if(used||!['next','previous'].includes(direction))return false;const accepted=accept(direction);if(accepted!==false)used=true;return accepted}
}
