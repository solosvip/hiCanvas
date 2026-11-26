// Old ea42c48 native Chromium observation, 2026-11-26: all 29 click
// readings below confirmed in app and actual exported file:// Play.html.
// Five keyboard contexts and both boundaries also passed (63 checks per path).
export const syntheticCdnUrl='https://hicanvas-slides-test.invalid/library.js'
export const slideClickCases = [
  {id:'plain',html:'<div>普通文字</div>',app:true,offline:true},
  {id:'link',html:'<a href="javascript:void(0)"><span>有地址的链接</span></a>',app:false,offline:false},
  {id:'anchor',html:'<a>没有地址的锚点</a>',app:true,offline:true},
  {id:'button',html:'<button><span>按钮内文字</span></button>',app:false,offline:false},
  {id:'disabled',html:'<button disabled>禁用按钮</button>',app:false,offline:false},
  {id:'input',html:'<input value="单行输入">',app:false,offline:false},
  {id:'select',html:'<select disabled><option>选择器</option></select>',app:false,offline:false},
  {id:'textarea',html:'<textarea>多行输入</textarea>',app:false,offline:false},
  {id:'summary',html:'<details><summary>折叠标题</summary>说明</details>',app:false,offline:false},
  {id:'video',html:'<video width="150" height="26"></video>',app:false,offline:false},
  {id:'audio',html:'<audio controls></audio>',app:false,offline:false},
  {id:'canvas',html:'<canvas width="150" height="26"></canvas>',app:false,offline:false},
  {id:'editable-true',html:'<div contenteditable="true"><span>可编辑true</span></div>',app:false,offline:false},
  {id:'editable-empty',html:'<div contenteditable>空值可编辑</div>',app:true,offline:true},
  {id:'editable-plain',html:'<div contenteditable="plaintext-only">纯文本编辑</div>',app:true,offline:true},
  {id:'editable-false',html:'<div contenteditable="false">不可编辑</div>',app:true,offline:true},
  {id:'onclick',html:'<div onclick="window.actionCount=(window.actionCount||0)+1"><span>行内点击处理</span></div>',app:false,offline:false},
  {id:'property-handler',html:'<div data-property-handler>属性点击处理</div>',app:true,offline:true},
  {id:'listener',html:'<div data-click-listener>事件监听处理</div>',app:true,offline:true},
  {id:'role-button',html:'<div role="button"><span>button角色</span></div>',app:false,offline:false},
  {id:'role-link',html:'<div role="link">link角色</div>',app:false,offline:false},
  {id:'role-menuitem',html:'<div role="menuitem">menuitem角色</div>',app:false,offline:false},
  {id:'role-tab',html:'<div role="tab">tab角色</div>',app:false,offline:false},
  {id:'role-checkbox',html:'<div role="checkbox">未列出的checkbox角色</div>',app:true,offline:true},
  {id:'pointer',html:'<div style="cursor:pointer">手型光标</div>',app:false,offline:true},
  {id:'ancestor-pointer',html:'<div style="cursor:pointer"><span>祖先手型光标</span></div>',app:false,offline:true},
  {id:'prevented',html:'<div data-prevent-click>阻止默认行为</div>',app:false,offline:true},
  {id:'stopped',html:'<div data-stop-click>阻止传播</div>',app:false,offline:false},
  {id:'shift',html:'<div>Shift点击普通文字</div>',app:false,offline:true,modifiers:8},
]
export function syntheticSlideHtml(number=1){
  const cases=number===1?slideClickCases.map(item=>'<section data-case="'+item.id+'">'+item.html+'</section>').join(''):'<h1>合成第'+number+'页</h1><p id="ordinary">普通翻页区域</p>'
  const external=number===3?'<script defer src="'+syntheticCdnUrl+'"></script><p id="external-slot">外部在线部件</p>':''
  return '<!doctype html><html><head><meta charset="utf-8"><title>合成幻灯片 '+number+'</title><style>body{margin:20px;font:14px Arial;background:white;color:black;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}section{height:48px;min-width:0;display:grid;align-items:center;border:1px solid gray}section>*{max-width:100%;box-sizing:border-box}input,textarea,select{max-width:150px}audio{width:180px;height:28px}canvas,video{background:lightgray}h1,p{grid-column:1/-1}</style></head><body>'+cases+external+'<script>addEventListener("message",event=>{if(event.source===parent&&typeof event.data?.syntheticSlideProbe==="string")window.syntheticSlideProbe=event.data.syntheticSlideProbe;if(event.source===parent&&["connect","hicanvas-slides-connect"].includes(event.data?.type)&&event.ports[0])window.syntheticConnection={data:event.data,port:event.ports[0]}});document.addEventListener("click",event=>console.log("__SLIDES_INPUT__"+JSON.stringify({case:event.target.closest?.("[data-case]")?.dataset.case||null,trusted:event.isTrusted,shift:event.shiftKey})),true);const property=document.querySelector("[data-property-handler]");if(property)property.onclick=()=>{window.actionCount=(window.actionCount||0)+1};document.querySelector("[data-click-listener]")?.addEventListener("click",()=>{window.actionCount=(window.actionCount||0)+1});document.querySelector("[data-prevent-click]")?.addEventListener("click",event=>event.preventDefault());document.querySelector("[data-stop-click]")?.addEventListener("click",event=>event.stopPropagation());window.syntheticSendSlideFlood=(junk=false)=>{const c=window.syntheticConnection,d=c.data;for(let i=0;i<1000;i++)c.port.postMessage(d.protocol?{protocol:d.protocol,instance:d.instance,generation:d.generation,type:junk?"unknown":"slide-nav",value:"next"}:{version:1,generation:d.generation,type:junk?"unknown":"slide-nav",value:"next"});if(junk)c.port.postMessage(d.protocol?{protocol:d.protocol,instance:d.instance,generation:d.generation,type:"slide-nav",value:"next"}:{version:1,generation:d.generation,type:"slide-nav",value:"next"});return 1000};window.slideNumber='+number+';window.slideLoaded=true;</script></body></html>'
}
