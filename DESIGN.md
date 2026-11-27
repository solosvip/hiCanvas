---
name: hiCanvas — Cowart baseline
description: 沿用用户选定的 Cowart 画板；本次导入保持原有视觉与组件，不做风格合并或重新设计。
colors:
  primary: "#2f80ed"
  overlay-brush-stroke: "#0000001a"
  overlay-brush-fill: "#0000000a"
  minimap-background: "#edf0f2"
  minimap-shape: "#6e7477"
  minimap-viewport: "#0000001a"
  overlay-crop-ghost: "#0000001a"
  overlay-scribble-stroke: "#2f80ed52"
  overlay-eraser-preview: "#00000052"
  overlay-eraser-stroke: "#0000000a"
  overlay-laser-stroke: "#ff0000b3"
  grid-dot: "#6e6e6e"
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
  overlay-selection-stroke: 2px
  overlay-brush-stroke: 1px
  overlay-scribble-stroke: 12px
  overlay-eraser-stroke: 12px
  overlay-laser-stroke: 4px
  overlay-handle-size: 10px
  overlay-handle-stroke: 2px
  overlay-handle-hit: 12px
  overlay-edge-hit: 8px
  overlay-rotate-offset: 7px
  overlay-rotate-radius: 6px
  minimap-width: 152px
  minimap-height: 88px
  minimap-breakpoint: 840px
  text-editor-min-width: 1px
  grid-dot-radius: 1px
  grid-dot-offset: 0.5px
  grid-l1-fade-start: 7px
  grid-l1-fade-range: 18px
  grid-l4-fade-start: 6px
  grid-l4-fade-range: 34px
  grid-l16-fade-start: 8px
  grid-l16-fade-range: 52px
  grid-l64-fade-start: -640px
  grid-l64-fade-range: 736px
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

画板右下角保留 tldraw SDK 的官方许可提示；浏览器与桌面版均使用 SDK 原始组件、文字和行为，不通过样式或脚本遮挡、隐藏或改写。

## Elevation & Depth

沿用上游浮层、菜单和演示层的阴影与层级；本轮不改变原有阴影与透明度组合。

## Shapes

保留 Cowart/tldraw 的圆角、图标与标注箭头。标注箭头的默认曲率、文本位置与连续标注交互保持不变。

## Components

激光笔复用橡皮的有限世界点列校验、外框和圆头路径绘制；使用 overlay-laser-stroke 色彩与宽度令牌，线宽固定4屏幕CSS px。两个独立白底旧版截图的中心合成色为RGB(255,77,77)，黑底为RGB(178,0,0)，永久原生守卫逐通道容差3；中心色不代表整条轮廓逐像素相同。激光路径实际显示时才校验令牌，不增加画板记录订阅；只读展示宿主可以不加载编辑令牌。点列随相机投影，消退从起点向末端收短，期间宽度和alpha不变。准确缓动未知，按已审定的1200ms等待、每16.7ms一点评估及总收短500ms上限做确定性近似，简单圆头折线与旧版末端平滑/约16px滞后有意不同。

网格点阵在作品下方，用 grid-dot 色和固定屏幕 grid-dot-radius 半径、grid-dot-offset 像素偏移。基础格距属于交互规则（10画布单位），显示基础格距的1/4/16/64倍四层。每层根据自己在屏幕上的格距单独淡入，透明度由对应 grid-l1/l4/l16/l64-fade-start/range 令牌算出并夹在0–1；最粗一层的起点是负数，为了镜头拉得很远时仍然留着粗格点。四层共用同一个线性公式，参数来自隔离旧版26个视角的公开DOM读数。点阵随相机平移缩放，在低视角淡出密层，不拦截输入；关闭会话网格偏好即移除。

对象吸附提示线复用 error（接近旧版截图的红色）与 overlay-brush-stroke 细线，叉形锚点和等间距中点刻度复用 xs 长度；线宽与标记尺寸固定为屏幕 CSS 像素，位置使用画布坐标。旧版精确颜色和线宽未取得可确认读数，本轮沿用这些既有令牌，作为功能清单中的有意差异。提示仅在变换手势中显示，松手、取消、切换工具和失焦时清除；不增加正式设置界面。

便签四边中点显示相邻续建的「+」柄，屏幕尺寸固定，复用 overlay-handle-size、overlay-handle-stroke、overlay-rotate-radius、primary、surface、full 圆角令牌；十字由两条既有线宽和半径尺寸的主色短线组成。编辑时只隐藏纸面文字，保留纸面和署名；便签编辑区复用统一富文本视图、原字体、标签颜色和16px文档内边距，不新增应用浮栏。

线条和连接箭头的选中态显示圆形端点与段间控制柄，复用 overlay-handle-size、overlay-handle-stroke、primary、surface 和 full 圆角令牌；尺寸及点击范围保持屏幕 CSS 像素。单选连接线使用这些控制柄，多选仍用共同选择框。控制点吸附的临时指示使用同尺寸主色圆点，松手或取消即消失，不写入画板。

选择动作的合成预览将无快捷键的拉伸、堆排、紧凑排布、全部解锁和适配画框按钮放进既有视角工具栏，沿用现有按钮、禁用、焦点与间距令牌。可用状态由编辑层提供，不新增正式菜单或视觉令牌。

橡皮擦预览不改作品透明度记录：命中根的渲染透明度为原记录透明度乘 overlay-eraser-preview 的 alpha，普通绘制树与荧光背景树同步，避免后代重复淡化。alpha在挂载时读取八位十六进制CSS令牌、第一次显示淡化时解析，修改令牌后重新挂载生效；只展示不编辑的宿主不加载编辑令牌也能挂载；不对零尺寸组使用mask。尾迹使用 overlay-eraser-stroke 屏幕宽度、圆头；点列有界并随时间收短，停住保留末点，松手短暂收尾后消失。旧版精确寿命、尖尾及缓动未证实，本轮使用100ms和圆头折线近似，作为有意差异集中验收。尾迹色值由2026-11-27两组独立旧版白底截图与新版同位置对照确定：旧版头部合成RGB(246,246,246)，新版(245,245,245)，逐通道差1；使用overlay-eraser-stroke色令牌，永久原生守卫允许逐通道最多差3，不以Canvas反预乘RGBA推断色值。

画笔与荧光笔的合成编辑预览沿用既有工具按钮、焦点和禁用样式；当前工具用已有按下态标示。检测到触控笔后露出「退出手写笔模式」按钮，退出即隐藏；笔画颜色、粗细、压力与荧光叠色是画板文档数据，复用既有笔迹渲染，不新增应用界面令牌。

画布文字编辑区沿用形状自身的字体、字号、颜色和对齐，透明背景、无额外边框；插入点及选区使用浏览器原生反馈，不增加另一套浮栏。普通正文、几何标签和箭头标签由同一个富文本视图承载；画框标题用单行输入框，保留既有固定屏幕字号和标题位置。编辑区最小宽度只用于让空文字能放置插入点，采用 text-editor-min-width。编辑时浏览器断行，退出后使用画板统一排版。

文字合成预览的字号、字体、适用对齐及自动大小控件复用创建工具栏的按钮和禁用状态；按钮显示当前值，点击顺序切换，不支持的对齐禁用，保存期间全部禁用，编辑区暂时只读，失败后恢复编辑。

小地图沿用隔离旧版的运行画面：152×88 CSS 像素，灰色矩形代表形状（选中用主色），约 10% 黑色的圆角视口填充盖在形状上，背景为冷灰；不重复绘制照片或文字。地图按钮控制展开／收起，窗口宽度不超过 840px 时隐藏（2026-11-26 逐像素调整旧版窗口，840px 隐藏、841px 显示），恢复宽窗口后保留展开偏好。尺寸和配色置信度高，圆角约 4px，沿用 xs 令牌。取景是内容与视口并集、完整等比居中，不添加缩略图内边距。

2026-11-25 对照运行中的旧版测量，沿用既有观感，不是新设计：选择框使用主色、屏幕线宽约 2px；框选矩形使用约 10% 黑色描边、约 4% 黑色填充，屏幕线宽约 1px；覆盖层线宽不随画布缩放变化。规范没有线宽分组，画布覆盖层的线宽作为尺寸放在 spacing 里，名字以 overlay- 开头；只用于覆盖层，不用于间距。

2026-11-25 在隔离旧版 tldraw 5.1.1 合成画板中，以原生鼠标和 overlay canvas 截图像素测量：四角手柄外径 10px（含 2px 主色边框、白色内部），角点命中范围中心左右上下各 6px，边线命中范围各 4px；旋转区域不画图标，位于每个角向外两个方向各 7px 处、半径约 6px。像素尺寸置信度高，旋转命中圆来自鼠标光标网格观察、置信度中。尺寸及命中范围均为屏幕 CSS 像素，不随视角缩放变化；overlay- 前缀的 spacing 只用于覆盖层尺寸和输入命中，不用于页面间距。

基础画板、拖动手柄、标注工具、颜色与样式面板、图片工具栏、AI 框及生成面板、HTML 编辑工具栏、Slides 工具栏与演示层均复用上游组件。默认、悬停、焦点、选中、禁用、加载、错误状态沿用已有实现。

图片裁剪复用主色选择框与现有手柄尺寸；边中点加短柄，屏幕尺寸不随画布缩放变化。裁剪框外的原图按约 10% 显示，对照旧版合成图片的裁剪状态取样；`overlay-crop-ghost` 的透明度用于原图预览的透明蒙版。裁剪控件沿用浮层、按钮、间距、焦点与禁用令牌，不增加永久侧栏。
2026-11-26 隔离旧版原生 Alt 拖动观察：涂抹轨迹使用约 12 CSS px 主色笔迹、透明度约 32%，线端圆润，停住时留下末端圆点；轨迹随时间缩短，已经选中的对象不随轨迹消失。像素尺寸与透明度置信度高；尾迹寿命按逐帧观察约 100ms 近似，置信度中。颜色与线宽分别放入 overlay-scribble-stroke 色彩、尺寸令牌，屏幕线宽不随缩放变化。

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
