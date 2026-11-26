import {contentHostEnabled} from '../../renderer/index.js'
// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Box } from "tldraw"
import { renderCowartFilmMp4 } from "../filmExport.js"
import { getFilmOptions } from "../filmConfig.js"
import { filmAnalyticsContext, withFilmExportAnalytics } from "../filmAnalytics.js"
import { trackFilmExport } from "../analytics.js"
import { downloadCowartFile, hasCowartWidgetBridge } from "../cowartClient.js"
import { AI_SLIDES_LABEL, PAGE_ASSETS_ROUTE } from './configuration.jsx'
import { readFileAsDataUrl } from './readFileAsDataUrl.jsx'
import { cowartHtmlDraftAssetUrlFromVirtualUrl, hydrateCowartHtmlDraftLocalImages } from './assets.jsx'
import { isCowartFilmShape, isAiSlidesShape, isCowartHtmlDraftEmbedShape } from './holderMeta.jsx'
import { getAnnotationEditExportPixelRatio } from './annotationRequests.jsx'
import { renderCowartHtmlDraftCanvas, htmlDraftExportFileName, textDataUrl, readCowartHtmlDraftContent, readCowartImageDataUrl } from './htmlCapture.jsx'
import { getAiSlidesItems } from './slidesLayout.jsx'
function cowartSlidesExportName(slidesShape) {
  const name = String(slidesShape?.props?.name || '').trim()
  return name || AI_SLIDES_LABEL
}
function escapeHtmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
function cowartImageSlideHtml(dataUrl, title) {
  const safeDataUrl = JSON.stringify(dataUrl).replaceAll('<', '\\u003c')
  const safeTitle = JSON.stringify(title).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtmlText(title)}</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
    body{display:grid;place-items:center}img{display:block;width:100%;height:100%;object-fit:contain}
  </style>
</head>
<body><img id="cowart-slide-image" alt=""></body>
<script>
  document.title=${safeTitle};
  document.getElementById('cowart-slide-image').src=${safeDataUrl};
</script>
</html>`
}
function cowartSlidesPlayerHtml(slidesName, pageFiles, isolatedScript) {
  const safeTitle = JSON.stringify(slidesName).replaceAll('<', '\\u003c')
  const safePages = JSON.stringify(pageFiles).replaceAll('<', '\\u003c')
  const legacy = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtmlText(slidesName)} · Play</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif}
    .stage{position:fixed;inset:0;overflow:hidden;background:#000;cursor:pointer}
    .canvas{position:absolute;width:1024px;height:576px;overflow:hidden;transform-origin:top left;background:#000}
    iframe{display:block;width:1024px;height:576px;border:0;background:#fff}
    .controls{position:fixed;z-index:2;top:16px;left:50%;display:flex;align-items:center;gap:2px;padding:4px;color:#fff;background:#0009;border-radius:9px;transform:translateX(-50%);backdrop-filter:blur(14px)}
    button{display:grid;width:26px;height:26px;padding:0;place-items:center;color:#fff;background:transparent;border:0;border-radius:8px;cursor:pointer;font:18px/1 system-ui,sans-serif}
    button:hover{background:#ffffff26}button:disabled{opacity:.35;cursor:default}.count{min-width:42px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
  </style>
</head>
<body>
  <main class="stage" id="stage"><div class="canvas" id="canvas"><iframe id="slide" title="Slides player"></iframe></div></main>
  <nav class="controls" id="controls" aria-label="翻页控制"><button id="prev" aria-label="上一页">‹</button><span class="count" id="count"></span><button id="next" aria-label="下一页">›</button></nav>
  <script>
    const title=${safeTitle}, pages=${safePages}; let index=0;
    const stage=document.getElementById('stage'), canvas=document.getElementById('canvas'), frame=document.getElementById('slide'), count=document.getElementById('count'), prev=document.getElementById('prev'), next=document.getElementById('next');
    document.title=title+' · Play';
    function layout(){const scale=Math.min(innerWidth/1024,innerHeight/576);canvas.style.left=(innerWidth-1024*scale)/2+'px';canvas.style.top=(innerHeight-576*scale)/2+'px';canvas.style.transform='scale('+scale+')'}
    function show(value){index=Math.max(0,Math.min(pages.length-1,value));frame.src=pages[index];count.textContent=(index+1)+' / '+pages.length;prev.disabled=index===0;next.disabled=index===pages.length-1}
    function go(delta){show(index+delta)}
    function isInteractiveClick(event){const target=event.target;return !!target?.closest?.('a[href],button,input,select,textarea,summary,video,audio,canvas,[contenteditable="true"],[onclick],[role="button"],[role="link"],[role="menuitem"],[role="tab"]')}
    function handleKey(event){if(event.key==='ArrowLeft'){event.preventDefault();go(-1)}else if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();go(1)}}
    function bindSlideEvents(){try{const doc=frame.contentDocument;if(!doc)return;doc.addEventListener('click',event=>{if(!isInteractiveClick(event))go(1)});doc.addEventListener('keydown',handleKey)}catch(_error){}}
    frame.addEventListener('load',bindSlideEvents);
    stage.addEventListener('click',()=>go(1));
    document.getElementById('controls').addEventListener('click',event=>event.stopPropagation());
    prev.onclick=()=>go(-1);next.onclick=()=>go(1);
    addEventListener('keydown',handleKey);addEventListener('resize',layout);
    layout();
    show(0);
  </script>
</body>
</html>`
  if (!isolatedScript) return legacy
  const bootstrap = isolatedScript + `
    document.title=${safeTitle}+' · Play';
    const canvas=document.getElementById('canvas');
    function layout(){const scale=Math.min(innerWidth/1024,innerHeight/576);canvas.style.left=(innerWidth-1024*scale)/2+'px';canvas.style.top=(innerHeight-576*scale)/2+'px';canvas.style.transform='scale('+scale+')'}
    addEventListener('resize',layout);layout();
    hiCanvasOfflineSlides({pages:${safePages}});
  `
  return legacy.replace(/<script>[\s\S]*<\/script>/,()=>'<script>'+bootstrap.replaceAll('</script','<\\/script')+'</script>')
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}
async function downloadCowartImageShape(editor, imageShape) {
  const asset = imageShape?.props?.assetId ? editor.getAsset(imageShape.props.assetId) : null
  const sourceUrl = asset?.props?.src
  if (!asset || !sourceUrl) throw new Error('当前图片没有可下载的原始文件。')
  const fileName = asset.props.name || 'cowart-image.png'
  if (sourceUrl.startsWith(PAGE_ASSETS_ROUTE)) {
    return downloadCowartFile({ assetUrl: sourceUrl, fileName })
  }
  let dataUrl = sourceUrl
  if (!sourceUrl.startsWith('data:')) {
    const resolvedUrl = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
    if (!resolvedUrl) throw new Error('无法读取当前图片的原始文件。')
    const response = await window.fetch(resolvedUrl)
    if (!response.ok) throw new Error(`读取当前图片失败：${response.status}`)
    dataUrl = await readFileAsDataUrl(await response.blob())
  }
  return downloadCowartFile({
    dataUrl,
    fileName,
    mimeType: asset.props.mimeType || undefined
  })
}
async function exportCowartHtmlDraft(editor, draftShapeId, format) {
  const shape = editor.getShape(draftShapeId)
  if (format === 'html') {
    const source = await readCowartHtmlDraftContent(shape)
    const htmlContent = await hydrateCowartHtmlDraftLocalImages(source)
    const fileName = htmlDraftExportFileName(shape, 'html')
    const dataUrl = textDataUrl(htmlContent, 'text/html')
    if (hasCowartWidgetBridge()) {
      return downloadCowartFile({ dataUrl, fileName, mimeType: 'text/html' })
    }
    downloadDataUrl(dataUrl, fileName)
    return { fileName }
  }
  const bounds = new Box(0, 0, Number(shape?.props?.w) || 1, Number(shape?.props?.h) || 1)
  const exportResult = await renderCowartHtmlDraftCanvas(
    shape,
    getAnnotationEditExportPixelRatio(bounds)
  )
  const fileName = htmlDraftExportFileName(shape, 'png')
  if (hasCowartWidgetBridge()) {
    return downloadCowartFile({
      dataUrl: exportResult.url,
      fileName,
      mimeType: 'image/png'
    })
  }
  downloadDataUrl(exportResult.url, fileName)
  return { fileName }
}
async function exportCowartFilm(editor, draftShapeId, onProgress, signal) {
  const shape = editor.getShape(draftShapeId)
  if (!isCowartFilmShape(shape)) throw new Error('请选择 AI 影片。')
  return withFilmExportAnalytics(async () => {
    // A separate iframe renders from zero without changing the preview or edits.
    const html = await hydrateCowartHtmlDraftLocalImages(await readCowartHtmlDraftContent(shape))
    const blob = await renderCowartFilmMp4({ html, width: Number(shape.props.w), height: Number(shape.props.h),
      duration: getFilmOptions(shape).duration, onProgress, signal, sourceUrl: shape.props.url })
    signal?.throwIfAborted()
    const fileName = htmlDraftExportFileName(shape, 'mp4')
    if (hasCowartWidgetBridge()) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      signal?.throwIfAborted()
      return downloadCowartFile({ dataUrl, fileName, mimeType: 'video/mp4' })
    }
    const url = URL.createObjectURL(blob)
    downloadDataUrl(url, fileName)
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    return { fileName }
  }, filmAnalyticsContext(shape), trackFilmExport, signal)
}
async function exportCowartSlides(editor, slidesShapeId, format) {
  const slidesShape = editor.getShape(slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) throw new Error('请选择一个 AI 幻灯片。')
  const items = getAiSlidesItems(editor, slidesShapeId)
  if (!items.length) throw new Error('当前 AI 幻灯片还没有可导出的页面。')
  let directoryName = cowartSlidesExportName(slidesShape)
  const results = []
  if (format === 'image') {
    for (const [index, item] of items.entries()) {
      let dataUrl
      if (isCowartHtmlDraftEmbedShape(item)) {
        const bounds = new Box(0, 0, Number(item.props?.w) || 1, Number(item.props?.h) || 1)
        dataUrl = (await renderCowartHtmlDraftCanvas(item, getAnnotationEditExportPixelRatio(bounds))).url
      } else {
        const exportResult = await editor.toImageDataUrl([item.id], {
          background: true,
          format: 'png',
          padding: 0,
          pixelRatio: 1
        })
        dataUrl = exportResult.url
      }
      const result = await downloadCowartFile({
        dataUrl,
        directoryName,
        fileName: `page-${String(index + 1).padStart(2, '0')}.png`,
        mimeType: 'image/png',
        overwrite: true,
        uniqueDirectory: index === 0
      })
      if (index === 0 && result.directoryName) directoryName = result.directoryName
      results.push(result)
    }
    return { directoryName, filePath: results[0]?.directoryPath, results }
  }
  let prepared
  if (await contentHostEnabled()) {
    const pages=[]
    let bytes=0
    for (const [index,item] of items.entries()) {
      const html=isCowartHtmlDraftEmbedShape(item)?await readCowartHtmlDraftContent(item):cowartImageSlideHtml(await readCowartImageDataUrl(editor,item),`${directoryName} · ${index+1}`)
      bytes+=new TextEncoder().encode(html).length
      if(pages.length>=200||bytes>20*1024*1024)throw new Error('离线幻灯片超过200页或20 MiB原始HTML。')
      pages.push({html,sourceUrl:isCowartHtmlDraftEmbedShape(item)?cowartHtmlDraftAssetUrlFromVirtualUrl(item.meta?.cowartHtmlDraftAssetUrl)||cowartHtmlDraftAssetUrlFromVirtualUrl(item.props.url)||undefined:undefined})
    }
    const response=await window.fetch('/api/content-host/slides-export',{method:'POST',credentials:'same-origin',mode:'same-origin',redirect:'error',headers:{'content-type':'application/json','x-hicanvas-client':'1'},body:JSON.stringify({pages,conversationId:new URLSearchParams(location.search).get('conversation')||'legacy'})})
    prepared=await response.json()
    if(!response.ok)throw new Error(prepared.error||'离线幻灯片资源打包失败。')
  }
  const pageFiles = []
  for (const [index, item] of items.entries()) {
    const fileName = `page-${String(index + 1).padStart(2, '0')}.html`
    let htmlContent
    if(prepared)htmlContent=prepared.pages[index]
    else if (isCowartHtmlDraftEmbedShape(item)) {
      htmlContent = await hydrateCowartHtmlDraftLocalImages(await readCowartHtmlDraftContent(item))
    } else {
      const imageDataUrl = await readCowartImageDataUrl(editor, item)
      htmlContent = cowartImageSlideHtml(imageDataUrl, `${directoryName} · ${index + 1}`)
    }
    pageFiles.push(`pages/${fileName}`)
    const result = await downloadCowartFile({
      dataUrl: prepared?await readFileAsDataUrl(new Blob([htmlContent],{type:'text/html'})):textDataUrl(htmlContent, 'text/html'),
      directoryName,
      subdirectory: 'pages',
      fileName,
      mimeType: 'text/html',
      overwrite: true,
      uniqueDirectory: index === 0
    })
    if (index === 0 && result.directoryName) directoryName = result.directoryName
    results.push(result)
  }
  results.push(await downloadCowartFile({
    dataUrl: textDataUrl(cowartSlidesPlayerHtml(directoryName, pageFiles, prepared?.playerScript), 'text/html'),
    directoryName,
    fileName: 'Play.html',
    mimeType: 'text/html',
    overwrite: true
  }))
  return { directoryName, filePath: results.at(-1)?.directoryPath, results, ...prepared?{externalResources:prepared.externalResources}:{} }
}
export { cowartSlidesExportName, escapeHtmlText, cowartImageSlideHtml, cowartSlidesPlayerHtml, downloadDataUrl, downloadCowartImageShape, exportCowartHtmlDraft, exportCowartFilm, exportCowartSlides }
