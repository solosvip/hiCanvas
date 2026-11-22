# 在 hiCanvas 生成 HTML

## 操作步骤

1. 复用 `conversationId`。收到画板通知时用 `get_canvas_requests` 领取请求，使用请求的目标 ID、参考图和尺寸。
2. 用 `get_canvas` 读取目标和最新 `revision`。优先使用请求目标，否则使用选中的 HTML 框。没有框也可插入新网页，默认 16:9。
3. 查看参考图；已有页面需要修改时用 `read_cowart_page_asset` 读取 HTML。制作完整单文件 HTML，内联样式和脚本，资源内联或使用本画板资源地址；重要文字保留为可编辑 DOM。
4. 调用 `insert_cowart_html_draft`，传 `conversationId`、`expectedRevision`、`htmlContent` 或 `htmlPath`、`fileName`。有目标时传 `draftShapeId`，按目标宽高设计。
5. 生成新稿时显式设置 `updateExistingDraft: false`；目标是临时网页框时使用 `matchAnchor: true`、`replaceDraftHolder: true`。只有明确直接编辑原网页才设 `updateExistingDraft: true`。按标注迭代时另设 `replaceDraftHolder: false`、`placement: "right"`，保留原稿。
6. 多个独立网页逐个插入；第一张之后以返回的 `shapeId` 为锚点，设置 `updateExistingDraft: false`、`replaceDraftHolder: false`、`matchAnchor: false`、`placement: "right"`。
7. 核对返回的形状、画板和保存路径。领取的请求在所有内容写回后，用 `complete_canvas_request` 报告完成；失败说明已完成到哪一步。

## 约束

- 不重复打开画板，不覆盖其他形状，不用截图代替可运行网页。
- 每次写回使用最新版本；冲突后重新读取，不直接覆盖旧快照。
- 保留用户未要求改变的内容、交互和标注。
