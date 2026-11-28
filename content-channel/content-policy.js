export const CONTENT_CAPABILITIES=Object.freeze(['allow-forms','allow-popups','allow-scripts'])
export function contentSandbox(){return CONTENT_CAPABILITIES.join(' ')}

// The one generated-content constructor that may preserve an origin. It is
// the instance's random origin, never the board's. Offline pages stay opaque.
export function isolatedContentSandbox(value,{port,parentOrigin,kind='generated'}={}){
  let url
  try{url=new URL(value)}catch{throw new Error('内容宿主来源无效。')}
  if(typeof parentOrigin!=='string'||!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(parentOrigin)||!Number.isInteger(port)||port<1||port>65535||url.protocol!=='http:'||url.username||url.password||!/^([a-f0-9]{48})\.localhost$/.test(url.hostname)||Number(url.port)!==port||url.origin===parentOrigin)throw new Error('内容宿主来源无效。')
  if(kind==='gist')return 'allow-scripts allow-same-origin'
  if(kind!=='generated')throw new Error('未知内容发布类型。')
  return [...CONTENT_CAPABILITIES,'allow-same-origin'].join(' ')
}
