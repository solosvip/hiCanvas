import {parse} from '@babel/parser'

const production=/^(?:src|renderer|content-channel|server|desktop|mcp|model|bin)\/.+\.[cm]?[jt]sx?$/
const board=/^(?:src|renderer|desktop)\//
const parentChannels=new Set(['content-channel/parent.js','content-channel/capture-parent.js','content-channel/edit-parent.js','content-channel/offline-slides.js'])
const member=node=>['MemberExpression','OptionalMemberExpression'].includes(node?.type)
function literal(node){
  if(node?.type==='StringLiteral')return node.value
  if(node?.type==='BinaryExpression'&&node.operator==='+'){
    const left=literal(node.left),right=literal(node.right)
    if(typeof left==='string'&&typeof right==='string')return left+right
  }
  if(node?.type==='TemplateLiteral'){
    let value=node.quasis[0].value.cooked
    for(let index=0;index<node.expressions.length;index++){
      const next=literal(node.expressions[index]);if(typeof next!=='string')return
      value+=next+node.quasis[index+1].value.cooked
    }
    return value
  }
  if(node?.type==='CallExpression'&&member(node.callee)&&key(node.callee)==='join'&&node.callee.object.type==='ArrayExpression'){
    const separator=node.arguments.length?literal(node.arguments[0]):','
    const values=node.callee.object.elements.map(literal)
    if(typeof separator==='string'&&values.every(value=>typeof value==='string'))return values.join(separator)
  }
}
const key=node=>node?.computed?literal(node.property):node?.property?.name
const childOnly=new Set(['installContentChild','attachCowartFilmController','renderHtmlDraftDocument','captureHtml2Canvas','createFilmVideoFrames','drawFittedVideo','seekFilmFrame','prepareFilmAssets','waitForFilmAPI','createCowartHtmlDraftDomEditorSession','serializeHtmlDoctype','serializeCowartHtmlDraftDocument','isCowartDomTextElement','cowartDomSelectionTarget','placeCowartDomCaret','captureCowartDomTextSelection','restoreCowartDomTextSelection'])

// Operates on supplied file text so working-tree and staged checks use exactly
// the same boundary. Test fixtures live outside these production roots.
export function checkContentIsolation(path,content){
  if(!production.test(path)||/\.test\.[cm]?[jt]sx?$/.test(path))return []
  const errors=[],channelParent=parentChannels.has(path),report=(node,message)=>errors.push(`${path}:${node.loc?.start.line||1}：${message}`)
  const tree=parse(content,{sourceType:'module',plugins:['jsx']})
  function walk(node,parent,approvedSandbox=false){
    if(!node||typeof node.type!=='string')return
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      const name=node.id?.name||(parent?.type==='VariableDeclarator'?parent.id.name:undefined)
      approvedSandbox=path==='content-channel/content-policy.js'&&name==='isolatedContentSandbox'||path==='renderer/embed-content.js'&&name==='frame'
    }
    // Conservatively reserve the origin grant itself, including split constant
    // expressions, to the two reviewed constructors (ADR0013). No file-wide bypass.
    const text=literal(node)
    const fragments=node.type==='TemplateLiteral'?node.quasis.map(part=>part.value.cooked):[]
    if(!approvedSandbox&&[text,...fragments].some(value=>typeof value==='string'&&value.includes('allow-same-origin')))report(node,'脚本与来源权限只能由已校验的内容宿主或白名单外部嵌入入口构造。')
    if(member(node)){
      const name=key(node)
      if(board.test(path)&&['contentDocument','contentWindow','getSVGDocument','frames'].includes(name))report(node,'画板不得直接访问内容页 window/document；改用内容消息通道。')
      if(name==='contentWindow'&&channelParent){
        const post=member(parent)&&key(parent)==='postMessage'&&parent.object===node
        const identity=parent?.type==='ObjectProperty'&&parent.key.name==='frame'&&parent.value===node
        if(!post&&!identity)report(node,'内容通道只可获取窗口身份或传递握手，不能取得子页对象。')
      }
      if(channelParent&&(['contentDocument','getSVGDocument','frames'].includes(name)||name==='document'&&node.object.name!=='host'))report(node,'父通道不能访问子页文档。')
      if(board.test(path)&&['srcdoc','srcDoc'].includes(name))report(node,'生成网页必须经内容宿主加载，不能回退 srcdoc。')
    }
    if((board.test(path)||channelParent)&&node.type==='ObjectPattern')for(const property of node.properties){
      const name=property.computed?literal(property.key):property.key?.name||property.key?.value
      if(['contentWindow','contentDocument','getSVGDocument','frames',...channelParent?['document']:[]].includes(name))report(property,'画板不能解构取得内容页 window/document。')
    }
    if(node.type==='CallExpression'&&member(node.callee)&&['get','getOwnPropertyDescriptor'].includes(key(node.callee))&&['contentWindow','contentDocument','document'].includes(literal(node.arguments[1]))&&(board.test(path)||channelParent))report(node,'不能通过反射取得内容页 window/document。')
    if(board.test(path)&&['ObjectProperty','JSXAttribute'].includes(node.type)&&['srcdoc','srcDoc'].includes(node.key?.name||node.key?.value||node.name?.name))report(node,'生成网页必须经内容宿主加载，不能回退 srcdoc。')
    if(board.test(path)&&node.type==='CallExpression'&&member(node.callee)&&['setAttribute','setAttributeNS'].includes(key(node.callee))&&['srcdoc','srcDoc'].includes(literal(node.arguments[key(node.callee)==='setAttributeNS'?1:0])))report(node,'生成网页不能使用 srcdoc 属性。')
    if(board.test(path)&&node.source?.value?.includes('content-channel')){
      if(!/content-channel\/index\.js$/.test(node.source.value))report(node,'画板只能经内容通道公开入口导入能力。')
      for(const specifier of node.specifiers||[])if(specifier.type==='ImportNamespaceSpecifier'||childOnly.has(specifier.imported?.name||specifier.local?.name))report(node,'画板不能导入或转导出子页 DOM 执行工具；使用父通道能力接口。')
      if(node.type==='ExportAllDeclaration')report(node,'画板不能整体转导出子页能力。')
    }
    if(board.test(path)&&node.type==='CallExpression'&&node.callee.type==='Import'&&literal(node.arguments[0])?.includes('content-channel'))report(node,'画板通道能力须通过明确的静态导入使用。')
    for(const value of Object.values(node))if(Array.isArray(value)){for(const child of value)walk(child,node,approvedSandbox)}else if(value&&typeof value==='object')walk(value,node,approvedSandbox)
  }
  walk(tree.program)
  return errors
}
