# 在 hiCanvas 生成影片

制作完整单文件 HTML/CSS/JavaScript 影片，由画板提供播放、文字编辑及带音轨 MP4 导出。

## 目标与输入

复用 `conversationId`。画板通知先用 `get_canvas_requests` 领取，使用请求的目标 ID、参考图、比例、风格和时长。用 `get_canvas` 读取目标框及最新 `revision`。已有画板不重新打开。

影片框标记为 `meta.cowartAiFilmHolder: true`，已生成影片标记为 `meta.cowartFilm: true`。目标框的宽高是构图和放置契约；没有框时使用用户要求的比例，默认 16:9。未指定时长时取约 15 秒。

## 风格

阅读 [分镜与导演指南](directing.md)、[播放与导出协议](runtime-contract.md)，再按请求选择一份风格参考：

| 风格 ID | 类型 | 参考 |
| --- | --- | --- |
| `kinetic-type` | 动态文字 | [kinetic-type.md](kinetic-type.md) |
| `product-launch` | 产品发布 | [product-launch.md](product-launch.md) |
| `abstract-physics` | 抽象物理 | [abstract-physics.md](abstract-physics.md) |
| `editorial-story` | 叙事短片 | [editorial-story.md](editorial-story.md) |
| `data-flow` | 数据流 | [data-flow.md](data-flow.md) |

## 操作步骤

1. 在工作笔记里确定主体、视觉规则、时长和分镜时间表。每个镜头写清动作、结果、阅读停留和转场衔接；简短作品不必拆成很多镜头。
2. 先做好主视觉和最难动作，再沿同一套颜色、造型、字体与空间关系完成其余镜头。读取并使用参考图，嵌入实际用到的素材。
3. 制作单文件 HTML。所有视觉状态由统一时间线计算，30 FPS 量化；直接跳到任意时间都能重建该帧，随机效果使用固定种子。重要文字为可编辑 DOM，跳转时不重写用户编辑的文字。
4. 按播放协议实现 `window.CowartFilm` 与 `cowart-film` 消息，提供 `duration`、`seek`、`play`、`pause`、`setMuted` 和 `renderAudio`，异步初始化提供 `ready`。`renderAudio` 返回完整时长的 AudioBuffer，包含音乐与音效；声音和动作共享事件时间。
5. 按 [视觉检查](visual-review.md) 检查开头、动作峰值、转场和最后编码帧，以及前后跳转、文字编辑、静音和音轨。没有相应工具时说明未验证项，继续完成可执行的交付。
6. 调用 `insert_cowart_html_draft`，传 `conversationId`、`expectedRevision`、目标 `draftShapeId`、完整 `htmlContent` 或 `htmlPath`。新稿显式设 `updateExistingDraft: false`；临时影片框使用 `matchAnchor: true`、`replaceDraftHolder: true`，只有明确原位编辑才设 `updateExistingDraft: true`。
7. `shapeMeta` 设置 `cowartFilm: true`、真实的 `cowartFilmStyle` 和 `cowartFilmDuration`。无目标时传设计的 `displayWidth`、`displayHeight`。按标注生成新稿时设 `updateExistingDraft: false`、`replaceDraftHolder: false`、`placement: "right"`，保留原影片。
8. 核对真实写回返回的形状、尺寸与资源路径；有领取请求时再用 `complete_canvas_request` 标记完成。失败保留已完成 HTML，不重新制作已有结果。

## 约束

- 影片 HTML 只含作品；播放、时间轴和静音控件由画板提供，不烘焙进作品。
- 除用户要求外，不调用图片或视频模型，不增加 CDN、远程字体或运行时安装依赖。
- 首帧默认暂停，播放限制不阻止视觉显示。拖动进度时不重复触发音效。
- 工具拒绝写入时如实报告，不改权限设置或绕过 MCP 直接写画板文件。
