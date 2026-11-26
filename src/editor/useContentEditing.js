import {useEffect,useRef,useState} from 'react'
import {createContentEditorSession,getContentChannel} from '../../content-channel/index.js'
import {createHtmlEditPersistence} from './htmlEditPersistence.js'
import {createPersistenceFeedback} from '../persistenceFeedback.js'

// Keep the loaded instance alive through save completion, including exits
// initiated by clicking outside the iframe. A failed exit restores editing.
export function useContentEditing({editor,shapeId,iframe,enabled,isEditing,loadVersion,sessions,applyResult,onExited}){
  const active=useRef(null),[retainSource,setRetainSource]=useState(false),[epoch,setEpoch]=useState(0)
  const callbacks=useRef(null)
  const feedback=useRef(null)
  const unsaved=useRef(false),saving=useRef(0)
  callbacks.current={applyResult,onExited}
  useEffect(()=>{
    if(!enabled)return
    const notice=createPersistenceFeedback(editor.getContainer(),()=>{
      const entry=active.current
      if(entry)void entry.promise.then(session=>session.finish()).then(()=>callbacks.current.onExited()).catch(()=>{})
      else{editor.setEditingShape(shapeId);editor.setCurrentTool('select.editing_shape')}
    },()=>unsaved.current||saving.current>0)
    feedback.current=notice
    return ()=>{notice.dispose();if(feedback.current===notice)feedback.current=null}
  },[editor,shapeId,enabled])
  useEffect(()=>{
    setRetainSource(false)
    return ()=>{
    const entry=active.current
    if(!entry)return
    active.current=null;entry.cancelled=true
    entry.promise.then(session=>{
      if(sessions.get(shapeId)===session)sessions.delete(shapeId)
      return session.dispose({save:false})
    }).catch(()=>{})
    }
  },[iframe,enabled,loadVersion,sessions,shapeId])
  useEffect(()=>{
    if(!enabled||!iframe)return
    if(isEditing&&!active.current){
      // A completed save may replace the iframe. Wait for its onLoad binding
      // instead of treating a click during navigation as an editing failure.
      if(!getContentChannel(iframe))return
      const entry={promise:null,cancelled:false,closing:null}
      active.current=entry;setRetainSource(true)
      const save=createHtmlEditPersistence(editor,shapeId,(result,html)=>callbacks.current.applyResult(result,html))
      entry.promise=createContentEditorSession(iframe,{onSave:save,
        onState:state=>{if(!entry.cancelled)unsaved.current=state.dirty},
        async onRequestExit(){await (await entry.promise).finish();if(!entry.cancelled)callbacks.current.onExited()},
        onError:error=>feedback.current?.failed('html',error.message),
      }).then(session=>{
        const wrap=method=>async(...args)=>{
          saving.current++
          try{const result=await session[method](...args);feedback.current?.saved('html');return result}
          catch(error){unsaved.current=true;feedback.current?.failed('html',error.message);throw error}
          finally{saving.current--}
        }
        const controlled={...session,flush:wrap('flush'),finish:wrap('finish')}
        if(!entry.cancelled){sessions.set(shapeId,controlled);feedback.current?.saved('html')}
        return controlled
      })
      entry.promise.catch(error=>{
        if(entry.cancelled)return
        console.error('hiCanvas could not start isolated HTML editing.',error)
        feedback.current?.failed('html',error.message)
        if(active.current===entry){active.current=null;setRetainSource(false);callbacks.current.onExited()}
      })
    }
    if(!isEditing&&active.current&&!active.current.closing){
      const entry=active.current
      entry.closing=entry.promise.then(session=>session.finish()).then(()=>{
        if(entry.cancelled)return
        entry.promise.then(session=>{if(sessions.get(shapeId)===session)sessions.delete(shapeId)})
        if(active.current===entry){active.current=null;setRetainSource(false);setEpoch(value=>value+1)}
      }).catch(error=>{
        if(entry.cancelled)return
        entry.closing=null
        console.error('hiCanvas kept unsaved HTML editing after a failed exit.',error)
        feedback.current?.failed('html',error.message)
        editor.setEditingShape(shapeId);editor.setCurrentTool('select.editing_shape')
      })
    }
  },[editor,shapeId,iframe,enabled,isEditing,loadVersion,sessions,epoch])
  return retainSource
}
