---
name: hicanvas-open-canvas
description: 打开、重新打开 hiCanvas 画板，或按用户要求新建画板对话。生成和修改已有画板内容时不必重新打开。
---

# 打开 hiCanvas

## 操作步骤

1. 使用 hiCanvas MCP。已有 `conversationId` 时持续使用；首次调用 `open_conversation`，传宿主提供的稳定聊天标识作为 `bindingKey`，记录返回的 `conversationId`。
2. 用户明确要求新建对话时，调用 `open_conversation`，设置 `createNew: true` 和合适的 `title`。无需用户先在画板里手动创建。
3. 用户要求看到画板时，首次打开可设置 `openWindow: true`；已有对话使用 `open_canvas`。一次打开请求只调用一次。
4. 返回画板链接。使用 `get_canvas` 读取当前页面、选择项和视角，继续操作同一对话。

## 约束

- 生图、改图、网页、影片和幻灯片请求复用已有画板，不把打开窗口当作前置步骤。
- 浏览器切换对话不改变 Agent 绑定；子 Agent 使用同一个 `conversationId`。
- 没有宿主聊天标识时保留返回的 ID，不自拟一个供所有聊天共用的绑定键。
- 工具缺失时先发现 hiCanvas MCP 工具；仍不可用时说明缺少哪项，不自行启动其他端口或修改配置。
