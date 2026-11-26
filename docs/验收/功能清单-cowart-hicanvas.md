# Cowart 继承与 hiCanvas 新增功能清单

新编辑底座文字（#132）：普通文字、几何标签、箭头标签和画框标题接同一编辑会话，正式Cowart界面尚未切换；不是C14/C25的HTML内页文字编辑。Esc保存文字会话，与画笔Esc丢弃未提交笔画分开；现有富文本JSON的节点、标记和属性保留，专用格式工具栏与精确排版归#150。公开动作及原生回归见 `tools/text-editing.test.mjs`、`tools/renderer-preview/text-editing-smoke.mjs`；详细条目、A38/E21旧版观察限制及手写字体差异见[文字覆盖](功能清单-tldraw.md#新编辑底座文字覆盖132)。

对应工单：[#21](https://github.com/solosvip/hiCanvas/issues/21)。用于更换画板底座时逐项验收；功能编号不随排序改变。此文记录已找到的入口和契约，不表示这些功能已全部通过真人或浏览器验收。

## 核对范围与读法

- 当前代码基点：`761faa5`（标签 `v0.0.16`，2026-11-25 建立清单时的版本）。后续许可提示、数据层重构等并行改动不包含在此基线。
- 上游基线：[Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587](https://github.com/zhongerxin/Cowart/tree/38bdafeff47374ddbc11b12bddbc4f1f4cf14587)。只读核对该提交的文件树、`src/App.jsx` 实际函数与界面入口；影片另核对 `src/filmConfig.js` 等同名模块。
- C 类：上游已有的创作流程。上游集中在 `src/App.jsx`，本项目拆到 `src/editor/`；下表给当前文件与符号名。标「适配」的行为在 hiCanvas 改为本机服务、自定义模型或通用 MCP，不能据此认为上游也有这些接入能力。
- H 类：hiCanvas 新增的产品行为。M 类：当前公开 MCP 工具的逐工具契约；与 C/H 流程有交叉，单列是为了防止漏接口，不将条数解释为互不重叠的能力数。
- 触发方式写「界面」「MCP」「后台」；后台一栏同时写实际 HTTP 入口或启动动作。界面按钮名为当前中文文案，符号名用于搜索当前代码，不依赖行号。
- 测试列：**有**表示已有断言覆盖该行所述核心行为；**部分**只覆盖括号里的子行为；**无**表示未找到当前检查入口执行的对应回归。`Txx` 的文件和完整测试名见末尾。所有界面外观、点击操作和真实模型质量均未在本单重测。
- tldraw 默认绘图工具、通用选择/裁剪/缩放、撤销重做、右键菜单等由工单 #20 记录；这里只列 Cowart 的定制与 hiCanvas 的接入。上游 Codex widget 宿主专用工具不是本机 MCP 工具，不列为当前可用接口。

## C：从 Cowart 继承的创作流程

### 框、参考图与标注

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| C01 | 创建 AI 图片框 | 界面：工具栏「AI 图片」、快捷键 A，或从工具栏拖出 | 视口中央或拖放位置创建目标框，选中新框，可继续填写生成要求。 | [overrides.jsx](../../src/editor/overrides.jsx) `cowartUiOverrides.tools`；[holderCreation.jsx](../../src/editor/holderCreation.jsx) `createAiImageHolderShape` | 无：工具栏、快捷键与拖放。 |
| C02 | 创建 AI 网页框 | 界面：工具栏「AI 网页」点击或拖出 | 创建带网页标记的占位框，作为随后生成 HTML 的目标。 | [holderCreation.jsx](../../src/editor/holderCreation.jsx) `createAiDraftHolderShape`；`cowartUiOverrides.tools` | 无：创建界面；部分 T01 验证占位框写回。 |
| C03 | 创建 AI 影片框 | 界面：工具栏「AI 影片」点击或拖出 | 创建影片框，保存风格、时长和静音元数据，后续写回仍识别为影片。 | [holderCreation.jsx](../../src/editor/holderCreation.jsx) `createAiFilmHolderShape` | 部分 T01：服务端识别影片和保留时长；无创建界面回归。 |
| C04 | 创建 AI 幻灯片 | 界面：工具栏「AI 幻灯片」点击或拖出 | 创建一套 Slides 容器，容纳多张图片或 HTML 页面；不是画板内部页面管理。 | [holderCreation.jsx](../../src/editor/holderCreation.jsx) `createAiSlidesShape` | 无：创建界面；部分 T01 验证页面归属容器。 |
| C05 | AI 框宽高、比例与比例锁 | 界面：AI 框尺寸设置（可见路径未核实） | 源码提供 W/H 输入、比例预设、锁定比例；修改一边时按锁定比例计算另一边。`CowartStylePanel` 在选择工具下返回空，实际如何进入该面板须实机核实。 | [StylePanel.jsx](../../src/editor/StylePanel.jsx) `CowartStylePanel`、`CowartAiImageStyleControls`；[holderMeta.jsx](../../src/editor/holderMeta.jsx) `isAiImageAspectLocked` | 无；入口实际可达性标「未核实」，不能作为已可用结论。 |
| C06 | 各生成面板的提示词与参考图 | 界面：选择空图片/网页/影片/幻灯片框，输入文字、选择文件或粘贴图片 | 显示参考图缩略图、逐张移除、限制数量，发送中防重复；输入快捷键由统一处理函数管理。参考图随请求保存或附带。 | [ImageGenerationPanel.jsx](../../src/editor/ImageGenerationPanel.jsx) `CowartAiImageGenerationPanel`；[DraftGenerationPanel.jsx](../../src/editor/DraftGenerationPanel.jsx) `CowartAiDraftGenerationPanel`；[SlidesGenerationPanel.jsx](../../src/editor/SlidesGenerationPanel.jsx) `CowartAiSlidesGenerationPanel`；[generationPrompts.jsx](../../src/editor/generationPrompts.jsx) `handleGenerationPromptKeyDown` | 无：上传、粘贴、移除和快捷键界面；T07/T08 只覆盖模型请求携带参考图。 |
| C07 | 文生图与参考图改图（适配） | 界面：图片框选择模型后「发送生成请求」 | 保存画板后提交本机后台任务，目标及框比例进入请求；结果替换目标为普通图片。hiCanvas 使用用户配置模型，上游通过宿主图片能力处理。 | [generationRequests.jsx](../../src/editor/generationRequests.jsx) `sendAiImageGenerationRequest`；[canvasImages.js](../../src/image-models/canvasImages.js) `generateOnCanvas` | 部分 T06/T07/T08/T10：接口与占位回填；无面板到模型的点击回归。 |
| C08 | 手绘箭头与文字标注 | 界面：标注工具、快捷键 C，拖出箭头后输入文字 | 创建带标注元数据的弯箭头，完成即编辑标签；过短拖动及取消撤销本次创建。 | [annotationTools.jsx](../../src/editor/annotationTools.jsx) `CowartAnnotationTool`、`CowartAnnotationPointing`；[annotationEditing.jsx](../../src/editor/annotationEditing.jsx) `startEditingAnnotationArrowLabel` | 无。 |
| C09 | 汇集附近标注与截图尺寸保护 | 界面：对图片/网页/幻灯片发起按标注操作时 | 将原作品及附近标注箭头/文字收进截图；图片修改前拒绝超长边或超总像素的截图，显示缩小或移近标注的提示。 | [annotationRequests.jsx](../../src/editor/annotationRequests.jsx) `collectAnnotationTargetShapeIds`、`prepareAnnotationEditRequest`；[imageToolbar.jsx](../../src/editor/imageToolbar.jsx) `CowartAnnotationEditToolbarButton` | 无：标注收集、截图及尺寸提示。 |
| C10 | 图片按标注生成新图（适配） | 界面：选图片→「按标注修改」 | 截图作为修改参考；原图和标注保留，新图片在旁边产生。独立版交给当前默认模型。 | [annotationSend.jsx](../../src/editor/annotationSend.jsx) `sendAnnotationEditRequest` | 部分 T08：参考图改图协议；T12/T27：保留结果与旁置数据逻辑。无截图到生图的整链路回归。 |
| C11 | 图片与标注转网页 | 界面：图片工具栏→按标注生成网页 | 保存含标注截图，发送 HTML 任务，要求右侧创建同尺寸新网页；保留原图和标注。 | [annotationSend.jsx](../../src/editor/annotationSend.jsx) `sendAnnotationHtmlRequest`；[annotationRequests.jsx](../../src/editor/annotationRequests.jsx) `buildAnnotationHtmlPrompt` | 部分 T03：请求队列；无该按钮、截图和最终旁置结果回归。 |

### HTML 网页

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| C12 | 生成网页并写回原框（适配） | 界面：网页框发送；MCP：`insert_cowart_html_draft` | 由外部 Agent 提供完整单文件 HTML；替换占位框并保留位置、尺寸、旋转和容器，框中显示 HTML。 | [generationRequests.jsx](../../src/editor/generationRequests.jsx) `sendAiDraftGenerationRequest`；[canvas-media.mjs](../../server/canvas-media.mjs) `createCanvasMedia.insertHtml` | 部分 T01：HTML 内容、原位替换与资源读取；无真实 Agent 生成质量回归。 |
| C13 | 网页内嵌预览与资源加载 | 界面：打开包含网页的画板 | iframe 加载已保存 HTML，本机参考图解析为可显示资源；加载中/失败显示提示。普通画布状态仅预览，网页不接收鼠标事件；编辑态与演示态另行处理。 | [shapes.jsx](../../src/editor/shapes.jsx) `CowartHtmlDraftEmbed`；[assets.jsx](../../src/editor/assets.jsx) `hydrateCowartHtmlDraftLocalImages` | 无：渲染、资源完整性及交互状态；T01 只验证资源字节可读。 |
| C14 | 直接修改网页中的 DOM 文字 | 界面：网页工具栏「编辑文字」→点文字→完成 | 选中文本元素编辑，保存时去掉编辑辅助标记；保存失败保留编辑状态并提示，成功后后续打开显示修改后的 HTML。 | [htmlEditor.jsx](../../src/editor/htmlEditor.jsx) `createCowartHtmlDraftDomEditorSession`、`serializeCowartHtmlDraftDocument`；[htmlToolbar.jsx](../../src/editor/htmlToolbar.jsx) `CowartHtmlDraftDomEditButton`；[cowartClient.js](../../src/cowartClient.js) `updateCowartHtmlDraft` | 部分 T02：HTTP 保存、内容指纹和重读；无 DOM 选择、输入、序列化与按钮回归。 |
| C15 | 按标注迭代网页 | 界面：网页工具栏「按标注修改」 | 将网页和附近标注合成截图，读取源 HTML，要求旁边生成同尺寸新稿；不覆盖原 HTML 文件与原标注。 | [htmlAnnotations.jsx](../../src/editor/htmlAnnotations.jsx) `sendHtmlDraftAnnotationRequest`、`buildHtmlDraftAnnotationEditPrompt` | 无：截图、提示构造与保留原稿整链路；T01/T03 仅覆盖通用写回/请求。 |
| C16 | 网页与标注转图片 | 界面：网页工具栏的图片生成操作 | 将网页截图及标注交给 Agent，要求在网页旁插入图片，原网页保留。此入口经 Agent 请求，不是直接调用本机图片模型。 | [htmlAnnotations.jsx](../../src/editor/htmlAnnotations.jsx) `buildHtmlDraftAnnotationImagePrompt`、`sendHtmlDraftAnnotationRequest` | 无：完整流程；T03 只覆盖请求领取完成。 |
| C17 | 导出独立 HTML | 界面：网页导出菜单→HTML | 读取当前源文件并内联本机图片，下载 `.html`，保留 HTML 中的文字和行为。 | [exports.jsx](../../src/editor/exports.jsx) `exportCowartHtmlDraft`；`hydrateCowartHtmlDraftLocalImages` | 无：完整导出、资源内联和下载。 |
| C18 | 网页导出 PNG | 界面：网页导出菜单→图片 | 等待字体/资源与绘制完成，按作品尺寸截图导出 PNG。 | [htmlCapture.jsx](../../src/editor/htmlCapture.jsx) `renderCowartHtmlDraftCanvas`；[exports.jsx](../../src/editor/exports.jsx) `exportCowartHtmlDraft` | 无：浏览器截图与 PNG 内容。 |

### 动效影片（HTML/CSS/JS）

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| C19 | 影片风格选择 | 界面：空影片框的风格按钮 | 提供产品发布、动态文字、抽象物理、叙事短片、数据流五种风格；选择写入框的元数据并加入生成要求。 | [filmConfig.js](../../src/filmConfig.js) `FILM_STYLES`、`getFilmOptions`；[FilmStyleButtons.jsx](../../src/FilmStyleButtons.jsx) `FilmStyleButtons` | 无。 |
| C20 | 设置影片时长 | 界面：影片生成面板时长输入 | 默认 15 秒，可设置 1–120 秒；设置随框保存并供生成、播放和导出使用。 | [SlidesGenerationPanel.jsx](../../src/editor/SlidesGenerationPanel.jsx) `CowartFilmGenerationOptions`；`getFilmOptions` | 部分 T01：时长写回保留；无输入限制与播放/导出一致性回归。 |
| C21 | 生成带音轨的代码影片（适配） | 界面：影片框发送；MCP 写回 | Agent 制作单文件 HTML，提供 `CowartFilm` 的 seek/play/pause/setMuted/renderAudio；不是扩散视频模型接口。写回保留影片身份、风格、时长。 | [filmConfig.js](../../src/filmConfig.js) `buildFilmGenerationPrompt`；[runtime-contract.md](../../skills/hicanvas/references/runtime-contract.md)；`createCanvasMedia.insertHtml` | 部分 T01：影片记录与时长；无生成接口契约、画面与音轨整体验证。 |
| C22 | 播放、暂停与播放就绪反馈 | 界面：影片框播放/暂停按钮 | 等待影片接口就绪后控制播放，暂停同时作用于时间线；界面显示当前状态或错误，文字编辑期间暂停。 | [htmlToolbar.jsx](../../src/editor/htmlToolbar.jsx) `CowartFilmPlaybackControls`；[filmPlayback.js](../../src/filmPlayback.js) `attachCowartFilmController` | 无。 |
| C23 | 时间轴定位 | 界面：影片进度条 | 拖动到指定秒，画面按影片 seek 接口定位；影片需保证该时刻渲染可确定，不能只依赖实时钟。 | `CowartFilmPlaybackControls`；[filmTimeline.js](../../src/filmTimeline.js) | 无。 |
| C24 | 影片静音与声音 | 界面：静音/取消静音按钮 | 预览静音状态随影片元数据保存；用户手势启用播放声音，预览静音不等于导出删音轨。 | [htmlToolbar.jsx](../../src/editor/htmlToolbar.jsx) `CowartFilmPlaybackControls`；[filmPlayback.js](../../src/filmPlayback.js) `attachCowartFilmController` | 无。 |
| C25 | 编辑影片中的文字 | 界面：影片工具栏「编辑文字」 | 暂停后编辑可编辑 DOM 文本并保存；影片继续 seek 时应保留文字，全部绘在 canvas 中的文字不承诺可编辑。 | `CowartHtmlDraftDomEditButton`；`createCowartHtmlDraftDomEditorSession`；[runtime-contract.md](../../skills/hicanvas/references/runtime-contract.md) | 部分 T02：通用 HTML 保存；无影片 seek 后文字仍在的回归。 |
| C26 | 导出带音乐与音效的 MP4 | 界面：影片导出菜单→影片 | 独立 iframe 逐帧 seek，以 30 FPS 编 H.264 视频和 AAC 音频；完整时长 renderAudio 混合 BGM/SFX，拒绝无有效音轨或不支持编码的环境。内嵌视频按时间线解码，所需音频由影片混入音轨。 | [exports.jsx](../../src/editor/exports.jsx) `exportCowartFilm`；[filmExport.js](../../src/filmExport.js) `renderCowartFilmMp4`；[filmVideoFrames.js](../../src/filmVideoFrames.js) | 无：当前检查不含 WebCodecs、音轨、内嵌视频及最终 MP4 内容回归。 |
| C27 | 导出影片 HTML | 界面：影片导出菜单→HTML | 下载完整影片源 HTML，含本机图片内联；不把生成时的播放器控件写成影片内容。 | `exportCowartHtmlDraft`；[htmlToolbar.jsx](../../src/editor/htmlToolbar.jsx) `CowartHtmlDraftToolbar` | 无。 |
| C28 | 导出进度、中止与错误状态 | 界面：导出菜单；后台：切换目标或卸载菜单组件 | 导出中禁用按钮，MP4 显示渲染进度；切换目标/卸载时发中止信号，MP4 会终止，HTML/PNG/Slides 导出未接入该信号，不能承诺中止。完成/失败有反馈，超时与编码失败不伪装成成功文件；没有独立取消按钮。 | [slidesToolbar.jsx](../../src/editor/slidesToolbar.jsx) `CowartExportMenu`；[filmExport.js](../../src/filmExport.js) `renderCowartFilmMp4` | 无。 |

### 幻灯片与定制编辑器交互

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| C29 | 按指定页数生成幻灯片（适配） | 界面：幻灯片提示面板，页数菜单/自定义页数→发送 | 页数与参考图进入请求；自定义页数 1–50，Agent 逐页 HTML 写进同一容器，页序元数据明确。 | `CowartAiSlidesGenerationPanel`；[generationRequests.jsx](../../src/editor/generationRequests.jsx) `sendAiSlidesGenerationRequest`；[generationPrompts.jsx](../../src/editor/generationPrompts.jsx) `buildAiSlidesGenerationPrompt` | 部分 T01：多页 HTML 归属及排列；无页数面板、生成页数满足要求的回归。 |
| C30 | 图片与 HTML 混排、拖入与粘贴 | 界面：将图片/网页拖进 Slides；选中 Slides 后粘贴 | 同一套 Slides 可含图片与 HTML；粘贴内容归入选中的容器，保留作品资源；不只是截图拼图。 | [slidesLayout.jsx](../../src/editor/slidesLayout.jsx) `preparePastedItemForAiSlides`、`movePastedItemsIntoAiSlides`、`copySelectedCowartContent` | 无：拖入、复制粘贴及混排。 |
| C31 | 幻灯片自动排版与页序 | 界面：增删/移动容器内页面；后台：HTML 插入 | 按页面横向位置确定顺序，统一间隔排列并扩展容器；生成页面可按父容器元数据被收纳。 | `getAiSlidesItems`、`layoutAiSlides`、`adoptGeneratedAiSlidesItems`；[media-placement.js](../../engine/media-placement.js) `placeMedia` | 部分 T01：服务端插入三页横排；无拖动重排及前端收纳回归。 |
| C32 | 预览、缩略图与翻页 | 界面：Slides「演示」；侧栏缩略图、上下页或键盘 | 演示器显示当前页和总页数；缩略图跳页；左右键/空格翻页、Esc 退出，首末页不越界。 | [slidesToolbar.jsx](../../src/editor/slidesToolbar.jsx) `CowartSlidesToolbar`；[SlidesPresentation.jsx](../../src/editor/SlidesPresentation.jsx) `CowartSlidesPresentationOverlay` | 无。 |
| C33 | 全屏播放与交互页面 | 界面：演示器「播放」 | 请求浏览器全屏，失败仍保留干净演示视图；空白区域点击翻页，HTML 中按钮、表单等交互点击不当作普通翻页。 | `CowartSlidesPresentationOverlay`；[slidesMedia.jsx](../../src/editor/slidesMedia.jsx) `isInteractiveHtmlClick`、`CowartSlidesMedia` | 无。 |
| C34 | 幻灯片按标注生成新套稿 | 界面：有内容 Slides→按标注修改 | 截图包含源 Slides/HTML 与标注；原稿保留，下方创建新 Slides 供 Agent 写入同页数修订稿；提交失败清理本次新建空目标。 | [htmlAnnotations.jsx](../../src/editor/htmlAnnotations.jsx) `sendAiSlidesAnnotationEditRequest`、`createAiSlidesBelowSource` | 无：截图、新目标及失败清理；T01/T03 只覆盖通用写回和队列。 |
| C35 | 整套逐页 PNG 导出 | 界面：Slides 导出菜单→图片 | 按页序导出 `page-01.png` 等到同一新目录；HTML 页用 DOM 截图，图片页按页渲染，防止覆盖另一套导出。 | [exports.jsx](../../src/editor/exports.jsx) `exportCowartSlides`；[exports.mjs](../../server/exports.mjs) `saveExport` | 部分 T02：共同目录与安全路径；无逐页截图内容与顺序回归。 |
| C36 | 整套 HTML 与离线播放器导出 | 界面：Slides 导出菜单→HTML | 导出 `pages/page-01.html` 等与 `Play.html`；图片页包装成 HTML，播放器按键/点击翻页；不输出原生 PPTX。 | [exports.jsx](../../src/editor/exports.jsx) `exportCowartSlides`、`cowartImageSlideHtml`、`cowartSlidesPlayerHtml` | 部分 T02：目录与文件保存；无实际播放器打开、资源内联及翻页回归。 |
| C37 | 移动主工具栏 | 界面：拖工具栏把手；把手获得焦点后方向键/Shift+方向键 | 在画布范围内移动工具栏，窗口变小时保持可达；偏移不写进画板快照或浏览器存储。 | [CowartDraggableToolbar.jsx](../../src/CowartDraggableToolbar.jsx) `CowartDraggableToolbar` | 无。 |
| C38 | 定制图片替代文本编辑器 | 界面：图片工具栏「文」进入，确认/点外部完成，Esc 取消 | 编辑选中图片 `altText`，只读状态禁用修改；切换图片退出编辑。此条只覆盖 Cowart 替换的编辑器，默认裁剪等在 #20。 | [imageToolbar.jsx](../../src/editor/imageToolbar.jsx) `CowartAltTextEditor` | 无。 |

## H：hiCanvas 新增的产品行为

### 本机画板、保存与恢复

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| H01 | 独立浏览器画板与本机宿主 | 后台：启动本机服务；界面：打开本机地址 | 同一服务提供静态画板与保存接口，默认仅监听回环地址；无需 Codex widget 宿主。 | [local-service.mjs](../../server/local-service.mjs) `createHiCanvasService`；[ConversationApp.jsx](../../src/conversations/ConversationApp.jsx) `ConversationApp` | 有 T30：构建资源和接口、本机边界。 |
| H02 | 默认简体中文 | 界面：首次打开与以后切换语言 | 首次将用户偏好初始化为简体中文；标记已应用后尊重用户后来选择，不改用户作品文字。 | [userPreferences.js](../../src/editor/userPreferences.js) `createHiCanvasUser`；[overrides.jsx](../../src/editor/overrides.jsx) `cowartUiOverrides.translations` | 无：语言初始化、切换与菜单文案。 |
| H03 | 画板设置浮层 | 界面：菜单栏设置图标 | 居中可拖动浮层，生图模型/AI 接入两个分类，加载/错误/重载及关闭状态；键盘可切换分类。 | [ModelSettings.jsx](../../src/image-models/ModelSettings.jsx) `SettingsPanel` | 无：拖动、分类、关闭与键盘。 |
| H04 | 新建画板 | 界面：画板名称下拉→新建；后台：`POST /api/conversations/open` | 可命名新建独立画板，自动打开并成为当前目标。MCP 的创建/恢复另见 M01。 | [BoardPopover.jsx](../../src/conversations/BoardPopover.jsx) `BoardPopover.save`；[conversations.mjs](../../server/conversations.mjs) `createConversations.open` | 部分 T15/T21：创建与绑定；无下拉操作回归。 |
| H05 | 查看列表、切换与保存前置 | 界面：名称下拉列表；方向键/Home/End | 显示当前画板，选择其他画板前等待保存；保存失败或等待期间继续编辑则保留当前画板，列表弹层不遮罩画布。 | [ConversationMenu.jsx](../../src/conversations/ConversationMenu.jsx) `ConversationMenu`；`BoardPopover`；[canvasNavigation.js](../../src/canvasNavigation.js) `prepareCanvasNavigation` | 部分 T20：切换前保存；无弹层、键盘和当前项外观回归。 |
| H06 | 重命名画板 | 界面：列表每行「⋯」→重命名→保存；后台：`PUT /api/conversations/:id` | 更新列表名称；当前画板标题同步，不改变画板 ID 或内容。 | [BoardActions.jsx](../../src/conversations/BoardActions.jsx) `BoardActions`；`BoardPopover.save`；`createConversations.rename` | 无：重命名行为的专门自动断言。 |
| H07 | 确认删除画板 | 界面：「⋯」→删除→确认；后台：`DELETE /api/conversations/:id` | 确认前读取版本，版本变化拒删；从列表移除并拒绝旧 ID 读写，保留本机作品文件。删除当前画板切其他画板或空页。 | [BoardPopover.jsx](../../src/conversations/BoardPopover.jsx) `requestDelete`、`remove`；[conversations.mjs](../../server/conversations.mjs) `createConversations.remove` | 部分 T16/T17：版本、保留文件、旧绑定；无确认弹层点击回归。 |
| H08 | 全删后的空状态与重新开始 | 界面：最后一个画板删除后刷新/重开、新建入口 | 显示空状态，不自动复活默认画板；明确删除的链接报删除，未指定链接可恢复现存其他画板。 | [BoardHome.jsx](../../src/conversations/BoardHome.jsx) `BoardHome`；[client.js](../../src/conversations/client.js) `initializeConversation` | 部分 T29：启动选择与空状态数据；无空页按钮回归。 |
| H09 | 链接恢复、窗口与 Agent 目标分离 | 界面：URL 带 `conversation`；MCP 创建/恢复 | 刷新恢复链接指定画板，不跟随其他窗口切换；无指定 URL 时使用上次目标。Agent 始终使用自己显式指定的 ID。 | [client.js](../../src/conversations/client.js) `initializeConversation`、`conversationUrl`；[server.mjs](../../mcp/server.mjs) `openConversation` | 部分 T15/T21/T29：绑定、恢复、错误 ID；无多窗口点击整链路回归。 |
| H10 | 内容、图片、选择与视角隔离 | 后台：`/api/canvas`、`/api/selection`、`/api/view-state` 均带目标画板 | 每块画板独立持久化，资源引用不得跨画板；模型设置共用，正文中的普通路径文字不被改写。 | `createConversations.read`、`createConversations.sidecar`、`createConversations.qualify`；[routes.mjs](../../server/routes.mjs) `createCanvasMiddleware` | 有 T13/T14/T15/T26：内容视角隔离、URL 校验、选择与视口保存。 |
| H11 | 导入旧 Cowart 与合并旧多页 | 后台：首次读取旧资料 | 旧文件保持不变；旧多页内容横向合到唯一画布，保留嵌套、旋转、层序、资源和视角，保存原始快照；重复读取不重复平移。 | [conversations.mjs](../../server/conversations.mjs) `readState`；[single-canvas.mjs](../../server/single-canvas.mjs) `mergeLegacyPages` | 有 T19/T26：迁移、原始快照、损坏停止导入。 |
| H12 | 每画板只用一张无限画布 | 界面：无页面管理；后台/MCP：拒绝增加、替换或删除内部 page | 不暴露页选择；普通内容自动进入唯一画布。Slides 的作品页数照常存在。 | [slidesLayout.jsx](../../src/editor/slidesLayout.jsx) `cowartTldrawOptions`；[single-canvas.mjs](../../server/single-canvas.mjs) `singlePageId`；[conversations.mjs](../../server/conversations.mjs) `mutate` | 有 T19：后端不变量与 MCP 无页参数；无所有菜单可见性回归。 |
| H13 | 自动保存、失败提示与重试 | 界面：编辑后；后台：快照/视角/选择写入 | 延迟自动保存，失败持续显示尚未保存并可重试，恢复后清除对应错误；离开页面时保护未保存改动。损坏文件停止加载而不覆盖。 | [App.jsx](../../src/editor/App.jsx) `saveCanvas`；[persistenceFeedback.js](../../src/persistenceFeedback.js) `createPersistenceFeedback`；[cowartCanvasSave.js](../../src/cowartCanvasSave.js) | 部分 T20/T26：反馈状态与损坏保护；无浏览器断网恢复整链路。 |
| H14 | 冲突备份后加载最新版 | 界面：保存冲突条→备份当前修改→加载最新画布 | 冲突保留本地内容；必须有对应当前内容的成功备份才允许加载；备份期间新编辑使备份失效，加载新快照后清除旧撤销历史。 | `App.showSaveConflict`；[backupCanvas.js](../../src/editor/backupCanvas.js) `backupCanvas` | 无：备份下载成功、并发编辑及恢复按钮门禁的专门回归。 |
| H15 | 版本检查与原子批量修改 | 后台：`PUT /api/canvas`、`POST /api/canvas/operations` | 整批合法、目标存在且 `expectedRevision` 匹配才提交；冲突先读新版本合并。进程异常释放保存锁，非法记录不产生半份文档。 | [conversations.mjs](../../server/conversations.mjs) `mutate`；[execute.js](../../engine/execute.js) `executeCanvasCommands`；[file-lock.mjs](../../server/file-lock.mjs) `withFileLock` | 有 T13/T14/T17/T31：并发互斥、非法数据不覆盖与异常解锁。 |
| H16 | 实时远端更新与删除退出 | 后台：`GET /api/canvas-events`；界面：保持画板打开/断线重连 | 接收本机服务更新并刷新内容；已删画板退出编辑，重连补查删除；普通离线不能误判删除。 | [App.jsx](../../src/editor/App.jsx) `loadRemoteCanvasSnapshot`；[canvasLifecycle.js](../../src/conversations/canvasLifecycle.js) `watchCanvasLifecycle`；[events.mjs](../../server/events.mjs) `getCanvasEvents` | 部分 T18：删除/重连状态机；无端到端 SSE 视觉同步回归。 |

### 自定义图片模型与后台生成

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| H17 | 添加任意命名模型配置 | 界面：设置→添加模型；后台：`POST /api/image-models` | 填显示名、协议、基础地址、模型标识和密钥，无预置服务名单；保存配置不产生生图任务。 | [ModelForm.jsx](../../src/image-models/ModelForm.jsx) `ModelForm`；[image-models.mjs](../../server/image-models.mjs) `createModelStore.save` | 部分 T04：保存重读、无密钥输出；无表单操作。 |
| H18 | 切换默认模型 | 界面：设置及图片面板的模型下拉；后台：`PUT /api/image-models/active` | 在已保存配置中切换默认模型，后续新任务使用它，已提交任务不随切换而改模型。 | [ModelContext.jsx](../../src/image-models/ModelContext.jsx) `ModelPicker`；`createModelStore.activate` | 部分 T05/T10：切换与在途模型固定；无下拉交互回归。 |
| H19 | 编辑配置与密钥留空/清除 | 界面：编辑模型；后台：`PUT /api/image-models/:id` | 同地址编辑时空密钥保留原值；可明确清除；更换地址或协议不能误带旧密钥。 | [ModelForm.jsx](../../src/image-models/ModelForm.jsx) `ModelForm`；[image-models.mjs](../../server/image-models.mjs) `createModelStore.save` | 部分 T05：同地址保留与换址拒绝；显式清除/换协议全部分支未完整自动覆盖。 |
| H20 | 删除模型配置 | 界面：模型删除确认；后台：`DELETE /api/image-models/:id` | 删除配置，必要时改选其他模型，不删除已经生成的图片。 | [ModelSettings.jsx](../../src/image-models/ModelSettings.jsx) `SettingsPanel.remove`；[image-models.mjs](../../server/image-models.mjs) `createModelStore.remove` | 部分 T05：删除配置及默认项回退；无确认与保留图片的组合断言。 |
| H21 | 两类生图协议 | 后台：提交生成后调用用户配置地址 | OpenAI Images：文生图 generations、参考图 multipart edits；Gemini：generateContent 文字+图片、支持比例并解析内联图；支持 base64 或下载 URL 输出。 | [image-provider.mjs](../../server/image-provider.mjs) `requestImages` | 有 T06/T07/T08/T09：模拟供应商请求与结果落盘；真实供应商兼容性未核实。 |
| H22 | 配置与模型密钥的边界 | 后台：读取设置/提交生成 | 返回模型清单仅有密钥已保存状态；文件权限限制本人；日志/错误不回显密钥，下载图片不把密钥转交 URL 或重定向目标。 | `createModelStore`；`requestImages`；[image-routes.mjs](../../server/image-routes.mjs) `createImageMiddleware` | 有 T04/T05/T08/T09/T21：不回显、权限和下载鉴权边界；不是磁盘加密承诺。 |
| H23 | 批量先建全部占位 | MCP/后台：`submit_image_batch`、`POST /api/images/jobs`；界面单张复用 | 一次提交 1–64 个独立提示词，携带目标版本；先创建全部占位并持久化任务，返回 `jobId`，不要求 Agent 逐张等待。 | [image-jobs.mjs](../../server/image-jobs.mjs) `createImageJobs.submit` | 部分 T10：16 张原子占位与任务执行；未覆盖全部边界数量组合。 |
| H24 | 网格排版与尺寸 | MCP：列数、位置、显示宽高/每图比例；后台排版 | 默认最多每行 4 张，16 张为 4×4；可指定 1–16 列与起点；按图片比例布置框，供应商原始像素保留。 | `createImageJobs.submit`；[image-dimensions.mjs](../../server/image-dimensions.mjs) `imageDimensions` | 部分 T10/T27：4×4 与真实像素比例；无全部自定义列数、坐标组合。 |
| H25 | 限并发、模型固定与编辑不丢失 | 后台：任务队列运行 | 默认最多 3 个供应商请求并发；任务记录固定模型 ID；生成间隙用户编辑及切换默认模型不覆盖既有内容。 | [image-jobs.mjs](../../server/image-jobs.mjs) `pump`、`execute` | 有 T10/T21：并发上限、模型切换、并发编辑保留。 |
| H26 | Agent 断开/关窗后继续生成 | 后台：已提交的队列继续运行 | 收到任务后由独立本机服务执行，关闭画板窗口或退出 MCP 不取消任务；按需查询进度即可。 | `createImageJobs`；[startup.mjs](../../mcp/startup.mjs) `ensureService`；[main.mjs](../../desktop/main.mjs) | 部分 T10/T11：服务端队列与重启；本单未运行签名应用关窗/AI 断开的桌面专项测试。 |
| H27 | 失败不自动重试与重启续队列 | 后台：供应商失败、服务重启 | 单张失败不阻塞其他图；仅恢复未发送项，运行中断标 interrupted 或保留已存结果，不重新发送可能收费请求。 | [image-jobs.mjs](../../server/image-jobs.mjs) `execute`、`ready` | 有 T11/T12：重启不重发、单项失败隔离。 |
| H28 | 删目标/删画板时保护结果 | 界面/MCP：生成途中删框或删画板 | 删占位框后结果仍保存且框不复活；删画板后未发请求停止，已发结果仍落盘但画板不复活。 | [image-jobs.mjs](../../server/image-jobs.mjs) `execute`；[conversations.mjs](../../server/conversations.mjs) `remove` | 有 T12/T16/T17：目标删除、任务取消、迟到保存。 |
| H29 | 找回、下载与重新插入图片 | 界面：菜单栏图片结果；MCP：`list_image_results` | 按本画板列最近 40 张已保存生成图，可下载或重新放进画板；插入失败仍能找回，不覆盖原文件名。 | [ImageResults.jsx](../../src/conversations/ImageResults.jsx) `ImageResults`；[image-results.mjs](../../server/image-results.mjs) `createImageResults.list`；`insertGeneratedImages` | 部分 T06/T12/T21/T27：结果可列出与插入辅助逻辑；无 40 张截断和界面下载回归。 |

### MCP 双向请求、桌面应用与技能

| 编号 | 名称 | 触发方式 | 预期行为 | 来源（当前文件、符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| H30 | 按钮请求持久化到 Agent 队列 | 界面：网页/影片/Slides/标注发送；后台：`POST /api/agent/requests` | 请求保存原目标、提示词、参考图及上下文；同一目标处理中拒绝重复任务或复用原请求，保存在所属画板而不串板。 | [agentBridge.js](../../src/agentBridge.js) `sendCanvasAgentRequest`；[agent-requests.mjs](../../server/agent-requests.mjs) `createAgentRequests.submit` | 部分 T03/T28：持久化、幂等与隔离；无各界面按钮整链路。 |
| H31 | 请求领取、归属与完成回执 | MCP：`get_canvas_requests` / `complete_canvas_request`；后台：claim/PUT 请求 | 按画板与可选 requestId 领取，记录领取方；实际写回后报告 completed 或 failed；重连可继续，迟到投递回执不回退终态。调用不要求 expectedRevision，但服务器可能用最新版本更新目标框状态并改变 revision，随后写作品仍须重读。 | [agent-requests.mjs](../../server/agent-requests.mjs) `list`、`complete`、`markTarget`；[bridge-tools.mjs](../../mcp/bridge-tools.mjs) `registerBridgeTools` | 部分 T03/T28：领取完成与迟到投递状态；完整跨客户端领取冲突组合未覆盖。 |
| H32 | REX 原会话通知与重新绑定 | 后台：`open_conversation` 识别接收器，`POST /api/agent/connect` | 可唤起绑定的原 REX Agent；接收进程更换后重新投递未领取任务；不执行 HTTP 指定程序，不把提示词当 shell。其他宿主通过 MCP 队列处理。 | [rex-delivery.mjs](../../server/rex-delivery.mjs) `rexReceiver`、`deliverRexRequest`；`createAgentRequests.connect` | 有 T28/T23：接收器、重投与不执行输入；不代表每种外部宿主都已验证。 |
| H33 | 画板请求等待/制作/完成/失败反馈 | 界面：任务提示与占位框状态；后台轮询 | 显示已发送、等待 Agent、制作中、完成或失败；未连接时提示保留请求；完成回执自身不替代实际写回。 | [AgentRequestFeedback.jsx](../../src/editor/AgentRequestFeedback.jsx) `AgentRequestFeedback`；[shapes.jsx](../../src/editor/shapes.jsx) `CowartFrameShapeUtil` | 部分 T28：后台状态；无通知、占位动画与错误反馈界面回归。 |
| H34 | 通用 stdio MCP 与自动服务启动 | 后台：`bin/hicanvas-mcp.mjs`；MCP 客户端连接 | 支持标准 MCP 发现和调用；不存在本机服务时启动已构建服务，存在则核验协议与资料身份；不关闭其他服务，不随客户端退出结束服务。 | [hicanvas-mcp.mjs](../../bin/hicanvas-mcp.mjs)；[startup.mjs](../../mcp/startup.mjs) `ensureService`；[http-client.mjs](../../mcp/http-client.mjs) `createApiClient` | 部分 T22/T23/T30：真实 stdio、协议/身份与宿主；完整冷启桌面专项不在 `npm run check`。 |
| H35 | 独立 Mac 应用与自带运行时 | 后台：桌面打包；界面：打开 hiCanvas.app | Electron 窗口复用相同画板，应用带 Chromium/Node 与 MCP 启动器；当前打包目标为 Apple 芯片 Mac，Developer ID 签名 ZIP，无公证和自动更新。 | [main.mjs](../../desktop/main.mjs) `showCanvas`；[pack-desktop.mjs](../../tools/pack-desktop.mjs) | 部分：`npm run check` 检查桌面 bundle；无本单实际签名、启动 `.app` 与分发安装验证。 |
| H36 | 桌面菜单、重开与安全离开 | 界面：中文应用菜单/Dock 重开/关窗/退出/深链切换 | 提供应用、编辑、视图和窗口菜单；关窗或导航先保存，失败保留原窗口；macOS 关最后窗口后可重开，不结束独立后台服务。 | `installMenu`、`showCanvas`；[window-navigation.mjs](../../desktop/window-navigation.mjs) `saveBeforeLeaving`、`navigateCanvas` | 部分 T23：离开前保存与未挂载页面；无原生菜单/Dock/退出界面回归。 |
| H37 | 桌面深链与共享连接配置 | MCP：`open_canvas`/openWindow；后台：`hicanvas:`、连接配置 | 已安装时打开桌面目标画板，否则浏览器；窗口/MCP 共用地址、资料和设置路径，环境变量可覆盖；拒绝远程链接、其他资料和旧多页服务。 | [connection.mjs](../../mcp/connection.mjs) `loadConnection`、`parseDeepLink`；[navigation.mjs](../../desktop/navigation.mjs) `validateCanvasLink`；[startup.mjs](../../mcp/startup.mjs) `openBrowser` | 部分 T19/T23：配置、深链与身份；无实际唤起应用/浏览器回归。 |
| H38 | 首开发现并部署唯一 Skill | 界面：首次启动；后台：已有技能目录扫描 | 识别共享目录与宿主目录，去重同指向链接，优先已有共享部署；没有或有多个候选则由用户选择，记住位置。 | [skill-discovery.mjs](../../desktop/skill-discovery.mjs) `discoverSkillDirectory`；[skill-setup.mjs](../../desktop/skill-setup.mjs) `createSkillSetup` | 有 T24：发现、去重、选择、记住位置的模拟交互。 |
| H39 | 跳过后补装、更改目录与保留旧链接 | 界面：部署取消/设置→AI 接入→选择或更改目录 | 取消不影响使用画板，稍后重试；移动时未修改的旧部署改成链接，用户修改或额外文件保留并提示。 | `createSkillSetup.setup`；[skill-migration.mjs](../../desktop/skill-migration.mjs) `linkPreviousSkill` | 有 T24/T25：取消、重试、迁移与保留用户内容的模拟交互；无原生选择器实机回归。 |
| H40 | 随应用升级与修改冲突处理 | 后台：启动检测新版本；界面：保留或备份更新 | 只更新自有 Skill 文件；用户修改/删除视为冲突，确认前保持原文件；可备份后更新，拒绝符号链接越界及暂存期新修改覆盖。 | [skill-install.mjs](../../desktop/skill-install.mjs) `installSkill`、`skillInstallState` | 有 T25：升级归属、冲突、备份、链接和并发修改。 |
| H41 | AI 接入状态、复制指令与菜单入口 | 界面：设置→AI 接入，或应用菜单「AI 接入…」 | 显示部署状态和目录，部署成功才可复制接入指令；即使没有画板也可从应用菜单操作；IPC 仅允许主画板页面调用。 | [AIConnection.jsx](../../src/ai-connection/AIConnection.jsx) `AIConnection`；`createSkillSetup.copyPrompt`、`createSkillSetup.showConnection`；[preload.cjs](../../desktop/preload.cjs) | 无：复制剪贴板、菜单和 IPC 来源校验的专门回归；T24/T25 只覆盖安装状态。 |
| H42 | 零上下文接入与按需创作说明 | 后台/Agent：读取部署的 `SKILL.md`、`installation.json` 与参考说明 | 单一 hicanvas 入口按图片、改图、HTML、Slides、影片路由；接入文档要求识别当前宿主、保留其他配置并只读验证；应用不自动修改真实 MCP 配置。影片附分镜、五种风格、播放协议与视觉检查说明。 | [SKILL.md](../../skills/hicanvas/SKILL.md)；[connect.md](../../skills/hicanvas/references/connect.md)；[skill-install.mjs](../../desktop/skill-install.mjs) `installSkill` | 部分 T25：installation 信息和文件部署；无零上下文 Agent 实际执行全部说明的回归。 |

## M：全部公开 MCP 工具

工具源：主工具注册在 [mcp/server.mjs](../../mcp/server.mjs) 的 `createHiCanvasMcp`，桥接工具注册在 [mcp/bridge-tools.mjs](../../mcp/bridge-tools.mjs) 的 `registerBridgeTools`。以下 17 个名称逐个对应当前注册，没有调用用户的真实 MCP 来探测。

共同规则：除 `open_conversation`、`list_conversations`、`list_image_models` 外，均要求显式 `conversationId`，与浏览器当前选择无关。直接修改画板文档、提交占位任务及删除画板须带 `expectedRevision`；缺失/过期不得无版本重试。资源必须属于目标画板。打开窗口和请求队列工具不接收 expectedRevision；队列处理可能由服务器读取最新版本更新目标框状态，领取后写作品仍须重新 get_canvas。

| 编号 | 名称 | 触发方式与输入要点 | 预期行为及写入规则 | 来源（文件、注册符号） | 现有自动测试 |
| --- | --- | --- | --- | --- | --- |
| M01 | `open_conversation` | MCP；可选 `conversationId`、稳定 `bindingKey`、`title`、`createNew`、`openWindow` | 创建或恢复画板并返回 ID/revision/URL；同连接重复或稳定键重连复用，只有明确新建才 `createNew:true`。可能创建索引/绑定或连接接收器，无 expectedRevision。并发首次打开串行。 | [server.mjs](../../mcp/server.mjs) `tool('open_conversation')`、`openConversation` | 有 T15/T21；openWindow 实际唤起未测。 |
| M02 | `list_conversations` | MCP；无参数 | 列出未删画板，不创建或改变连接绑定；无 expectedRevision。 | [server.mjs](../../mcp/server.mjs) `tool('list_conversations')` | 部分 T16：后端列表不含删除项；无专门经此 MCP 工具读列表断言。 |
| M03 | `delete_conversation` | MCP；`conversationId`、`expectedRevision` | 破坏性工具，仅明确删除时使用；校验版本，保留本机文件；旧 ID/绑定报删除，不自行新建替代板。 | [server.mjs](../../mcp/server.mjs) `tool('delete_conversation')` | 有 T16/T17：真实 MCP 删除、破坏性声明和绑定保持。 |
| M04 | `get_canvas` | MCP；`conversationId` | 返回完整 snapshot、revision、选择、视角；作为写入前读取，不改变画板内容；无 expectedRevision。 | [server.mjs](../../mcp/server.mjs) `tool('get_canvas')` | 有 T21/T22：快照、隔离及真实 stdio 读取；选择/视角见 T13/T26。 |
| M05 | `apply_canvas_operations` | MCP；ID、版本、1–500 个操作；`create_shape`/`put`/`update`/`delete` | 支持 geo/text/arrow/image/embed/frame/group 的简便创建及完整记录写入；省略 parentId 进唯一画布。整批校验与原子提交；删除级联子形状和连接，禁止非法/跨画板资源。 | `tool('apply_canvas_operations')`；[execute.js](../../engine/execute.js) `executeCanvasCommands` | 部分 T14/T19/T21：增改、冲突、非法不覆盖；并非所有形状与级联组合全覆盖。 |
| M06 | `list_image_models` | MCP；无参数 | 返回用户配置的模型和默认模型，不返回 API 密钥，不生成图片；无目标 ID/版本。 | [server.mjs](../../mcp/server.mjs) `tool('list_image_models')` | 有 T21：MCP 输出无测试密钥。 |
| M07 | `generate_image` | MCP；ID、版本、`prompt`；可选 modelId、x/y、displayWidth、最多 10 个 referenceUrls | 兼容单张入口，转换成一项后台 job，立即返回 jobId；目标明确、版本检查后建占位，失败不自动重试。多张首选 M11。 | [server.mjs](../../mcp/server.mjs) `tool('generate_image')` | 有 T21：生图/参考改图、看图及冲突不调用模型。 |
| M08 | `list_image_results` | MCP；`conversationId` | 列当前画板最近保存结果，包括未插入者；只读，不影响画布版本。 | [server.mjs](../../mcp/server.mjs) `tool('list_image_results')` | 部分 T21：并发编辑后可列出成功结果且不同板隔离；T12 覆盖后台保留未插入结果，没有经此 MCP 读取未插入结果的专门断言。 |
| M09 | `read_image` | MCP；ID、`src` | 仅允许当前板 assets/page-assets 的本机图片，限制 20 MB，返回 MCP 图片内容；拒绝归一化越界/跨板地址，只读。 | [server.mjs](../../mcp/server.mjs) `server.registerTool('read_image')`、`imageBytes` | 部分 T21：图片内容与跨板拒绝；20 MB、重定向等边界未完整覆盖。 |
| M10 | `open_canvas` | MCP；`conversationId` | 先确认板存在，再打开桌面应用或浏览器；不更改 Agent 目标绑定，不写画板文档，无 expectedRevision。 | `tool('open_canvas')`；[startup.mjs](../../mcp/startup.mjs) `openBrowser` | 部分 T23：深链解析；无实际此工具打开窗口回归。 |
| M11 | `submit_image_batch` | MCP；ID、版本、1–64 个 `requests`；每项 prompt/references/aspectRatio/size/anchorShapeId；可选 modelId、顶层 anchorShapeId、x/y、宽高、1–16 列 | 先原子预留全部框、持久化任务再生成；每项最多 10 个参考图。返回 jobId 后后台继续；固定模型 ID，冲突不发供应商请求，结果原位替换。 | [bridge-tools.mjs](../../mcp/bridge-tools.mjs) `tool('submit_image_batch')`；`createImageJobs.submit` | 部分 T10/T12：HTTP 同一处理器的占位、并发与失败；无以该 MCP 名称直接提交整批的专门回归。 |
| M12 | `get_generation_job` | MCP；ID、`jobId` | 只读目标板的该任务进度、已保存图片和 finished；不调用也继续生成，不跨板查询。 | [bridge-tools.mjs](../../mcp/bridge-tools.mjs) `tool('get_generation_job')`；`createImageJobs.get` | 有 T21：经 MCP 查询直至完成；T10 断言后台拒绝跨板 jobId，未找到经 MCP 名称直测跨板拒绝。 |
| M13 | `insert_cowart_html_draft` | MCP；ID、版本、`htmlContent` 或本机 `htmlPath`；可选 draftShapeId/anchorShapeId、fileName、显示尺寸、placement/margin/matchAnchor、shapeMeta、updateExistingDraft/replaceDraftHolder、dryRun | HTML、影片或 Slides 页写回；保留原框位置/旋转/容器，Slides 横排。`dryRun` 只核验目标和版本，不落文件/改版本；正常写入返回新版本。每次读新版本，原稿保留策略须按操作显式传参。 | [bridge-tools.mjs](../../mcp/bridge-tools.mjs) `tool('insert_cowart_html_draft')`；`createCanvasMedia.insertHtml`；`placeMedia` | 部分 T01/T19：三类写回及无需页参数；dryRun、htmlPath 和所有定位参数组合未完整覆盖。 |
| M14 | `insert_cowart_image` | MCP；ID、版本；本机 `imagePath`、dataUrl 或本板 assetUrl；可选锚点/占位、宽高、placement/margin/matchAnchor、shapeMeta、replaceAiImageHolder | 读取原始像素，新增普通图或替换 AI 图片框；按位置/尺寸/旋转/容器放置，已有图资源不得跨板。 | [bridge-tools.mjs](../../mcp/bridge-tools.mjs) `tool('insert_cowart_image')`；`createCanvasMedia.insertImage` | 部分 T10/T27：后台复用的同一插图处理器和像素识别；无 imagePath/dataUrl 各 MCP 入参分支全覆盖。 |
| M15 | `get_canvas_requests` | MCP；ID、可选 `requestId` | 领取本板持久请求，附目标、上下文、参考图及通用写回 guide；claimBy 由连接身份确定，会修改领取状态，并可能更新目标框元数据而改变 revision；不接收 expectedRevision，写作品前仍须重读。 | [bridge-tools.mjs](../../mcp/bridge-tools.mjs) `tool('get_canvas_requests')`；`createAgentRequests.list` | 有 T03：领取、完成后不再领取与不同板隔离；重投见 T28。 |
| M16 | `complete_canvas_request` | MCP；ID、requestId、status=completed/failed、可选 message | 由领取方报告请求结果；先写作品再完成。修改请求状态、可能清理目标任务标记，服务内部按最新版本处理；调用不接收 expectedRevision，不是插入作品的替代。 | [bridge-tools.mjs](../../mcp/bridge-tools.mjs) `tool('complete_canvas_request')`；`createAgentRequests.complete`、`markTarget` | 部分 T03/T28：完成与迟到终态保护；无所有失败/归属组合。 |
| M17 | `read_cowart_page_asset` | MCP；ID、`assetUrl` | 只读本板 assets/page-assets 的图片或 HTML 等资源，返回 base64/类型/路径；限制 20 MB，拒绝跨板和路径逃逸；无 expectedRevision。名称保留上游兼容，不提供页面管理。 | `tool('read_cowart_page_asset')`；`createCanvasMedia.readAsset`；[routes.mjs](../../server/routes.mjs) `createCanvasMiddleware` | 部分 T14/T21/T26：其他入口的跨板资源保护；未找到经此 MCP 工具直接读取的专门断言。 |

## 测试索引（当前仓库已有测试）

同编号可引用多个完整测试名；上表标「部分」时，不因测试标题提到整套流程就把未断言的界面算作已覆盖。`npm test` 和 `npm run check` 都使用隔离目录与模拟 API。上游仓库的 `scripts/probe-*` 没有进入当前检查入口，不计为现有回归覆盖。

| 引用 | 文件 | 完整测试名（用于搜索） |
| --- | --- | --- |
| T01 | [bridge.test.mjs](../../server/bridge.test.mjs) | `通用 MCP 将 HTML 和影片原位替换到原版占位框，Slides 页面仍属于同一套演示` |
| T02 | [bridge.test.mjs](../../server/bridge.test.mjs) | `独立画板可保存 DOM 修改并将整套 Slides 导出同一目录，拒绝跨目录文件名` |
| T03 | [bridge.test.mjs](../../server/bridge.test.mjs) | `画板按钮创建持久请求，绑定 Agent 经 MCP 获取并完成；另一个对话不收到请求` |
| T04 | [image-api.test.mjs](../../server/image-api.test.mjs) | `用户添加任意模型后可重读配置，密钥不回显，配置文件仅本人可读` |
| T05 | [image-api.test.mjs](../../server/image-api.test.mjs) | `可切换、编辑和删除模型；换地址不能沿用旧密钥；外部网页不能操作设置` |
| T06 | [image-api.test.mjs](../../server/image-api.test.mjs) | `生成请求使用用户填写的地址和模型；图片本机落盘且能从结果列表找回` |
| T07 | [image-api.test.mjs](../../server/image-api.test.mjs) | `Gemini 格式按用户所选模型发送文字及参考图，读取真正的图片结果` |
| T08 | [image-api.test.mjs](../../server/image-api.test.mjs) | `带参考图的 OpenAI 兼容请求使用 multipart；服务出错不回显密钥、不自动重试` |
| T09 | [image-api.test.mjs](../../server/image-api.test.mjs) | `URL 图片会下载到本机，下载不附带密钥；重定向不会泄漏鉴权` |
| T10 | [image-jobs.test.mjs](../../server/image-jobs.test.mjs) | `16 张一次建好 4×4 占位，后台限并发执行；切默认模型和编辑画布不改变任务或丢数据` |
| T11 | [image-jobs.test.mjs](../../server/image-jobs.test.mjs) | `服务重启只恢复尚未发送的队列，中断的收费请求不会自动重发` |
| T12 | [image-jobs.test.mjs](../../server/image-jobs.test.mjs) | `删除目标后保留生成结果；某一张失败不妨碍其余图片，不自动重试收费请求` |
| T13 | [conversations.test.mjs](../../server/conversations.test.mjs) | `两个对话内容和视角隔离；相同版本的并发修改只有一个提交成功` |
| T14 | [conversations.test.mjs](../../server/conversations.test.mjs) | `批量修改原子提交，非法记录不会覆盖已有画板，也不允许跨对话引用图片`；`真实编辑器的 user 文档记录也能保存；错误键、循环父子关系和跨对话资源被拒绝`；`路径样式的正文保持原样，资源只限定 URL 字段且拒绝归一化后的跨对话地址` |
| T15 | [conversations.test.mjs](../../server/conversations.test.mjs) | `MCP 可在没有画板时创建对话，同一个绑定键重连保持原对话`；`服务重建后仍可恢复对话，显式错误 ID 不得偷偷创建空对话`；`我的画板恢复旧视角后写入新位置，不覆盖原始视角文件` |
| T16 | [delete-boards.test.mjs](../../server/delete-boards.test.mjs) | `删除只移除目标画板，保留文件；旧绑定和重启不会复活，最后一个也能删除`；`真实 MCP 删除工具声明破坏性、检查版本，并保留已删除绑定直到明确新建` |
| T17 | [delete-boards.test.mjs](../../server/delete-boards.test.mjs) | `删除与保存使用同一画板锁，已变化的版本拒绝删除，删除后迟到写入也被拒绝`；`删除会通知已打开窗口，原画板资源及请求不再可访问`；`删除画板后未发送的图片不再调用模型，已发出图片保存但不复活画板`；`删除与 Agent 请求共享生命周期锁，等待旧锁的领取不会越过删除边界` |
| T18 | [canvas-lifecycle.test.mjs](../../tools/canvas-lifecycle.test.mjs) | `SSE 在首次连接及断线恢复时核验已删除画板，普通离线不误判，卸载后停止处理`；`初始读取或保存返回410时通知画板退出编辑；其他错误不触发删除`；`旧核验未返回时收到重连错误，旧成功结果之后仍补查删除状态` |
| T19 | [single-canvas.test.mjs](../../server/single-canvas.test.mjs) | `旧多页合成一个画布，保留嵌套、旋转、图层和原始快照，重复读取不重复移动`；`单画布约束由服务端守住，不能经批量操作或整份快照另建、替换、删除内部画布`；`MCP 无需页面参数即可创建普通形状与 HTML，生图接口也不暴露页面选择`；`新版 MCP 与桌面深链拒绝复用旧多页服务，不在其上隐藏页面` |
| T20 | [persistenceFeedback.test.mjs](../../tools/persistenceFeedback.test.mjs)、[canvasNavigation.test.mjs](../../tools/canvasNavigation.test.mjs) | `保存失败持续提示；成功只清除对应失败；重试与关闭页面保护随状态变化`；`切换对话先等待保存并清除未保存提示；保存失败或期间继续编辑时保留当前页` |
| T21 | [mcp.test.mjs](../../server/mcp.test.mjs) | `同一 MCP 连接并发首次打开时只创建一个对话，各请求返回自己的绑定`；`两个独立 MCP 客户端创建各自对话；批量读写、重连绑定和重复打开均不串板`；`MCP 复用用户配置生图、插入图片、看图并参考改图；模型密钥不进入 MCP 输出`；`生图期间出现并发编辑，结果仍可找回且不会覆盖画板或自动重试` |
| T22 | [mcp.test.mjs](../../server/mcp.test.mjs) | `真实 stdio MCP 进程可被通用客户端发现并调用工具` |
| T23 | [desktop-connection.test.mjs](../../tools/desktop-connection.test.mjs) | `桌面与 MCP 共享配置；显式资料目录覆盖保存的目录`；`深链保留对话，只接受本机画板和明确资料标识`；`深链拒绝其他资料目录的已运行服务`；`深链切换和关闭先完成保存，保存失败保持原窗口`；`GUI 服务没有终端环境时，仍可发现本机 REX，不接收 HTTP 指定的程序`；`画板相同、模型设置目录不同时拒绝复用后台`；`尚未挂载编辑器的加载/错误页面也可关闭；已挂载时等待保存` |
| T24 | [skill-install.test.mjs](../../tools/skill-install.test.mjs) | `discovery asks when none or multiple, deduplicates aliases and respects saved custom directory`；`first launch asks for missing directory, remembers choice and deploys only there`；`cancel keeps app usable; choose later retries; damaged bundle leaves deployed skill intact` |
| T25 | [skill-install.test.mjs](../../tools/skill-install.test.mjs) | `install and upgrade only owned files; conflicts leave all files intact until explicit backup`；`preexisting unowned skill and nested symlinks are never overwritten silently`；`changing directory keeps old harness links current, but preserves modified old files`；`user-deleted owned reference is a conflict and custom-named skill symlink stays valid`；`concurrent edit during staging aborts upgrade and preserves the new user content`；`moving a skill with user-deleted files keeps the old directory and reports it` |
| T26 | [storage.test.mjs](../../server/storage.test.mjs) | `图片内容保存到页面资源目录，重开仍引用同一份资源`；`HTTP 保存与重开使用同一份画板，非法输入不会覆盖已有文件`；`非法视口不会覆盖有效状态；选择项可以恢复`；`已有旧文件含损坏记录时停止导入，原始文件保持不变` |
| T27 | [image-dimensions.test.mjs](../../server/image-dimensions.test.mjs)、[canvasImages.test.mjs](../../tools/canvasImages.test.mjs) | `常见生图格式按真实像素尺寸插入，坏文件拒绝插入并保留已保存结果`；`两次生成的图片使用不同文件名，避免保存时互相覆盖；比例保持不变`；`生成期间切到别页，仍放回原页且不切走用户选择；原页或框已删除则保留结果并提示找回` |
| T28 | [rex-delivery.test.mjs](../../server/rex-delivery.test.mjs) | `REX 回传只发到原 AI 进程，不会把用户提示词输入 shell，也不执行客户端指定的程序`；`并发重复点击只投递一次；迟到的回执不回退终态，新任务可再次使用同一目标`；`已通知但未领取的请求，接收进程更换后重新唤起新 Agent`；`画板请求经绑定接收器发出；持久化后重连可领取，重复点击标识不会重复派发` |
| T29 | [board-startup.test.mjs](../../tools/board-startup.test.mjs) | `所有画板已删除时启动为空状态，重开不重新创建默认画板`；`上次画板已删除时恢复现存画板；显式已删除链接返回删除状态，不偷偷替换` |
| T30 | [local-service.test.mjs](../../server/local-service.test.mjs) | `独立服务同时提供构建资源和完整画板接口，保持本机边界` |
| T31 | [file-lock.test.mjs](../../server/file-lock.test.mjs) | `持锁进程异常退出后可恢复，多个等待者不会同时进入保存区` |

## 覆盖说明与验收边界

本表按用户流程粒度记录 C01–C38 共 38 条继承/适配流程，H01–H42 共 42 条新增行为，M01–M17 共 17 个公开工具。HTTP 路由没有另计一遍功能：模型配置映射 H17–H22，画板和 sidecar 映射 H04–H16，图片任务映射 H23–H29，请求和接收器映射 H30–H33，HTML 保存/参考资源/导出映射 C06/C12–C18/C35–C36 与 M13/M17。`/api/images` 的同步兼容生成由 H21 与 T06–T09 记录，当前图片框走后台 jobs。

没有自动测试直接覆盖的主要区域：Cowart 创作界面、所有生成面板、标注绘制与截图、网页/影片文字的浏览器编辑、HTML/PNG/MP4 的真实渲染导出、Slides 拖放/演示/播放器、主工具栏拖动、重命名界面、冲突备份恢复、语言与设置浮层、接入指令剪贴板与原生菜单。T01/T02 的服务端写回和文件落盘不能替代这些界面断言。M02/M10/M11/M14/M17 没有经对应 MCP 名称完整调用的专门回归；M13 的 dryRun/htmlPath 也没有完整分支回归。

未核实：C05 的尺寸面板实际可达路径；真实供应商协议差异与生图质量；影片在具体 Chromium/系统上的 H.264/AAC 能力、音画同步、内嵌视频捕获和 MP4 成片；导出 HTML/Slides 在外部浏览器的运行结果；所有外部 AI 宿主的真实配置接入。读取到代码入口的置信度高；这些端到端运行结果为未知。

另有 [desktop-app.md](desktop-app.md)、[通信桥验收.md](通信桥验收.md) 和 [tools/smoke-desktop.mjs](../../tools/smoke-desktop.mjs) 的历史/专项步骤；本单没有重跑真实桌面窗口或签名安装包，不将历史记录算作本次验证。SDK 许可入口在本基点隐藏，许可检查与许可证文件存在；恢复提示由工单 #16 处理，不是这里新增的功能。

| AI 本单自测层次及断言所防的问题 | 需用户在后续新底座验收时验证（操作 → 期望） |
| --- | --- |
| 静态核对源文件、符号、测试名及 MCP 注册集合 → 防遗漏工具、引用不存在的代码和夸大测试覆盖。 | 逐项走 C 类生成、标注、编辑与导出 → 原稿保留、目标正确，网页/影片/幻灯片都能继续编辑使用。 |
| `npm run check`：已有隔离自动测试、样式/令牌、Web 构建、构建资源、桌面 bundle 与工程检查 → 防文档位置、敏感内容及现有构建/回归破坏。具体执行结论以本次派活结果为准。 | 用合成带声音影片导出 MP4，打开成片 → 画面、时长、音轨与进度一致；导出 Slides 的 `Play.html` → 翻页与交互正常。 |
| 本单没有操作真实画板、调用真实模型或实际 hiCanvas MCP。 | 设置、画板新建/切换/重命名/删除、Skill 安装与复制指令 → 界面可达、取消有效、原有资料和配置保留。 |

工单 #21 的完成核对（指文档验收项，不是所有产品行为已测试）：

- [x] 当前代码与固定 Cowart 基线入口有据可查，tldraw 默认能力交由 #20。
- [x] 每条具有编号、名称、触发方式、预期行为、文件/符号及覆盖状态。
- [x] 当前 17 个 MCP 工具逐个列出，注明目标、输入、版本与状态写入例外。
- [x] 末尾说明覆盖缺口、未核实项与真人验收步骤。
- [x] 项目完整检查通过：98 项隔离自动测试通过，Web 构建、构建资源、桌面 bundle、样式/令牌及工程检查均通过；未操作真实画板或模型。

## 与旧版的有意差异

| 编号 | 差异 | 原因 | 工单 |
| --- | --- | --- | --- |
| C01–C04（工具栏拖入） | 拖到画布外或界面按钮上松手取消；旧版在 x=-20 松手仍保存矩形 x=-120/y=330/w=200/h=200。 | 将界面外松手作为放弃，避免隐藏对象。 | #126 |
| C01–C04（拖入首帧） | 第一帧预览直接跟随指针；旧版第一帧停在工具栏起手位置，下一帧或松手才跟上。 | 避免首帧在工具栏闪现。 | #126 |
| C01（星形、云形、心形边界） | (500,350)→(650,430) 时，旧版星形 x=499.82110936132005/y=350/w=150.35778127735986/h=80.72700079076078；云形 x=500/y=346.24659754821914/w=150/h=87.50680490356174；心形 x=500/y=349.5531112507849/w=150/h=80.44688874921506。新版三种均为 x=500/y=350/w=150/h=80。 | 新轮廓按完整宽高归一化，创建框与指针框一致；默认点击尺寸和 Shift/Alt 规则保留。 | #126 |
