# 在 hiCanvas 生成幻灯片

## 操作步骤

1. 复用 `conversationId`；画板通知用 `get_canvas_requests` 领取。用 `get_canvas` 读取目标、页数、参考图和最新 `revision`；页面优先请求或目标所属页面，其次 `viewState.currentPageId`，新对话无视角时取快照中的唯一 page。
2. Slides 容器为 `type: "frame"` 且 `meta.cowartAiSlides: true`。没有容器时，用 `apply_canvas_operations` 的 `create_shape` 创建，显式传新 `id: "shape:<唯一值>"`、`shapeType: "frame"`、`parentId: pageId` 和空闲位置；`props` 取 `w: 1048`、`h: 600`、`name: "幻灯片"`。后续使用这个自行指定的 ID。
3. 按用户要求的页数设计连续叙事，未指定时使用 5 页。每页独立完整 HTML，默认设计尺寸 1024×576；风格统一、版式服务内容，文字保留为 DOM，样式和脚本内联。
4. 按页序调用 `insert_cowart_html_draft`，每次都把同一个容器 ID 作为 `draftShapeId`。设置 `replaceDraftHolder: false`、`updateExistingDraft: false`、`matchAnchor: false`、`displayWidth: 1024`、`displayHeight: 576`，文件名用 `slide-01.html` 等顺序名。
5. `shapeMeta` 填入 `cowartAiSlidesParentShapeId`、`cowartAiSlidesGeneratedPageCount` 和从 1 开始的 `cowartAiSlidesGeneratedPage`。每次沿用上次写回的 `revision`；冲突时重新读取。画板自动排列子页和扩展外框。
6. 直接修改指定单页时，以该页的 ID 写回并使用 `updateExistingDraft: true`。要求整套标注修订时创建新容器，原演示与标注保留。
7. 核对页数、顺序和容器归属。领取的请求在全部页面写回后再 `complete_canvas_request`。画板支持演示、逐页 PNG 与整套 HTML 导出。

## 约束

- 不替换或删除 Slides 容器，不把所有幻灯片拼进一张图。
- 不重复打开画板，不把 HTML 导出说成原生 PPTX。
- 中途失败时保留已写回页面，报告具体缺少的页，不重新提交已完成内容。
