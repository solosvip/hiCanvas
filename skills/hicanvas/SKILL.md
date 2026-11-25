---
name: hicanvas
description: 通过 MCP 使用 hiCanvas 画板，创建或恢复画板、批量生图、按标注改图，以及生成和编辑 HTML 原型、幻灯片、动效影片。用于接入 hiCanvas、在画板中创作，或处理来自该画板的请求。
---

# hiCanvas

用户要求安装或连接 MCP，或当前宿主没有 hiCanvas 工具时，先读取 [接入说明](references/connect.md)。

## 画板

1. 使用 hiCanvas MCP。请求带有 `conversationId` 时优先使用；已有绑定则持续复用。首次调用 `open_conversation`，传宿主提供的稳定聊天标识作为 `bindingKey`，记录返回的 ID。没有宿主标识时保留返回 ID，不自拟所有聊天共用的键。
2. 用户明确要求新建画板才设置 `createNew: true`，无需用户先手动创建。浏览器切换画板不改变 Agent 绑定；参与同一任务的子 Agent 沿用同一 ID。
3. 用户要求看到画板时，首次打开设置 `openWindow: true`，已有画板用 `open_canvas`；一次打开请求只调用一次并返回链接。生成或修改已有内容不重复打开窗口。
4. 每个画板只有一张无限画布，无需选择或新建页面。用 `get_canvas` 读取最新 `revision` 和目标形状；请求目标优先于后来变化的选择项。普通形状省略 `parentId` 自动放入画板，只有放进已有画框或分组时才指定父形状。
5. 用户明确要求删除画板时，核对目标后用最新 `revision` 调用 `delete_conversation`。遇到已删除的画板 ID，先报告并等待用户选择其他画板或要求新建，不自行创建替代画板。

## 按任务读取

只读取当前任务需要的操作说明：

| 任务 | 操作说明 |
| --- | --- |
| 单张或批量生图 | [生图](references/image-gen.md) |
| 根据标注和参考图改图 | [改图](references/image-edit.md) |
| HTML 页面、网页原型 | [HTML](references/html-gen.md) |
| 幻灯片 | [幻灯片](references/slides-gen.md) |
| 有时间线和音轨的动效影片 | [影片](references/film-gen.md) |

普通形状与文字使用 `apply_canvas_operations`，已有图片插入用 `insert_cowart_image`。收到画板通知先用 `get_canvas_requests` 领取指定请求；内容实际写回后才用 `complete_canvas_request` 报告完成。

## 写入约束

- 每次写入携带 `conversationId` 和最新 `expectedRevision`；冲突时重读并合并，不用旧快照覆盖。
- 图片整批一次提交给画板；返回 `jobId` 表示已提交，画板独立完成占位、排版和生成。任务已受理或结果不明时先查询，不重复收费提交，失败不自动重试。
- 保留未要求改动的原稿与标注，不擅自改变视角，不直接改画板文件。
- 工具缺失时先发现 hiCanvas MCP 工具；仍不可用时说明缺少哪项，不自行启动其他端口或修改配置。
