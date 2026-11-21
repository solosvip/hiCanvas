// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import aiHtmlToolIconRaw from "../assets/ai-html.svg?raw"
import aiImageToolIconRaw from "../assets/ai-image.svg?raw"
import aiSlidesToolIconRaw from "../assets/ai-slides.svg?raw"
import aiFilmToolIconRaw from "../assets/ai-film.svg?raw"
import annotationToolIconRaw from "../assets/tool-comment.svg?raw"
const SELECTION_STATE_ELEMENT_ID = 'cowart-selection-state'
const PAGE_ASSETS_ROUTE = '/page-assets/'
const GLOBAL_ASSETS_ROUTE = '/assets/'
const AI_IMAGE_TOOL_ID = 'ai-image'
const AI_IMAGE_HOLDER_LABEL = 'AI 图片'
const AI_DRAFT_TOOL_ID = 'ai-draft'
const AI_DRAFT_HOLDER_LABEL = 'AI HTML'
const AI_FILM_TOOL_ID = 'ai-film'
const AI_FILM_LABEL = 'AI 影片'
const COWART_FILM_STATUS_EVENT = 'cowart:film-status'
const AI_SLIDES_TOOL_ID = 'ai-slides'
const AI_SLIDES_LABEL = 'AI Slides'
const AI_SLIDES_PRESENT_LABEL = '演示 Slides'
const COWART_EXPORT_LABEL = '导出'
const COWART_EXPORT_IMAGE_LABEL = '导出为图片'
const COWART_EXPORT_HTML_LABEL = '导出为 HTML'
const AI_SLIDES_GAP = 32
const COWART_OPEN_SLIDES_EVENT = 'cowart:open-slides'
const AI_IMAGE_HOLDER_DEFAULT_W = 512
const AI_IMAGE_HOLDER_DEFAULT_H = 683
const AI_DRAFT_HOLDER_DEFAULT_W = 1024
const AI_DRAFT_HOLDER_DEFAULT_H = 576
const AI_SLIDES_PADDING = 12
const AI_SLIDES_DEFAULT_W = AI_DRAFT_HOLDER_DEFAULT_W + AI_SLIDES_PADDING * 2
const AI_SLIDES_DEFAULT_H = AI_DRAFT_HOLDER_DEFAULT_H + AI_SLIDES_PADDING * 2
const AI_IMAGE_SIZE_MIN = 16
const AI_IMAGE_SIZE_MAX = 8192
const AI_IMAGE_GENERATION_PANEL_OFFSET = 14
const AI_IMAGE_GENERATION_PANEL_MIN_W = 520
const AI_IMAGE_GENERATION_PANEL_MAX_W = 640
const AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN = 16
const AI_IMAGE_GENERATION_PANEL_ESTIMATED_H = 226
const AI_IMAGE_GENERATION_STATUS_RESET_MS = 2200
const AI_IMAGE_REFERENCE_MAX_FILES = 10
const COWART_HTML_DRAFT_URL_ORIGIN = 'http://cowart.local'
const COWART_HTML_DRAFT_EMBED_TYPE = 'cowart_html_draft'
const AI_IMAGE_ASPECT_PRESETS = [
  { id: '1-1', label: '1:1', w: 512, h: 512 },
  { id: '3-2', label: '3:2', w: 768, h: 512 },
  { id: '2-3', label: '2:3', w: 512, h: 768 },
  { id: '4-3', label: '4:3', w: 683, h: 512 },
  { id: '3-4', label: '3:4', w: 512, h: 683 },
  { id: '16-9', label: '16:9', w: 1024, h: 576 },
  { id: '9-16', label: '9:16', w: 512, h: 910 }
]
const ANNOTATION_TOOL_ID = 'cowart-annotation'
const ANNOTATION_TOOL_LABEL = '标注'
const ANNOTATION_DEFAULT_COLOR = 'red'
const ANNOTATION_MIN_LENGTH = 8
const ANNOTATION_BEND_RATIO = 0.12
const ANNOTATION_MIN_BEND = 16
const ANNOTATION_MAX_BEND = 48
const ANNOTATION_LABEL_POSITION = 0
const ANNOTATION_SELECT_TEXT_MAX_ATTEMPTS = 8
const ANNOTATION_SELECT_TEXT_SETTLE_ATTEMPTS = 4
const ANNOTATION_EDIT_TOOL_LABEL = '按标注修改'
const ANNOTATION_HTML_TOOL_LABEL = '按标注生成 Html'
const COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE =
  '本请求来自已经打开的 Cowart 画布；请复用当前画布，不要调用 render_cowart_canvas_widget，除非用户明确要求重新打开或刷新。'
const ANNOTATION_EDIT_PROMPT = [
  '[@Cowart](plugin://cowart@cowart-github) 按标注修改',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据这张 Cowart 截图里的标注修改当前选中的图片：',
  '- 截图包含当前图片，以及连到图片里或图片附近的标注箭头和标注文字。',
  '- 请把标注文字当作修改要求，生成一张新的干净图片。',
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏带进最终图片。',
  '- 保留原图和原标注不动，把新图放到原图旁边。'
].join('\n')
const AI_HTML_LOCAL_ASSET_PROMPT_LINES = [
  '- HTML 中不要引用 http:// 或 https:// 远程图片；Cowart widget 的 CSP 不允许 HTML iframe 直接加载这些资源。',
  '- 如果 HTML 需要图片，先确定目标 shape 所在的 page，再把图片下载到当前项目的 canvas/pages/<page-id-without-page-prefix>/assets/ 目录。',
  '- HTML 内必须使用 /page-assets/<page-id-without-page-prefix>/<filename> 引用这些本地图片；不要使用 file:// URL 或绝对文件路径。',
  '- Cowart 会在将 HTML 放入 iframe 前，通过 read_cowart_page_asset 把 /page-assets/ 图片转换为 data: URL。'
]
const ANNOTATION_HTML_PROMPT = [
  '[@Cowart](plugin://cowart@cowart-github) 按标注生成 AI HTML',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据这张 Cowart 截图里的当前图片和周围标注，生成一个新的单文件 HTML 草稿：',
  '- 截图包含当前选中的图片，以及连到图片里或图片附近的标注箭头和标注文字。',
  '- 请把当前图片作为主体、构图和视觉风格参考，把标注文字作为 HTML 的修改或生成要求。',
  '- 这不是图片生成任务：不要调用 imagegen，不要调用 insert_cowart_image。',
  '- 请生成完整可运行的 HTML 文档，CSS 和 JS 尽量内联，适合直接放进 iframe 预览。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏写进 HTML。',
  '- 保留原图片和原标注不动，把新 HTML 草稿放到原图片右侧。'
].join('\n')
const ANNOTATION_EDIT_EXPORT_PADDING = 32
const ANNOTATION_EDIT_NEAR_MARGIN_MIN = 160
const ANNOTATION_EDIT_NEAR_MARGIN_MAX = 720
const ANNOTATION_EDIT_RELATED_TEXT_MARGIN = 120
const ANNOTATION_EDIT_STATUS_RESET_MS = 2200
const ANNOTATION_EDIT_MAX_EXPORT_DIMENSION = 4096
const ANNOTATION_EDIT_MAX_EXPORT_PIXELS = 16_000_000
const ANNOTATION_EDIT_COLORS = new Set(['red', 'yellow', 'orange'])
const HTML_DRAFT_CAPTURE_DELAY_MS = 2000
const HTML_DRAFT_ASSET_RETRY_DELAYS_MS = [0, 200, 600, 1400]
const HTML_DRAFT_DOM_EDIT_LABEL = '编辑文本'
const HTML_DRAFT_DOM_EDIT_DONE_LABEL = '完成编辑'
const HTML_DRAFT_ANNOTATION_EDIT_LABEL = '按标注修改'
const HTML_DRAFT_ANNOTATION_IMAGE_LABEL = '按标注生图'
const HTML_DRAFT_ANNOTATION_EDIT_PROMPT = [
  '[@Cowart](plugin://cowart@cowart-github) 按标注修改 AI HTML',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据这张 Cowart 截图里的标注修改当前选中的 HTML 草稿：',
  '- 截图包含当前 HTML 草稿，以及草稿周围的标注箭头和标注文字。',
  '- 请把标注文字当作修改要求，并以现有 HTML 源文件为基础修改。',
  '- 不要生成 bitmap，不要调用 imagegen，也不要调用 insert_cowart_image。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏写进 HTML。',
  '- 保留原 HTML 草稿和原标注不动，创建一个修改后的新 HTML 草稿并放到原草稿右侧。',
  '- 不要覆盖原草稿的 HTML 文件、shape 或画布记录。'
].join('\n')
const HTML_DRAFT_ANNOTATION_IMAGE_PROMPT = [
  '[@Cowart](plugin://cowart@cowart-github) 按标注生图',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请使用内置 imagegen skill，根据这张 Cowart 截图里的 HTML 草稿和标注生成一张新的干净位图：',
  '- 截图包含当前 HTML 草稿，以及草稿周围的标注箭头和标注文字。',
  '- 请把标注文字当作生成要求，并保留草稿的主体、构图和纵横比，除非标注明确要求改变。',
  '- 不要修改 HTML，不要调用 insert_cowart_html_draft。',
  '- 不要把标注箭头、标注文字、蓝色选框或工具栏带进最终图片。',
  '- 保留原 HTML 草稿和原标注不动，把生成的图片放到草稿右侧。'
].join('\n')
const AI_IMAGE_GENERATION_PROMPT_PREFIX = [
  '[@Cowart](plugin://cowart@cowart-github) 生成图片',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据下面的 prompt 生成一张图片，并替换当前选中的 Cowart AI 图片框；最终画布里应留下普通图片形状，不保留 AI 图片框容器。',
  '默认生成一张；如果用户在 prompt 中明确要求多张图片，则用户要求的数量优先于上面的单数措辞。',
  '多张时必须分别生成对应数量的独立 bitmap，并作为多个普通图片形状从左到右平铺在画布上；第一张替换当前 AI 图片框，后续图片放在上一张图片右侧。',
  '插入多张图片时，第一张按默认流程替换 AI 图片框；之后每次使用上一张插入结果返回的 shapeId 作为 anchorShapeId，并设置 replaceAiImageHolder: false、matchAnchor: false、placement: "right"。',
  '不要把多张图片合成一张拼图、画册或带分页的单一产物。',
  '如果附带一张或多张参考图，请把参考图作为视觉参考；不要把参考图文件名或任何界面元素画进最终图片。',
  '不需要选择生图模型，使用 Codex 当前可用的图片生成能力。'
].join('\n')
const AI_DRAFT_GENERATION_PROMPT_PREFIX = [
  '[@Cowart](plugin://cowart@cowart-github) 生成 AI HTML',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据下面的 prompt 生成一个单文件 HTML 草稿，并把它嵌入当前选中的 Cowart AI HTML 框。',
  '默认生成一个 HTML；如果用户在 prompt 中明确要求多个 HTML、多个方案或多张页面，则用户要求的数量优先于上面的单数措辞。',
  '多个 HTML 必须分别生成为对应数量的完整、独立、可运行的单文件 HTML，并作为多个 HTML embed 从左到右平铺在画布上；第一个替换当前 AI HTML 框，后续 HTML 放在上一个 HTML 右侧。',
  '不要在一个 AI HTML 里制作多页、分页、选项卡、轮播或幻灯片来代替多个独立 HTML；只有用户明确要求 AI Slides 时才使用多页 Slides 语义。',
  '这不是图片生成任务：不要生成 bitmap，不要调用 insert_cowart_image。',
  '请生成完整可运行的 HTML 文档，CSS 和 JS 尽量内联，适合直接放进 iframe 预览。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '完成后调用 Cowart MCP 工具 insert_cowart_html_draft，把 htmlContent 写入当前 page 的 canvas/pages/<page-id>/assets/，并替换对应 AI HTML 框为 HTML embed。'
].join('\n')
const AI_SLIDES_GENERATION_PROMPT_PREFIX = [
  '[@Cowart](plugin://cowart@cowart-github) 生成 AI Slides',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据下面的 prompt 生成一套视觉与叙事连贯的 AI Slides。',
  '每一页都必须是完整、独立、可运行的单文件 HTML；CSS 和 JS 尽量内联。',
  '每页画布固定为 1024 x 576（16:9），不要生成 bitmap，不要调用 insert_cowart_image。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES
].join('\n')
const AI_SLIDES_ANNOTATION_EDIT_PROMPT = [
  '[@Cowart](plugin://cowart@cowart-github) 按标注修改 AI Slides',
  COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE,
  '',
  '请根据 Cowart 截图中的原 AI Slides 和周围标注，生成一套修改后的新 Slides。',
  '原 AI Slides 和标注必须保持不动；新的目标 AI Slides 已经创建在原 Slides 下方，请只把修改后的页面加入新 Slides。',
  '每一页都必须是完整、独立、可运行的单文件 HTML；CSS 和 JS 尽量内联。',
  ...AI_HTML_LOCAL_ASSET_PROMPT_LINES,
  '每页画布固定为 1024 x 576（16:9），不要生成 bitmap，不要调用 insert_cowart_image。'
].join('\n')
const aiImageToolIconSvg = aiImageToolIconRaw.replaceAll('black', 'currentColor')
const aiImageToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiImageToolIconSvg }}
  />
)
const aiHtmlToolIconSvg = aiHtmlToolIconRaw.replaceAll('black', 'currentColor')
const aiHtmlToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiHtmlToolIconSvg }}
  />
)
const aiFilmToolIconSvg = aiFilmToolIconRaw.replaceAll('black', 'currentColor')
const aiFilmToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiFilmToolIconSvg }}
  />
)
const aiSlidesToolIconSvg = aiSlidesToolIconRaw.replaceAll('black', 'currentColor')
const aiSlidesToolIcon = (
  <div
    aria-hidden="true"
    className="cowart-ai-frame-tool-icon"
    dangerouslySetInnerHTML={{ __html: aiSlidesToolIconSvg }}
  />
)
const annotationToolIconSvg = annotationToolIconRaw.replaceAll('black', 'currentColor')
const annotationToolIcon = (
  <div
    className="cowart-annotation-tool-icon"
    dangerouslySetInnerHTML={{ __html: annotationToolIconSvg }}
  />
)
const iconSvgSources = import.meta.glob(
  '../../node_modules/@tldraw/assets/icons/icon/*.svg',
  { eager: true, query: '?raw', import: 'default' }
)
export { SELECTION_STATE_ELEMENT_ID, PAGE_ASSETS_ROUTE, GLOBAL_ASSETS_ROUTE, AI_IMAGE_TOOL_ID, AI_IMAGE_HOLDER_LABEL, AI_DRAFT_TOOL_ID, AI_DRAFT_HOLDER_LABEL, AI_FILM_TOOL_ID, AI_FILM_LABEL, COWART_FILM_STATUS_EVENT, AI_SLIDES_TOOL_ID, AI_SLIDES_LABEL, AI_SLIDES_PRESENT_LABEL, COWART_EXPORT_LABEL, COWART_EXPORT_IMAGE_LABEL, COWART_EXPORT_HTML_LABEL, AI_SLIDES_GAP, COWART_OPEN_SLIDES_EVENT, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, AI_DRAFT_HOLDER_DEFAULT_W, AI_DRAFT_HOLDER_DEFAULT_H, AI_SLIDES_PADDING, AI_SLIDES_DEFAULT_W, AI_SLIDES_DEFAULT_H, AI_IMAGE_SIZE_MIN, AI_IMAGE_SIZE_MAX, AI_IMAGE_GENERATION_PANEL_OFFSET, AI_IMAGE_GENERATION_PANEL_MIN_W, AI_IMAGE_GENERATION_PANEL_MAX_W, AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN, AI_IMAGE_GENERATION_PANEL_ESTIMATED_H, AI_IMAGE_GENERATION_STATUS_RESET_MS, AI_IMAGE_REFERENCE_MAX_FILES, COWART_HTML_DRAFT_URL_ORIGIN, COWART_HTML_DRAFT_EMBED_TYPE, AI_IMAGE_ASPECT_PRESETS, ANNOTATION_TOOL_ID, ANNOTATION_TOOL_LABEL, ANNOTATION_DEFAULT_COLOR, ANNOTATION_MIN_LENGTH, ANNOTATION_BEND_RATIO, ANNOTATION_MIN_BEND, ANNOTATION_MAX_BEND, ANNOTATION_LABEL_POSITION, ANNOTATION_SELECT_TEXT_MAX_ATTEMPTS, ANNOTATION_SELECT_TEXT_SETTLE_ATTEMPTS, ANNOTATION_EDIT_TOOL_LABEL, ANNOTATION_HTML_TOOL_LABEL, COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE, ANNOTATION_EDIT_PROMPT, AI_HTML_LOCAL_ASSET_PROMPT_LINES, ANNOTATION_HTML_PROMPT, ANNOTATION_EDIT_EXPORT_PADDING, ANNOTATION_EDIT_NEAR_MARGIN_MIN, ANNOTATION_EDIT_NEAR_MARGIN_MAX, ANNOTATION_EDIT_RELATED_TEXT_MARGIN, ANNOTATION_EDIT_STATUS_RESET_MS, ANNOTATION_EDIT_MAX_EXPORT_DIMENSION, ANNOTATION_EDIT_MAX_EXPORT_PIXELS, ANNOTATION_EDIT_COLORS, HTML_DRAFT_CAPTURE_DELAY_MS, HTML_DRAFT_ASSET_RETRY_DELAYS_MS, HTML_DRAFT_DOM_EDIT_LABEL, HTML_DRAFT_DOM_EDIT_DONE_LABEL, HTML_DRAFT_ANNOTATION_EDIT_LABEL, HTML_DRAFT_ANNOTATION_IMAGE_LABEL, HTML_DRAFT_ANNOTATION_EDIT_PROMPT, HTML_DRAFT_ANNOTATION_IMAGE_PROMPT, AI_IMAGE_GENERATION_PROMPT_PREFIX, AI_DRAFT_GENERATION_PROMPT_PREFIX, AI_SLIDES_GENERATION_PROMPT_PREFIX, AI_SLIDES_ANNOTATION_EDIT_PROMPT, aiImageToolIconSvg, aiImageToolIcon, aiHtmlToolIconSvg, aiHtmlToolIcon, aiFilmToolIconSvg, aiFilmToolIcon, aiSlidesToolIconSvg, aiSlidesToolIcon, annotationToolIconSvg, annotationToolIcon, iconSvgSources }
