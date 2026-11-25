---
name: hiCanvas — Cowart baseline
description: 沿用用户选定的 Cowart 画板；本次导入保持原有视觉与组件，不做风格合并或重新设计。
colors:
  primary: "#2f80ed"
  secondary: "#596170"
  tertiary: "#0ea5e9"
  neutral: "#f7f5ef"
  surface: "#ffffff"
  on-surface: "#25282d"
  on-neutral: "#1f2430"
  error: "#c2410c"
  success: "#1f8f4d"
  outline: "#d1d5db"
  scrim: "#25282d80"
typography:
  body-md:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 14px
  label-md:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1
spacing:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
components:
  toolbar-handle:
    width: 28px
    height: 32px
  annotation-tool:
    width: 76px
    padding: "{spacing.md}"
    typography: "{typography.label-md}"
  generation-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
---

## Overview

来源是 Cowart 提交 `38bdafeff47374ddbc11b12bddbc4f1f4cf14587`。用户已确认以它为基础、保留现有界面；本轮只改变运行方式，不重新安排组件，也不把近似样式值合并。

Cowart 与 tldraw 的既有组件是本轮沿用的上游界面。`src/styles/cowart-*.css` 是按完整规则拆分的上游样式；画板形状的坐标、比例、尺寸、颜色属于用户文档数据，不作为应用界面令牌收敛。

## Colors

画布外层使用原有暖色底板，浮层和工具栏保持原有表面、文字与焦点色。成功、错误与禁用状态沿用来源组件的反馈；不得用品牌色重染用户画出的形状。

## Typography

字体沿用系统无衬线字体序列。标注按钮的字号、字重和行高直接取自 Cowart。tldraw 自带的字体、形状文字与编辑器内部尺寸由其组件维护。

## Layout

画布铺满窗口。保留可拖动工具栏、画板切换、右侧样式控件、上下文工具栏，以及所选 AI 框下方的原有面板布局。工具栏在窄窗口中使用上游的折叠菜单，不新增侧栏。

## Elevation & Depth

沿用上游浮层、菜单和演示层的阴影与层级；本轮不改变原有阴影与透明度组合。

## Shapes

保留 Cowart/tldraw 的圆角、图标与标注箭头。标注箭头的默认曲率、文本位置与连续标注交互保持不变。

## Components

基础画板、拖动手柄、标注工具、颜色与样式面板、图片工具栏、AI 框及生成面板、HTML 编辑工具栏、Slides 工具栏与演示层均复用上游组件。默认、悬停、焦点、选中、禁用、加载、错误状态沿用已有实现。

## Do's and Don'ts

既有样式值记录在 `tools/upstream-styles.json`，允许逐步替换成令牌，不允许新增或复制字面量扩张例外。新增 hiCanvas 界面使用由本文件生成的令牌，优先扩展现有组件。修改上游视觉时先提炼涉及的实际值并确认，不借独立运行改造重画界面。API、MCP、模型配置尚未接入的能力不得提示已经成功执行。

统一设置入口位于画板现有左上菜单栏，与菜单按钮保持同一排；点击后使用原生模态窗口承载设置分区。设置以紧凑页签切换「生图模型」和「AI 接入」；AI 接入显示部署状态、目录、更改目录和复制接入指令。当前生图设置包含可增删改的模型配置，沿用画板浮层的白色表面、圆角和间距。主按钮使用正文色底与白字。图片结果使用菜单栏独立入口，按当前画板显示小图、放入画板和下载，不放在设置内。

## 画板与图片结果

沿用已确认的白色浮层、圆角、阴影、紧凑按钮和首行对齐的圆形关闭按钮。画板入口位于现有左上菜单栏，显示当前名称；点击后在名称下方展开紧凑下拉列表，当前画板用勾选标记；支持新建、命名和切换，不遮罩画布。新建、重命名与删除确认在同一下拉层内完成。切换前必须保存当前画板；保存失败保持原页并显示错误。图片结果为独立浮层，只显示当前画板的生成图片。画板列表与结果区域可滚动，键盘可达，Escape 关闭并恢复入口焦点。所有新样式复用既有令牌，不新增永久侧栏。


## 生成与 Agent 请求状态

沿用原 AI 框和 tldraw 加载动效，在框中央显示排队、正在生成、等待 Agent、处理中、失败或中断。提交成功只提示任务已提交；结果回到原框后才算完成。非占位框请求用统一通知反馈，不增加第二套生成面板。生成期间禁用重复提交，保留移动、缩放和其他画板操作；提示文字和背景均复用现有令牌；框内文字跟随 tldraw 的 --tl-color-text-1 主题令牌，保证深色画板同样可读。

## 单画布

每个画板只有一张无限画布。顶部仅显示画板名称，不显示 Page 1 或页面菜单；右键菜单、快捷键和操作列表均不提供页面管理。图片、HTML、影片和幻灯片仍使用原工具栏，在画布内通过位置、分组和画框组织。

## 画板管理

画板列表每行右侧使用紧凑的「⋯」图标按钮，打开包含重命名和删除的浮动菜单，删除项使用错误色文字。确认删除时在同一浮层展示画板名称与影响，取消在左、删除在右，默认焦点在取消；删除按钮使用错误色实底，复用现有间距、圆角和字体令牌。最后一个画板删除后显示居中空状态、新建入口；已有其他画板时提供选择入口。浮动菜单可通过方向键、Tab、Escape 操作，不将整行按钮与菜单按钮嵌套。
