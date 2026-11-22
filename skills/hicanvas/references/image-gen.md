# 在 hiCanvas 生成图片

## 目标与输入

使用已有 `conversationId`；首次用 `open_conversation` 建立绑定。画板请求携带的对话、页面和目标框 ID 优先于后来变化的选择项。已有画板不再调用 `open_canvas`。

## 操作步骤

1. 调用 `get_canvas`，记录最新 `revision`。页面依次取请求指定页面、目标框所属页面、`viewState.currentPageId`；新对话没有视角时取 `snapshot.store` 中的唯一 page。多页且目标不明时先确认，不为普通生图另建页面。
2. 有目标框时读取其 `props.w`、`props.h` 和 ID。AI 图片框标记为 `meta.cowartAiImageHolder: true`。没有选中框也可生成，无需让用户先画框。
3. 用 `list_image_models` 读取模型。优先用户指定的模型，否则使用 `activeModelId`。没有可用模型时让用户在设置中添加，不读取密钥或替用户填写服务。
4. 为每张图片准备独立提示词。保留要求的文案、主体、参考图和比例。将比例同时写入提示词与每项的 `aspectRatio`；模型支持精确像素尺寸时填写 `size`，不靠拉伸或裁切满足比例。
5. 调用一次 `submit_image_batch`，传 `conversationId`、`expectedRevision`、`pageId`、`modelId` 和完整 `requests`。单张也走此工具。参考图填入各项 `references`，使用本对话资源地址或图片 data URL。
6. 替换已有 AI 图片框时传 `anchorShapeId`，显示宽高取目标框；新图使用合适的 `displayWidth`、`displayHeight`。让画板自动建占位和排网格；用户未指定时保留默认列数。超过单批 64 张时按上限拆批。
7. 记录 `jobId`，告诉用户已提交及所在页面。画板独立完成后台生成和原位替换，返回后无需逐张接力或持续轮询。用户询问进度时用 `get_generation_job`；逐项区分已插入、仅保存和失败，`finished: true` 不代表全部成功。

## 约束

- 已有图片只需放入画板时，用 `insert_cowart_image`，不重新生图。
- 保留用户已有图片和标注。改图新稿放原图旁，阅读 [改图操作](image-edit.md)。
- `revision-conflict` 时重新读取并合并后提交；结果不明或已经返回 `jobId` 时先查任务，不重复提交收费请求。
- 失败不自动重试。图片已保存但目标框已删除时，用 `list_image_results` 找回，不重新生成。
- 不直接修改画板文件，不重新打开窗口或擅自改变用户视角。
