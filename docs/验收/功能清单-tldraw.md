# tldraw 5.1.1 用户可见功能清单

对应工单：[#20](https://github.com/solosvip/hiCanvas/issues/20)。这是替换编辑器时逐项对照的验收基线；条目存在不表示新编辑器已实现或已验收。

盘点对象是本分支锁文件安装的 `tldraw@5.1.1` 默认编辑器和随包源码；hiCanvas 露出状态以提交 `761faa5`（标签 `v0.0.16`）为基线。包版本由 `node_modules/tldraw/package.json` 核对。只查源码，不调用真实画板、模型、第三方嵌入或系统剪贴板。置信度：源码入口与静态露出判断为高；实际交互、辅助技术读出、浏览器权限和第三方在线效果未核实。

## 阅读与验收方法

- 每行是一项验收能力；同一项列出的选项、快捷键变体都要覆盖，不把颜色、语言或端点组合展开为重复功能。编号固定，后续新增接续编号。
- 「是」表示 hiCanvas 源码保留了该入口和处理路径；「部分」表示入口或行为被改写、受环境条件限制；「否」表示没有提供。它们不是实机通过标记。
- 操作默认先让画布获得焦点，并满足行内的选中数量、未锁定和编辑状态条件。`Mod` 指 Mac 的 Cmd、其他系统的 Ctrl；`Alt` 在 Mac 是 Option。富文本快捷键以本包实际注册的 `Mod` 为准。
- 下文源码路径前缀：`T/` = `node_modules/tldraw/src/lib/`；`U/` = `T/ui/`；`E/` = `node_modules/@tldraw/editor/src/lib/`；`S/` = `node_modules/@tldraw/tlschema/src/`。`#` 后为可搜索的符号名，括号内是动作 ID、属性或分支关键词；不是行号。
- 每行最后一栏的 `H` 编号对应下一表，给出 hiCanvas 露出判断的文件和符号。新实现的人工验收可按「操作 → 预期」逐行记录到对应版本验收记录，不修改这里的源码事实。

## hiCanvas 露出依据

| 代号 | 文件与符号 | 判断依据 |
| --- | --- | --- |
| H1 | `src/editor/App.jsx#App`；`T/Tldraw.tsx#Tldraw` | 使用 Tldraw 默认工具、形状、动作与外部内容处理；额外传入自定义工具/形状，不整体移除默认集合；未传协作 store 或只读模式。 |
| H2 | `src/editor/Toolbar.jsx#CowartToolbar`；`src/CowartDraggableToolbar.jsx#CowartDraggableToolbar` | 保留默认工具栏中的所有工具；更多工具由溢出区承载。 |
| H3 | `src/editor/StylePanel.jsx#CowartStylePanel` | `select` 工具时直接返回空；其他工具使用 `DefaultStylePanelContent`。因此默认样式选项可设置新对象，但选择模式下的整套已有对象样式修改入口缺失。 |
| H4 | `src/editor/overrides.jsx#cowartUiOverrides` | 保留默认动作；删除上一页/下一页/移到新页动作；箭头的 `A` 快捷键清空并给 AI 图片；PNG 复制及原文件下载在宿主桥环境有替换分支。 |
| H5 | `src/editor/shapes.jsx#CowartConfiguredEmbedShapeUtil`、`CowartEmbedShapeUtil` | 自定义 HTML 嵌入后追加完整 `DEFAULT_EMBED_DEFINITIONS`；普通嵌入仍调用父类组件。 |
| H6 | `src/editor/components.jsx#cowartComponents`、`CowartMainMenu` | 主菜单继续使用 `DefaultMainMenu`；未替换右键、排列、缩放、帮助、富文本与视频工具栏；`SharePanel` 置空；图片工具栏被替换。 |
| H7 | `src/editor/imageToolbar.jsx#CowartImageToolbarContent`、`CowartAltTextEditor` | 保留 `DefaultImageToolbarContent` 和裁剪状态，外加自定义图片操作与替代文本编辑。 |
| H8 | `src/editor/userPreferences.js#createHiCanvasUser`、`useHiCanvasLocale`；`App` | 首次默认简体中文；语言和偏好回写共享 tldraw 用户偏好，使用 inferDarkMode。 |
| H9 | `src/editor/slidesLayout.jsx#cowartTldrawOptions`；`docs/adr/0003-single-canvas.md`；H4 | `maxPages: 1`；不提供页管理，不等于删除 hiCanvas 的画板切换功能。 |
| H10 | `src/editor/assets.jsx#cowartTldrawAssetStore` | 文件上传读为 data URL，解析时支持本机资源；不替换默认媒体 MIME 类型筛选。 |
| H11 | `src/styles.css`（`tl-watermark-unlicensed`）；`src/editor/watermarkLocalization.js#startWatermarkLocalization` | 此基线用 CSS 隐藏未许可入口；仍含本地化逻辑和 SDK 许可检查。这里只描述基线，不作为授权结论。 |
| H12 | `src/editor/App.jsx#App(handleCowartCopy)`；`src/editor/slidesLayout.jsx#copySelectedCowartContent` | 捕获原生 copy 事件，写可再编辑 HTML 载荷但将 text/plain 设为空格并停止后续监听；菜单复制仍走默认剪贴板 API；文字编辑态不拦截。`cowartTldrawOptions(onClipboardPasteRaw)` 在已有本机复制缓存且选中 AI Slides 时改粘缓存内容，绕过实际剪贴板；其他场景继续默认路径。 |

## A. 工具、形状与创建

几何形状以 `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle` 的 20 个值和 `T/shapes/geo/getGeoShapePath.ts#defaultGeoTypeDefinitions` 为准；默认工具栏只直接摆出其中 16 种，余下从几何样式选择器进入。

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| A01 | 选择工具 | 工具栏选择或 V | 切换到选择状态；再次选该工具结束文字工具的粘滞状态 | `U/hooks/useTools.tsx#ToolsProvider(select)` | 是（H1、H2） |
| A02 | 手形工具 | 工具栏手形或 H，拖动画布 | 平移视口，不移动作品 | `U/hooks/useTools.tsx#ToolsProvider(hand)`；`T/tools/HandTool/HandTool.ts#HandTool` | 是（H1、H2） |
| A03 | 画笔 | 工具栏画笔或 D/B/X，拖动 | 产生自由笔迹；支持笔压数据 | `U/hooks/useTools.tsx#ToolsProvider(draw)`；`T/shapes/draw/toolStates/Drawing.ts#Drawing` | 是（H1、H2）；笔压硬件未核实 |
| A04 | 橡皮 | 工具栏橡皮或 E，点按/扫过；Mod 点按 | 普通点按收集命中的多层可擦对象，Mod 点按只擦最上层；拖动出现擦除轨迹 | `T/tools/EraserTool/EraserTool.ts#EraserTool`；`T/tools/EraserTool/childStates/Pointing.ts#Pointing`；`U/hooks/useTools.tsx#ToolsProvider(eraser)` | 是（H1、H2） |
| A05 | 文本 | 工具栏文字或 T；点击/拖出文字框 | 点击创建自动宽度文本，拖动创建限定宽度文本并编辑 | `T/shapes/text/TextShapeTool.ts#TextShapeTool`；`T/shapes/text/toolStates/Pointing.ts#Pointing` | 是（H1、H2） |
| A06 | 便签 | 工具栏便签或 N；点击/拖动 | 创建可编辑文字的便签 | `T/shapes/note/NoteShapeTool.ts#NoteShapeTool`；`U/hooks/useTools.tsx#ToolsProvider(note)` | 是（H1、H2） |
| A07 | 连接箭头 | 工具栏箭头或默认 A；拖动两端 | 创建可绑定的连接箭头 | `T/shapes/arrow/ArrowShapeTool.ts#ArrowShapeTool`；`U/hooks/useTools.tsx#ToolsProvider(arrow)` | 部分（H2、H4）：工具保留，A 被 AI 图片占用 |
| A08 | 线条 | 工具栏线条或 L；拖动 | 创建可编辑顶点的线条 | `T/shapes/line/LineShapeTool.ts#LineShapeTool` | 是（H1、H2） |
| A09 | 画框 | 工具栏画框或 F；拖动 | 创建有标题的容器，框内内容按容器裁切/组织 | `T/shapes/frame/FrameShapeTool.ts#FrameShapeTool`；`T/shapes/frame/FrameShapeUtil.tsx#FrameShapeUtil` | 是（H1、H2、H5） |
| A10 | 荧光笔 | 工具栏荧光笔或 Shift+D | 创建高亮笔迹，保留与普通画笔不同的渲染 | `T/shapes/highlight/HighlightShapeTool.ts#HighlightShapeTool`；`U/hooks/useTools.tsx#ToolsProvider(highlight)` | 是（H1、H2） |
| A11 | 激光笔 | 工具栏激光或 K，拖动 | 产生短暂指示轨迹，不成为永久作品 | `T/tools/LaserTool/LaserTool.ts#LaserTool` | 是（H1、H2） |
| A12 | 媒体工具 | 工具栏媒体或 Mod+U | 打开系统文件选择，按支持格式插入图片/视频 | `U/hooks/useTools.tsx#ToolsProvider(asset)`；`U/context/actions.tsx#ActionsProvider(insert-media)` | 是（H1、H2、H10）；系统选择器未核实 |
| A13 | 矩形 | 工具栏矩形或 R，点击/拖动 | 创建 rectangle 几何对象 | `U/hooks/useTools.tsx#ToolsProvider`；`S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(rectangle)` | 是（H2） |
| A14 | 椭圆 | 工具栏椭圆或 O | 创建 ellipse 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(ellipse)`；`U/hooks/useTools.tsx#ToolsProvider` | 是（H2） |
| A15 | 三角形 | 工具栏三角形 | 创建 triangle 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(triangle)` | 是（H2） |
| A16 | 菱形 | 工具栏菱形 | 创建 diamond 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(diamond)` | 是（H2） |
| A17 | 六边形 | 工具栏六边形 | 创建 hexagon 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(hexagon)` | 是（H2） |
| A18 | 胶囊形 | 工具栏 oval | 创建 oval 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(oval)` | 是（H2） |
| A19 | 斜四边形 | 工具栏 rhombus | 创建 rhombus 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(rhombus)` | 是（H2） |
| A20 | 星形 | 工具栏星形 | 创建 star 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(star)` | 是（H2） |
| A21 | 云形 | 工具栏云形 | 创建 cloud 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(cloud)` | 是（H2） |
| A22 | 心形 | 工具栏心形 | 创建 heart 对象 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(heart)` | 是（H2） |
| A23 | 叉号框 | 工具栏 x-box | 创建含叉号的框 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(x-box)` | 是（H2） |
| A24 | 勾号框 | 工具栏 check-box | 创建含勾号的框 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(check-box)` | 是（H2） |
| A25 | 左向块箭头 | 工具栏 arrow-left | 创建左向几何箭头，区别于连接箭头 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(arrow-left)` | 是（H2） |
| A26 | 右向块箭头 | 工具栏 arrow-right | 创建右向几何箭头 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(arrow-right)` | 是（H2） |
| A27 | 上向块箭头 | 工具栏 arrow-up | 创建上向几何箭头 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(arrow-up)` | 是（H2） |
| A28 | 下向块箭头 | 工具栏 arrow-down | 创建下向几何箭头 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(arrow-down)` | 是（H2） |
| A29 | 五边形 | 几何工具 → 样式面板形状列表 | 创建/改为 pentagon | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(pentagon)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelGeoShapePicker` | 部分（H3）：无工具栏直达；几何工具下可选 |
| A30 | 八边形 | 几何工具 → 样式面板形状列表 | 创建/改为 octagon | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(octagon)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelGeoShapePicker` | 部分（H3） |
| A31 | 第二种斜四边形 | 几何工具 → 样式面板形状列表 | 创建/改为 rhombus-2 | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(rhombus-2)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelGeoShapePicker` | 部分（H3） |
| A32 | 梯形 | 几何工具 → 样式面板形状列表 | 创建/改为 trapezoid | `S/shapes/TLGeoShape.ts#GeoShapeGeoStyle(trapezoid)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelGeoShapePicker` | 部分（H3） |
| A33 | 重用最近几何形状 | G | 进入最近选用的几何工具 | `U/context/actions.tsx#ActionsProvider(select-geo-tool)` | 是（H1、H4） |
| A34 | 从工具栏拖出对象 | 将几何、箭头、线、框、文本或便签工具拖到画布 | 创建默认尺寸对象并跟随指针落下；文本/便签进入编辑 | `U/hooks/useTools.tsx#onDragFromToolbarToCreateShape`、`ToolsProvider(onDragStart)` | 是（H2） |
| A35 | 连续使用工具 | Q、偏好 → 工具锁定，或工具栏锁定控件 | 完成一次创建后保留当前工具；取消锁定恢复默认回选择 | `U/context/actions.tsx#ActionsProvider(toggle-tool-lock)`；`U/components/Toolbar/DefaultToolbar.tsx#DefaultToolbar` | 是（H2、H4）：自定义工具栏仍包裹 DefaultToolbar，保留锁定控件 |
| A36 | 笔迹直线与闭合 | 画笔按 Shift 延续直线；笔迹回到起点 | 直线段/自由段可组合；闭合轮廓按填充样式渲染 | `T/shapes/draw/toolStates/Drawing.ts#Drawing(getIsClosed)` | 是（H1） |
| A37 | 数字切换可见工具 | 画布聚焦且非输入状态，按 1–9、0 | 依次点击当前主工具栏前十个可编号按钮；随窗口宽度与溢出项改变，不固定映射为某种形状 | `U/components/Toolbar/OverflowingToolbar.tsx#OverflowingToolbar`、`NUMBERED_SHORTCUT_KEYS`；`E/options.ts#defaultTldrawOptions(enableToolbarKeyboardShortcuts)` | 是（H2）：拖动手柄不参与编号 |
| A38 | 矩形/勾号框快速互换 | Alt 双击矩形或 check-box | rectangle 与 check-box 互换，保留同一形状 | `T/shapes/geo/GeoShapeUtil.tsx#GeoShapeUtil(onDoubleClick)` | 是（H1） |
| A39 | 双击空白直接写字 | 选择工具下双击未命中对象的空白处 | 创建文本形状并进入文字编辑，无需先切文字工具 | `T/tools/SelectTool/childStates/Idle.ts#Idle(handleDoubleClickOnCanvas)` | 是（H1） |

## B. 选择、直接变换与容器

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| B01 | 点选及取消选择 | V 后点对象/空白处；Esc | 选中对象；点击空白或取消清除选择/退出当前组 | `T/tools/SelectTool/childStates/PointingShape.ts#PointingShape`；`PointingCanvas.ts#PointingCanvas`；`Idle.ts#Idle(onCancel)`（同目录） | 是（H1） |
| B02 | 加选/减选 | Shift 点击或 Shift 框选 | Shift 点击增减；Shift 框选只追加（2026-11-26 旧版实测） | `T/tools/SelectTool/childStates/PointingShape.ts#PointingShape`；`Brushing.ts#Brushing`（同目录） | 是（H1） |
| B03 | 矩形框选 | 在空白处拖框 | 选中与框相交的对象，或按环绕选择偏好要求完全包含 | `T/tools/SelectTool/childStates/Brushing.ts#Brushing(hitTestShapes)` | 是（H1） |
| B04 | 临时反转环绕选择 | 框选时按 Ctrl | 临时反转「相交/完全包含」判据 | `T/tools/SelectTool/childStates/Brushing.ts#Brushing(isWrapping)` | 是（H1） |
| B05 | 自由轨迹选择 | 空白处 Alt 拖动 | 以涂抹轨迹命中对象并选择 | `T/tools/SelectTool/childStates/Brushing.ts#Brushing`；`ScribbleBrushing.ts#ScribbleBrushing`（同目录） | 是（H1） |
| B06 | 全选 | 编辑/右键 → 全选；Mod+A | 选中当前页允许选择的对象 | `U/context/actions.tsx#ActionsProvider(select-all)`；`U/components/menu-items.tsx#SelectAllMenuItem` | 是（H1、H6） |
| B07 | 拖动位置 | 拖动已选对象/选择框 | 所选对象一起移动，保留内部相对位置 | `T/tools/SelectTool/childStates/Translating.ts#Translating` | 是（H1） |
| B08 | 限定移动方向 | 拖动时按 Shift | 锁定水平或垂直方向 | `T/tools/SelectTool/childStates/Translating.ts#moveShapesToPoint` | 是（H1） |
| B09 | 拖动复制 | 按 Alt 拖动已有对象 | 保留原件并移动副本；可在拖动中切换 Alt | `T/tools/SelectTool/childStates/Translating.ts#Translating(startCloning/stopCloning)` | 是（H1） |
| B10 | 连续复制 | 编辑/右键 → 复制副本；Mod+D | 按默认间距复制；连续复制沿用上次偏移 | `U/context/actions.tsx#ActionsProvider(duplicate)` | 是（H4、H6） |
| B11 | 边角缩放 | 拖动选择边框的边/角 | 改变可调整对象尺寸；多选整体变换 | `T/tools/SelectTool/childStates/Resizing.ts#Resizing` | 是（H1） |
| B12 | 等比缩放 | 缩放时 Shift | 锁定比例；本来锁比例的媒体按其规则处理 | `T/tools/SelectTool/childStates/Resizing.ts#Resizing(isAspectRatioLocked)` | 是（H1）；自定义 AI 框另有规则 |
| B13 | 从中心缩放 | 缩放时 Alt | 围绕选择中心改变尺寸 | `T/tools/SelectTool/childStates/Resizing.ts#Resizing(isResizingFromCenter)` | 是（H1） |
| B14 | 鼠标旋转 | 拖动角外旋转柄 | 绕选择中心旋转；Shift 按 15° 吸附 | `T/tools/SelectTool/childStates/Rotating.ts#Rotating` | 是（H1） |
| B15 | 键盘移动 | 方向键；Shift+方向键 | 小步/大步移动；网格模式使用相应网格步长 | `T/tools/SelectTool/childStates/Idle.ts#Idle(nudgeSelectedShapes)` | 是（H1） |
| B16 | 键盘旋转 | Shift+. / Shift+,；加 Alt 微调 | 顺/逆时针转到 15° 刻度；Alt 为更细刻度 | `U/context/actions.tsx#ActionsProvider(rotate-cw/rotate-ccw)` | 是（H4、H6） |
| B17 | 键盘放大 | Mod+Alt+Shift+= | 围绕选择中心按 1.1 倍调整对象 | `U/context/actions.tsx#ActionsProvider(enlarge-shapes/scaleShapes)` | 是（H4） |
| B18 | 键盘缩小 | Mod+Alt+Shift+- | 按放大的倒数比例缩小 | `U/context/actions.tsx#ActionsProvider(shrink-shapes/scaleShapes)` | 是（H4） |
| B19 | 组合 | 编辑/右键 → 组合；Mod+G | 将多个对象组合；仅选一个组时该快捷动作可解组 | `U/context/actions.tsx#ActionsProvider(group)`；`U/components/menu-items.tsx#GroupMenuItem` | 是（H4、H6） |
| B20 | 解组 | 编辑/右键 → 解组；Mod+Shift+G | 拆开组并保留子对象 | `U/context/actions.tsx#ActionsProvider(ungroup)` | 是（H4、H6） |
| B21 | 进入/退出组 | 双击组；选组 Enter；Esc | 可选取组内对象；Esc 退出组级选择 | `T/tools/SelectTool/childStates/Idle.ts#Idle(onDoubleClick/onKeyUp/onCancel)` | 是（H1） |
| B22 | 锁定/解锁对象 | 编辑/右键 → 锁定；Shift+L | 锁定对象免于普通编辑；再次操作可解锁符合条件的选择 | `U/context/actions.tsx#ActionsProvider(toggle-lock)`；`U/components/menu-items.tsx#ToggleLockMenuItem` | 是（H4、H6） |
| B23 | 全部解锁 | 编辑 → 全部解锁 | 解锁当前页所有带锁对象 | `U/context/actions.tsx#ActionsProvider(unlock-all)` | 是（H4、H6） |
| B24 | 删除 | Delete/Backspace；右键编辑 → 删除 | 删除所选可编辑对象 | `U/context/actions.tsx#ActionsProvider(delete)` | 是（H4、H6） |
| B25 | 撤销 | 编辑 → 撤销；Mod+Z | 撤销最近可撤销操作；不可用时入口禁用 | `U/context/actions.tsx#ActionsProvider(undo)`；`U/components/MainMenu/DefaultMainMenuContent.tsx#UndoRedoGroup` | 是（H4、H6） |
| B26 | 重做 | 编辑 → 重做；Mod+Shift+Z | 恢复撤销过的操作；不可用时入口禁用 | `U/context/actions.tsx#ActionsProvider(redo)`；`U/components/MainMenu/DefaultMainMenuContent.tsx#UndoRedoGroup` | 是（H4、H6） |
| B27 | 中止/完成当前操作 | 拖动中 Esc；适用状态下 Enter/松开指针 | 中止恢复起始状态，完成确认变换 | `T/tools/SelectTool/childStates/Resizing.ts#Resizing(onCancel/onComplete)`；`Translating.ts#Translating`（同目录） | 是（H1） |
| B28 | 拖入/拖出画框 | 将普通对象拖进/拖出框 | 改变容器归属，随框移动且在框外部分被裁切 | `T/tools/SelectTool/childStates/Translating.ts#Translating`；`T/shapes/frame/FrameShapeUtil.tsx#FrameShapeUtil` | 是（H1、H5） |
| B29 | 画框标题 | 双击画框标题/按其编辑入口 | 编辑容器名称 | `T/shapes/frame/FrameShapeUtil.tsx#FrameShapeUtil(canEdit)` | 是（H1、H5） |
| B30 | 调整画框边界/内容 | 拖画框边角；按住 Mod 调整 | 普通调整框边界不缩放内容；按 Mod 调边界时保持子对象在画布上的位置，类似裁框 | `T/tools/SelectTool/childStates/Resizing.ts#Resizing`；`T/shapes/frame/FrameShapeUtil.tsx#FrameShapeUtil(canResizeChildren)` | 是（H1、H5）；组合手感未核实 |
| B31 | 画框适配内容 | 编辑/右键编辑 → 适配框内容 | 框边界包住内部内容 | `U/context/actions.tsx#ActionsProvider(fit-frame-to-content)`；`T/utils/frames/frames.ts#fitFrameToContent` | 是（H4、H6） |
| B32 | 移除画框 | 编辑/右键编辑 → 移除画框；Mod+Shift+F | 取消容器，保留内部作品 | `U/context/actions.tsx#ActionsProvider(remove-frame)`；`T/utils/frames/frames.ts#removeFrame` | 是（H4、H6） |
| B33 | 相邻便签创建/吸附 | 便签周围的创建柄；移动便签到另一便签附近 | 可在邻位续建，并按相邻便签的布局位置吸附 | `T/shapes/note/NoteShapeUtil.tsx#NoteShapeUtil(getHandles)`；`T/tools/SelectTool/childStates/PointingHandle.ts#PointingHandle`；`T/tools/SelectTool/childStates/Translating.ts#moveShapesToPoint` | 是（H1） |
| B34 | 便签键盘续建 | 编辑便签时 Tab/Shift+Tab；Mod+Enter/Mod+Shift+Enter | 横向/纵向转到相邻便签，不存在则创建并编辑；横向次序考虑 RTL | `T/shapes/note/NoteShapeUtil.tsx#useNoteKeydownHandler` | 是（H1）；输入法/RTL 手感未核实 |
| B35 | 便签署名 | 已有显示名的用户首次填写非空便签；悬停署名 | 记录首位文字编辑者；显示首名，提示完整名，SVG 导出保留署名；空便签清除署名 | `T/shapes/note/NoteShapeUtil.tsx#NoteShapeUtil(component/onBeforeUpdate/toSvg)`；`E/editor/Editor.ts#Editor(getAttributionDisplayName/getAttributionUserId)`；`E/config/createTLStore.ts#defaultUserStore` | 部分（H8）：保留共享姓名偏好；无个人姓名编辑面板（H6）；署名效果未核实 |
| B36 | 双击画框边界适配 | 选画框后双击左/右边、上/下边或角 | 左右边适配内容宽度，上下边适配高度，并调整对应子对象偏移；双击角执行完整适配 | `T/shapes/frame/FrameShapeUtil.tsx#FrameShapeUtil(onDoubleClickEdge/onDoubleClickCorner)` | 是（H1、H5） |

## C. 排列、层级与吸附

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| C01 | 左对齐 | 至少选 2 个未锁对象 → 排列/右键排列；Alt+A | 左边界对齐 | `U/context/actions.tsx#ActionsProvider(align-left)`；`U/components/ActionsMenu/DefaultActionsMenuContent.tsx#AlignMenuItems` | 是（H4、H6） |
| C02 | 水平居中 | 同上；Alt+H | 水平方向中心对齐 | `U/context/actions.tsx#ActionsProvider(align-center-horizontal)` | 是（H4、H6） |
| C03 | 右对齐 | 同上；Alt+D | 右边界对齐 | `U/context/actions.tsx#ActionsProvider(align-right)` | 是（H4、H6） |
| C04 | 顶对齐 | 同上；Alt+W | 顶边界对齐 | `U/context/actions.tsx#ActionsProvider(align-top)` | 是（H4、H6） |
| C05 | 垂直居中 | 同上；Alt+V | 垂直方向中心对齐 | `U/context/actions.tsx#ActionsProvider(align-center-vertical)` | 是（H4、H6） |
| C06 | 底对齐 | 同上；Alt+S | 底边界对齐 | `U/context/actions.tsx#ActionsProvider(align-bottom)` | 是（H4、H6） |
| C07 | 水平拉伸 | 至少选 2 个 → 排列/右键排列 | 调整宽度，使对象铺满选择范围 | `U/context/actions.tsx#ActionsProvider(stretch-horizontal)` | 是（H4、H6） |
| C08 | 垂直拉伸 | 同上 | 调整高度，使对象铺满选择范围 | `U/context/actions.tsx#ActionsProvider(stretch-vertical)` | 是（H4、H6） |
| C09 | 水平分布 | 至少选 3 个 → 排列/右键；Alt+Shift+H | 在两端范围间均匀分布 | `U/context/actions.tsx#ActionsProvider(distribute-horizontal)` | 是（H4、H6） |
| C10 | 垂直分布 | 同上；Alt+Shift+V | 垂直方向均匀分布 | `U/context/actions.tsx#ActionsProvider(distribute-vertical)` | 是（H4、H6） |
| C11 | 水平堆排 | 符合条件的至少 3 个 → 排列/右键顺序 | 按固定相邻间距排成一行 | `U/context/actions.tsx#ActionsProvider(stack-horizontal)`；`U/components/menu-items.tsx#OrderMenuGroup` | 是（H4、H6） |
| C12 | 垂直堆排 | 同上 | 按固定间距排成一列 | `U/context/actions.tsx#ActionsProvider(stack-vertical)` | 是（H4、H6） |
| C13 | 紧凑排布 | 多选 → 右键排列 → 打包/紧凑排列 | 在保留间隔下紧凑摆放作品 | `U/context/actions.tsx#ActionsProvider(pack)`；`U/components/menu-items.tsx#OrderMenuGroup` | 是（H4、H6） |
| C14 | 水平镜像 | 右键排列 → 水平翻转；Shift+H | 水平方向翻转所选形状 | `U/context/actions.tsx#ActionsProvider(flip-horizontal)` | 是（H4、H6） |
| C15 | 垂直镜像 | 同上垂直翻转；Shift+V | 垂直方向翻转 | `U/context/actions.tsx#ActionsProvider(flip-vertical)` | 是（H4、H6） |
| C16 | 置于最前 | 排列/右键层级；] | 选择移到所在层级最前 | `U/context/actions.tsx#ActionsProvider(bring-to-front)` | 是（H4、H6） |
| C17 | 前移一层 | 同上；Alt+] | 向前调整层序 | `U/context/actions.tsx#ActionsProvider(bring-forward)` | 是（H4、H6） |
| C18 | 后移一层 | 同上；Alt+[ | 向后调整层序 | `U/context/actions.tsx#ActionsProvider(send-backward)` | 是（H4、H6） |
| C19 | 置于最后 | 同上；[ | 选择移到所在层级最后 | `U/context/actions.tsx#ActionsProvider(send-to-back)` | 是（H4、H6） |
| C20 | 对象边缘/中心及间距吸附 | 开启吸附偏好后移动/缩放，靠近其他对象 | 位置被修正并显示对齐或间距指示线 | `T/tools/SelectTool/childStates/Translating.ts#moveShapesToPoint`；`Resizing.ts#Resizing`（同目录）；`E/editor/managers/SnapManager/BoundsSnaps.ts#BoundsSnaps` | 是（H1） |
| C21 | 临时反转吸附 | 移动/缩放时按 Mod；拖控制点时按 Ctrl | 反转当前吸附开关；松开恢复偏好 | `T/tools/SelectTool/childStates/DraggingHandle.tsx#DraggingHandle(update)`；`Translating.ts#moveShapesToPoint`（同目录） | 是（H1） |
| C22 | 网格吸附 | 开网格后移动/创建/缩放 | 根据网格位置对齐；修饰键和其他吸附有优先级 | `T/tools/SelectTool/childStates/Translating.ts#moveShapesToPoint`；`Resizing.ts#Resizing`（同目录） | 是（H1） |
| C23 | 控制点吸附 | 拖动可吸附的线/箭头控制点 | 对自身/其他几何控制点、轮廓吸附并给指示 | `T/tools/SelectTool/childStates/DraggingHandle.tsx#DraggingHandle(update)`；`T/shapes/line/LineShapeUtil.tsx#LineShapeUtil(getHandleSnapGeometry)` | 是（H1） |

## D. 样式选项

以下都是默认样式面板的真实选项，不把 schema 中存在但未出现在 UI 的属性推断成能力。新建前选样式与修改已有选择均属于默认编辑器的验收；hiCanvas 的 H3 差异应一并记录。选中多个对象时，混合值和只支持部分样式的形状也要检查。

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| D01 | 调色板 | 样式 → 颜色；逐色选择 | black、grey、light-violet、violet、blue、light-blue、yellow、orange、green、light-green、light-red、red 共 12 色；白色不出现在面板 | `T/styles.tsx#getColorStyleItems`；`S/styles/TLColorStyle.ts#DefaultColorStyle` | 部分（H3） |
| D02 | 隐藏白色快捷操作 | Alt+T | 给适用选择及下一对象设 white | `U/context/actions.tsx#ActionsProvider(select-white-color)` | 是（H4）；不依赖 H3 面板 |
| D03 | 不透明度 | 样式 → 不透明度滑块 | 10%、25%、50%、75%、100%；混合选择有对应状态 | `U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelOpacityPicker` | 部分（H3） |
| D04 | 填充 | 样式 → 填充及附加下拉 | none、semi、solid、pattern、lined-fill、fill 六种均可选 | `T/styles.tsx#STYLES(fill/fillExtra)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelFillPicker` | 部分（H3） |
| D05 | 填充快捷操作 | Alt+F；Alt+Shift+F | 分别设 fill 和 lined-fill，作用于适用选择及后续对象 | `U/context/actions.tsx#ActionsProvider(select-fill-fill/select-fill-lined-fill)` | 是（H4） |
| D06 | 线型 | 样式 → 线型 | draw、dashed、dotted、solid 四种 | `T/styles.tsx#STYLES(dash)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelDashPicker` | 部分（H3） |
| D07 | 尺寸档位 | 样式 → 小/中/大/特大 | s/m/l/xl 改笔画粗细或文本字号等适用尺寸 | `T/styles.tsx#STYLES(size)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelSizePicker` | 部分（H3） |
| D08 | 字体 | 样式 → 字体 | draw、sans、serif、mono 四种默认字体 | `T/styles.tsx#getFontStyleItems`、`STYLES(font)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelFontPicker` | 部分（H3） |
| D09 | 文本水平对齐 | 文本样式 → 对齐 | start/middle/end 三种；垂直对齐按钮在此面板禁用，不算可用选项 | `U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelTextAlignPicker`；`T/styles.tsx#STYLES(textAlign)` | 部分（H3） |
| D10 | 标签水平对齐 | 带标签形状样式 → 对齐 | 标签 start/middle/end | `U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelLabelAlignPicker`；`T/styles.tsx#STYLES(horizontalAlign)` | 部分（H3） |
| D11 | 标签垂直对齐 | 带垂直标签样式的形状 → 垂直对齐下拉 | start/middle/end；不支持的形状禁用按钮 | `U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelLabelAlignPicker`；`T/styles.tsx#STYLES(verticalAlign)` | 部分（H3） |
| D12 | 几何形状切换 | 几何对象/工具的形状下拉 | 切换 A13–A32 的全部 20 种形状 | `U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelGeoShapePicker` | 部分（H3） |
| D13 | 箭头路径类型 | 箭头样式 → 类型 | arc 弧线、elbow 折肘线两类 | `T/styles.tsx#STYLES(arrowKind)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelArrowKindPicker` | 部分（H3） |
| D14 | 箭头起点端帽 | 箭头样式 → 起点 | none、arrow、triangle、square、dot、diamond、inverted、bar 八种 | `T/styles.tsx#STYLES(arrowheadStart)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelArrowheadPicker` | 部分（H3） |
| D15 | 箭头终点端帽 | 箭头样式 → 终点 | 同上八种，起终点可独立配置 | `T/styles.tsx#STYLES(arrowheadEnd)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelArrowheadPicker` | 部分（H3） |
| D16 | 线条插值 | 线条样式 → 线形 | line 折线、cubic 曲线两种 | `T/styles.tsx#STYLES(spline)`；`U/components/StylePanel/DefaultStylePanelContent.tsx#StylePanelSplinePicker` | 部分（H3） |
| D17 | 样式作用域与混合状态 | 无选择切样式后创建；多选不同样式对象 | 记录下一形状样式；适用选择更新；不支持的选项不显示；混合值不会假装成统一值 | `U/components/StylePanel/StylePanelContext.tsx#StylePanelContextProvider`；`U/components/StylePanel/StylePanelButtonPicker.tsx#StylePanelButtonPicker` | 部分（H3） |

## E. 连接线、标签与文字编辑

富文本来自实际 `tipTapDefaultExtensions`，并继续核对本机 `@tiptap/starter-kit/src/starter-kit.ts` 及对应扩展的键盘/输入规则；不把快捷键帮助面板中「仅展示」的项目当作实现证据。默认关闭 blockquote、codeBlock、horizontalRule，不列为可用能力。

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| E01 | 箭头绑定对象 | 从对象开始/将箭头端点拖到对象上 | 端点绑定到对象；对象移动/缩放后连接跟随 | `T/shapes/arrow/ArrowShapeUtil.tsx#ArrowShapeUtil(onHandleDrag)`；`T/bindings/arrow/ArrowBindingUtil.ts#ArrowBindingUtil` | 是（H1） |
| E02 | 精确绑定/取消绑定 | 拖箭头端点，停留或按 Alt 精确；按 Ctrl 忽略绑定目标 | 区分中心附近/指定位置，离开目标可解除绑定 | `T/tools/SelectTool/childStates/DraggingHandle.tsx#DraggingHandle(update)`；`T/shapes/arrow/arrowTargetState.ts#getArrowTargetState` | 是（H1）；组合修饰键手感未核实 |
| E03 | 调整弧度/折肘 | 拖动箭头中间手柄 | 修改弧度或折肘路径，不等同普通整体缩放 | `T/shapes/arrow/ArrowShapeUtil.tsx#ArrowShapeUtil(getHandles/onHandleDrag)` | 是（H1） |
| E04 | 箭头文字及标签位置 | 双击箭头；拖动箭头标签 | 编辑标签并调整其沿连接路径的位置 | `T/tools/SelectTool/childStates/PointingArrowLabel.ts#PointingArrowLabel`；`T/shapes/arrow/ArrowShapeUtil.tsx#ArrowShapeUtil` | 是（H1） |
| E05 | 线条加点/移点 | 拖线条端点和段间创建柄 | 移动顶点；拖创建柄新增顶点，曲线/折线按样式渲染 | `T/shapes/line/LineShapeUtil.tsx#LineShapeUtil(getHandles/onHandleDragStart/onHandleDrag)` | 是（H1） |
| E06 | 进入/退出文字编辑 | 双击文本/便签/几何标签，或选中后 Enter；Esc/点击外部结束 | 将焦点放到富文本；写回当前形状标签 | `T/tools/SelectTool/childStates/Idle.ts#Idle`；`T/shapes/shared/useEditableRichText.ts#useEditableRichText` | 是（H1） |
| E07 | 自动宽度/固定宽度 | 创建文本时点击或拖动；拖文本横边；编辑 → 自动大小 | 固定宽度时换行；自动大小动作恢复随内容增长 | `T/shapes/text/toolStates/Pointing.ts#Pointing`；`T/shapes/text/TextShapeUtil.tsx#TextShapeUtil(onResize)`；`U/context/actions.tsx#ActionsProvider(toggle-auto-size)` | 是（H1、H4、H6） |
| E08 | 粗体 | 选中文字 → 浮动栏 B；Mod+B | 对选择或后续输入切换粗体 | `U/components/Toolbar/DefaultRichTextToolbarContent.tsx#DefaultRichTextToolbarContent(bold)`；`T/utils/text/richText.ts#tipTapDefaultExtensions` | 是（H1、H6） |
| E09 | 斜体 | 选中文字 → 浮动栏斜体；Mod+I | 切换斜体 | `U/components/Toolbar/DefaultRichTextToolbarContent.tsx#DefaultRichTextToolbarContent(italic)`；`T/utils/text/richText.ts#tipTapDefaultExtensions` | 是（H1、H6） |
| E10 | 行内代码 | 浮动栏 code；Mod+E | 切换行内代码；默认 Code 扩展排斥其他文字标记，不以粗体/高亮叠加作为验收预期 | `U/components/Toolbar/DefaultRichTextToolbarContent.tsx#DefaultRichTextToolbarContent(code)`；`T/utils/text/richText.ts#tipTapDefaultExtensions`；`node_modules/@tiptap/extension-code/src/code.ts#Code(excludes)` | 是（H1、H6） |
| E11 | 文字高亮 | 浮动栏高亮；Mod+Shift+H | 切换文字背景高亮 | `U/components/Toolbar/DefaultRichTextToolbarContent.tsx#DefaultRichTextToolbarContent(highlight)`；`T/utils/text/richText.ts#tipTapDefaultExtensions` | 是（H1、H6） |
| E12 | 删除线 | Mod+Shift+S | 切换删除线；默认浮动栏没有删除线按钮 | `T/utils/text/richText.ts#tipTapDefaultExtensions`；`node_modules/@tiptap/extension-strike/src/strike.ts#Strike` | 是（H1） |
| E13 | 下划线 | Mod+U（文字编辑时） | 切换下划线；不是默认浮动栏按钮，画布非编辑态的 Mod+U 是插入媒体 | `T/utils/text/richText.ts#tipTapDefaultExtensions`；`node_modules/@tiptap/starter-kit/src/starter-kit.ts#StarterKit`；`node_modules/@tiptap/extension-underline/src/underline.ts#Underline` | 是（H1） |
| E14 | 标题与普通段落 | 文字编辑时 Mod+Alt+1…6；Mod+Alt+0 | 切换 1–6 级标题或普通段落 | `T/utils/text/richText.ts#tipTapDefaultExtensions`；`node_modules/@tiptap/extension-heading/src/heading.ts#Heading`；`node_modules/@tiptap/extension-paragraph/src/paragraph.ts#Paragraph` | 是（H1） |
| E15 | 无序列表 | 浮动栏列表；Mod+Shift+8；输入规则 | 切换项目符号列表 | `U/components/Toolbar/DefaultRichTextToolbarContent.tsx#DefaultRichTextToolbarContent(bulletList)`；`node_modules/@tiptap/extension-list/src/bullet-list/bullet-list.ts#BulletList` | 是（H1、H6） |
| E16 | 有序列表 | Mod+Shift+7；输入规则 | 切换编号列表 | `T/utils/text/richText.ts#tipTapDefaultExtensions`；`node_modules/@tiptap/extension-list/src/ordered-list/ordered-list.ts#OrderedList` | 是（H1） |
| E17 | 列表缩进/退格及换行 | 列表中 Tab/Shift+Tab、Enter/Backspace | 按当前项层级缩进/提升、续建或退出列表；Shift+Enter 使用段落 Enter | `T/shapes/text/RichTextArea.tsx#handleTab`；`T/utils/text/richText.ts#KeyboardShiftEnterTweakExtension`；`node_modules/@tiptap/extension-list/src/item/list-item.ts#ListItem` | 是（H1） |
| E18 | 富文本链接 | 浮动栏链接或 Mod+Shift+K，输入/修改/移除 URL | 为选中文字设置链接，弹出编辑面板；URL 可自动识别 | `U/components/Toolbar/DefaultRichTextToolbar.tsx#DefaultRichTextToolbar`；`DefaultRichTextToolbarContent.tsx#DefaultRichTextToolbarContent`（同目录）；`T/utils/text/richText.ts#tipTapDefaultExtensions` | 是（H1、H6） |
| E19 | 富文本粘贴与文本方向 | 在文字中粘贴格式化内容/输入 RTL 文字 | 解析支持的富文本；根据内容自动判断文字方向 | `T/shapes/text/RichTextArea.tsx#RichTextArea`；`T/utils/text/richText.ts#tipTapDefaultExtensions` | 是（H1）；输入法/RTL 视觉未核实 |
| E20 | 形状超链接 | 支持 url 的对象 → 编辑链接；点击链接按钮 | 添加/编辑形状 URL，并通过链接按钮打开 | `U/context/actions.tsx#ActionsProvider(edit-link)`；`U/components/EditLinkDialog.tsx#EditLinkDialog`；`T/shapes/shared/HyperlinkButton.tsx#HyperlinkButton` | 是（H4、H6） |
| E21 | 键盘完成文字编辑 | 普通文本/标签编辑中 Mod+Enter | 完成当前文字编辑；便签按 B34 的自定义续建规则处理；不把 Tiptap 底层同名快捷键当成独立软换行入口 | `T/shapes/shared/useEditableRichText.ts#useEditableRichText(handleKeyDown)`；`T/shapes/note/NoteShapeUtil.tsx#useNoteKeydownHandler` | 是（H1） |
| E22 | 双击箭头端点切端帽 | 选箭头后双击起点/终点控制点 | 当前端为 none 时变 arrow，否则变 none；两端独立 | `T/shapes/arrow/ArrowShapeUtil.tsx#ArrowShapeUtil(onDoubleClickHandle)` | 是（H1）；不依赖 H3 面板 |
| E23 | 连续点选延伸线条 | 用线条工具创建后继续 Shift 点击 | 延伸上一条线并增加顶点；过近时调整末点，保留同一线条 | `T/shapes/line/toolStates/Pointing.ts#Pointing`；`T/shapes/line/toolStates/Idle.ts#Idle` | 是（H1） |

## F. 剪贴板、导入、媒体与导出

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| F01 | 复制对象 | 编辑/右键 → 复制；Mod+C | 复制选择，保存可再编辑的 tldraw 内容及可用的文本/HTML 表示 | `U/context/actions.tsx#ActionsProvider(copy)`；`U/hooks/useClipboardEvents.ts#useNativeClipboardEvents`；`T/utils/clipboard.ts#clipboardWrite` | 部分（H4、H6、H12）：原生 Mod+C 保留可编辑载荷，但纯文本变空格；菜单复制另走默认路径；系统权限未核实 |
| F02 | 剪切对象 | 编辑/右键 → 剪切；Mod+X | 写入剪贴板并移除可剪切的选择 | `U/context/actions.tsx#ActionsProvider(cut)`；`U/hooks/useClipboardEvents.ts#useNativeClipboardEvents` | 是（H4、H6）；系统权限未核实 |
| F03 | 粘贴内部对象 | 编辑/右键 → 粘贴；Mod+V | 恢复形状、资源及内部关系；粘贴根对象解锁；新对象选中 | `U/hooks/clipboard/putPastedContent.ts#putPastedExternalContent`；`T/defaultExternalContentHandlers.ts#defaultHandleExternalTldrawContent` | 部分（H1、H4、H6、H12）：普通对象保留；已选 AI Slides 的本机缓存粘贴另有路径；系统权限未核实 |
| F04 | 切换粘贴位置 | Mod+Alt+V | 临时反转鼠标位置/视口中间的粘贴偏好 | `U/context/actions.tsx#ActionsProvider(paste-at-cursor)` | 是（H4）；系统权限未核实 |
| F05 | 纯文本粘贴 | Mod+Shift+V；Mod+Alt+Shift+V | 去除富文本格式；后一组合再反转粘贴位置偏好 | `U/hooks/useClipboardEvents.ts#useNativeClipboardEvents`；`U/context/actions.tsx#ActionsProvider(paste-plain-text-at-cursor)` | 是（H1、H4）；系统权限未核实 |
| F06 | 文本/HTML 贴到画布 | 复制普通文本或非嵌入片段的富文本 → 粘贴 | 创建文本形状，保留受支持格式；长内容按视口换行 | `T/defaultExternalContentHandlers.ts#defaultHandleExternalTextContent` | 是（H1） |
| F07 | 拖入/粘贴多媒体 | 拖文件到画布或粘贴图片/视频；媒体选择器 | 图片支持 JPEG/PNG/WebP/SVG/GIF/APNG/AVIF，视频支持 MP4/WebM/QuickTime；可批量放入，非法格式/数量过多/上传失败有提示 | `T/defaultExternalContentHandlers.ts#defaultHandleExternalFileContent`、`notifyIfFileNotAllowed`；`U/hooks/clipboard/pasteFiles.ts#pasteFiles`；`node_modules/@tldraw/utils/src/lib/media/media.ts#DEFAULT_SUPPORTED_MEDIA_TYPES` | 是（H1、H10）；权限/编码支持未核实 |
| F08 | SVG 导入 | 粘贴 SVG 文本或插入 SVG 文件 | 清理 SVG 后作为图像资产创建，保留尺寸 | `T/defaultExternalContentHandlers.ts#defaultHandleExternalSvgTextContent`、`maybeSanitizeSvgFile` | 是（H1、H10） |
| F09 | Excalidraw 剪贴板导入 | 粘贴 Excalidraw 格式内容 | 转成支持的 tldraw 形状；不是完整 .excalidraw 文件管理器 | `T/defaultExternalContentHandlers.ts#defaultHandleExternalExcalidrawContent`；`U/hooks/clipboard/putPastedContent.ts#putPastedExternalContent` | 是（H1） |
| F10 | URL 粘贴 | 将 URL 粘到空白画布 | 匹配服务时生成嵌入；其他 URL 生成书签卡片 | `T/defaultExternalContentHandlers.ts#defaultHandleExternalUrlContent` | 是（H1、H5）；外部抓取未核实 |
| F11 | 书签卡片 | 粘贴不自动嵌入的 URL | 显示可得到的标题、描述、图片等；失败给提示/回退 | `T/defaultExternalContentHandlers.ts#defaultHandleExternalUrlAsset`；`T/shapes/bookmark/BookmarkShapeUtil.tsx#BookmarkShapeUtil` | 是（H1）；跨域抓取未核实 |
| F12 | 图片替换 | 选一张图片 → 图片工具栏替换 | 用新文件替换媒体，保持形状身份，按替换逻辑处理尺寸/裁剪 | `U/context/actions.tsx#ActionsProvider(image-replace)`；`T/defaultExternalContentHandlers.ts#defaultHandleExternalFileReplaceContent` | 是（H7、H10）；系统选择器未核实 |
| F13 | 自由裁剪与移图 | 图片工具栏裁剪；双击/Enter 或 Ctrl 拖边的适用路径 | 进入 crop 状态；拖边改裁剪框、拖内容改变取景 | `U/components/Toolbar/DefaultImageToolbarContent.tsx#DefaultImageToolbarContent`；`T/tools/SelectTool/childStates/Crop/Crop.ts#Crop` | 是（H7） |
| F14 | 裁剪缩放滑块 | 进入裁剪 → 图像缩放 | 以滑块改变取景缩放，保持合法裁剪范围 | `U/components/Toolbar/DefaultImageToolbarContent.tsx#DefaultImageToolbarContent(handleZoomChange)` | 是（H7） |
| F15 | 裁剪比例 | 裁剪 → 比例菜单 | original、square、circle、landscape(4:3)、portrait(3:4)、wide(16:9) 六种 | `T/shapes/shared/crop.ts#ASPECT_RATIO_OPTIONS`；`U/components/Toolbar/DefaultImageToolbarContent.tsx#DefaultImageToolbarContent(handleAspectRatioChange)` | 是（H7） |
| F16 | 裁剪确认/取消 | 裁剪工具栏确认、Enter/Esc | 完成当前裁剪或退出/取消当前操作，焦点可回到画布 | `U/components/Toolbar/DefaultImageToolbarContent.tsx#DefaultImageToolbarContent(handleKeyDown)`；`T/tools/SelectTool/childStates/Crop/Crop.ts#Crop` | 是（H7） |
| F17 | 图片替代文本 | 图片工具栏 alt/文 → 输入文字 | 保存图片 altText，供屏幕阅读器及描述使用 | `U/components/Toolbar/DefaultImageToolbar.tsx#DefaultImageToolbar`；`U/components/Toolbar/DefaultImageToolbarContent.tsx#DefaultImageToolbarContent` | 是（H7）：自定义编辑器 |
| F18 | 动图播放 | 插入支持的动画图片；系统切换减少动态效果偏好 | 正常显示动画；减少动态效果时显示静态首帧；默认图像没有独立播放按钮 | `T/shapes/image/ImageShapeUtil.tsx#ImageShapeUtil` | 是（H1）；浏览器效果未核实 |
| F19 | 视频播放 | 插入视频，双击进入互动并使用视频控件 | 播放/暂停、时间进度等原生视频操作 | `T/shapes/video/VideoShapeUtil.tsx#VideoShapeUtil`、`VideoShape` | 是（H1）；编解码器未核实 |
| F20 | 视频替换 | 视频工具栏替换 | 重新选视频并替换对应资产 | `U/components/Toolbar/DefaultVideoToolbarContent.tsx#DefaultVideoToolbarContent`；`U/context/actions.tsx#ActionsProvider(video-replace)` | 是（H6、H10）；系统选择器未核实 |
| F21 | 视频替代文本 | 视频工具栏 alt | 编辑保存视频的 altText | `U/components/Toolbar/DefaultVideoToolbar.tsx#DefaultVideoToolbar`；`DefaultVideoToolbarContent.tsx#DefaultVideoToolbarContent`（同目录） | 是（H6） |
| F22 | 下载原媒体 | 图片/视频工具栏下载或右键转换组 → 下载原文件 | 下载原始资产；抓取失败可在新窗口打开 | `U/context/actions.tsx#ActionsProvider(download-original)`；`U/components/menu-items.tsx#DownloadOriginalMenuItem` | 部分（H4、H7）：普通路径保留，宿主桥下载分支只筛图片 |
| F23 | 复制为 SVG | 右键/编辑 → 复制为 → SVG | 将选择（无选择则本页）渲染为 SVG 写入剪贴板 | `U/context/actions.tsx#ActionsProvider(copy-as-svg)`；`U/components/menu-items.tsx#CopyAsMenuGroup` | 是（H4、H6）；系统权限未核实 |
| F24 | 复制为 PNG | 右键/编辑 → 复制为 → PNG；Mod+Shift+C | 将选择（无选择则本页）渲染为 PNG | `U/context/actions.tsx#ActionsProvider(copy-as-png)` | 部分（H4）：宿主桥改用本机写入；权限未核实 |
| F25 | 导出选择 SVG | 右键 → 导出为 SVG | 下载选择的 SVG，无选择时动作回退到本页内容 | `U/context/actions.tsx#ActionsProvider(export-as-svg)`；`U/components/menu-items.tsx#ConversionsMenuGroup` | 是（H4、H6）；下载效果未核实 |
| F26 | 导出选择 PNG | 同上 PNG | 下载所选内容的 PNG | `U/context/actions.tsx#ActionsProvider(export-as-png)` | 是（H4、H6）；下载效果未核实 |
| F27 | 导出整页 SVG | 主菜单 → 全部导出为 → SVG | 导出当前页全部形状，不限当前选择，不跨其他页 | `U/context/actions.tsx#ActionsProvider(export-all-as-svg)`；`U/components/MainMenu/DefaultMainMenuContent.tsx#ExportFileContentSubMenu` | 是（H4、H6、H9） |
| F28 | 导出整页 PNG | 同上 PNG | 导出当前页全部形状 | `U/context/actions.tsx#ActionsProvider(export-all-as-png)` | 是（H4、H6、H9） |
| F29 | 透明背景 | 导出子菜单 → 背景勾选项 | 切换 exportBackground；导出/复制遵循背景设置 | `U/context/actions.tsx#ActionsProvider(toggle-transparent)`；`U/components/menu-items.tsx#ToggleTransparentBgMenuItem` | 是（H4、H6） |
| F30 | 扁平化成图片 | 编辑/右键编辑 → 扁平化；Shift+F | 将选择转换为图像形状，新图被选中；替换前保留撤销点 | `U/context/actions.tsx#ActionsProvider(flatten-to-image)`；`U/hooks/useFlatten.ts#flattenShapesToImages` | 是（H4、H6） |
| F31 | 打印 | Mod+P | 按选择或页面内容生成打印结果；由浏览器打印流程承接 | `U/context/actions.tsx#ActionsProvider(print)`；`U/hooks/usePrint.ts#usePrint` | 是（H4）；系统打印未核实；主菜单未默认放打印项 |
| F32 | 裁剪复位 | 正在裁剪图片时双击边界 | 恢复完整图像范围与未裁尺寸，并相应调整形状位置 | `T/shapes/image/ImageShapeUtil.tsx#ImageShapeUtil(onDoubleClickEdge)` | 是（H1、H7） |

## G. 嵌入

G05–G22 各自是一种服务。触发均为「主菜单 → 插入嵌入（Mod+I）→ 选择该服务 → 填匹配的 URL → 创建」。除 tldraw 的 `embedOnPaste: false` 外，各默认定义开启了 URL 自动嵌入。来源统一为 `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS` 中该行的 `type`；每行列出类型避免混淆。在线服务状态、登录、第三方页面策略及播放效果均未核实，不能据此宣称服务当前可访问。

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| G01 | 嵌入选择与 URL 校验 | 主菜单插入嵌入；Mod+I | 展示服务列表；无效 URL 不允许创建，可返回/取消 | `U/components/EmbedDialog.tsx#EmbedDialog`；`U/context/actions.tsx#ActionsProvider(insert-embed)` | 是（H4、H5、H6） |
| G02 | 互动和尺寸限制 | 双击嵌入后互动，拖动允许的边框 | iframe 获得互动；每种定义决定可缩放、比例、最小尺寸及权限 | `T/shapes/embed/EmbedShapeUtil.tsx#EmbedShapeUtil(canEdit/canResize/onResize/component)` | 是（H5）；外部页面未核实 |
| G03 | 嵌入转书签 | 选嵌入 → 编辑/右键编辑 → 转书签 | 以原 URL 创建书签；异步失败回退该操作 | `U/context/actions.tsx#ActionsProvider(convert-to-bookmark)`；`U/components/menu-items.tsx#ConvertToBookmarkMenuItem` | 是（H4、H5）；外部抓取未核实 |
| G04 | 书签转嵌入 | 选可识别服务的书签 → 转嵌入 | 以该服务尺寸创建嵌入，保留原位置/旋转关系 | `U/context/actions.tsx#ActionsProvider(convert-to-embed)`；`U/components/menu-items.tsx#ConvertToEmbedMenuItem` | 是（H4、H5） |
| G05 | tldraw | 嵌入对话框选 tldraw | 匹配网址转成 tldraw iframe；不靠普通粘贴自动嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(tldraw)` | 是（H5）；在线效果未核实 |
| G06 | Figma | 嵌入对话框选 Figma/粘贴匹配 URL | 创建 Figma 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(figma)` | 是（H5）；在线效果未核实 |
| G07 | Canva | 同上选 Canva | 创建 Canva 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(canva)` | 是（H5）；在线效果未核实 |
| G08 | Google Maps | 同上选 Google Maps | 创建地图嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(google_maps)` | 是（H5）；在线效果未核实 |
| G09 | Val Town | 同上选 Val Town | 创建 Val Town 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(val_town)` | 是（H5）；在线效果未核实 |
| G10 | CodeSandbox | 同上选 CodeSandbox | 创建沙盒嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(codesandbox)` | 是（H5）；在线效果未核实 |
| G11 | Codepen | 同上选 Codepen | 创建 Codepen 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(codepen)` | 是（H5）；在线效果未核实 |
| G12 | Scratch | 同上选 Scratch | 创建 Scratch 嵌入；定义不允许普通调整尺寸 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(scratch)` | 是（H5）；在线效果未核实 |
| G13 | YouTube | 同上选 YouTube | 创建锁定比例的视频嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(youtube)` | 是（H5）；在线效果未核实 |
| G14 | Google Calendar | 同上选 Google Calendar | 创建日历嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(google_calendar)` | 是（H5）；在线效果未核实 |
| G15 | Google Slides | 同上选 Google Slides | 创建演示文稿嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(google_slides)` | 是（H5）；在线效果未核实 |
| G16 | GitHub Gist | 同上选 GitHub Gist | 创建 Gist 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(github_gist)` | 是（H5）；在线效果未核实 |
| G17 | Replit | 同上选 Replit | 创建 Replit 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(replit)` | 是（H5）；在线效果未核实 |
| G18 | Felt | 同上选 Felt | 创建 Felt 地图嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(felt)` | 是（H5）；在线效果未核实 |
| G19 | Spotify | 同上选 Spotify | 创建 Spotify 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(spotify)` | 是（H5）；在线效果未核实 |
| G20 | Vimeo | 同上选 Vimeo | 创建锁定比例的视频嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(vimeo)` | 是（H5）；在线效果未核实 |
| G21 | Observable | 同上选 Observable | 创建 Observable 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(observable)` | 是（H5）；在线效果未核实 |
| G22 | Desmos | 同上选 Desmos | 创建 Desmos 嵌入 | `T/defaultEmbedDefinitions.ts#DEFAULT_EMBED_DEFINITIONS(desmos)` | 是（H5）；在线效果未核实 |
| G23 | 粘贴 iframe 嵌入代码 | 将含 HTTP(S) iframe 的 HTML 或纯文本代码粘到画布 | 取 src 和宽高创建嵌入；非服务列表 URL 使用原 URL 和未知嵌入的 sandbox 默认值，不等于任意 HTML 原样执行 | `U/hooks/useClipboardEvents.ts#extractIframeFromHtml`、`handleClipboardThings`；`T/defaultExternalContentHandlers.ts#defaultHandleExternalEmbedContent`；`T/shapes/embed/EmbedShapeUtil.tsx#EmbedShapeUtil(component)` | 是（H1、H5）；外站策略/权限效果未核实 |

## H. 视口、导航、偏好与多语言

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| H01 | 临时平移与惯性 | 空格拖动/中键拖动；手形拖动后松开 | 不换作品位置地浏览画布；支持对应输入的惯性路径 | `E/hooks/useCanvasEvents.ts#useCanvasEvents`；`E/editor/Editor.ts#Editor`；`T/tools/HandTool/childStates/Dragging.ts#Dragging` | 是（H1）；触控硬件手感未核实 |
| H02 | 滚轮/触控板手势 | 滚轮、双指滚动、捏合 | 按设备模式平移或以指针为中心缩放 | `E/hooks/useGestureEvents.ts#useGestureEvents`；`E/editor/Editor.ts#Editor` | 是（H1、H8）；硬件未核实 |
| H03 | 放大 | 缩放菜单/视图菜单；= 或 Mod+= | 以视口中心放大 | `U/context/actions.tsx#ActionsProvider(zoom-in)` | 是（H4、H6） |
| H04 | 缩小 | 同上；- 或 Mod+- | 以视口中心缩小 | `U/context/actions.tsx#ActionsProvider(zoom-out)` | 是（H4、H6） |
| H05 | 指针位置放大/缩小 | 上述放大/缩小组合加 Shift | 以指针屏幕位置缩放 | `U/context/actions.tsx#ActionsProvider(zoom-in-on-cursor/zoom-out-on-cursor)` | 是（H4） |
| H06 | 恢复 100% | 缩放/视图菜单；Shift+0；双击缩放百分比按钮 | 重置缩放比例 | `U/context/actions.tsx#ActionsProvider(zoom-to-100)`；`U/components/ZoomMenu/DefaultZoomMenu.tsx#ZoomTriggerButton(handleDoubleClick)` | 是（H4、H6） |
| H07 | 适合全部内容 | 缩放/视图菜单；Shift+1 | 当前页全部内容进入视口 | `U/context/actions.tsx#ActionsProvider(zoom-to-fit)` | 是（H4、H6） |
| H08 | 适合所选 | 缩放/视图菜单；Shift+2 | 将选择范围放入视口 | `U/context/actions.tsx#ActionsProvider(zoom-to-selection)` | 是（H4、H6） |
| H09 | 缩放工具 | 按 Z；单击或拖框；Alt 反向 | 点击缩放或缩放到框选区域，结束回原工具 | `U/context/actions.tsx#ActionsProvider(select-zoom-tool)`；`T/tools/ZoomTool/childStates/ZoomBrushing.ts#ZoomBrushing` | 是（H1、H4） |
| H10 | 快速缩放概览 | Shift+Z/缩放工具中按 Shift，移动指针后释放 | 临时展示全局；释放返回原视口或移到新的区域 | `T/tools/ZoomTool/childStates/ZoomQuick.ts#ZoomQuick` | 是（H1、H4） 2026-11-25 运行中的旧版按上述方式未能触发（步骤见 #85），新版暂不实现，验收时由用户确认是否需要。 |
| H11 | 小地图 | 导航面板展开小地图；点击/拖动/双击、滚轮；Shift 拖动 | 显示内容概览；双击将目标置中，Shift 拖动锁定单轴，滚轮沿用画布导航规则；可折叠 | `U/components/NavigationPanel/DefaultNavigationPanel.tsx#DefaultNavigationPanel`；`U/components/Minimap/DefaultMinimap.tsx#DefaultMinimap`；`U/components/Minimap/MinimapManager.ts#MinimapManager(minimapScreenPointToPagePoint)` | 是（H6）；小窗口按断点隐藏 |
| H12 | 返回内容 | 平移到作品全在视口外 → 返回内容按钮 | 回到选择或当前页内容，缩放不过度放大 | `U/context/actions.tsx#ActionsProvider(back-to-content)`；`U/components/HelperButtons/DefaultHelperButtons.tsx#DefaultHelperButtons` | 是（H4、H6） |
| H13 | 吸附偏好 | 主菜单 → 偏好 → 吸附 | 保存 isSnapMode，影响直接变换 | `U/components/MainMenu/DefaultMainMenuContent.tsx#PreferencesGroup`；`U/context/actions.tsx#ActionsProvider(toggle-snap-mode)` | 是（H4、H6、H8） |
| H14 | 网格模式 | 偏好 → 网格；Mod+' | 显示/隐藏网格并参与网格吸附 | `U/context/actions.tsx#ActionsProvider(toggle-grid)` | 是（H4、H6） |
| H15 | 环绕选择偏好 | 偏好 → 环绕选择 | 保存 isWrapMode，框选默认采用完全包含 | `U/context/actions.tsx#ActionsProvider(toggle-wrap-mode)`；`T/tools/SelectTool/childStates/Brushing.ts#Brushing` | 是（H4、H6、H8） |
| H16 | 专注模式 | 偏好 → 专注；Mod+. | 切换 isFocusMode，收起相关界面并清理对话框/提示 | `U/context/actions.tsx#ActionsProvider(toggle-focus-mode)`；`U/TldrawUi.tsx#TldrawUi` | 部分（H6）：默认 UI 路径保留，自定义界面是否全部隐藏未核实 |
| H17 | 边缘滚动 | 偏好 → 边缘滚动，拖动到视口边缘 | 打开/关闭边缘自动平移 | `U/context/actions.tsx#ActionsProvider(toggle-edge-scrolling)`；`T/tools/SelectTool/childStates/Brushing.ts#Brushing(onTick)` | 是（H4、H6、H8） |
| H18 | 动态尺寸 | 偏好 → 动态尺寸 | 新建对象尺寸随当前缩放调整，维持屏幕上的可用大小 | `U/context/actions.tsx#ActionsProvider(toggle-dynamic-size-mode)`；`E/editor/Editor.ts#Editor(getResizeScaleFactor)` | 是（H4、H6、H8） |
| H19 | 默认粘贴位置 | 偏好 → 在鼠标处粘贴 | 切换指针处/视口中心，临时快捷键见 F04/F05 | `U/context/actions.tsx#ActionsProvider(toggle-paste-at-cursor)` | 是（H4、H6、H8） |
| H20 | 输入设备模式 | 偏好 → 输入设备 → 自动/触控板/鼠标 | null、trackpad、mouse 三档；改变滚轮行为 | `U/components/InputModeMenu.tsx#InputModeMenu` | 是（H6、H8） |
| H21 | 反转缩放方向 | 偏好 → 输入设备 → 反转缩放 | 反转滚轮缩放方向；不适用的模式禁用入口 | `U/components/InputModeMenu.tsx#InputModeMenu`；`U/components/menu-items.tsx#ToggleInvertZoomItem`；`U/context/actions.tsx#ActionsProvider(toggle-invert-zoom)` | 是（H6、H8） |
| H22 | 浅色/深色/跟随系统 | 偏好 → 主题；Mod+/ 切换浅深 | 三种配色偏好；画布、形状色板随模式适配 | `U/components/ColorSchemeMenu.tsx#ColorSchemeMenu`；`U/context/actions.tsx#ActionsProvider(toggle-dark-mode)` | 是（H6、H8） |
| H23 | 减少动画 | 偏好 → 无障碍 → 减少动态效果 | animationSpeed 在 0/1 切换，减弱视口等动画 | `U/context/actions.tsx#ActionsProvider(toggle-reduce-motion)`；`U/components/AccessibilityMenu.tsx#AccessibilityMenu` | 是（H6、H8） |
| H24 | 开关快捷键 | 偏好 → 无障碍 → 快捷键 | 普通快捷动作停止/恢复；必需无障碍动作仍保留 | `U/context/actions.tsx#ActionsProvider(toggle-keyboard-shortcuts)`；`U/hooks/useKeyboardShortcuts.ts#useKeyboardShortcuts` | 是（H6、H8） |
| H25 | 增强无障碍模式 | 偏好 → 无障碍 → 增强模式 | 启用 enhancedA11yMode，样式标题等增强说明出现 | `U/context/actions.tsx#ActionsProvider(enhanced-a11y-mode)`；`U/components/StylePanel/DefaultStylePanelContent.tsx` | 部分（H3、H6、H8）：选择态样式面板仍隐藏 |
| H26 | 快捷键说明 | 主菜单/帮助 → 快捷键；Mod+Alt+/ | 按工具、编辑、视口、变换、文字、无障碍分组展示；工具快捷键按覆盖结果显示 | `U/components/KeyboardShortcutsDialog/DefaultKeyboardShortcutsDialogContent.tsx#DefaultKeyboardShortcutsDialogContent`；`U/context/actions.tsx#ActionsProvider(open-kbd-shortcuts)` | 是（H4、H6） |
| H27 | 界面语言 | 主菜单/帮助 → 语言列表 | 切换下面列出的 49 个 locale；当前项勾选，用户内容不被翻译 | `U/components/LanguageMenu.tsx#LanguageMenu`；`S/translations/languages.ts#LANGUAGES` | 是（H6、H8）；各翻译及 RTL 外观未核实 |
| H28 | 退出手写笔模式 | 检测到笔模式后的辅助按钮 | 清除 isPenMode，恢复普通输入方式 | `U/context/actions.tsx#ActionsProvider(exit-pen-mode)`；`U/components/HelperButtons/DefaultHelperButtons.tsx#DefaultHelperButtons` | 是（H1、H6）；笔设备未核实 |
| H29 | 响应式菜单与溢出 | 缩窄窗口/打开更多工具 | 导航、样式、工具与排列按断点收纳，功能不因窄窗静默丢失 | `U/components/Toolbar/DefaultToolbar.tsx#DefaultToolbar`；`U/components/NavigationPanel/DefaultNavigationPanel.tsx#DefaultNavigationPanel`；`U/components/StylePanel/DefaultStylePanel.tsx#DefaultStylePanel` | 部分（H2、H3、H6）：工具栏和样式面板有改写；窄窗未核实 |
| H30 | 手形连续点击缩放 | 手形工具下双击/三击/四击 | 双击在指针处放大，三击缩小；四击在 100% 时适合全部，否则重置 100% | `T/tools/HandTool/HandTool.ts#HandTool(onDoubleClick/onTripleClick/onQuadrupleClick)` | 是（H1） |

H27 的全部 locale：`id, ms, ca, cs, da, de, en, es, tl, fr, gl, hr, it, hu, nl, no, pl, pt-br, pt-pt, ro, sl, so, fi, sv, vi, tr, el, ru, uk, he, ur, ar, fa, ne, mr, hi-in, bn, pa, gu-in, ta, te, kn, ml, th, km-kh, ko-kr, ja, zh-cn, zh-tw`。切换语言的能力计 1 条，49 种选项都在覆盖范围。

## I. 无障碍与键盘交互

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| I01 | 跳到画布内容 | Tab 到跳转按钮后 Enter | 选中阅读顺序的第一个对象，必要时将其带入视口 | `U/components/A11y.tsx#SkipToMainContent` | 是（H1、H6）；读屏器未核实 |
| I02 | 顺序选择对象 | 已选对象后 Tab/Shift+Tab | 按阅读顺序选择下一/上一对象 | `T/tools/SelectTool/childStates/Idle.ts#Idle(onKeyUp/onKeyRepeat)` | 是（H1） |
| I03 | 按方向选择对象 | Mod+方向键 | 选择对应方向的相邻对象 | `T/tools/SelectTool/childStates/Idle.ts#Idle(onKeyDown)` | 是（H1） |
| I04 | 选择父/子对象 | Mod+Shift+上/下 | 进入第一个子形状或回到父形状 | `T/tools/SelectTool/childStates/Idle.ts#Idle(onKeyDown)` | 是（H1） |
| I05 | 键盘进入样式或媒体栏 | 选形状后 Mod+Enter | 焦点移到样式面板首按钮；单图片/视频移到对应上下文工具栏 | `U/context/actions.tsx#ActionsProvider(adjust-shape-styles)` | 部分（H3、H7）：选择态无样式面板，普通形状没有目标按钮 |
| I06 | 键盘打开右键菜单 | 选形状后 Mod+Shift+Enter | 在选择中心调出右键菜单 | `U/context/actions.tsx#ActionsProvider(a11y-open-context-menu)` | 是（H4、H6） |
| I07 | 读出选择变化 | 用键盘/指针更换选择 | live region 播报类型、序号、数量及文字/替代文本描述 | `U/components/A11y.tsx#DefaultA11yAnnouncer`、`generateShapeAnnouncementMessage`、`useSelectedShapesAnnouncer` | 是（H1、H6）；真实读屏效果未核实 |
| I08 | 重复播报 | 已选对象后 Alt+R | 重新宣布当前选择信息 | `U/context/actions.tsx#ActionsProvider(a11y-repeat-shape-announce)` | 是（H4）；真实读屏效果未核实 |
| I09 | 模拟按下指针 | 按住逗号，再释放 | 在当前指针处派发 pointer_down/up，可配合工具进行操作 | `U/hooks/useKeyboardShortcuts.ts#useKeyboardShortcuts` | 是（H1） |
| I10 | 键盘平移视口 | 空格+方向键 | 移动画布视口而非移动选择 | `E/editor/Editor.ts#Editor`；`U/components/KeyboardShortcutsDialog/DefaultKeyboardShortcutsDialogContent.tsx#DefaultKeyboardShortcutsDialogContent(a11y-pan-camera)` | 是（H1） |
| I11 | 菜单与控件键盘可达 | Tab/方向键/Enter/Esc 操作菜单、工具栏和对话框 | 焦点可导航，禁用项不可触发，菜单/对话框有对应标签与角色 | `U/components/primitives/TldrawUiToolbar.tsx#TldrawUiToolbar`；`U/components/primitives/TldrawUiDropdownMenu.tsx`；`U/components/primitives/TldrawUiDialog.tsx` | 部分（H2、H3、H6、H7）：默认控件继承，改写部分需独立实机验收 |
| I12 | 输入场景不误触画布快捷键 | 正在输入文字、输入法组合、表单编辑或菜单开启时按字母键 | 不应把文本输入当成切换工具；原生复制剪切粘贴另走剪贴板事件 | `U/hooks/useKeyboardShortcuts.ts#shouldSkipEvent`、`areShortcutsDisabled`；`U/hooks/useClipboardEvents.ts#useNativeClipboardEvents` | 是（H1、H4） |

## J. 页面管理（按产品约定不提供）

这是默认编辑器真实存在、但 ADR 0003 明确排除的能力。不得把它们记成新编辑器遗漏，也不得据此重新开放 hiCanvas 页管理。全部露出「否」依据 H9；页面区别于 hiCanvas 画板，后者由另一张功能清单覆盖。

| 编号 | 名称 | 用户怎么触发（默认编辑器） | 预期行为（默认编辑器） | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| J01 | 页面列表与切换 | 点页面名，选另一页 | 切换编辑页并展示当前页标记 | `U/components/PageMenu/DefaultPageMenu.tsx#DefaultPageMenu` | 否（H9）；按产品约定不提供 |
| J02 | 新建页 | 页面列表 → 新建 | 按数量上限新建页并切换 | `U/components/PageMenu/DefaultPageMenu.tsx#DefaultPageMenu(handleCreatePage)` | 否（H9）；按产品约定不提供 |
| J03 | 重命名页 | 双击页名或页菜单重命名 | 行内编辑名称，完成/取消有相应处理 | `U/components/PageMenu/DefaultPageMenu.tsx#DefaultPageMenu(startRenamingPage)`；`PageItemInput.tsx#PageItemInput`（同目录） | 否（H9）；按产品约定不提供 |
| J04 | 复制页 | 页菜单 → 复制 | 复制页与其内容 | `U/components/PageMenu/PageItemSubmenu.tsx#PageItemSubmenu(onDuplicate)` | 否（H9）；按产品约定不提供 |
| J05 | 删除页 | 页菜单 → 删除 | 删除该页；受最后一页等条件限制 | `U/components/PageMenu/PageItemSubmenu.tsx#PageItemSubmenu(onDelete)` | 否（H9）；按产品约定不提供 |
| J06 | 页面排序 | 拖动页行手柄或页菜单上/下移 | 调整页面顺序 | `U/components/PageMenu/DefaultPageMenu.tsx#DefaultPageMenu`；`PageItemSubmenu.tsx#PageItemSubmenu`（同目录） | 否（H9）；按产品约定不提供 |
| J07 | 移动选择到页 | 右键 → 移到页 → 已有页/新页 | 将选择转移到目标页 | `U/components/menu-items.tsx#MoveToPageMenu`；`U/context/actions.tsx#ActionsProvider(move-to-new-page)` | 否（H9、H4）；按产品约定不提供 |
| J08 | 上/下一页快捷键 | Alt+左/上、Alt+右/下 | 切到前后页；末页有内容时「下一页」可新建页 | `U/context/actions.tsx#ActionsProvider(change-page-prev/change-page-next)` | 否（H9、H4）；按产品约定不提供 |
| J09 | 页面列表尺寸与滚动 | 拖列表底部尺寸柄、滚动列表 | 列表高度持久化并适配大量页面 | `U/components/PageMenu/DefaultPageMenu.tsx#DefaultPageMenu`、`readSavedPageMenuListHeight` | 否（H9）；按产品约定不提供 |

## K. 需要协作连接或许可条件的可见能力

多人能力仅在接入 collaboration store/presence 时出现；裸的默认本机 Tldraw 不自动带来多人服务。hiCanvas 的 HTTP 版本冲突保护/MCP 更新不等同于 tldraw presence。

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| K01 | 人员头像和名单 | 有协作连接时打开人员面板 | 显示在线人员、姓名/颜色及连接状态 | `U/components/SharePanel/DefaultPeopleMenu.tsx#DefaultPeopleMenu`；`U/hooks/useCollaborationStatus.ts#useShowCollaborationUi` | 否（H1、H6）：无 collaboration store，SharePanel 为空 |
| K02 | 编辑自己的姓名/颜色 | 人员面板中的个人信息区 | 修改个人显示名与光标颜色 | `U/components/SharePanel/DefaultPeopleMenuContent.tsx#DefaultPeopleMenuContent`；`U/components/SharePanel/DefaultUserPresenceEditor.tsx#DefaultUserPresenceEditor` | 否（H1、H6） |
| K03 | 查看/跟随他人视角 | 人员名单单击定位；双击/跟随按钮；停止跟随 | 跳到对方视口或持续跟随，可退出 | `U/components/SharePanel/DefaultPeopleMenuItem.tsx#DefaultPeopleMenuItem`；`U/context/actions.tsx#ActionsProvider(stop-following)` | 否（H1、H6） |
| K04 | 他人光标/选择与光标聊天 | 协作连接后；桌面按 / 或右键光标聊天 | 显示 presence，输入临时聊天；触屏不打开聊天动作 | `U/context/actions.tsx#ActionsProvider(open-cursor-chat)`；`U/components/menu-items.tsx#CursorChatItem`；`T/overlays/CollaboratorCursorOverlayUtil.ts#CollaboratorCursorOverlayUtil` | 否（H1、H6） |
| K05 | 许可入口/品牌提示 | 满足 SDK 对应许可状态时看画布角落 | SDK 显示对应许可/品牌入口，点击按许可组件行为跳转 | `E/license/Watermark.tsx#Watermark` | 部分（H11）：本基线隐藏未许可入口，SDK 校验保留；许可状态未核实 |

## L. 默认界面能打开的调试功能（条件项）

这些不是仅存在于编程 API：偏好菜单确实能开启 Debug 菜单。它们属于开发诊断，替换编辑器时单列决策，不与普通创作工具混算；本次没有实际执行重置、造错或造数据。

| 编号 | 名称 | 用户怎么触发 | 预期行为 | 来源（文件与符号） | hiCanvas 当前露出 |
| --- | --- | --- | --- | --- | --- |
| L01 | 调试模式 | 偏好 → Debug mode | 显示/隐藏调试面板 | `U/context/actions.tsx#ActionsProvider(toggle-debug-mode)`；`U/components/DefaultDebugPanel.tsx#DefaultDebugPanel` | 是（H4、H6） |
| L02 | JSON 复制 | 开调试后 → 复制为 → JSON | 将选择/当前页的 JSON 内容写剪贴板 | `U/components/menu-items.tsx#CopyAsMenuGroup`；`U/context/actions.tsx#ActionsProvider(copy-as-json)` | 是（H4、H6）；系统权限未核实 |
| L03 | 诊断动作 | Debug → Hard reset / Show toast / Show dialog / Create 100 shapes / Count shapes / Throw error | 分别重置本地编辑器、展示提示/对话框、创建测试形状、统计节点、触发错误；每个按钮独立条件验收 | `U/components/DebugMenu/DefaultDebugMenuContent.tsx#DefaultDebugMenuContent`、`createNShapes` | 是（H6）；未执行破坏性诊断 |
| L04 | 调试/功能标志 | Debug → Debug flags / Feature flags | 枚举当前标志并切换，不把未启用实验行为当成默认创作能力 | `U/components/DebugMenu/DefaultDebugMenuContent.tsx#DebugFlags`、`FeatureFlags`、`DebugFlagToggle` | 是（H6）；未核实各实验标志效果 |

## 只给程序员的接口（不作为验收项）

`T/defaultShapeUtils.ts#defaultShapeUtils`、`T/defaultShapeTools.ts#defaultShapeTools`、`T/defaultTools.ts#defaultTools` 提供扩展注册；`E/editor/Editor.ts#Editor` 提供形状、相机、历史、导出等调用；store/schema/migrations/persistence 提供数据基础；`T/Tldraw.tsx#Tldraw` 与 `U/overrides.ts#TLUiOverrides` 支持替换组件、主题、资源和动作。服务端同步、资产存储及许可参数由宿主接入。这里仅说明扩展面，不把 API 方法数量当成用户功能数量，也不把 `.tldr` 文件打开/保存、云端共享链接、PDF/PPTX 原生导出推断为默认 UI 已有入口。

## 覆盖说明与验收边界

已读入口：工具与形状注册三表、`useTools`；`ActionsProvider` 全动作表、`useKeyboardShortcuts`、默认快捷键对话框；默认主/右键/排列/缩放/帮助菜单及 `menu-items` 的条件分支；默认样式面板与 `STYLES`、几何枚举；选择/移动/缩放/旋转/框选/自由选择/裁剪/快速缩放状态；箭头绑定、线顶点、画框、便签、媒体形状；富文本默认扩展、文字区、浮动栏及 Tiptap 扩展；默认外部内容处理、剪贴板、嵌入定义与对话框；导航、输入设备、配色、语言、无障碍播报、页面、人员与调试入口。hiCanvas 对照入口见 H1–H12。

覆盖 ActionsProvider 中有默认菜单或键盘入口的动作；`open-embed-link` 仅注册而未被默认菜单/快捷键引用，不单列为可触发功能，`select-none` 的用户结果归 B01。

每类数量和「未核实」条目索引在下方汇总；「未核实」描述的是尚未实测的环境效果，不表示靠记忆填入条目。全部交互均尚未在本轮实际点击；即使行中没有额外标注，也不能报告为实机通过。

| 类别 | 条目数 | 其中额外标注「未核实」的编号 |
| --- | ---: | --- |
| A 工具、形状与创建 | 39 | A03、A12 |
| B 选择、直接变换与容器 | 36 | B30、B34、B35 |
| C 排列、层级与吸附 | 23 | 无 |
| D 样式选项 | 17 | 无 |
| E 连接线、标签与文字 | 23 | E02、E19 |
| F 剪贴板、导入、媒体与导出 | 32 | F01、F02、F03、F04、F05、F07、F10、F11、F12、F18、F19、F20、F23、F24、F25、F26、F31 |
| G 嵌入 | 23 | G02、G03、G05、G06、G07、G08、G09、G10、G11、G12、G13、G14、G15、G16、G17、G18、G19、G20、G21、G22、G23 |
| H 视口、偏好与语言 | 30 | H01、H02、H16、H27、H28、H29 |
| I 无障碍与键盘 | 12 | I01、I07、I08 |
| J 页面（产品排除） | 9 | 无 |
| K 协作/许可条件项 | 5 | K05 |
| L 调试条件项 | 4 | L02、L04 |

合计 **253 条**；其中 A–I 普通创作/操作能力 235 条，J 产品排除 9 条，K/L 条件项 9 条。静态露出为「是」209 条、「部分」31 条、「否」13 条；57 条额外标注了环境或交互效果「未核实」。这些计数不包含 H1–H12 证据编号和程序员接口段。

后续默认编辑器验收：在隔离合成画板中按 A–I 操作 → 对照每行预期；J 确认按产品约定缺席；K/L 按是否提供协作/诊断能力决定测项；嵌入只在明确允许联网且有测试资源时检查。hiCanvas 现有缺口（H3 样式、A 键、协作面板等）应由主控在重构验收时明确保留或补齐，不能将此盘点当成用户已经批准的改动。

## 与旧版的有意差异

网格（#171，淡入由#180补齐）：四层低视角淡入已对齐，原粗层有意差异取消。各层使用独立DESIGN令牌和同一线性钳制公式；永久公开渲染探针对照隔离旧版26个实际视角、104项计算透明度，逐层误差上限0.01，包含14个归纳时预留的核对视角。会话偏好仍由宿主公开接口持有，未接正式菜单；点色、固定屏幕半径及四层固定SVG图案不变，避免逐点创建节点。真实设备视觉仍需集中确认。

| 编号 | 差异 | 原因 | 工单 |
| --- | --- | --- | --- |
| A11 | 消退采用1200ms等待、每16.7ms收一点、整批最多500ms的确定性近似，保留串行收短及收短期间恒宽恒色；不宣称精确缓动一致。 | 59组旧版黑盒观察确认行为与有限时序样本，精确曲线未知；主控批准近似。 | #131 |
| A11 | 最多32段，每段1024点；超限淘汰最老完成段或隔点降采样保留首尾。简单圆头折线不复刻旧版轮廓平滑及新末端约16px滞后。 | 上限用于有界内存，属于明确新增规则；旧版L37末端像素与公开点投影不一致，失败样本保留，不放宽阈值冒充复刻。 | #131 |
| I（菜单Esc） | 打开着的菜单按Esc仅关闭菜单，画布选择保持；旧版同一输入还会清选择。 | 保持现有菜单保护契约；旧版同时清选择的两个独立处理器因果未知。普通按钮/链接/关闭触发器Esc继续保护，工具栏Esc才执行画布取消并请求回焦。 | #209 |
| A04 | 尾迹寿命、尖尾和缓动使用有界点列、100ms收短及圆头折线近似，不宣称精确复刻。 | 123组原生观察确认12px、收短/末点/收尾，精确曲线与寿命未知；颜色另以白底截图合成像素对照。 | #130 |
| A04 | Mod统一为Command或Ctrl，不复制macOS单按Control时按下就删且后续输入状态异常的观察现象。 | 旧版三次重复观察不能定位原因，不能推断撤销历史损坏；按新底座统一输入契约处理。 | #130 |
| A04 | 失焦或pointer_cancel统一取消未提交擦除，保留作品及原选区，不增加撤销。 | 旧版只做过离屏焦点模拟，没有可信真实系统失焦/pointer_cancel读数；新实现遵循统一取消契约。 | #130 |
| B25、B26（通用编辑器差异） | 删除后撤销恢复作品及绑定，通常不恢复删除前选区；复制事务的选区跟随继续保留。 | 会话选区不进入文档历史；选择工具删除也如此。本次#130观察发现旧版擦除撤销会恢复原选区，记录为全编辑器差异，不新增橡皮专有选择历史。 | #130观察发现，ADR0010 |
| 通用几何（选择框、吸附、居中） | 旋转椭圆的可见边界用解析计算，比旧版的多边形近似略大；80×60椭圆旋转45°参与两图联合居中时，平移量约差0.18个世界单位。 | 全部操作复用同一几何来源，不在导入器追加凑旧读数的修正。 | #176发现，通用几何口径 |
| F07、F19 | 打开画板和新导入视频均不自动播放；同一时刻只播一个视频，其余保留当前帧。存档playing/autoplay不起播、不改旧存档；人、MCP与AI新建视频的两个默认值都为false。播放与进度只在会话，不进撤销。 | 用户 2026-11-26 决定；有意改变旧版批量导入后全部自动静音循环播放的行为。 | #186 |
| B30 | 先按住 Command 再按画框手柄可直接裁框，并同时翻转对象吸附、绕过网格。 | 保留已验收的手柄优先入口；旧版此时清空选择且不进入缩放。 | #135 |
| B36、B31 | 单轴双击适配修正旧版的位移和撤销不完整；锁定子项也保持画布位置。 | `fit-left` 实测旧版子项 x 从 -30/220 变10/260，框原点不动，一次撤销只恢复框宽；新底座整个动作一次事务。 | #135 |
| B09 | 松开Alt在该按键输入帧立即切回原件移动；旧版原生采样的松键首帧仍显示副本，下一指针帧或松手才完成切回。 | 统一逐帧输入，避免旧副本短暂残留；位置、最终选择、一次撤销及后续复制偏移保持一致。 | #125 |
| C20、C21、H13 | 提示线复用既有 error 色（#c2410c）、1 CSS px brush 线宽及 xs 锚点；Command 释放时在静止指针上立即恢复偏好。偏好由宿主会话持有，经公开接口读写，本单无设置界面。 | 旧版129组离屏原生记录确认红细线、叉形锚点和中点刻度，精确色值/线宽未知；按主控审定复用令牌。旧版 keyUp 后公开修饰键状态等待下一次指针移动才恢复，新底座按按键生命周期立即重算。 | #128 |
| C23、E23 | 控制点吸附用8 CSS px半径，默认关闭、Ctrl临时反转；连续点选仅替换初始种子，后续近点也追加，种子接段使用精确指针位置，不保留旧版约0.1px偏移。 | 旧版三点线距首点(7,3)吸点、(8,3)吸段，阈值只定位在7.62–8.54px区间；连续点选距末点3–32px均追加。不提前引入#128总框架。 | #134 |
| E04、E22 | 标签拖动沿实际路径投影、保留抓取偏移并夹在0–1；端点双击独立切none/arrow，标签双击复用文字会话。 | 按清单实现；旧版原生与显式CDP观察中，前者移动整条箭头、后者进入文字编辑，均没有可靠正例，不宣称旧版无此功能，留集中体验确认。 | #134 |
| C14/C15 | 旋转组镜像按每个后代的页面朝向反射；旧版的结果见 #75 观察记录 | 旧版递归处理父组角度时，部分后代朝向没有正确反射；新实现围绕共同选择外框统一镜像 | [#75](https://github.com/solosvip/hiCanvas/issues/75) |
| A03/A10/A36 | 活动笔画按 Esc 整条丢弃、不提交、不增加撤销；松手后 Esc 保留已完成笔画。旧版「按下→移动→Esc→松开」留下 `isComplete=false` 的半成品，撤销一次才消失。追加直线时只丢弃当前未提交的接段，保留先前完成的部分。 | 主控 2026-11-26 审定；沿用 ADR 0010 的逐手势事务，避免半成品残留。 | #129 |
| F11 | 书签预览图加载失败时显示无图卡片，保留标题和网址；旧版保留破图及替代文字。 | 避免破图文字覆盖卡片；2026-11-25 主控审定。 | #83 |
| F14 | 缩放滑块明确标示 100%–300%，在两端之间线性变化；旧版中点映射非线性。 | 保留旧版测得的完整图像与三倍端点，让百分比直接对应放大倍数。 | #139 |
| F16 | 松手立即保存一次裁剪；Esc 撤掉当前未保存手势，空闲时退出并保留已保存裁剪。 | 遵循新引擎的逐手势事务；旧版空闲时 Esc 会撤销进入裁剪以来的全部改动。 | #139 |
| F12 | 新编辑预览中的图片替换保留身份、画框、镜像和描述，按新原图重新居中；不沿用旧取景。旧版隔离原生选择器补测：240×180外框、原裁剪(.2,.1)–(.8,.9)，换160×320后(.2,.3875)–(.8,.6125)，换4096×256后(.486111,.333333)–(.513889,.666667)。 | #137补齐旧版实际读数后，主控审定继续保留#139的新图居中算法，不逐值沿用旧裁剪。 | #139、#137 |
| G05 tldraw | `www.tldraw.com.example.invalid` 不识别为嵌入服务。 | 精确主机名；旧版本轮会误识别。 | #202安全差异 |
| G07 Canva | `www.canva.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G08 Google Maps | `www.google.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G09 Val Town | `www.val.town.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G10 CodeSandbox | `codesandbox.io.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G14 Google Calendar | `calendar.google.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G15 Google Slides | `docs.google.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G16 GitHub Gist | `gist.github.com.example.invalid` 不识别为嵌入服务。 | 同上；真实Gist也暂作书签，等待安全包装。 | #202安全差异、#220 |
| G17 Replit | `replit.com.example.invalid` 不识别为嵌入服务。 | 精确主机名；旧版本轮会误识别。 | #202安全差异 |
| G18 Felt | `felt.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G19 Spotify | `open.spotify.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| G21 Observable | `observablehq.com.example.invalid` 不识别为嵌入服务。 | 同上。 | #202安全差异 |
| F10、G23 | HTTP只建书签；iframe只读唯一src，采用服务默认尺寸；未知服务回退书签并提示。混合代码或多个iframe整批拒绝。 | 旧版HTTP可转HTTPS嵌入，未知服务可嵌入，输入宽高生效，多个iframe只取第一个。新版保留一套已知服务权限来源。 | #202安全差异 |
| G06 | Figma内层URL独立校验并按一个查询参数完整编码。 | 旧版拼接会把内层查询/片段误当外层；其他安全参数继续保留。 | #202 |
| G03、G04 | 同ID原子互转保留parent/index、rotation、opacity、meta和选区；新尺寸围绕原页面中心，组与兄弟保持，已有箭头绑定不改锚点、端点随新几何重算。 | 旧版embed→bookmark换ID、opacity从0.7变1、meta清空、选区清空；480×270的(260,190)转成300×46的(350,165)，中心Y从325变188；组内旋转转换拆组、兄弟提升到page，中心偏移(-100,-100)。证据见本节末尾第二段路径conversion-*.json。 | #202，经主控审定修正旧缺陷 |
| F10、F11 | 新书签形状和asset同次提交、同次撤销/重做，撤销后全部记录逐字段还原。 | 旧版迟到网址粘贴撤销删除形状但留下孤立bookmark asset；history-late-cancel.json保留完整前后记录。联网补全和迟到结果归#203。 | #202、#203 |
| G16 | Gist 在新渲染层先显示保留原地址的书签卡片；脚本包装待 #220。 | 旧版使用 srcdoc 加载脚本包装；宿主隔离基础已完成，Gist包装归 #220，互动归 #206。 | #83、#202、#220 |
| E06–E19、A09/B29（画框标题） | 正文、箭头标签、便签及画框标题的连续全角标点均不挤压，例如「。」」不再挤掉半个字宽。编辑与显示均显式使用 space-all / no-autospace。 | 旧版挤压依赖行尾上下文，静态排版无法可靠复现；编辑仍由浏览器断行，松手显示以统一排版结果为准，极少量换行差异见 ADR 0011。 | #103 |
| D08（字体） | 手写字体用作者 1.011 可变字体的拟合实例，与旧版自然宽度最大差约 1.8 px，字形接近但不完全一致。 | 旧版的手写字体与作者各发布版都不一致，旧版文件不能取用。 | #94、#103 |
| H11 | 小地图滚轮只转交一次现有画布滚轮规则，与相同画布锚点的输入逐项一致。 | 旧版一次原生滚轮产生小地图与画布两次 wheel，平移和缩放重复响应；2026-11-25 主控审定。 | #98 |
| H11 | 小地图拖动期间固定按下时的取景和换算，视口框等量跟随指针；松手后再取景，Shift 锁主要轴。 | 避免旧版取景反馈造成静止指针继续追赶、左右不对称；2026-11-25 主控审定。 | #98 |

| A01/A09、A13–A35（工具栏拖入） | 从工具栏拖到画布外或界面按钮上松手取消；旧版在 x=-20 松手仍保存默认矩形 x=-120/y=330/w=200/h=200，成为画面外的对象。 | 在画布外或按钮上松手表示放弃，避免留下看不见的对象。 | #126 |
| A01/A09、A13–A35（拖入首帧） | 拖入的第一帧即以指针为中心；旧版第一帧预览停在工具栏起手位置，下一帧或松手才跟上指针。 | 让首帧跟手，避免对象闪在工具栏。 | #126 |
| A20/A21/A22（星形、云形、心形创建边界） | 从 (500,350) 拖到 (650,430)，旧版星形 x=499.82110936132005/y=350/w=150.35778127735986/h=80.72700079076078；云形 x=500/y=346.24659754821914/w=150/h=87.50680490356174；心形 x=500/y=349.5531112507849/w=150/h=80.44688874921506。新版三种均为 x=500/y=350/w=150/h=80。 | 旧版不满 1×1 的曲线种子造成偏移；新轮廓按完整宽高归一化，20种均以指针框定边界。默认点击尺寸、Shift 等比、Alt 种子中心规则保留。 | #126 |

## 新编辑底座手绘覆盖（#129）

正式应用尚未切换新编辑器。下表是独立合成预览的实现与验证入口，不改上文旧版的露出结论。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| TL-A03 | D/B/X 或工具按钮进入画笔；逐帧保留自由采样及压力，松手一笔一次提交、撤销和重做；绘制与点中复用已有笔迹几何 | `tools/draw-interaction.test.mjs`、`tools/draw-context.test.mjs` |
| TL-A10 | Shift+D 或工具按钮进入荧光笔，保留压力数据，显示使用已有等宽、双层叠色；不同笔画分别提交 | 同上；`tools/renderer-preview/draw-smoke.mjs` 的原生压感与叠色 |
| TL-A36 | Shift 自由段与15°约束直线段切换；松手仍持 Shift 可向同一笔迹接段；首尾靠近时实时更新闭合标记 | 同上；三档比例的闭合边界、接段取消和原生逐帧输入 |
| TL-H28 | 笔输入自动进入会话内笔模式，鼠标不再新建笔画；「退出手写笔模式」恢复鼠标输入，不产生画板记录或撤销 | 同上；原生 pen 输入、真实退出按钮与鼠标恢复 |

观察方式与已测数值就近写在 `engine/interaction/stroke-input.js`、`draw.js` 注释中。压力换算和闭合阈值由有限旧版样本近似，几何平滑沿用现有实现；真实手写板、倾斜、橡皮端、高频合并事件与触控手感仍需硬件集中验收。变形仍按 #105 只改 scale，不重写笔迹编码点。

## 新编辑底座文字覆盖（#132）

正式应用仍使用旧编辑器。下表记录独立合成预览与公开动作，不改上文旧版来源。文字编辑 Esc 保存当前会话；画笔 Esc 丢弃未提交笔画，两种事务分别处理。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| A01/A05/A39、E06/E21 | 四类对象双击或选中Enter编辑；空白双击直接写字；Esc/Mod+Enter/画布外点击完成，组字及表单焦点保留草稿 | `tools/text-editing.test.mjs`、`tools/renderer-preview/text-editing-smoke.mjs` |
| A38 | Alt双击矩形/勾号框互换，不进入编辑，保留ID和其他属性，一次撤销 | 同上；2026-11-26原生及显式Alt指针协议均未复现旧版正例，按清单实现，留用户集中确认 |
| B29、E04 | 画框标题使用单行input写name；箭头标签使用共享视图写richText，沿路径既有标签位置进入 | 同上；标题点中由宿主注入自然宽测量，守住祖先裁切和遮挡 |
| D07–D11 | 四档字号、四类字体；普通文字水平对齐、几何标签水平和垂直对齐，其他目标禁用不适用选项；样式动作遵守祖先锁及隐藏 | `tools/text-editing.test.mjs`、`tools/renderer-text-editing.test.mjs`、原生文字守卫 |
| E07 | T点击自动宽、长拖固定宽；自动大小动作；编辑内切换及输入一次撤销，空新文字不留历史，已有普通文字清空删除 | 同上；旧版700px长拖为独立正例，新版短拖沿用通用创建4px门槛，未把它当作旧版文字阈值 |
| E08–E19（数据保留部分） | 进入、退出及实际改字保留完整MIT schema节点/标记/属性，不随每次预览重建视图 | 原生文字守卫；格式工具栏/精确富文本排版/链接/列表/编辑中粘贴归#150，画布文本粘贴归#136 |

旧版E21未在原生或显式Meta/Ctrl协议得到完成编辑正例，按清单提供Mod+Enter，留用户集中验证。字体沿用#103公开作者字体，其手写拟合差异仍按上文D08记录；新文字默认draw。编辑时浏览器断行，退出使用统一字宽；远端改文字或删除时保留草稿并停自动提交，远端只改其他字段携最新版本叠文字一次。正式冲突选择界面尚未接入。

## 新编辑底座连接线覆盖（#134）

正式应用仍使用旧编辑器。下表是独立合成预览及公开交互入口；既有绘制、绑定路由和#105整体缩放继续复用。默认产品工具仍为select/hand，需显式开放line/arrow。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| A07、A08 | 箭头与线条点击/拖动创建，L选择线条，A保留AI图片；一手势一次提交/撤销 | `tools/connection-interaction.test.mjs`、`tools/renderer-preview/connection-smoke.mjs` |
| C23 | 可选控制点吸附参数；自身非邻接顶点/线段、其他可见控制点/真实轮廓；开放曲线不产生虚构闭合边；取消移除指示 | `tools/connection-controls.test.mjs`、原生连接线守卫；总开关归#128 |
| E01、E02 | 从对象起手可同时创建两端绑定，轮廓内/边界绑定、外1px解绑；Alt精确、Ctrl忽略目标，停留转精确；移动/缩放/删除及撤销维持记录一致，保留绑定meta | 两组连接线事务测试；组内成员变化取消旧预览，删除文字/便签依赖宿主已准备字体 |
| E03 | 中柄改bend；折肘反解现有路由中柄位置并夹到0–1，不重写路径 | 两组连接线测试、原生连接线守卫 |
| E04 | 标签拖动写labelPosition，双击经#132会话编辑richText，文字与拖动各自整次撤销 | `tools/connection-controls.test.mjs`、原生连接线守卫；旧版正例限制见有意差异 |
| E05 | 端点/顶点移动及段间加点，保留线条身份、负坐标和曲线样式 | 两组连接线测试、原生连接线守卫 |
| E22、E23 | 两端独立切端帽；保持线条工具时Shift继续接段，点选种子替换末点、后续近点及远点均追加；拖画Shift按15度约束 | 两组连接线测试、原生连接线守卫；端帽旧版正例限制见有意差异 |

旧版观察在2026-11-26隔离应用内用合成画板、离屏原生鼠标/键盘及公开只读getShapeHandles/记录读数完成：水平400px箭头中柄下拉100px得到bend100；m号折肘中柄横移50px得到elbowMidPoint约0.635685；Alt需在手柄按下后使用，200ms样本仍中心、300ms转精确。观察方法和已证实数值同时就近写在实现注释；精确毫秒阈值未宣称已测准。补测中3–32px近点均追加；锁定目标不绑定，透明目标旧版允许绑定、新版沿用隐藏对象过滤（有意差异）。

## 新编辑底座选择动作覆盖（#124）

正式应用仍使用旧编辑器。以下是合成预览的编辑层实现，状态不替代上文的旧版露出结论；正式菜单和MCP尚未接入。`tools/renderer-preview/actions-check.mjs` 使用真实按钮、原生键鼠及带真实repeat标记的CDP按键，结果和截图保存在 `.scratch/actions-smoke/`；不能据此声称真实键盘手感或最终产品已验收。

| 条目 | 覆盖 | 新底座行为与永久回归 |
| --- | --- | --- |
| TL-B15 | 已实现 | 默认方向键1、Shift为10画布单位；#171会话网格开启后为10/50，保留非格点偏移，与相机比例无关；长按重复只在最后松键提交一次，分开的按键分别提交。`selection-actions.test.mjs`、`action-history.test.mjs`、`grid-interaction.test.mjs`覆盖逐帧、撤销、失焦、取消和父框基准冲突。 |
| TL-B16–B18 | 已实现 | 顺逆15°下一刻度、Alt为15°/16，围绕选择中心按1.1或倒数缩放；复用既有旋转／缩放命令及类型规则。`action-history.test.mjs`；旧版合成原生按键读回的数值与方式写在动作表注释。 |
| TL-B19/B20/B22–B24 | 已实现 | 组合选新组，单组Mod+G切换解组；混选解组先保留非组再追加子项。锁定清选择，全部解锁保留空选择，删除清选择。`selection-actions.test.mjs`、`action-history.test.mjs`。 |
| TL-B27 | 已实现适用状态 | 活动移动／缩放／画笔Enter不提前完成，松手提交；Esc只取消当前预览。画笔／荧光笔空闲Esc退选择工具、保留选择。`action-history.test.mjs`、`selection-actions.test.mjs`及既有工具取消回归。 |
| TL-B31/B32 | 已实现 | 适配框动作显式留白50，内容画布位置不动；移除框选直接内容。命令padding默认0不变。`action-commands.test.mjs`、`action-history.test.mjs`。 |
| TL-C01–C12 | 已实现 | 六对齐、双轴拉伸／分布／堆排，堆排显式间距10；分布和堆排至少三项，双选仍可拉伸。`action-history.test.mjs`、`selection-actions.test.mjs`及既有命令层排版回归。 |
| TL-C13 | 已实现 | `pack_shapes`按画布外框高度、宽度升序，同尺寸保留选择顺序；原选择宽度约束换行，结果整体居中。动作间距10，直接命令默认间距仍16；两者使用同一排法。#154隔离旧版原生菜单28组读数（不同数量／尺寸／位置、重叠、旋转、缩放及换行临界值）逐组由`server/engine-pack.test.mjs`守住坐标、一次撤销重做和重复执行；原生动作守卫检查精确落点及整次撤销重做。 |
| TL-C14/C15 | 已实现 | 双轴镜像复用既有命令，旋转组的既定有意差异仍见上表。`action-history.test.mjs`及既有组镜像回归。 |
| TL-C16–C19 | 已实现 | 置顶置底不变；前移／后移传`mode:overlapping`，只跨过碰到任一已选对象的下一同级对象，保留已选相对顺序；边角接触算重叠，选择外框空隙不算。命令默认adjacent不变。`action-commands.test.mjs`、`action-history.test.mjs`。 |
| TL-I12及跨工具冲突 | 已实现编辑层接线 | 表单、菜单、组字和关闭快捷键先拦截键盘；程序动作拒绝提交中／活动手势／裁剪／文字编辑。Option+A的key=å用code识别；Shift H/V、旋转逗号、对象缩放组合各有唯一拥有者。`action-shortcuts.test.mjs`枚举真实声明表，联合既有键盘／选择／创建／画笔／裁剪／视角回归。 |

用户后续集中体验：在隔离合成小板选几个对象，逐项按上述快捷键及按钮 → 每次完成一次撤销，选择与内容符合表中规则；在表单／输入法内按同样的键 → 输入正常，画板不变。长按、组合键、触控和菜单的最终手感仍需真实设备确认。

## 新编辑底座便签覆盖（#133）

正式应用仍使用旧编辑器；下表只记录独立合成预览和公开动作，不改变上文旧版来源。便签整体缩放沿用 #105，SVG 署名导出 G17 不在本单。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| A06 | 显式开放 note 后 N、工具栏点击/拖入创建固定200方纸；创建与首次文字同次提交及撤销 | `tools/note-interaction.test.mjs`、`tools/renderer-preview/note-smoke.mjs` |
| B33 | 四边中点「+」邻位续建，间距10×scale，增高纸面按实际高度向下续建；复用既有邻居。单张同层/角度/比例便签移动时，邻位径向距离严格小于10 CSS px吸附；取消恢复、指示不进文档 | 同上；覆盖父级旋转、0.5/2比例、6/6与8/8径向反例、10px边界 |
| B34、E21（便签） | Tab/Shift+Tab横向、Mod+Enter/Mod+Shift+Enter纵向，RTL反转横向；一次键盘续建含源文和邻居一次撤销。IME/重复按键不续建 | 同上；另守住409最新位置重算、失败保留草稿、表单/工具切换不抢焦点及双指导航 |
| B35（屏幕署名） | 仅宿主显式displayName；首次实际输入（含空格）才署名，首名显示/完整名提示，清空移除。仅查看不认领、已有作者不替换，净空往返保留作者及远端最新归属 | 同上；缺姓名留空，编辑层不读账号/OS/runtime actor；G17另单 |

旧版观察使用隔离编译应用、合成画板与离屏原生输入，共64个样本；只读公开记录、控制柄及DOM。确认四向邻位、10×scale间距、增长高度、RTL和已有邻居复用，以及严格径向10 CSS px吸附（Ctrl/Meta在移动中不关闭）。便签Mod+Enter取得结束源编辑并进入下邻居的正例；普通文字的E21补测仍无可靠完成正例，保留#132限制，不扩大结论。旧版隔离资料的显示名为空，未找到姓名编辑入口，故未宣称已原生验证旧版非空姓名偏好。

有意差异：新底座只接宿主姓名，未传时保持null；旧版空姓名隔离用户仍可写不显示姓名的内部作者ID。新「+」使用既有令牌的可见圆柄及十字，旧版观察为细小边中点标记，动作和坐标保留。首次编辑后又清空再恢复原文时，以原作者/最新远端归属为准，避免净空操作生成历史或抹去署名。真实输入法候选窗、RTL阅读手感及正式界面留集中人工验收。

## 新编辑器复制手势覆盖（#125）

| 清单条目 | 已实现行为 | 永久守卫 |
| --- | --- | --- |
| TL-B09 | 按下前或拖动中按Alt复制，原件回到起点、选中移动副本；松Alt移除副本并移动原件，反复切换分配新ID。拖动门槛、Shift约束、旋转父框、组／画框子孙、内部绑定保持一致；松手一次提交／撤销／重做，Esc、失焦、冲突取消无残留。 | `tools/duplicate-interaction.test.mjs`，`tools/renderer-preview/duplicate-smoke.mjs`（并入动作原生入口） |
| TL-B10 | Mod+D及公开duplicate动作复用复制命令；默认画布范围宽+10、纵向0，连续复制及移动／微移副本沿用先前偏移；Alt复制以拖动位移建立后续偏移。重新选择及新会话回默认，原件不变、选择副本；组框复制全部后代，内部绑定改指副本、外部解绑保留可见线端。 | 同上及 `server/engine-duplicate.test.mjs`；键盘入口复用声明表与输入上下文门禁 |

2026-11-26在隔离旧版的合成画板，以离屏原生键盘／鼠标和公开只读记录逐帧观察：100宽矩形连续三次Mod+D位于x=210、320、430（原件x=100）；500宽多选每次右移510；z=2偏移不变；移动／微移副本后偏移不变；Alt拖动(70,40)后再Mod+D继续(70,40)。组宽240／框宽350分别右移250／360。绑定箭头存储终点250、可见终点236.5，单独复制及部分复制冻结外部可见端点；内部绑定指向副本。复制ID对应关系与重复偏移只保存在当前交互会话，通过本会话复制回执跟随撤销／重做的副本增删，不写进画板或宿主撤销历史。正式应用仍使用旧编辑器；集中体验需用户在合成小板验证连续复制、Alt往返切换与一次撤销的手感。

## 新编辑底座对象吸附覆盖（#128）

正式应用仍使用旧编辑器；本单只覆盖独立预览及编辑层公开接口。网格 C22/H14/TL-B15 网格部分已拆到 #171；创建 G01 和新增控制点 G07 接入保持后续范围。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| C20 | 移动与缩放吸到对象边、中线及等间距；8 CSS px包含边界；多选/组以共同外框；Shift轴锁、Alt中心及Shift比例保留 | `tools/snapping-interaction.test.mjs`、`tools/renderer-preview/snapping-check.mjs` |
| C21 | 宿主指定主修饰键，默认Mac Command；按下/释放实时反转对象偏好；控制点沿用Ctrl独立反转 | 同上及既有连接线回归 |
| H13 | `snapping`会话偏好，经`getSnappingPreferences`/`setSnappingPreferences`读写；不入画板/撤销，非法patch不部分生效 | 对象吸附逻辑回归；正式菜单另单 |
| C23框架 | 统一计算、描述及清理入口收纳既有控制点和便签邻位策略；兼容`controlPointSnapping`，保留各自半径、优先级和修饰键 | 既有`connection-controls.test.mjs`、`note-interaction.test.mjs`及对应原生守卫 |

对象阈值来自2026-11-26隔离旧版整包的129组原生输入与公开读数：移动7.99/8吸附、8.01/8.25不吸附；缩放8吸附、8.01不吸附，0.5/1/2倍整数边界交叉核对。锁定对象可作参照，画框裁掉的隐藏边不参与吸附，90°缩放保留旋转及固定边；对应行为留有回归。观察不读取受限实现；网格原始读数仅供#171复用，本单未加网格代码或占位参数。

永久原生守卫15例通过，覆盖三档移动/缩放边界、Command静止反转、等间距、保存及整次撤销；公开渲染接口另验证覆盖层复制、非法/溢出更新原子拒绝和不写画板。将实际吸附半径临时改成0时，守卫在首个阈值断言报错；恢复8后重新通过。既有连接线、便签原生守卫各8例通过，控制台错误和外网请求均为零；证据分别在本工作区`.scratch/snapping-smoke/`、`.scratch/connection-smoke/`和`.scratch/note-smoke/`。

开启吸附的5000档双生产宿主三轮交替对照通过本单拖动门槛：paint帧率中位数旧版3.94、新版29.28，比例7.44，高于0.90，无需补测。打开耗时中位数旧版2464ms、新版4935ms，比例2.00；这项仍是限制，不代表#96所有指标通过。正式报告及原始样本在`.scratch/snapping-perf/run-Mg0EWH/`，两端每轮均读回吸附开启状态；最终设备手感及正式界面仍留集中人工验收。

## 新编辑底座网格覆盖（#171）

正式应用仍使用旧编辑器，本单仅扩展独立合成预览和既有公开吸附接口。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| TL-C22 | 10画布单位格点，移动和缩放同一统一入口；移动中对象边/中线/间距优先于更近网格，未吸住的轴才落网格；缩放先指针落格，再施加原约束、判断对象半径，半径内对象覆盖格点；主修饰键按住绕过网格、同时沿用对象偏好反转 | `tools/grid-interaction.test.mjs`；`tools/renderer-preview/snapping-check.mjs`网格场景 |
| TL-H14 | `snapping.grid`会话布尔字段，沿用get/set；纯数据grid描述，渲染层在作品下方画四层点阵；不写画板、不进撤销、不同会话独立 | 同上；公开挂载/覆盖层浏览器契约探针 |
| TL-B15网格 | 方向键10、Shift为50画布单位，非格点偏移保留；按住逐帧预览、松键整次保存撤销；公开微移动作同一规则，关闭后仍1/10 | `tools/grid-interaction.test.mjs`及既有动作/撤销回归 |

旧版网格原始样本复用#128，另用15组隔离旧版原生补测独立复核：原始x321更近网格320，同时开启对象策略仍吸对象边317，四种对象/Command组合落点为320、317、317、321。缩放原始右边387先落390，再判对象383：0.5/1倍落383，2倍距离14 CSS px超出8px半径而保持390；等比角拖动得到宽290、高193.333333，中心缩放保持中心。逐帧守卫先按这两项新反例报红，修正顺序后通过。

永久原生回归30场景（原对象15＋网格15）通过，覆盖三个视角、对象/网格优先级、实体Command与Shift、中心/等比缩放、10/50微移、关闭点阵及保存撤销；公开渲染探针检查四层相机位置、令牌色、固定屏幕半径、基础透明度及非法输入原子拒绝。实改格距10为11，原生守卫按坐标错误报红，逐字恢复后30场景再次通过。1/2倍截图已看：点阵位于作品下方，实心图形内无点阵，选择手柄清晰。证据在工作区`.scratch/grid-legacy/observed.json`、`.scratch/snapping-smoke/`及`grid-native-*.log`。低视角四层淡入已由#180对齐，26个视角的逐层读数守卫见上节；真机视觉与手感仍留集中验收。

## 新渲染层视频覆盖（#120）

正式应用仍使用旧编辑器；以下为独立合成预览、编辑层公开接口及共享本机资源服务。

| 清单项 | 已实现与回归 | 限制或有意差异 |
| --- | --- | --- |
| F19 | 保存外框与cover；旧data URL及本机相对路径；双击原生播放/暂停/跳转，外点/Escape退出；播放进度仅在会话，摄像机不换video节点、无关形状零DOM变更 | 不支持外部视频URL；缺失/损坏显示占位，无未捕获错误；编码支持取决于Chromium |
| F20 | 文件选择替换保留形状ID/x/y，尺寸改新视频自然宽高；资源ID换新、进度归零、保留会话暂停；失败恢复原资源及原进度 | 使用拦截文件选择的合成文件，未操作系统选择窗口 |
| F07（视频部分） | MP4/WebM/MOV文件导入，屏幕落点居中、自然尺寸；两/三个文件紧贴成行、顶部对齐；一次提交/撤销，上传期间版本或选择改变拒绝整次；非法/损坏/上传错误有提示 | 旧版写data URL，新上传改本机文件，避免画板被视频撑大；旧版合成ClipboardItem未取得粘贴正例，新版仅以合成文件粘贴事件验证，不声称真实系统剪贴板已验收 |
| F21 | 工具栏编辑并经命令保存altText，提供视频无障碍名称；保留资源身份，支持清空 | 新预览保存按钮与旧版输入后外点保存的入口不同；正式产品宿主归#143 |

旧版隔离观察确认：320×180外框和320×240外框保持保存尺寸；播放/暂停/3.302536秒跳转没有修改持久time/playing。替换160×320后保留x/y=100/100。两文件落在(550,420)时为(310,260,320,180)、(630,260,160,320)；三文件为(150,260,320,180)、(470,260,160,320)、(630,260,320,180)。替代文字真实输入后外点保存为“合成彩色格视频”。这些读数由`tools/video-*.test.mjs`和`tools/renderer-preview/video-smoke.mjs`守住。

公共`createMediaImport`收编辑语义；临时`video-ui.js`的文件入口已复用媒体上传宿主，描述和播放行为不变。文件读取单独放在`video-file.js`，正式产品接入仍另行完成。上传后最终提交失败的本次文件清理见#196；旧版损坏视频的未捕获异常及上传失败留下缺资源形状均不照搬。

32MiB/64秒相对路径视频在2MiB/s限速、仅缓冲约1.2秒时，无Range的真实中段跳转失败；新增Range后，小文件和大文件的中段、末段、播放后跳转均等待seeking=false及解码完成通过。永久HTTP回归覆盖首尾/后缀/开放范围、非法范围416、HEAD与路径边界。

5000元素同一固定板，3张图片替为3个静音循环视频，0/3交替三轮；未修改记录与相机哈希一致。paint中位数：平移44.62→49.55fps，缩放55.93→44.05fps（下降21.2%，实际播放门禁后的最终六样本；首轮下降16.4%的数据另保留）；只报告本轮负载下的结果，不声称缩放无代价。复用既有输入/时钟/RAF/paint驱动，拖动按原驱动不适用。原始六样本与环境负载在`.scratch/video-performance/report.json`；新旧同场对照归#181；设备手感与真实系统文件粘贴留用户集中验收。

## 新编辑底座内部剪贴板覆盖（#136）

本单按主控16:55审定覆盖TL-F01/F02/F03/F04/H19；TL-E19/F05/F06/F09/F10/G23外部链已拆至#176，编辑文字内的富文本粘贴仍归#150。自有格式不兼容旧data-tldraw，本单不声明外部条目完成。正式应用仍为原编辑器。

| 条目 | 已实现且经永久单测断言的行为 | 原生／人工验证 |
| --- | --- | --- |
| F01 | 复制选中树和内部绑定，外部箭头端点冻结为可见坐标；内容脱离来源记录也可再编辑；自有plain/HTML封装保留Unicode和HTML字面值 | 合成事件边界的原生回归通过；系统互通／权限由用户验证 |
| F02 | 先确认写入成功再带版本删除；拒写、异步版本变化和失焦都不删除；重复动作只做一次IO | 同上 |
| F03 | 父子／绑定／资源重新编号，根解锁、孩子保留锁定；目标已有记录不覆盖；跨板资源包含HTML/CSS/静态模块嵌套依赖；整次记录撤销重做 | 原生跨板、刷新及撤销守卫通过；另三组旧版锁定补测确认粘贴根解锁、子锁保留 |
| F04／H19 | 本轮审定映射为「粘贴至光标处」偏好开关，默认false；原位重复重叠、完全离屏时视口居中、光标处整体居中，支持旋转父链和框外回页；Shift不改变实测落点 | 原生偏好按钮与坐标守卫通过；未经本轮实测的临时Alt热键不实现、不声称兼容 |

永久入口：`server/engine-clipboard.test.mjs`、`server/editor-clipboard.test.mjs`、`server/clipboard-assets.test.mjs`；既有duplicate、运行时及content-assets回归继续保留。原生入口 `node tools/renderer-preview/clipboard-check.mjs` 已通过，材料在 `.scratch/clipboard-smoke/`：宿主对其他／编造画板拒绝且不写；三次报错桩反例精确命中，正常流程核对原位、重复、光标、剪切、整次撤销重做、表单／组字不IO、跨板与刷新；离屏文档焦点模拟配合原生点击/按键，剪贴板事件仍为合成事件。另实测在启动清单写入期间及Electron运行时中断，均不遗留进程或端口。

两项已审定有意差异：跨板重新分配资源编号，避免旧版同编号不同图片串图，包内共享仍只导入一次；新资源记录随对象同次撤销，物理文件保留。原35组旧版读数及新增三组锁定补测均为合成ClipboardEvent／私有DataTransfer边界，结合原生指针／修饰键／菜单；未使用真实系统剪贴板，不据此声明跨应用或系统权限验证。锁定补测先重跑同源码边界证明，再分别观察锁定叶、锁定根框及锁定后代，来源记录不变、整次撤销重做一致，材料在 `.scratch/clipboard/locks-fb1x15wj/`。

## 新编辑底座画框交互覆盖（#135）

旧版已在隔离合成画板完成78组观察，另有19组先按手柄后Command的补证及2组焦点/松键时序补证。每次全新进程先重跑同源码三红一绿平台证明；未读取受限实现，未调用真实系统剪贴板或外部接口。证据在工作区 `.scratch/frames/observed-facts.json` 及其逐条来源。一次旧版 React #300 的不完整批次原样保留，针对同组独立重复三次及后续逐组独立页面均未复现，未认定为稳定旧版缺陷。

| 清单项 | 本次实现与永久守卫 | 当前验证边界 |
| --- | --- | --- |
| B28 | 指针选择前层可用画框，多选只收纳与该目标相交的根；组只换根；保持画布姿态、Alt副本、取消、一次撤销；共享reparent_shapes复查锁/父链，相关子树变化拒绝、无关更新有限重试 | 服务端原子/历史与公开交互逻辑回归通过；原生拖入拖出及一次撤销通过 |
| B30 | 普通缩框保持孩子局部记录；Command先取最终对象/网格吸附，再补偿未锁的直接孩子；锁子随框移动，嵌套子框作为整体补偿 | 八边角、旋转父链、Alt/缩放逻辑回归通过；原生旋转八边角、取消及四种吸附组合通过 |
| B36、B31 | 左右边只适配x，上下边只适配y，角点适配两轴；UI留白10，默认共享命令仍为两轴/零留白；所有直接孩子含锁项保持画布位置，一次撤销还原；第二击按住拖动转普通缩框 | 永久命令、两次完整点击逻辑回归通过；原生旋转八边角适配和两种第二击拖动通过 |
| B29 | 复用#132标题编辑入口，本次只补旧版观察：Enter/Esc都保留输入且可整次撤销，旋转及2倍视角可编辑；锁框不编辑其名称 | 未增加标题实现；真实设备手感留集中验收 |

永久原生入口 `tools/renderer-preview/frame-check.mjs` 仅用内存合成夹具，鼠标/键盘进入同一输入链，只读诊断用于断言；39场景通过，包含旋转边角、先按Command入口、四种对象/网格组合、适配、第二击拖动及整次撤销，材料在 `.scratch/frame-smoke/`。旧版另补两次独立进程观察，确认第二击按住拖动走普通缩框。已变基到含#136/#100/#186的main；新增两文件53项逻辑回归通过，完整检查逐文件核对169文件1629项通过，构建与桌面打包通过。实际设备手感、触控板及前台焦点交给用户集中验收；正式应用尚未切换。

## 新编辑底座栅格图片导入与属性（#137）

正式应用仍使用旧编辑器。本节是新底座实现范围；旧版粘贴观察有缺口，不以合成事件未触发为“不支持”的证据，文件粘贴由#136公开适配器与本单回归承接，真实系统剪贴板未验证。

| 条目 | 新底座行为 | 永久回归入口 |
| --- | --- | --- |
| TL-A12、TL-F07 | 图片选择器、拖入、文件粘贴共用`createMediaImport`；PNG/JPEG/WebP/GIF/APNG/AVIF保留自然尺寸和动画标志，整排无缝/顶部对齐/落点居中，重复落点不避障，大图视口90%适配。支持项失败整批不落形状；不支持类型提示后过滤。单批100、单文件20 MB、边长16384及64 Mi像素预算。 | `tools/image-import.test.mjs`、`tools/image-host.test.mjs`、`server/image-upload.test.mjs`、`tools/renderer-preview/image-smoke.mjs#imageImportSmoke` |
| TL-F08 | #189已接SVG文件净化与两阶段导入，范围及原生验收见下节；SVG文本粘贴策略未变。 | `server/svg-sanitize.test.mjs`、`tools/image-host.test.mjs`；非栅格伪装拒绝沿用 |
| TL-F12 | 文件选择器替换保留身份、外框、位置、镜像和描述；继续#139按新图居中裁剪。 | `tools/image-import.test.mjs`、既有裁剪命令回归、`imageImportSmoke` |
| TL-F17 | `set_image_alt_text`与`interaction.imageAlt`；草稿仅会话持有，Enter或外点一次提交、一次撤销；Escape无记录，输入法组字不确认，冲突/锁定/选择变化/销毁不写回旧草稿。渲染层沿用alt描述。 | `tools/image-alt.test.mjs`、`imageImportSmoke` |

旧版补测采用隔离生产构建、合成资料、离屏原生选择器/CDP文件拖入与只读记录：320×180单张选择置于(480,310)，拖到(550,420)置于(390,330)；320×180与160×320两张左上(310,260)/(630,260)，第三张320×180加入后(150,260)/(470,260)/(630,260)；4096×256保留尺寸，1280×800视口z=.28125。描述Enter及外点保存、Escape取消；原生探针的Meta+A没有清除旧文，故仅主张新内容保存、取消原文的观察结果。

原生入口`node tools/renderer-preview/image-check.mjs --port 43397`已通过：六格式真实浏览器解码及彩色像素、原生选择器/CDP拖入、私有DataTransfer的PNG和PNG+WebM文件粘贴、文件优先HTML、表单/组字不拦截、替换/描述/撤销重做、损坏及第二次上传503整批回滚、刷新恢复。描述输入在1280及390宽度留图，窄屏输入与工具栏不越界、不遮导航；保存由HTTP门禁暂停，期间产生的新文件错误经实际相机刷新仍保留，恢复旧错误清理写法会准确报红。版本是不可计算的令牌，事务同时以HTTP提交次数和整次撤销核对。系统剪贴板API与未捕获错误均为零。

| AI已自测及防止的问题 | 需用户集中体验（操作 → 期望） |
| --- | --- |
| 六格式解码/像素、自然尺寸/批量/大图视角，防空白占位、尺寸缩小及落点偏移 | 正式宿主接入后选择和拖入日常图片 → 显示、位置与缩放手感符合预期 |
| 私有文件粘贴、PNG+WebM一次提交撤销、表单/组字不拦截，防双收和吞表单输入 | 从其他应用复制图片再粘贴 → 系统权限正常、只出现一次，表单粘贴照常 |
| 描述Enter/外点保存、Escape无记录、390宽不越界；替换保留身份/外框/镜像/描述，防属性丢失 | 真实输入法输入描述并用辅助技术读取 → 候选操作和读出正确；窄屏操作顺手 |
| 损坏/503无半批、受控保存中错误不被刷新抹掉、刷新恢复，防误报成功或数据丢失 | 出错后重试 → 反馈易懂，重新导入及撤销行为清楚 |

有意差异：替换继续按新图居中，具体旧版两组裁剪读数见上表F12；SVG在#137后由#189补充，见下节。旧版图片先写data URL，故reference上传503拦截实际命中0次，不能当作上传失败验证；真实画板PUT 503命中3次、显示未保存/重试。本底座先上传后单次提交，读取/上传失败不落形状；上传后最终事务失败只清本次尚未保存文件，规则见#196。真实设备输入法/辅助技术读出与系统剪贴板权限仍需集中体验。

## 新编辑底座SVG文件导入（#189）

实现沿#137/#136的选择器、拖入与公共文件粘贴宿主，File和原始XML不进入编辑层。SVG先经不落盘的`file-import-prepare`净化，浏览器只解码规范dataUrl；未取消且自然尺寸合法才最终上传，服务端再净化一次，不信“已净化”标记。最终资源仍由既有响应沙箱和nosniff隔离；生成内容/历史SVG路径不改。只读图鉴缺少准备服务时明确拒绝SVG。SVG文本粘贴策略未扩展。

| 行为与有意边界 | 永久回归入口 |
| --- | --- |
| 基础几何、Unicode文字、简单标签/class/id CSS、变换、线性/径向渐变、clip/mask、内部use、marker箭头及六格式内嵌栅格；保留尺寸单位/viewBox，由浏览器读取自然尺寸 | `server/svg-sanitize.test.mjs`、`server/svg-styles.test.mjs`、`tools/renderer-preview/svg-smoke.mjs` |
| XML/CSS白名单重建；脚本/事件/foreignObject/外链/动画/xml:base等移除并有类别提示；DTD、自定义实体、坏编码/XML、循环/错类型/悬空引用拒绝，正常预定义和数字字符引用只解码一次 | 同上；27类攻击夹具在`svg-fixtures.js` |
| 有意差异：旧版按图片原样显示filter/pattern/SVG字体，包括滤镜阴影；新底座不开放这些效果，移除并提示。复杂CSS选择器/@规则/外部字体及未知值不开放 | `svg-styles.test.mjs`、`svg-sanitize.test.mjs` |
| 输入/输出2 MiB、单批8 MiB；10000节点/64层/单元素64及总100000属性；CSS 64 KiB/1000规则/10000声明；路径256 KiB/100000参数；直接引用10000/深32/展开25000节点；内嵌1 MiB/16张/16 Mi像素，复用及继承marker同时计开销 | 上述单位边界/加一测试；主机文件数及取消在`tools/image-host.test.mjs` |
| 准备阶段零素材/版本变化；解码失败和取消不最终上传；混合SVG/PNG/WebM一次事务，坏第二项整批无形状；替换沿既有身份/外框/镜像/描述及撤销 | `server/svg-upload.test.mjs`、`tools/image-host.test.mjs`、`tools/image-import.test.mjs`、`svg-smoke.mjs` |
| 桌面格式专用bundle在无源码依赖的新进程完成准备/保存；按实际metafile核对xmldom、PostCSS、nanoid、picocolors、source-map-js及原文许可，五份文件随桌面licenses目录分发 | `tools/svg-pack.test.mjs`；证据`.scratch/svg-observation/bundle-metafile.json`、`bundle-licenses.json` |

原生入口`node tools/renderer-preview/image-check.mjs --port 43397`已通过，保留全部六栅格及既有图片断言。SVG选择器/CDP拖入成功，坏XML不留形状；六组自然尺寸依次为320×180、267×150（viewBox、偏移viewBox及百分比）、192×96（物理单位）、300×150（缺省）。真实渲染截图核对use绿色、线性渐变和marker蓝色箭头；安全图片解码后的像素核对clip/mask透明区域、径向渐变及内嵌PNG。SVG+PNG+WebM私有DataTransfer粘贴只有一次提交，整批撤销重做；坏第二项不落半批，系统剪贴板API调用及未捕获错误为零。视频原生回归也已通过。

同隔离响应的原始恶意SVG阳性对照实测出现1次脚本标记、3次子资源请求尝试（含1次同源），两次外部请求被阻断、fetch失败如实记录；随后27类样本中14类明确拒绝，另外13类最终再净化后直接导航，脚本执行、子资源请求尝试和错误均为零。探针只排除预期顶层导航，在网络阻断前计数。结果和像素图在`.scratch/image-check/svg-native.json`、`svg-security.json`及`svg-renderer-pixels.png`；这些是合成材料的验证，不代表任意SVG均已穷举。

| AI已自测层次及防止的问题 | 需用户集中体验（操作 → 期望） |
| --- | --- |
| 单位/真实HTTP/独立打包：拒绝坏XML、越权资源和引用爆炸，准备零写入；取消/失败无半批，SVG替换保留属性 | 正式宿主接入后选择/拖入常用设计或流程图SVG → 支持的渐变、文字、箭头和尺寸正确，不支持效果有清楚提示 |
| 原生尺寸/像素/箭头、同边界阳性对照与27类恶意样本、混合文件一次撤销及视频回归，防空白导入、箭头丢失、探针失效和危险资源请求 | 从日常应用复制SVG文件再粘贴 → 系统权限正常、只出现一次；一次撤销整批消失。日常字体替代和设备手感一并体验 |

## 橡皮擦的新编辑底座（#130，A04）

旧版123组隔离合成画板原生观察确认：普通点按多层、Meta点按顶层而拖动多层、整段跨越、8屏幕px容差、超过4屏幕px起拖；完全透明可擦，锁定叶及祖先跳过；未聚焦组提升外层根，未锁子项命中级联删除锁住兄弟，直接命中锁住子项跳过；聚焦组只擦子项；画框空心、可见裁剪与旋转父链。按住只有淡化/尾迹，松手才一次删除，一次撤销重做。观察不读受限实现或真实资料，证据在本单`.scratch/eraser-legacy/`。

实现复用增量索引、现有删除级联和runtime事务；移动只维护会话，松手一次delete/commit，取消无历史。永久测试覆盖组的两种锁情况、取消、绑定可见端点及整次撤销、远端目标/后代/新绑定变化拒绝、无关远端变化保留、网络失败与保存响应丢失只重读。移动时全板读取直接抛错；索引透明选项默认关闭，既有选择不因擦除变更。

原生入口为 `tools/renderer-preview/eraser-check.mjs`，使用 `watch:false`、纯合成内存画板、原生鼠标/键盘和只读观察；原生49条断言通过，14份读回样本，0运行/控制台错误、0外部请求：普通/Meta点拖、Esc/V、叶对象/组及荧光背景同时淡化、原透明度0.5乘令牌alpha且取消/松手撤销恢复、画框剪裁、三视角跨小对象、原生笔画擦除与键盘归属。白底尾迹中心旧版RGB(246,246,246)、新版(245,245,245)，逐通道差1；独立读数固化进永久守卫，不依赖旧版包或临时参考。淡化alpha在挂载时解析CSS令牌，改令牌后重新挂载；取消后DOM透明度精确恢复，荧光两层合成像素允许1字节取整差。构建/全量和真实钩子结果以本单派活交付为准。

| AI已自测及防护目的 | 需用户集中验证（操作 → 期望） |
| --- | --- |
| 会话/几何/纯描述及每ID订阅回归，防提前删除、漏跨段、锁/裁剪误擦及整板订阅 | 实际设备按E点按/扫过 → 预览清楚，松手整次删除，手感自然 |
| 模拟远端改动、网络失败、响应丢失和整次撤销，防扩大删除范围、覆盖他人及重复提交 | 擦除后撤销 → 作品恢复；通用选区差异、Control和尾迹近似按上表决定是否接受 |
| 原生49条断言和白底/组/荧光/半透明实际像素通过，防淡化失效、透明度覆盖及取消残留 | 真实窗口切出、触控笔与输入法中按E → 未完成擦除取消，文字输入不被抢走 |

## 新编辑底座样式接口（#127；界面尚未接入）

`createCanvasInteraction`提供`getStyles()`和`setStyles(patch)`。查询返回不可变的`next`及每项的`choices/state/value/supportedCount`；Mixed和unsupported不提供统一value。无选择仅更新本窗口会话，不写文档、不进撤销。选择本身不采纳样式；保存成功才更新下一默认，失败不采纳，文档撤销不倒退默认。下一对象创建见下方#194，AI框尺寸见#195；这些底座接口不代表正式面板已接入。

下一对象的“换页”边界不适用（ADR 0003）：每个画板只有一张无限画布，没有页面管理。换画板已在旧版原生观察；最近工具、相邻便签及续画的补证结论见#194。

| 条目 | 接口范围及与旧版的关系 | 永久回归 |
| --- | --- | --- |
| D01–D06 | 12色面板预设、Alt+T白色、六填充及Alt+F/Alt+Shift+F设值、四线型；只改适用类型，保留labelColor。opacity接受有限[0,1]，五档choices仅为界面预设。**有意差异：旧面板最低10%，新API允许0**。离散动作一次保存/撤销；未提供滑块预览协议。 | `tools/style-query.test.mjs`、`tools/style-session.test.mjs`、`tools/keyboard-context.test.mjs` |
| D07–D12、A29–A32 | 四尺寸/四字体，textAlign仅普通文字，align/verticalAlign仅geo与note；20几何变体复用既有能力和统一排版。 | 同上及`tools/text-editing.test.mjs` |
| D13–D16 | arrowKind映射props.kind，两端各八种端帽独立设置；line/cubic仅line。保留bend、线点、笔迹段、身份、位置、元数据及不相关字段。 | `tools/style-session.test.mjs` |
| D17选择与组锁 | **与旧版一致**：组查询包含锁定后代的兼容样式，动作只改可编辑叶子；group及嵌套group自身opacity不变，因此操作后仍可能Mixed。整份非法patch拒绝、无空历史、失败恢复选择。 | `tools/style-query.test.mjs`、`tools/style-session.test.mjs` |
| 活动文字、键盘归属 | 活动文字/标签/标题的适用样式保留草稿与光标，共用原文字事务；位置远端更新可重放，同字段样式冲突保留草稿停止覆盖。**有意差异：旧版一次编辑可产生多条历史，新版整次编辑只一条**。快捷键沿用code/Option、表单/菜单/文字、IME及禁用保护。 | `tools/text-editing.test.mjs`、`tools/keyboard-context.test.mjs` |

旧版结论来自2026-11-27隔离原生观察；默认夹具字体不可达，精确旧字宽/换行不在已验证范围。API逻辑回归已通过；本单原生、新生产构建、完整检查及真实提交钩子待白板验证，不把API通过写成面板验收。

| AI已自测及防的问题 | 留用户集中验证（操作 → 期望） |
| --- | --- |
| 公共API覆盖类型子集、全部离散选项、组锁与Mixed、非法/失败/忙碌、零提交/一次undo及会话隔离 → 防半批写回、假统一值和默认污染。 | 界面接入后多选混合对象并切样式 → 选项及Mixed易懂，锁项保持原样。 |
| 文字与样式共同保存/取消、失败重试、远端样式冲突及透明度0恢复 → 防草稿/光标丢失、重叠事务和覆盖远端。 | 界面接入后用真实IME、物理Option及辅助技术编辑 → 输入不中断，整次一次撤销的有意差异可接受。 |

## 新编辑底座外部粘贴覆盖（#176）

正式应用仍未切换；本节仅列新底座范围，不把原表旧编辑器的“是”当成本底座全部实现。旧版隔离观察为合成ClipboardEvent与私有DataTransfer，29组主批次中的28组取得完整结果；一组ASCII大文本超时、三组报错和三次导航取消单列，不当作解析安全或完整支持的证据。

| 清单项 | 本次支持范围 | 未覆盖／后续 |
| --- | --- | --- |
| F05、F06 | 普通文本按换行建段；HTML保留段落、br、粗体、斜体，折叠HTML源码缩进空白，重建纯数据；两者沿#136默认落点规则 | 合法http/https/mailto链接、RTL、标题、列表等格式整次提示等#150；未增加强制纯文本热键，不能宣称F05全覆盖 |
| F09 | Excalidraw基础矩形、椭圆、菱形，保持相对位置、层序、尺寸、归一化旋转及透明度；整批校验后单次导入 | 其他类型及无法表达的特性跳过并汇总提示；不是完整.excalidraw文件导入器 |
| F10、F11 | 普通URL暂作文本；独立iframe代码或HTML iframe明确提示 | 自动书签/外部嵌入归#138 |
| F07、F08 | 文件粘贴保留#137媒体入口，文件优先于文字，不加第二套监听 | SVG文件/纯SVG文字入口归#189；HTML中的SVG/MathML子树整棵丢弃 |

Excalidraw明确转换表（与旧版相同的转换，加上计数提示）：描边`#1e1e1e/#ffffff/#e03131/#1971c2/#2f9e44/#f08c00`对应black/white/red/blue/green/orange，其余描边转black；背景`#ffc9c9/#a5d8ff`对应light-red/light-blue，transparent无填充，其他背景使用描边映射色。填充与描边共用一个颜色，因此已知背景覆盖独立描边时也计数提示。hachure与cross-hatch合为pattern，未知fillStyle按solid；roughness 1/2配solid线型合为draw，dashed/dotted保留；opacity除以100。有限正线宽分档≤1.5/≤2.5/≤3.5/其余对应s/m/l/xl，修正旧版线宽8部分写入后报错的缺陷。

不能表达的类型、组/画框归属、圆角、链接、锁定及有效绑定等特性跳过整个元素；引用不存在对象的boundElements只去掉绑定，几何仍导入。删除元素不导入，附件不导入。转换、跳过和丢弃绑定合为一条按类别计数的普通提示，不回显输入原文；全跳过提示“没有可导入的内容”，零提交。**可选改进，待用户决定**：其他Excalidraw颜色可按色系映射到最接近的现有颜色。

Excalidraw整批联合边界中心移至视口中心、父级固定page，不受指针、光标偏好、画框和聚焦组影响；旋转原点按元素中心换算，相机变化只产生统一平移。旋转椭圆边界引用上文“通用几何”有意差异，导入器不单独修正。

本实现的有意差异与边界：坏JSON、结构、ID重复、非有限数、非正尺寸和资源超限整批拒绝，不提交、不改记录/revision/撤销重做，避免旧版部分导入；旧data-tldraw载荷明确不兼容。HTML在无浏览上下文的惰性文档里解析，脚本/样式/资源标签丢弃，原节点不插入活文档，SVG/MathML正文也不保留。有效链接/RTL及本单外格式整批拒绝，不静默丢格式。普通文本256 KiB且最多100000码点、HTML 1 MiB/10000节点、JSON 4 MiB/100000值、1000元素、深度64，总UTF-8输入4 MiB，均为新的资源预算，不声称是旧版上限。

永久逻辑入口：`server/engine-external-clipboard.test.mjs`、`server/editor-external-clipboard.test.mjs`、`tools/external-clipboard.test.mjs`。原生入口复用`tools/renderer-preview/clipboard-check.mjs`，同源码三红一绿及35组外部夹具已通过：HTML资源/导航/执行陷阱零触发，默认与Excalidraw落点、一次提交、原生撤销重做及拒绝后保留既有redo分支均守住。受控缺失对象update经实际HTTP两次400，旧runtime错误不遮住全跳过通知或成功复制；合成错误调用真实反馈回调后，原生hover刷新仍保留新错误，此项仅证明显示生命周期。临时恢复旧错误优先级或移除HTML粗体转换，分别准确报红，源码逐字恢复后最终入口再次通过，材料在`.scratch/clipboard-smoke/`和`.scratch/clipboard-red-proof/`。

界面按中档验证（沿用已有预览界面，只新增提示和粘贴内容）：实际查看粗斜体/多行与转换提示截图，文字和提示清楚、未见新增裁切。截图前调整合成视角以避开预览状态栏，测完还原；每组原生undo/redo核对后再次undo恢复初态，避免夹具互相叠字。普通文字默认落点仍按#136契约，不把截图视角当作改变落点。完整检查176文件1668项、生产构建及桌面打包已通过；真实提交钩子在本地提交时执行。正式应用与系统跨应用剪贴板仍不在本次验证范围。

| AI已自测及防止的问题 | 需用户集中验证（操作 → 期望） |
| --- | --- |
| 纯数据构造器、样式对照、字节/结构限额、单次paste命令、异步取消和通知生命周期离线回归已过，防越权字段、半批写入和迟到粘贴 | 正式宿主接入后从常用应用复制多行与粗斜体 → 支持格式可见，其他格式提示清楚 |
| 原生HTML净化、资源/导航/执行陷阱及重做分支保留通过，防隐式联网、脚本执行和空历史项；真实系统剪贴板未操作 | 从Excalidraw复制常用基础图形 → 相对位置和整体中心正确，转换/跳过提示易懂，一次撤销整次消失 |
| 既有内部剪贴板及文件入口与新增回归合跑，完整检查/构建通过，防新增解析破坏原入口 | 实际跨应用粘贴、权限、输入法、设备手感与双向视觉 → 不重复导入、不吞表单输入 |

## 媒体导入失败清理（#196）

图片、SVG和视频选择/拖入/替换/共用文件粘贴使用同一临时上传宿主。后续读取/解码/上传失败、取消、60秒总时限及最终提交失败后，服务端仅清本次wx独占创建且未保护的文件。提交成功后永久退出清理范围，回执丢失、撤销再取消或其他操作者先引用均不会误删；无关变化重放成功保留文件。SVG准备仍零落盘，不新增按URL删除接口。

| AI已自测层次及防止的问题 | 需用户集中体验（操作 → 期望） |
| --- | --- |
| 共享所有权测试：wx冲突、同内容既有文件、部分写入、ENOENT、身份/路径变化，防扩大删除范围；剪贴板继续复用同一能力 | 正式宿主接入后导入一批常用媒体并使后项失败 → 原错误清楚、没有半批对象，旧图仍正常 |
| 真实workspace与HTTP：两种锁先后、提交丢回执后撤销重做、实际保存失败、A/B/MCP并发、批次首项先被保护、凭证归属/数量、租约与清理失败，防误删和迟到提交空引用 | 取消、失败后重试，再撤销重做 → 已完成内容保持、操作可恢复 |
| 共用宿主：60秒含提交等待、独立取消signal、销毁后不碰视图、原错误保留、首次409的无关变化重放；原生图片/视频实测第二项503后失败文件404、并发成功200，取消请求503保留原错误与追加提示，同凭证重试后404 | 从其他应用粘贴文件，配合真实系统权限和输入法集中体验 → 只导入一次，反馈能看懂 |

永久回归：`server/asset-attempt-files.test.mjs`、`server/media-import-cleanup.test.mjs`、`server/media-import-http.test.mjs`、`tools/media-upload-cleanup.test.mjs`；既有剪贴板、六栅格/SVG及视频断言保留。原生专项由`media-cleanup-smoke.mjs`接入既有image-check/video-check，核对第二项真实503、第一项资源404、并发成功资源200及撤销重做。图片/视频原生均通过，保留六栅格、SVG27类恶意与阳性对照以及全部视频断言；系统剪贴板调用及未捕获错误为零。故意停用服务端清理时新守卫准确报“本次失败素材仍可读取”，逐字恢复后再次通过。清理请求失败时的原错误/附加提示已实际截图查看：字迹完整，无裁切、重叠或溢出；证据为`.scratch/image-check/media-cleanup-image-error.png`和`media-cleanup-image-warning.png`，视频有对应截图。完整`renderer:smoke`（33组）和`npm run check`（181文件1780项测试及构建/打包）通过；真实提交钩子仍作为本次本地提交门禁，不绕过。

边界与有意差异：本单只处理本进程掌握所有权的导入，沿用现有的跨画板门禁。客户端清理独立2秒，原错误先显示；服务端租约5分钟、每板8个/工作区32个待定尝试、单批100项；仅同一清单自动重试2次、间隔1秒，失败留状态和额度。**服务崩溃或重启时正在进行的导入，可能留下未引用的文件**。视频原独立循环改用与图片相同的60秒总时限。没有内容去重、历史扫描或服务崩溃恢复能力，正式应用仍使用旧编辑器。

## AI框尺寸的编辑底座覆盖（#195）

对应Cowart清单CH-C05，与D01–D17通用样式分别提供入口；公开协议及七档尺寸见《功能清单-cowart-hicanvas.md》的“新编辑底座AI框尺寸接口”。本单范围是唯一选中的可编辑AI图片/网页/影片frame，多选、组、普通对象与Slides不支持。`cowartAiAspectRatio/cowartAiAspectLocked`是文档meta，不进入下一对象默认。比例锁不等同于B12拖动时的Shift等比或对象isLocked。

复用既有frame记录、选择有效性、update命令与运行时单次提交/历史；手输草稿留在交互状态，确认前不改Store，失败保留可重试草稿，冲突不自动重放。目标/祖先改变则丢弃旧草稿，远端孩子及无关记录保持。局部w/h变化保留x/y、旋转、parent/index、孩子和绑定，未调用会缩放孩子或改变锚点的通用缩放。`tools/ai-frame-size.test.mjs`与既有frame/creation/selection/runtime测试共同守卫这些边界。

旧版隔离原生观察确认三类框预设/锁键及整数比值一致；手输真实事件未改变记录。**旧版输入未生效，新版按规则实现**：有限正number、取整、16..16384；锁下存档比值、双轴宽优先、超限反算输入边，无解整次拒绝。详见CH-C05，不把这套新规则称为旧版兼容已验收。

| AI已自测及防的问题 | 留用户集中验证（操作 → 期望） |
| --- | --- |
| 公开API覆盖三类框的21预设、锁/尺寸边界、整份拒绝、零/一次历史、只读查询、独立会话、保存失败与409 → 防错误联动、半次覆盖和默认污染。228项相关接口、39组frame原生、完整renderer:smoke（含creation与内容安全）、183文件/1899项完整检查及生产构建通过；提交前由真实钩子再次检查。 | 正式面板接入后改单/双轴、开关比例锁、确认/取消及撤销 → 数字与作用范围清楚；设备/IME/辅助技术符合预期。 |

本次没有正式尺寸面板或新视觉，不声称已做该面板的原生验收；影片时长另单，创建默认仍由#194处理。

## 激光笔的新编辑底座（#131，A11）

旧版50组矩阵、5组补测及O1/O2各两次，共59组隔离黑盒原生观察：K进入/重复保持、按住超过8秒点列不老化；最后松手后等待约1200ms，先画的段先从起点收短。未开始收短的旧段随新段延后；已经收短的旧段在新段按住时继续消失。活动Esc清全部轨迹，V保留并自然消退。文档和服务revision在K-only场景前后不变；D哨兵验证激光不占撤销、不截断重做。输入框及真实TipTap保留k；离屏组字模拟不能代替系统IME验收。

实现仅维护交互会话，激光工具不持有文档写入口。共用有限点列/外框/圆头绘制，橡皮128点及100ms不变；激光容量和精确收短曲线的差异见上表。12项逻辑与4项渲染永久测试守住等待/串行收短、O1/O2、离开工具继续帧调度、容量、主指针、取消、历史/远端及输入归属，描述复制冻结、坏值拒绝和世界投影；既有橡皮46项原样通过。受控撤销响应期间松手仍结束纯会话段、尾迹消失后停止空帧，不因文档忙碌留下永久按住的状态。

专项原生入口 `tools/renderer-preview/laser-check.mjs` 使用合成内存画板、`watch:false`和原生输入。172条断言、31个场景首次通过，控制台/页面/HTTP错误与外部请求为零；原样橡皮原生49条断言、14份样本也通过。白底中心RGB(255,77,77)、黑底(178,0,0)的旧版独立读数内置永久守卫，逐通道容差3；白/黑底各三倍率的截图横截面积分均通过4 CSS px容差。五组公开挂载探针实际验证空描述不校验、四种坏令牌首绘各报一次、合法首绘可见、固定观察者2→0及文档不变。完整renderer:smoke及构建/全量/真实钩子结果以本单派活交付为准。

| AI已自测及防护目的 | 需用户集中验证（操作 → 期望） |
| --- | --- |
| 逻辑/纯描述回归，防激光落盘、抢撤销、尾迹泄漏、错误输入归属及内存无界；59组旧版观察提供独立行为与颜色证据 | 正式宿主接入后按K快画/连续画、V退出 → 临时红线顺序收短，速度与平滑近似可接受 |
| 原生172条断言及真实像素/首绘令牌/订阅卸载探针通过，防假线宽、缺令牌早崩、订阅泄漏与覆盖层写文档 | 活动画线时Esc → 全部临时轨迹消失；真实中文组字、失焦、触控笔与高频快画 → 文字不被抢、无残留或异常 |

## 下一对象样式的编辑底座覆盖（#194）

对应TL-A29–A32与D01–D17的下一对象部分。通用几何、普通框、四类AI框、文字点击/拖动/工具栏拖入/空白双击、普通便签、线/箭头及手绘/荧光笔，均在起手时读取本交互的一份适用样式快照。移动只更新几何，不重新覆盖样式；起手至提交期间的样式动作被忙碌门禁拒绝。根透明度和props在同一手势保存，仍只需一次撤销。框仅适用整体透明度，普通框的black和AI框的blue/身份/名称/尺寸保留；不把颜色、字体等不适用字段写进去。

| 边界 | 已观察的旧版事实及本次规则 | 永久回归 |
| --- | --- | --- |
| 初始值 | 第0组八工具实际保存共用默认；荧光笔存black而显示黄色。**改为与旧版一致**：新底座原先硬写yellow的起手改取black默认。无需记录“采纳过哪些键”。 | `tools/draw-interaction.test.mjs`、`tools/style-creation.test.mjs` |
| 几何唯一来源 | `setStyles({geo})`与`setCreationOptions({geo})`写同一会话默认，`creation.geo`仅为只读兼容投影；创建选项整份校验，忙碌拒绝不得部分改锁。G进入几何并使用当前geo；R/O明确设矩形/椭圆。 | `tools/creation-interaction.test.mjs`、`tools/style-creation.test.mjs`（20变体） |
| 最近工具 | `useRecentTool()`回取最近工具及几何变体，经同一个默认设置入口回取geo；颜色等取当前默认，不恢复旧样式快照。旧版G也保留四个特殊变体。 | 同上 |
| 相邻便签 | 四边与Tab/Shift+Tab续建继承来源样式，**包括整体透明度**，不覆盖next；已有邻居仅回取并保留原记录样式。普通N新建仍取当前默认。父级/旋转/间距/RTL和署名规则沿原契约。 | `tools/note-interaction.test.mjs` |
| 线及笔迹续段 | 保留既有ID、样式、点/段及笔压；只有新对象取新默认。新箭头同时保留绑定。 | `tools/connection-interaction.test.mjs`、`tools/draw-interaction.test.mjs` |
| 生命周期D17 | 换工具、取消、文档撤销/重做不回退默认；不同交互互相隔离，销毁重建或换画板的新交互恢复初值。旧版实际刷新/换板也重置。默认不进文档、HTTP或撤销；独立命令、MCP、导入和粘贴仍用显式文档规则。换页不适用（ADR0003）。 | `tools/style-creation-lifecycle.test.mjs`、既有样式/剪贴板/导入回归 |

**与旧版的有意差异及阶段5兼容说明**：H3最近工具按钮对pentagon/octagon/rhombus-2/trapezoid显示成rectangle，点击也建矩形；本底座明确的最近工具动作保留实际几何变体，不把该按钮回退复制进样式逻辑。正式界面阶段据此验收按钮呈现。沿#127，opacity API可设0（旧面板最低10%）；自己刚创建的透明文字/便签可完成首次输入，保存后的隐藏对象仍不能重新选择编辑。

| AI已自测及防的问题 | 留用户集中验证（操作 → 期望） |
| --- | --- |
| 公开交互API逐帧覆盖全部入口、20几何、适用字段/透明度、两会话、取消/失败、一次撤销、独立命令与来源继承 → 防漏接、样式漂移、默认污染及半次保存。15文件353项定向通过；文字14组、便签8组、连接8组及笔迹原生回归通过。完整renderer:smoke的33组样本errors/blocked为空，含普通/四类AI框、工具栏拖入、取消/撤销；完整检查192文件2008项、生产构建及桌面bundle通过。提交门禁由真实钩子执行。 | 正式面板接入后先改默认再逐工具新建、回取最近工具 → 样式和几何选择易懂，框身份颜色与比例符合预期。 |
| 新文字/便签透明度0的首次输入、取消、保存及撤销红绿通过；已有隐藏目标的访问门禁不变。未新增正式面板或视觉。 | 正式界面用真实IME、物理快捷键及辅助技术输入 → 默认作用域清楚，首次编辑与一次撤销手感可接受。 |


## 新编辑底座网址嵌入覆盖（#202）

本节只指新底座；正式应用尚未切换。模型、语义创建/同ID互转命令、外部剪贴板分流和G01已接线。初次交付的完整检查192文件1887项、生产/桌面构建、嵌入专项、原剪贴板三红一绿及47场景、独立renderer:smoke的33组通过。孤立书签资源补项通过8文件69项定向回归；最终修订提交的完整检查、embeds专项及smoke由主控合并流水线复核，本次提交钩子由该流水线代替，结论见本单交付报告。

| 清单项 | 当前范围 | 后续范围 |
| --- | --- | --- |
| F10、G23 | 内部格式优先；URL和独立iframe沿#176端口进入同一事务，整体放page的视口中心。HTTP/未知服务只建书签，iframe回退给一条提示。 | 真实系统跨应用粘贴与权限留用户验证。 |
| F11 | 新书签300×46，asset只保留URL，标题/描述/图片/图标为空；不请求外网；历史远程预览图显示不改。 | #203文字信息与网络边界，#204受控图片；F11仍为部分。 |
| G01 | 18家服务列表，Gist禁用；Mod+I、选择、返回、有效性、取消、提交与焦点接线。草稿不写Store；提交检查版本与选择。 | 原生宽窄窗口、按钮Enter、焦点恢复通过；截图不是正式视觉验收。 |
| G03、G04 | convert_url_shape一条命令保留身份、父链中心、组和层序、透明度与meta；锁定自身/祖先、未知书签、生成内容和过期版本/选择拒绝。公开命令及本机HTTP覆盖绑定和全快照撤销/重做；转出书签同事务删除无人引用的旧asset，共用保留，反复互转无孤立资源。 | 原生守卫确认旧iframe断开，撤销重新挂载、重做再次释放；有意差异见上表。 |
| G05–G15、G17–G22 | 共用模型识别、默认尺寸与规范地址；Scratch不可缩放，YouTube/Vimeo默认锁比例且最小高度200，由模型能力表供既有缩放逻辑消费。渲染仍由原权限构造入口加载。 | 外站线上可用性未验证；互动归#206。 |
| E20、G02、G16 | 形状超链接、双击互动及Gist脚本包装不在本单。 | #205、#206；不能记作#138全完成。 |

| AI已自测的层次及防护 | 需用户集中验证：操作 → 期望结果 |
| --- | --- |
| 公开命令/实际HTTP：组内旋转中心、父级/层序/透明度/meta/绑定不丢，通用update改type拒绝，过期版本409且零提交，整次快照撤销/重做；书签资源随转换清理，共用不删。 | 在正式界面开放后转换带箭头和分组的对象 → 布局与关联稳定，撤销一步完整还原。 |
| 原生G01：18家列表及Gist禁用，Mod+I、校验、返回/取消零写入、有效提交和焦点归还；宽窄窗口无越界。 | 用真实键盘和输入法输入、返回、取消与创建 → 操作顺序自然，读屏/焦点清楚。 |
| 合成ClipboardEvent：URL/iframe分流、只采用src、坏/混合代码整批拒绝；原内部优先级、资源及历史守卫保留。 | 从其他应用真实复制网址和代码 → 只插入一次，系统权限与错误反馈易懂。 |
| 同ID原生转换：原iframe残留0，撤销新挂载、重做释放；书签形状与asset整次撤销/重做。 | 来回转换后编辑/撤销 → 选择和对象身份连续；设备手感与视觉集中确认。 |
| 外部请求0：6次服务导航重定向到本机假页，Figma编码地址指向同一受控假页；主进程、网页及子框剪贴板报错桩先证明。 | 本轮不验证第三方在线可用性；后续联网与真实服务体验分别按#203/#206验收。 |
| renderer:smoke原守卫33组，含500/2000/5000、生命周期/几何/外部服务；内容宿主45检查及9次拒绝写入。 | 阶段5正式界面视觉确认 → 颜色、密度、文案和窄窗使用符合预期。 |

材料入口为 `.scratch/embeds-smoke/`、`.scratch/clipboard-smoke/`、`.scratch/renderer-smoke/`。对话框阴影只在打开状态生效；关闭后不应向裁剪守卫声明可能覆盖整屏。此修正已用基点对照及原2000档逐点AA取证验证，守卫、阈值和几何未变。

旧版首段52组另复核28项，80份输入输出与保存记录的完整哈希一致。书签失败路径观察到浏览器直接GET目标网址，均已取消；未观察到本机或第三方展开接口。成功抓取后的进一步行为未知，不据此推断隐私收益。18家相似域名旧版误识别12家，上表逐项记为有意安全差异。

参数规则：保留普通安全查询及片段；按已审定规则移除redirect/redirect_url/redirect_uri、return/return_to/return_url、next、target、callback、continue等重定向字段（大小写不敏感、可含可选下划线），控制字符字段及带协议/双斜杠的嵌套地址值；Figma的url是唯一经服务内层校验的例外。危险片段移除；路径的控制字符、反斜杠与多重编码分隔符拒绝。YouTube t转start并保留controls/autoplay，Maps pb和Calendar src/ctz/mode等原安全样本继续守住。

第二段30组旧版受控观察留作#203/#205/#206的共同资料；合成夹具通过运行时公开API建立，观察动作由离屏原生指针/键盘送入，粘贴明确是私有DataTransfer及不受信ClipboardEvent。证据位于主仓库 `.scratch/embed-observation/runs/legacy-DbgTj5/`，总表 `second-summary.json`；全部30组的前后保存完整SHA-256一致，含分步154份一致读回。删除即时一个读数尚未保存，最终稳定状态一致；不把即时读数当保存断言。

| 后续清单项/证据 | 旧版实际读数 | 实施边界 |
| --- | --- | --- |
| G02，interaction-double-click/inside/outside/escape-focus/tool/delete/second-down-drag.json | 双击进入editingShapeId，pointerEvents none→auto、tabIndex -1→0；框内点击焦点IFRAME。点外、父页Esc、换工具和删除退出；第二击按住拖动只移动。框内Esc仍保留互动。 | #206实施；本单不增加互动状态或开放指针。所有外部导航被取消，框内容为浏览器阻断页，框内Esc仅参考，不承诺真实服务页。 |
| 服务尺寸，interaction-scratch-resize/video-aspect/minimum.json | Scratch480×270角点拖(+100,+15)仅移动至(360,205)；YouTube/Vimeo480×270同样拖动得到580×326.25；YouTube强缩小停355.55555555555554×200。 | 本单模型规则及原缩放回归覆盖，不在界面按服务写特例。 |
| E20，hyperlink-*.json八组 | geo右键编辑链接可新增、替换、清空与取消；embed无此项；javascript:使继续禁用。锚点44×44，target=_blank、rel=noopener noreferrer；点击/Enter拟打开合成原URL均被拦截。 | #205实施；不宣称已经访问外站，不使用系统剪贴板。 |
| 历史，history-create/embed-bookmark/bookmark-embed/link.json | 四种操作各一次undo完整恢复前快照，一次redo完整恢复后快照。 | 新底座同样一次事务，选择仍是会话状态；互转身份差异见上表。 |
| 异步，history-late-cancel/focus-revision.json | 延迟请求仅以取消恢复后，Esc、换draw焦点或另一个本机HTTP写入者已改revision，旧版仍插入300×46空书签。撤销形状后残留asset。 | 补信息与迟到结果归#203；本单不联网，不制造异步抓取。资产同事务缺陷在本单修正。 |

本次35次外部请求尝试及2次拟新开窗口全部取消，允许的外部请求0；服务端outbound=[]。这些结果证明受控夹具内的行为，真实第三方页面、真实系统粘贴及正式界面的视觉/辅助技术体验留集中验收。

## 新编辑底座画布输出覆盖（#210）

本单实现独立合成预览与公开只读输出接口，正式应用仍用旧编辑器。F25–F29的选择/整页SVG、PNG下载和背景偏好由同一固定快照生成；B35非空便签的首名署名保留在SVG，空便签不显示。锁定项照常输出，opacity=0仍参与范围并保持透明；没有新增隐藏字段。祖先变换、框裁剪、连接线/笔迹/荧光笔顺序及图片裁剪翻转复用现有几何。复制F23/F24、打印及扁平化F30分别留后续工单。

有意差异（07:58主控审定）：小数范围向外取整，避免切墨迹；文字采用共享排版的SVG text而非foreignObject；网页、影片、幻灯片和视频输出实际画面，不复刻旧版通用出口的“加载中”。已挂载媒体取当前显示画面且不改变播放状态；未挂载影片/视频取初始帧，幻灯片取当前内容页。导出默认浅底取令牌，可透明；PNG默认2倍且不随相机/DPR变化。超过资源/尺寸额度、取消或实例失效整次拒绝，不写画板，不产生半文件。系统后备字体仍受打开文件的设备影响。

网络边界（09:14主控审定）：画板外链图片、书签预览和图标不读取，改成占位并给一条汇总提示；字体只用应用自带清单，画板来源不借导出联网。生成网页、影片、幻灯片沿用显示时的隔离网络边界，内容外部素材可能再次加载，不承诺完全离线输出。原生专项分别计来源，要求画板素材外部请求为0，内容导出目标不超出同夹具显示时的外部目标；测试宿主的拦截和合成重定向不作为生产保证。专项已在合成原生宿主实跑：画板和服务来源外部请求0，内容请求均为同夹具显示目标的子集。

共享截图变化（08:51主控审定，原生红灯后实施）：AI参考图、网页和幻灯片等普通截图同样冻结当前动画帧，不再回到初始样式；入场动画播完后保留最终状态。冻结仅写捕获克隆，原内容不seek、不暂停；影片专用逐帧路径原本已冻结，行为不变。

| AI自测所防的问题 | 用户集中验证（操作 → 期望） |
| --- | --- |
| 离线公开接口覆盖固定快照、选择/整页、空画板、透明/锁、旋转父框裁剪、水平线描边、中文/粗斜体/署名、字体内联、尺寸预检、取消/失败不写历史。原生14红/1绿边界守卫、四次实际下载、SVG/PNG/DPR、外链占位和来源计数通过；媒体当前帧、未挂载影片0帧标记和视频独立首帧像素通过，原实例播放状态不变；取消/销毁/超时拒绝。原共享截图8组、编辑保存回归及30组零差异像素比较通过；专项纳入renderer:smoke。 | 正式界面接入后下载SVG/PNG，在其他应用打开 → 范围、文字、透明度与媒体画面符合预期；中文/表情后备字体及视觉效果由用户确认。真实剪贴板和打印留后续集中验收。 |


## 控件焦点与画布快捷键（#209）

旧版黑盒观察区分普通按钮、工具栏按钮、链接、关闭/打开菜单触发器和select；16工具字母、删除、历史及全选在四类非输入控件中交给画布。旧版A直接插入框；本单只对齐归属，沿用新底座已有动作。关闭菜单触发器的历史格先补公开可见哨兵，Enter送真实char，按事件结束后的defaultPrevented采样；废弃前置不足的格子，不把零净差当作已保护。SPAN/SVG子元素和无href可聚焦A另有各两次原生扩展。主控从该规律推定其它快捷键也放行，置信度中；普通/工具栏按钮各Mod+D、Mod+G、Shift+1、Mod+=共8格旧版可信原生抽查全部符合：复制新增对象、组合建立双子组、适配/放大改变相机，控件未额外激活。推断经这8格抽查支持，不等于穷举全部绑定。

编辑层统一决定按键：button、toolbar-button、anchor、关闭menu-trigger保留Enter/Space/四方向及Space组合，其余已有绑定照常；Esc仅toolbar-button放行。select整体保护，expanded仅为菜单触发器事实。显式video/text-editing/canvas、菜单/对话框/文字、组字、快捷键开关及旧form契约保持；自带方向控件只报告ownsArrows，不在宿主另写按键白名单。焦点转移释放临时按键和逗号指针，但新允许控件上的真实活动拖动保留，直到允许的Esc或指针收尾。工具栏Esc实际处理后才发可选onRequestFocus('canvas')，repeat/keyup或未处理不发；预览映射到真实画布焦点，无新增Store观察者。

| AI已自测及防止的问题 | 待验证（操作 → 期望） |
| --- | --- |
| 公开交互与宿主26条短测通过，原keyboard-context14例完整保留；防按钮焦点吞复制/组合/视角、激活键误改画板、方向漏保护、提前取消真实拖动、误取消便签续建、重复回焦及丢失keyup。便签/小地图连同这些焦点用例共62例通过。 | 正式宿主接入后点工具栏→K进入激光、Esc清选择/取消并回焦，随后Enter/Space→只激活当前焦点控件。 |
| 旧版8格可信原生抽查、修后专项386断言/44样本、原样keyboardSmoke、实际TipTap/解码视频及小地图保护通过；已有静默异常负探针、21项拦截守卫，真实CDP组字已见（实测keyCode75）。 | 真实中文输入法组字/选候选→文字和候选保留；未把CDP合成组字称作真实系统输入法。 |
| 真实按钮删除和复制均只做一次、一次撤销恢复；原连续复制/Alt/历史场景保留；真实input有可操作选择时Delete及Mod+D不改文档、选区与版本，两组各6份原生样本通过。select迁移仅改owner期望，48默认键/6组字键保护保留。 | 系统select真正展开后方向/Enter/Esc→原生选值/关闭；目前无法保证弹层离屏受控，留待可控制环境。 |

**未测8格保留**：旧版select的Enter、Space、Space+拖动、Space+四方向共7格，因不能保证系统弹层限制在离屏窗口内而未执行；已开菜单的活动Esc无法同时保留真实展开焦点及原活动预览，按前置失败记未测。系统select真正展开态也未测，等待可控制的环境，不加假open字段或“系统下拉不可用”的永久断言。正式应用仍使用原编辑器。公开守卫覆盖ownsArrows的窗口捕获与显式小地图转交通道，以及受保护文字会话返回画布时的便签续建。select及裸按钮的旧form断言随新契约迁移，真实input负例保留，未放宽原样keyboardSmoke和小地图保护。原生及浏览器首败、pmset核对和修后门禁证据保留于本单派活交付报告；完整检查与真实提交钩子结论以该报告为准。

## 新编辑底座嵌入互动覆盖（#206）

仅新底座与隔离预览，正式应用尚未切换。旧版依据直接采用#202第二段 `interaction-double-click/inside/outside/escape-focus/tool/delete/second-down-drag.json`，不重新读取受限源码或加载外站。Gist安全包装已拆到#220。

| 清单项/场景 | 新底座行为及永久守卫 |
| --- | --- |
| G02进入与退出 | 共用真实点击计数，在第二次抬起且仍为pointing时进入；第二击移动越过4 CSS px（含仅松手带来位移）留给原拖动。`interactingEmbedId`仅在会话，不写Store、版本或历史。 |
| 指针与键盘归属 | 唯一活动iframe为auto/0，其余none/-1，沙箱、allow及referrer不变。iframe按form保护全部画布键；获得子框焦点的blur只释放按键/手势，保持互动。 |
| 明确退出 | 框外可信工具栏“退出嵌入互动”鼠标/Tab+Enter可达；按钮归还画布焦点，画布Esc只退出一次并保留选择，点外继续该次选择/控件输入，不抢表单焦点。子框内Esc仍由网页决定。 |
| 互斥与变化 | 视频互动与嵌入互斥，后台播放与进度不改；文字/裁剪/G01、换工具/选择结束互动。目标或祖先相关记录变化、改源/类型、删除锁定隐藏以及当前iframe重载/失败均退出；无关远端变化、相机/视口变化保持。 |
| G02尺寸及历史 | Scratch不可缩放；YouTube/Vimeo锁比例及最小高度200仍由既有模型控制。变换保持原一事务/一次撤销；undo恢复记录而不恢复互动。 |

| AI自测层次及防住的问题 | 用户集中验证：操作 → 期望 |
| --- | --- |
| `server/editor-embeds.test.mjs`公开接口与真实点击序列：文档零写入、组作用域、无效目标、忙碌/IME拒绝、相关/无关远端变化、输入宿主监听清理及视频播放保留。 | 正式界面开放后双击服务网页，输入并使用其键盘/滚轮 → 网页正常操作，画板不误移动或删除对象。 |
| `embeds-interaction-smoke.mjs`原生专项23阶段通过：父按钮鼠标和Tab+Enter、子框焦点/实际滚动、点外表单、相机保留iframe与子状态、互斥、拖动、尺寸、重载及删除撤销；原创建/转换/剪贴板18阶段同时保留通过。 | 在真实第三方网页获得焦点后，用框外按钮和父画布Esc退出 → 容易返回画板；子页内部Esc不承诺替父页退出。 |
| 完整检查197文件2063项及生产/桌面构建通过；独立`renderer:smoke`三档33样本零错误/越界请求、45条内容安全检查通过，9次测试写入被拒绝；真实提交钩子结果另列于交付报告。 | 窄窗口、不同缩放、读屏与真实设备下重复操作 → 按钮始终可用，尺寸及布局稳定。 |

原生假子页会被父测试读取，仅用于核对本机合成控件；产品代码只读iframe元素本身，不访问子页DOM。原外站地址重定向后的请求仍带跨站标记，会被原同源读取门禁拒绝；测试先保留服务src和权限断言/记账，再仅将三个合成iframe直接导航到确切的本机假页并确认加载及input。门禁没有放宽；原生输入证明限于同源假页，不证明真实跨来源或线上服务兼容。材料在`.scratch/embeds-smoke/`，相关/无关远端记录与祖先失效由Node公开runtime/store回归证明。
### E20：形状超链接（#205，新底座）

单选 geo、note、image、video 后可编辑或清除既有 `props.url`，不增加保存字段；书签改网址归 #221，embed 内容地址不在本单。草稿只属会话，确认一次提交/撤销；取消、空值已清除、规范化等价值均不新增版本。固定目标、选区、工具、锁或远端版本失效时保留草稿，停止自动提交；命令重查祖先锁，已有锁定链接仍可只读打开。复制编码/解码和粘贴通过私有替身走公开接口，保留组孩子链接及独立身份，不读取系统剪贴板。

保留旧版裸域名补 `https://` 的便利，只在交互层预处理；命令及只读入口仍严格校验完整 HTTP(S) URL。相对/协议相对、凭据、非默认端口和内部空格明确拒绝；与旧版相比，规范化等价值不写入、祖先锁提前禁用、链接 Enter 不再顺带进入文字编辑，属于有意差异。旧版未观察的系统IME、粘贴、部分iframe和透明命中不写成永久旧行为断言。

独立链接层在 `aria-hidden` 覆盖层之外，anchor 名称「打开链接」，保留新窗口及 `noopener noreferrer`。命中44、图标15、底块32和颜色来自DESIGN令牌，按文档单位跟随相机、形状/组旋转及frame裁切；完全被裁掉的入口退出Tab顺序。缩小视角时命中小于44屏幕CSS px照搬旧版，以Tab可达作补偿。正式应用尚未切换。

| AI 已自测及防止的问题 | 需用户集中体验的步骤 → 期望 |
| --- | --- |
| 25项公开命令/交互/渲染回归：四类字段保持、危险URL原子拒绝、等价不写、三层祖先锁、一次历史、延迟去重/销毁、草稿冲突、无全板查询、ASCII层序、深冻缓存、无链接零DOM、组旋转/裁切及私有粘贴。防止误写其他字段、覆盖新版本和指针每帧读全板。 | 正式宿主接入后，分别选几何/便签/图片/视频→编辑、取消、清除、一次撤销→原值及本体内容正确，提示易懂。 |
| 9组专项原生及独立renderer:smoke的33场景通过，errors/blocked为空；包含打开漏记红例（拒绝始终保留）、真实Tab/Enter/输入、一次历史、实际文字/本地视频及裁切。原标题缩放守卫发现空链接层DOM写入，补红绿修正后原守卫通过。完整检查204文件2102项、生产/桌面构建通过；真实钩子与提交结果以本单派活交付报告为准。全程仅记录打开意图。 | Tab到「打开链接」→Enter→系统浏览器只开一次，画布不进入文字编辑；缩放/旋转/框内→位置和可点击范围符合预期。真实OS输入法及设备手感另验。 |
