// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Box, onDragFromToolbarToCreateShape } from "tldraw"
import { copyCowartImageToClipboard, hasCowartWidgetBridge } from "../cowartClient.js"
import { AI_IMAGE_TOOL_ID, AI_IMAGE_HOLDER_LABEL, AI_DRAFT_TOOL_ID, AI_DRAFT_HOLDER_LABEL, AI_FILM_TOOL_ID, AI_FILM_LABEL, AI_SLIDES_TOOL_ID, AI_SLIDES_LABEL, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, AI_DRAFT_HOLDER_DEFAULT_W, AI_DRAFT_HOLDER_DEFAULT_H, AI_SLIDES_DEFAULT_W, AI_SLIDES_DEFAULT_H, ANNOTATION_TOOL_ID, ANNOTATION_TOOL_LABEL, aiImageToolIcon, aiHtmlToolIcon, aiFilmToolIcon, aiSlidesToolIcon, annotationToolIcon } from './configuration.jsx'
import { isCowartHtmlDraftEmbedShape, isImageShape } from './holderMeta.jsx'
import { createAiImageHolderShape, createAiImageHolderAtViewportCenter, createAiDraftHolderShape, createAiDraftHolderAtViewportCenter, createAiFilmHolderShape, createAiFilmHolderAtViewportCenter, createAiSlidesShape, createAiSlidesAtViewportCenter } from './holderCreation.jsx'
import { unlockGlobalToolLock } from './annotationEditing.jsx'
import { getAnnotationEditExportPixelRatio } from './annotationRequests.jsx'
import { renderCowartHtmlDraftCanvas } from './htmlCapture.jsx'
import { downloadCowartImageShape } from './exports.jsx'
const cowartUiOverrides = {
  actions(editor, actions, helpers) {
    const canvasActions = Object.fromEntries(Object.entries(actions).filter(([id]) => !['change-page-prev', 'change-page-next', 'move-to-new-page'].includes(id)))
    const defaultDownloadOriginal = actions['download-original']
    const defaultCopyAsPng = actions['copy-as-png']
    return {
      ...canvasActions,
      'copy-as-png': {
        ...defaultCopyAsPng,
        async onSelect(source) {
          // Codex widgets run inside an iframe where the host can deny the browser Clipboard API.
          // Render in the widget, then hand the PNG to the local MCP process for the native write.
          if (!hasCowartWidgetBridge()) {
            return defaultCopyAsPng.onSelect(source)
          }
          let shapeIds = editor.getSelectedShapeIds()
          if (shapeIds.length === 0) {
            shapeIds = Array.from(editor.getCurrentPageShapeIds())
          }
          if (shapeIds.length === 0) return
          try {
            const onlyShape = shapeIds.length === 1 ? editor.getShape(shapeIds[0]) : null
            let image
            if (isCowartHtmlDraftEmbedShape(onlyShape)) {
              const bounds = new Box(
                0,
                0,
                Number(onlyShape.props?.w) || 1,
                Number(onlyShape.props?.h) || 1
              )
              image = await renderCowartHtmlDraftCanvas(
                onlyShape,
                getAnnotationEditExportPixelRatio(bounds)
              )
            } else {
              image = await editor.toImageDataUrl(shapeIds, { format: 'png' })
            }
            const result = await copyCowartImageToClipboard({
              dataUrl: image.url,
              mimeType: 'image/png'
            })
            helpers.addToast({
              title: 'PNG 已复制',
              description: `${result.width} × ${result.height}，可直接粘贴到其他应用。`,
              severity: 'success'
            })
          } catch (error) {
            console.error(error)
            helpers.addToast({
              id: 'copy-fail',
              title: '复制失败',
              description: error instanceof Error ? error.message : '无法复制图像。',
              severity: 'error'
            })
          }
        }
      },
      'download-original': {
        ...defaultDownloadOriginal,
        async onSelect(source) {
          if (!hasCowartWidgetBridge()) {
            return defaultDownloadOriginal.onSelect(source)
          }
          const imageShapes = editor.getSelectedShapes().filter(isImageShape)
          if (!imageShapes.length) return
          try {
            const results = []
            for (const imageShape of imageShapes) {
              results.push(await downloadCowartImageShape(editor, imageShape))
            }
            helpers.addToast({
              title: imageShapes.length === 1 ? '图片已下载' : `${imageShapes.length} 张图片已下载`,
              description: results[0]?.filePath || '文件已保存到系统下载目录。',
              severity: 'success'
            })
          } catch (error) {
            console.error(error)
            helpers.addToast({
              title: '图片下载失败',
              description: error instanceof Error ? error.message : '请稍后重试。',
              severity: 'error'
            })
          }
        }
      }
    }
  },
  translations: {
    en: {
      'tool.ai-image': AI_IMAGE_HOLDER_LABEL,
      'tool.ai-draft': AI_DRAFT_HOLDER_LABEL,
      'tool.ai-film': AI_FILM_LABEL,
      'tool.ai-slides': AI_SLIDES_LABEL,
      'tool.cowart-annotation': ANNOTATION_TOOL_LABEL
    },
    'zh-cn': {
      'tool.ai-image': AI_IMAGE_HOLDER_LABEL,
      'tool.ai-draft': AI_DRAFT_HOLDER_LABEL,
      'tool.ai-film': AI_FILM_LABEL,
      'tool.ai-slides': AI_SLIDES_LABEL,
      'tool.cowart-annotation': ANNOTATION_TOOL_LABEL,
      'page-menu.max-pages-reached': '已达到页面数量上限',
      'page-menu.resize': '调整页面列表大小'
    }
  },
  tools(editor, tools) {
    return {
      ...tools,
      arrow: {
        ...tools.arrow,
        kbd: undefined
      },
      [AI_IMAGE_TOOL_ID]: {
        id: AI_IMAGE_TOOL_ID,
        label: 'tool.ai-image',
        icon: aiImageToolIcon,
        kbd: 'a',
        onSelect() {
          createAiImageHolderAtViewportCenter(editor)
        },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) =>
              createAiImageHolderShape(editor, id, {
                props: {
                  w: AI_IMAGE_HOLDER_DEFAULT_W * scale,
                  h: AI_IMAGE_HOLDER_DEFAULT_H * scale
                }
              }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: {
          cowartTool: 'ai-image-holder'
        }
      },
      [AI_DRAFT_TOOL_ID]: {
        id: AI_DRAFT_TOOL_ID,
        label: 'tool.ai-draft',
        icon: aiHtmlToolIcon,
        onSelect() {
          createAiDraftHolderAtViewportCenter(editor)
        },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) =>
              createAiDraftHolderShape(editor, id, {
                props: {
                  w: AI_DRAFT_HOLDER_DEFAULT_W * scale,
                  h: AI_DRAFT_HOLDER_DEFAULT_H * scale
                }
              }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: {
          cowartTool: 'ai-draft-holder'
        }
      },
      [AI_FILM_TOOL_ID]: {
        id: AI_FILM_TOOL_ID,
        label: 'tool.ai-film',
        icon: aiFilmToolIcon,
        onSelect() { createAiFilmHolderAtViewportCenter(editor) },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) => createAiFilmHolderShape(editor, id, {
              props: { w: AI_DRAFT_HOLDER_DEFAULT_W * scale, h: AI_DRAFT_HOLDER_DEFAULT_H * scale }
            }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: { cowartTool: 'ai-film-holder' }
      },
      [AI_SLIDES_TOOL_ID]: {
        id: AI_SLIDES_TOOL_ID,
        label: 'tool.ai-slides',
        icon: aiSlidesToolIcon,
        onSelect() {
          createAiSlidesAtViewportCenter(editor)
        },
        onDragStart(source, info) {
          const scale = editor.getResizeScaleFactor()
          onDragFromToolbarToCreateShape(editor, info, {
            createShape: (id) =>
              createAiSlidesShape(editor, id, {
                props: {
                  w: AI_SLIDES_DEFAULT_W * scale,
                  h: AI_SLIDES_DEFAULT_H * scale
                }
              }),
            onDragEnd: (id) => editor.select(id)
          })
        },
        meta: {
          cowartTool: 'ai-slides'
        }
      },
      [ANNOTATION_TOOL_ID]: {
        id: ANNOTATION_TOOL_ID,
        label: 'tool.cowart-annotation',
        icon: annotationToolIcon,
        kbd: 'c',
        onSelect() {
          unlockGlobalToolLock(editor)
          editor.setCurrentTool(ANNOTATION_TOOL_ID)
        },
        meta: {
          cowartTool: 'annotation'
        }
      }
    }
  }
}
export { cowartUiOverrides }
