# hiCanvas

基于 [Cowart](https://github.com/zhongerxin/Cowart) 逐步建设的独立 AI 画板。

当前应用运行在 tldraw 上，正在用自有实现替换其受限部分；目标结构、必须守住的规则和切换条件见 [架构说明](架构说明.md)。

## 现在能做什么

这一版提供独立本机画板、自定义生图/改图模型，以及通用 MCP。用户可以手动画图、输入文字、拖入图片、添加标注；也可以让 Rex 等支持 stdio MCP 的客户端操作画板。画板在浏览器中显示，本机服务负责保存。

左上菜单栏可以新建和切换画板；画板列表每行右侧的「⋯」可重命名或删除。每个画板只有一张无限画布，作品、图片结果和视角分别保存；模型配置共用。多个 Agent 可以操作不同画板；同一画板的并发修改采用版本检查，旧版本会被拒绝，需要读取最新内容后合并。

删除需要确认；删除当前画板会切换到其他画板，最后一个也可以删除，之后显示新建入口。删除会从列表移除画板并停止后续读写，本机作品、图片和备份文件仍保留，不用于释放磁盘空间。已打开的窗口会退出编辑；旧 Agent 绑定会明确收到“画板已删除”，不会自行新建替代画板。尚未发送的生图任务停止，已发送的任务可能继续计费，返回的图片仍保存在本机。

保留 Cowart 的 AI 图片、网页、影片、幻灯片、文字编辑、标注迭代和导出流程。图片使用用户配置的 API；网页、动效影片和幻灯片由外部 Agent 制作，通过 MCP 回到原目标框。画板按钮可以将请求交给已绑定的 REX Agent，结果回到同一画板。内置文本模型和聊天助手属于下一阶段。

影片是 HTML/CSS/JS 动效作品，支持预览播放、时间轴、文字编辑及带音轨 MP4 导出；不是扩散视频模型接口。幻灯片支持 HTML 或图片页面、演示翻页、逐页 PNG 和带 `Play.html` 的整套 HTML 导出；不输出原生 PPTX。影片导出要求生成内容提供完整音轨，浏览器支持 H.264/AAC WebCodecs 编码。

## 安装与运行

使用 Node.js **24** 和 npm。先检查 `node --version`，复用已有 Node 24；无需安装新的运行时。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm start
```

在浏览器打开 **http://127.0.0.1:43218/**。保持终端服务运行，按 Ctrl+C 停止。只监听本机，不开放局域网。端口占用时会明确退出，不会悄悄换端口；需要换端口可运行 `HICANVAS_PORT=43219 npm start`。

开发时用 `npm run dev`；修改本机服务后需要重启，预览时修改源码还需重新构建。

本机已有 Homebrew Node 24、但默认 Node 是其他版本时，可以先在当前终端运行：

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
```

## 生成网页的隔离开关（迁移阶段）

`HICANVAS_CONTENT_HOST=1 npm start`（开发时改用 `npm run dev`）启用独立内容来源，默认关闭。开启后，网页、影片和 HTML 幻灯片的加载入口把每次挂载登记为一个随机 `*.localhost` 主机；内容宿主只监听 loopback，端口由系统分配，经 `/api/health` 启动信息提供，不写进画板、HTML 或 `connection.json`。保存的 URL 与文档不变。关闭时仍沿用原 srcdoc／data URL；父来源的 HTML、SVG 资源直接打开始终带响应级沙箱。

隔离模式的影片播放、暂停、时间定位、静音与状态已通过实例 MessagePort 接线；每次加载重新握手，绑定窗口、精确来源、协议版本及实例，重载和卸载使旧请求失效。启动信息每个页面共用一次。网页 PNG、复制图片、标注参考图、幻灯片逐页图片及影片 MP4 的逐帧画面和音轨已改走实例通道；网页就地编辑与保存也已接线；幻灯片点击和离线 Play.html 也已接线，日常使用保持默认关闭。架构与取舍见 [ADR0012](docs/adr/0012-isolated-generated-content.md)。第三方公网脚本允许运行；字体、ESM 与媒体仍遵守资源方 CORS。

内容服务只接受已登记的精确主机名，按当前画板文档中的静态 HTML／CSS 引用发布资源快照，不暴露画板、生图、MCP、任意路径或请求转发。CSS 引用继续展开；动态拼接的本地请求和未列出的资源返回拒绝或未找到，不回退到整个资源目录。HTML 上限 5 MiB，发布页面与供编辑器读取的原文均计入宿主总额；单素材 20 MiB，每份文档最多 128 个素材、总计 32 MiB；宿主最多 64 个实例、128 MiB，并限制同时准备的登记。租约 30 分钟，挂载期间自动续期，卸载即时撤销；异常断连最多保留到租约到期。

`npm test` 包含宿主、资源授权及卸载回归。`npm run renderer:smoke` 先执行真实 Electron 浏览器安全门禁，再运行渲染回归；也可只运行 `node tools/content-host-smoke.mjs`。它使用 `.scratch/` 合成资料和独立后台窗口，关闭／开启各跑一次，检查网页、影片、幻灯片脚本、父窗口／存储／兄弟访问、document.domain、第三来源脚本，以及真实写接口的服务端拒绝计数。证据在 `.scratch/content-host-smoke/`。复用已安装的项目 Electron，不下载浏览器；云端普通 `npm run check` 不自动运行此浏览器门禁。

实例通道的原生回归：在占用白板登记专用端口后运行 `HICANVAS_CHANNEL_PORT=43396 node tools/content-channel-smoke.mjs`（按登记替换端口，可用 `HICANVAS_TEST_ELECTRON` 复用已有运行时）。它使用合成画板操作旧影片工具栏，并验证新渲染宿主、重载和共用启动请求；证据在 `.scratch/content-channel-smoke/`。消息接受四个播放命令、截图、影片导出、编辑会话命令及纯值状态，普通消息单条最多4 KiB、每秒最多60条请求及120条普通回复/状态、同时最多32个请求；握手与普通播放请求最多3秒。合法匹配的导出阶段、二进制结果、编辑状态／整页结果和结束回执有各自的每请求保留额度，避免垃圾消息挤掉在途结果；未知、迟到消息继续占普通额度。时间轴合并高频定位并保留最后位置，取消会撤回未执行请求，已开始的播放操作由暂停命令停止。既有仅实现 cowart-film 消息的影片保留一条严格绑定窗口与来源、校验字段和额度的状态兼容入口；控制和导出命令仍走Port，关闭开关不启用这条适配。

截图原生回归：登记专用端口后运行 `HICANVAS_CAPTURE_PORT=43397 node tools/content-capture-smoke.mjs`（同样可指定 `HICANVAS_TEST_ELECTRON`）。合成网页覆盖本地字体、延迟图片、居中变换与圆角裁剪；真实后台 Chromium 通过原生点击调用四个生产入口，比较隔离开关两侧的 PNG，并验证父页标注旋转／叠加、两页导出、复制委托和错误提示。剪贴板与下载只在输出边界截获，不写真实剪贴板或下载目录；证据在 `.scratch/content-capture-smoke/`。允许单通道差值8以内的抗锯齿变化，超出该差值的像素不得超过1%，全部通道平均绝对差不得超过0.5；字体或素材缺失另有内容断言，不靠相似空白图通过。

截图等待素材和旧版2秒稳定期，单独限时30秒；像素通过 transfer 传RGBA，整数边长各不超过4096、总计不超过1600万像素（64MB），超限明确报错。每实例最多1张、整页最多2张同时截图，忙时立即拒绝；取消／超时先撤回等待，无法中止的渲染完成后丢弃，确认结束再释放额度。父页恢复canvas后立即释放像素缓冲，不缓存截图。内容页在同实例来源的中性iframe里运行原helper，避免全局img/span样式污染字体测量；每次结束、失败或取消后清理，旧版本来就有的自定义字体回退由#153另行处理。内容宿主只额外发布固定 `capture.js`：源码首次使用在内存打包，桌面构建预先打包；按锁定html2canvas版本与捕获源码哈希缓存，不联网，桌面运行不依赖esbuild或源码目录。关闭开关继续原捕获路径；无桥接时只有选中的单个隔离网页改走父页Clipboard API，其他选择原样交给旧编辑器。

影片导出原生回归：登记专用端口后运行 `HICANVAS_FILM_PORT=43397 node tools/content-film-export-smoke.mjs`（可用 `HICANVAS_TEST_ELECTRON` 指定已有运行时）。调用真实 MP4 导出入口，解码全部30帧按上述像素门槛对照；比较编码前双声道PCM，要求最大采样差为0，并记录开关两侧总耗时。合成影片包括背景、伪元素、字体、逐帧移动的视频及BGM/SFX；另外验证旧Web Audio音轨兼容、分步骤长等待、自定义超时，以及取消、超时、重载、卸载、坏像素时实际编码器中止且不返回半截文件。证据在 `.scratch/content-film-export-smoke/`，不写真实画板或下载目录。

隔离影片每次只传一帧，父页等编码器消费后才请求下一帧并释放缓冲；虚拟钟和RAF队列留在子页，截图仍复用固定 `capture.js`，不增加旧版没有的稳定等待。每个旧步骤分别使用 `taskTimeout`（默认15秒，有限正数且不超过2,147,483,647毫秒）；视频源开始时一次声明，最多64个，之后新插入的源明确拒绝。严格前进的阶段回报保留每步时限，父页额外给1秒失联余量；单帧固定硬上限为 `(4+2×视频源数)×taskTimeout`，音轨初始化为 `7×taskTimeout`，进展不能延长总上限。普通截图仍是30秒。PCM只接受8/11.025/16/22.05/24/32/44.1/48kHz及1/2声道，总计不超过46,080,000字节，和像素共用实例1/页面2的大结果额度。固定 `film-export.js` 包含原样锁定的 mediabunny（MPL-2.0），独立引用捕获资产；按依赖版本和源码哈希缓存，桌面预打包与源码宿主保持逐字节一致。

网页编辑原生回归：登记专用端口后运行 `HICANVAS_EDIT_PORT=43385 node tools/content-edit-smoke.mjs`（同样可指定已有 `HICANVAS_TEST_ELECTRON`）。它在真实挂载的画板中以离屏 Chromium 原生输入对照隔离开关两侧的点选、选字、换行、替换、保存与资源原址，并验证保存途中继续输入。证据在 `.scratch/content-edit-smoke/`；`--observe` 只记录旧路径。隔离子页的输入直接通过该帧的 Chromium 调试会话路由，避免 Electron 离屏父窗口无法把输入转发到跨进程子页。

隔离网页的选中、光标和输入都在内容页处理，只上报编辑版本与脏状态。父页保存时取回最多5 MiB UTF-8整页，写入成功才确认对应版本；期间新输入继续保存，退出与最后输入之间也检查版本。返回内容不得带桥接脚本、实例编号、临时地址或编辑标记；资源还原在子页完成，父页不解析返回HTML。保存经现有带 `expectedRevision` 的编辑命令；冲突时先读取最新画板，仅合并无重叠记录并带新版本重试一次。远端也改了同一网页、删除网页或存在重叠修改时保留当前网页草稿并提示，保持页面打开后处理；未保存内容会触发关闭页面提醒。隔离开关关闭时继续原编辑路径。

幻灯片原生回归：登记专用端口后运行 `HICANVAS_SLIDES_PORT=43385 node tools/content-slides-smoke.mjs`（可用 `HICANVAS_TEST_ELECTRON` 复用已有 Electron）。默认对照文件地址与data URL，逐项核对开启隔离时29类点击相同，关闭时data URL仍不接受点击翻页；`--observe` 只观察关闭的文件路径，`--inline` 单独验证data URL。证据在 `.scratch/content-slides-smoke/`；合成案例还覆盖父子页键盘、边界、千条突发、父窗口读写、本地CSS/脚本/字体/图片/音轨、后页资源缺失时零新增写入，并实际关闭服务再用 file:// 播放。CDN 由测试层切断，翻页保持可用。

开启隔离后，幻灯片子页只发前后方向，父页定页码，每次加载更新通道，同页突发只接受一次有效翻页；交互判定保留应用与旧 Play.html 各自的规则。离线播放器使用 opaque 沙箱，脚本、表单、弹窗和外部网络权限与应用相同，字体、ESM和媒体继续遵守浏览器CORS。离线指无需 hiCanvas 服务，外部在线引用原样保留，并通过返回值 `externalResources` 和既有导出按钮提示列出。打包只读取本画板授权的静态标签、CSS及模块引用；不枚举运行时拼接的地址，缺失、越界、循环或超限依赖在写文件前明确失败。每页HTML最多5 MiB，整套最多200页、20 MiB原始HTML；资源集合及最终展开页各限32 MiB，下载使用base64保持在既有请求上限内。固定 `offline-slides.js` 源码与桌面预打包保持逐字节一致。 模块依赖识别复用已锁定的 Babel parser，其 [MIT 许可原文](licenses/babel-parser-MIT.txt) 随桌面资源分发。


## 画板保存在哪里

默认在 `~/Documents/hiCanvas/canvas/`。画板索引在 `conversations/index.json`，各画板的 `state.json` 一起保存画板文档与版本；图片、选择项、视角也归各自画板。保存锁由 Node 24 内置 SQLite 管理，进程异常退出后自动释放，不需安装数据库；画板内容仍保存在 JSON。备份时复制整个 `canvas/` 文件夹。

旧 Cowart 画板在首次打开“我的画板”时读入新的画板格式，原页面及图片文件保持不变；之后以新的画板快照为准，旧文件不会跟着继续更新。回退旧版代码只能读到导入前的旧画板，回退前先备份新画板资料夹。不要同时用旧版和新版编辑同一份资料。

源码与画板分开保存。要使用其他位置，在启动服务时指定：

```sh
HICANVAS_PROJECT_DIR="/你的资料目录" npm start
```

也可用 `HICANVAS_CANVAS_DIR` 直接指定画板目录；两者同时设置时，后者优先。浏览器的 URL 带有画板 ID，不跟随另一个窗口的画板切换。刷新和重开会恢复该画板；没有指定 URL 时恢复上次打开的画板。

自动保存有短暂延迟，关闭服务或刷新前稍等片刻。无法读取或保存时会显示错误；部分记录损坏时停止加载并保留原文件；保存失败会持续显示“尚未保存”，恢复服务后自动重试，也可点击“重试保存”。遇到文件损坏请先备份整个资料夹，不要用空画板覆盖。

## Mac 桌面应用

Apple 芯片 Mac 可直接打开 `hiCanvas.app`，画板、模型设置、图片结果、HTML、影片和幻灯片沿用同一套界面。应用自带运行环境，使用者无需另装 Node。关闭窗口后可点击 Dock 图标重开；关闭窗口或退出应用后，已提交的任务仍由本机服务继续处理。菜单与操作默认使用简体中文。

开发者在已安装 Node 24、Xcode 命令行工具及项目签名证书的 Mac 上运行：

```sh
npm ci
npm run desktop:pack
```

产物为 `build/desktop/hiCanvas-darwin-arm64/hiCanvas.app` 与 `build/hiCanvas-版本号-mac-arm64.zip`。签名使用 `Developer ID Application: Feng Shu (5QS2RDW5AK)`；没有该证书时停止打包，不生成未签名交付物。本机试用包未做公证和自动更新。`npm run check` 包含桌面服务/MCP 代码的独立打包检查，实际 `.app` 的签名和启动需在 Mac 上验证；打包命令最后自动运行 `npm run desktop:smoke`，使用隔离资料、本机模拟生图接口和应用自带 MCP 冷启动服务，断言脱离源码运行、占位排版、断开后生成与画板恢复。

桌面版默认资料位置与源码版一致，也可在 `~/Library/Application Support/hiCanvas/connection.json` 保存连接；MCP 启动器读取同一份配置。文件只包含地址和目录，不放模型密钥：

```json
{
  "baseUrl": "http://127.0.0.1:43218",
  "projectDir": "/你的资料目录",
  "canvasDir": "/你的资料目录/canvas",
  "settingsDir": "/你的资料目录/settings"
}
```

环境变量 `HICANVAS_URL`、`HICANVAS_PORT`、`HICANVAS_PROJECT_DIR`、`HICANVAS_CANVAS_DIR`、`HICANVAS_SETTINGS_DIR` 可覆盖对应配置；自测使用 `HICANVAS_DESKTOP_CONFIG_DIR` 指向隔离配置目录。不要让两个端口同时操作同一资料目录。桌面版连接已运行的同协议服务时直接复用；健康接口返回设置目录标识时，同时核对模型设置目录；未返回该标识时需自行保证 `settingsDir` 与既有服务一致；端口对应其他程序或其他资料目录时停止连接并提示。

安装至「应用程序」后，MCP 客户端可使用应用自带入口，源码目录和 Homebrew Node 均不再是运行依赖：

```json
{
  "mcpServers": {
    "hiCanvas": {
      "command": "/Applications/hiCanvas.app/Contents/Resources/hicanvas-mcp"
    }
  }
}
```

`open_conversation` 的 `openWindow: true` 或 `open_canvas` 会在已安装的 hiCanvas 应用中打开目标画板。未安装桌面应用时使用浏览器；多 Agent 操作仍按各自的 `conversationId` 隔离。自定义安装位置可设置 `HICANVAS_DESKTOP_APP`。

## 添加自己的生图模型

点击画板左上菜单栏的设置图标→“添加模型”，自行填写显示名称、接口格式、API 基础地址、模型名和密钥，可以保存多组并随时切换、修改或删除。没有预设的服务地址、账号或模型名单。保存设置不会发送生图请求。

目前支持两种接口格式：

- **OpenAI Images 兼容**：基础地址包含服务商要求的版本路径（通常 `/v1`），自动追加 `/images/generations`；有参考图时使用 multipart `/images/edits`。支持返回 base64 图片或可直接下载的图片 URL。
- **Gemini generateContent**：基础地址包含版本路径（通常 `/v1beta`），自动追加 `/models/你填写的模型名:generateContent`，支持文字与参考图输入及内联图片输出。

具体模型由用户填写；兼容这些格式的网关也可接入。仅提供聊天、Responses、异步任务或其他自有格式的服务需要另做适配，不是任意图片 API 都能直接使用。模型需要同时具备相应生图/改图能力；图片框比例加入提示词；Gemini 同时传递其支持的比例，OpenAI Images 兼容接口可由 MCP 显式指定 `size`，未指定则采用服务默认值。结果文件保留供应商的原始像素，画板按目标框展示；需要精确像素比例时，请选择支持该比例的模型和尺寸。远程地址使用 HTTPS，本机无鉴权接口可用 HTTP 并留空密钥。

添加后选择“AI 图片”创建图片框，选择模型、写描述，按“生成”；可以上传或粘贴 PNG、JPEG、WebP 参考图。对已有图片添加箭头和文字标注，再按“按标注修改”，使用当前模型在旁边生成新图，保留原图。

提交后先显示占位框和生成动效，本机服务负责后台生成，成功后在原框位置显示结果。生成期间可以继续编辑、移动和切换画板；删除占位框不会让它复活，成功的图片仍可从菜单栏“图片结果”找回、下载或放入画板。结果按画板保存，最近列表显示 40 张。失败不自动重试；服务重启只继续尚未发送的任务，发送中断的标为“已中断”，避免重复收费。网络中断或超时可能已经计费，请先检查供应商记录后再手动重试。

设置默认保存在 `~/Documents/hiCanvas/settings/image-models.json`，跟随 `HICANVAS_PROJECT_DIR`；可用 `HICANVAS_SETTINGS_DIR` 单独指定。密钥以本机文件权限保护（文件 `600`），浏览器读取配置只返回“已保存”状态，不回显密钥；本机磁盘上的配置是明文，备份时请自行保管。编辑密钥留空保留旧值，更换地址或接口格式须重填密钥或明确勾选清除。生成图片保存在各画板的 `assets/` 中；旧画板仍引用原资源目录。

## 接入 Rex 或其他 MCP 客户端

先按上文安装依赖并构建，再在客户端的 MCP 配置中添加以下 stdio 服务（把路径换成实际项目目录；macOS 已有 Node 24 可直接使用下面的绝对路径）：

```json
{
  "mcpServers": {
    "hiCanvas": {
      "command": "/opt/homebrew/opt/node@24/bin/node",
      "args": ["/Users/solos/Documents/myproject/hiCanvas/bin/hicanvas-mcp.mjs"]
    }
  }
}
```

MCP 会连接本机服务；没有服务时自动启动已经构建的画板，最后一个 MCP 客户端退出后画板服务仍保留。默认 `http://127.0.0.1:43218`，可用 `HICANVAS_URL` 指定另一个本机端口。发现端口是旧版服务或其他资料目录时会明确报错，不会停止它；请先关闭旧服务，再重新连接。不要在多个端口同时编辑同一份资料目录。

Agent 的使用顺序：

1. 首次调用 `open_conversation`，可以直接创建画板；无需在画板里先手动新建。记录返回的 `conversationId`。
2. 后续所有读写传同一个 ID。普通重复调用 `open_conversation` 会复用当前绑定；只有用户要求另起画板才设置 `createNew: true`。
3. 要跨客户端重启恢复，传原 ID，或将外部聊天自己的稳定标识作为 `bindingKey`。也可在该 MCP 进程的环境变量里设置 `HICANVAS_CONVERSATION_KEY`。**不要给所有外部聊天设置同一个键**，否则它们会共用同一画板。同一聊天的子 Agent 应共享已有 ID。MCP 无法自动得知所有客户端的聊天标识；未提供 ID/稳定键时，保证范围仅为当前 MCP 连接。
4. `get_canvas` 读取快照、页面、选择项和 `revision`；`apply_canvas_operations` 携带该版本原子批量新增、修改或删除。发生 `revision-conflict` 后重读并合并，不能直接重放整份旧快照。
5. `list_image_models` 读取配置的模型名单。单张或多张统一用 `submit_image_batch` 一次提交全部提示词和参考图：先创建全部占位框，立即返回 `jobId`，随后服务自行生成并替换。默认每排最多 4 张，16 张为 4×4；可指定列数、位置和尺寸，最多 64 张，服务总并发为 3。提交时固定模型，不受之后切换默认模型影响。无需 Agent 逐张发送或持续监控；按需用 `get_generation_job` 看进度。`generate_image` 是同一后台队列的单张兼容入口。
6. 网页、影片和幻灯片用 `insert_cowart_html_draft`：传目标 `draftShapeId`，保留原位置、尺寸、旋转和父容器；幻灯片页面自动成为同一演示的子页并排列。标注迭代按请求指示在原稿旁边生成新稿；普通 DOM 文字编辑保存到原稿。已有图片用 `insert_cowart_image` 插入，不重复调用生图接口。`read_image` 和 `read_cowart_page_asset` 可读取本画板图片及参考资源。
7. 调用 `open_canvas`（或首次打开时传 `openWindow: true`）会打开浏览器中的指定画板。浏览器里切换其他画板不会改变 Agent 的 ID。
8. 用户明确要求删除时，用最新 `get_canvas` 返回的 `revision` 调用 `delete_conversation`。版本冲突须重新核对内容；已删除的 ID 返回 410，不自动换绑或新建。需要重新开始时，由用户指定其他画板或明确要求新建。

MCP 不提供密钥的读取与修改工具。画板通过本机 HTTP 复用同一套保存和生图逻辑，MCP 客户端不直接写文件。

### 配套 Skill

`skills/hicanvas/` 提供一个 `hicanvas` 技能，统一处理画板、生图、改图、HTML、幻灯片和影片；各项说明按任务加载。先完成上面的 MCP 配置，再安装技能。

使用共享技能目录时，在仓库根目录运行：

```sh
mkdir -p "$HOME/Documents/skills"
cp -R skills/hicanvas "$HOME/Documents/skills/"
```

宿主的技能入口应指向这份共享目录。需要单独安装的 Codex 环境可将 `skills/hicanvas/` 放入 `${CODEX_HOME:-$HOME/.codex}/skills/`；其他宿主使用各自的技能入口。安装后重载技能或新开 Agent 会话。只接 MCP 的宿主仍可直接使用工具。

### 从画板唤起 REX Agent

在 REX 内启动的 MCP 进程继承 `REX_SESSION`、`REX_BLOCK` 和 `REX_SERVER` 时，`open_conversation` 会绑定当前前台 AI 进程，返回 `agentConnection.connected: true`。之后点击网页、影片、幻灯片的发送按钮，或针对内容按标注修改，请求及参考图先持久保存在该画板，再由 REX 通知原 Agent。Agent 调用 `get_canvas_requests` 领取，按请求写回，最后 `complete_canvas_request` 报告完成或失败。原 AI 退出后不会把请求当命令输入 shell；重新连接该画板可继续处理，等待和失败都有提示。

图片生成和图片标注改图直接由本机队列调用已配置的生图模型，不需要外部 Agent 逐张接力。没有 Agent 连接时，网页等请求保存并显示“等待 Agent 连接”，不会假报生成成功。

任何兼容 stdio MCP 的宿主都可使用主动读写和请求领取工具。自动唤起目前实现了 REX 终端适配；其他宿主需提供自己的通知适配，或由 Agent 主动领取请求。MCP 本身不保证所有宿主都能自动开启一轮 AI 对话。

### 导出与更新

幻灯片的整套 HTML 和 PNG 存入当前画板的 `exports/`，界面显示具体路径；每次导出使用新目录。单幅图片、网页和影片可通过浏览器下载。

当前服务协议为 2。更新后先完成当前编辑并等待保存，再停止旧服务、重新构建和连接 MCP；仅刷新网页无法更新服务代码。启动器发现协议不匹配会明确报错，不会自动停止正在运行的旧服务。

## 检查

```sh
npm run check
```

统一入口运行数据/API 回归测试、设计规范检查、生成令牌一致性检查、继承样式之外的颜色/尺寸检查、生产构建和资源路径检查，以及源码行数、文档位置、规则入口和私人文件检查。数据测试使用自动清理的临时目录和本机模拟生图服务，不调用真实供应商。包括真实 HTTP 的画板隔离、恢复、损坏保护、版本冲突，以及 MCP stdio 协议、重复绑定、HTML/影片/Slides 原框写回、请求领取与恢复、16 张占位网格、并发上限、模型固定、删框找回和重启不重复收费。测试未显式提供隔离资料库时，生图服务会在读取或恢复任务前拒绝启动。`npm run design:tokens` 同时更新 CSS 令牌和供宿主传入交互层的 `src/styles/tokens.js` 数值令牌。

`npm test` 先检查测试入口，再预加载 `tools/test-sandbox.mjs`，为每个进程建立独有临时目录；主目录、资料、模型设置和桌面配置路径均指向其中，子进程继承隔离环境，退出时自动清理。每个 `*.test.mjs` 的第一条导入也必须是该模块，因此可单独运行 `node --test server/storage.test.mjs`；业务模块的静态导入会先于正文执行，不能在正文中才设置隔离路径。工程检查会拦住缺失或顺序错误的导入。

`npm test`、提交前检查与 CI 共用 `tools/run-tests.mjs`：从 `tools/` 与 `server/` 发现测试文件，逐文件对照 Node 的登记事件（`test:enqueue`）、带身份编号的完成事件与文件最终汇总；漏项、重复结果或缺汇总均以非零退出，并指出文件和差额。循环登记、动态子测试、套件、跳过与 TODO 都计入，不靠人工维护固定总数。只复查指定文件时运行 `node tools/run-tests.mjs server/engine-layout.test.mjs`。Node 24.22.1 的强制退出可能丢失尚未写完的报告，本入口的专用预加载将测试报告管道改为同步写出；保留强制结束悬挂句柄的能力，数量核对仍独立生效。该绕开使用 Node 内部的 `setBlocking` 接口，升级运行时后须重跑 `tools/run-tests.test.mjs` 的长报告和丢事件回归。

本机默认与当前提交比较；检查已提交改动时用 `npm run check -- --base <基点提交>`。CI 使用 PR 的目标提交或推送前的提交。首次克隆后启用提交前检查：

```sh
git config core.hooksPath .githooks
```

提交前跑快检查，CI 跑完整入口。仓库为公开仓库，GitHub Actions 使用云端 Ubuntu 检查机运行完整入口。本地检查通过后仍需核对 PR 的远程检查结果。

新渲染层的合成开发预览单独启动，不加载真实资料。原 `npm run renderer:preview` 仅在内存里临时编辑，刷新还原。先登记专用端口，再运行：

```sh
npm run renderer:preview -- --port 43330
# 打开 http://127.0.0.1:43330/?count=500，count 也支持 2000、5000
# 全部形状：/?gallery=shapes；颜色与样式：/?gallery=styles
npm run renderer:check
npm run renderer:smoke
```

需要验证松手保存和刷新恢复时，先登记另一个专用端口，再运行 `node tools/renderer-preview/service.mjs --port 43368`，打开 `http://127.0.0.1:43368/?count=500`（也支持 2000、5000）。这个独立宿主只监听 `127.0.0.1`，只用本工作区 `.scratch/interaction-preview/` 下的合成资料；支持点选、Shift 加减选、空白拖框、拖动移动和 Esc 取消，松手整次保存，刷新恢复位置。撤销和重做统一由后续 #82 接入。

手绘验证使用同一隔离宿主的 `/?gallery=draw-input`：D/B/X 画笔，Shift+D 荧光笔，Shift 自由／直线接段，Esc 丢弃当前未提交笔画；检测到笔输入后可用「退出手写笔模式」恢复鼠标。该合成图鉴只保存在内存中，刷新还原，支持整笔撤销和重做。设置 `HICANVAS_TEST_ELECTRON` 指向已有 Electron 可执行文件并登记专用端口后，运行 `HICANVAS_DRAW_PORT=43398 node tools/renderer-preview/draw-check.mjs`；原生手绘、CDP pen 压感、真实退出按钮、叠色和三档缩放结果写入 `.scratch/draw-smoke/`。高频硬件采样与真实手写板仍需人工验收。

文字合成图鉴用 `/?gallery=text-editing`，完整格式保留样本用 `/?gallery=text-formatted`：双击文字、几何、箭头标签或画框标题进入编辑，选中后 Enter 也可进入；双击空白直接写字，T 点击自动宽、长拖固定宽。Esc、Mod+Enter 和画布外部点击保存当前会话，画框标题也支持普通 Enter；组字期间不完成。清空普通文字会删除它，清空标签或标题只清字段；新空文字退出不留历史。一次编辑、样式切换和自动大小合为一次画板撤销；编辑内撤销由文本视图处理。保存等待期间只读，失败恢复草稿。这里的 Esc 保存与画笔 Esc 丢弃分别遵循各自事务。

连接线合成图鉴用 `/?gallery=connection-editing`，空白创建用 `/?gallery=creation`。在 `createCanvasInteraction` 的 `toolIds` 显式开放 `line`、`arrow` 后，可从工具栏创建，L 选择线条（A 继续用于 AI 图片）。拖端点移动或绑定，Alt 精确绑定、Ctrl 忽略绑定；拖中柄调整弧度或折肘，拖线条段间圆点加顶点。拖标签沿现有路径移动，双击继续使用同一文字会话；双击箭头端点在 none/arrow 间切换。线条点击创建后可 Shift 连续点击延伸；Q 保持工具后，拖画的线条也可继续加点。每次手势单次撤销，Esc 取消活动预览。

可选 `controlPointSnapping: boolean` 默认 false，Ctrl 在当前手势中反转它；吸附自身非邻接顶点/线段及其他可见几何控制点和轮廓，指示只在会话覆盖层。它暂不提供 #128 的总开关或偏好系统。停留约 300ms 转精确锚点；控制点吸附半径为8 CSS px，落在旧版原生样本测得的7.62–8.54px区间内，精确阈值未断言。绑定对象移动/缩放后连接跟随，删除时保留可见端点，撤销恢复绑定；独立无界面命令宿主须先按下文准备字体，尤其是删除文字、便签或含文字组的绑定目标时，真实轮廓依赖其排版。

登记专用端口及已有 `HICANVAS_TEST_ELECTRON` 后，运行 `HICANVAS_CONNECTION_PORT=43386 node tools/renderer-preview/connection-check.mjs`；原生鼠标、键盘及标签文字守卫的结果写入 `.scratch/connection-smoke/`，也纳入完整 `npm run renderer:smoke`。普通 `npm run check` 自动执行连接线的定向事务与几何回归。正式应用尚未切换；旧版标签拖动和端帽双击未取得可靠正例，差异及待集中确认项见功能清单。

宿主通过 `interaction.editText({type:'begin',id})`、`update`（`content,selection?`）、`selection`、`finish`、`cancel` 管理会话；`style`（`id,changes`）只接受适用的 `size/font/textAlign/align/verticalAlign`，`auto-size` 接受 `id,enabled`。订阅 `state.textEditing`，交给 `renderer.setTextEditing(description)`；挂载渲染器时提供 `textEditing.onChange/onSelection/onInputContext/onError` 回调。`onChange` 单向调用编辑层，TipTap 内容和选区是输入权威，视图仅进入时初始化，不随预览回灌。标题写 `name`，其余写 `richText`。远端改位置或尺寸时只叠文字并携新版本重试一次；远端改原文或删除目标时保留草稿，`conflict` 给出纯数据状态，停止自动提交。`isSaving` 表示提交中。正式界面尚未切换，冲突选择界面由后续产品接入。

登记文字验证端口并设置已有 `HICANVAS_TEST_ELECTRON` 后，运行 `HICANVAS_TEXT_PORT=43386 node tools/renderer-preview/text-check.mjs`，结果在 `.scratch/text-smoke/`。完整 MIT TipTap schema 保留已有节点、标记和属性，依赖许可证见 [文字编辑依赖声明](licenses/text-editor-dependencies.txt)；格式工具栏、格式快捷键、富文本精确排版、链接、列表和编辑中粘贴归 #150，画布文本粘贴归 #136。实际 macOS 输入法候选窗及系统剪贴板需集中人工验证。

选择动作验证使用 `/?gallery=selection-actions`，只修改内存中的合成小板，刷新还原。方向键每次1画布单位、Shift为10；按住重复在松键时保存一次。Alt+A/H/D/W/V/S 对齐，Alt+Shift+H/V 分布，Shift+H/V 镜像，`[`/`]` 置底／置顶，加Alt只跨过下一处重叠；Shift+,/. 旋转15°，再加Alt细转；Mod+Alt+Shift+=/- 缩放对象。Mod+G 组合／单组解组，Mod+Shift+G 解组，Shift+L 锁定，Delete删除，Mod+Shift+F 移除框。无快捷键的拉伸、堆排、紧凑排布、全部解锁及适配框使用预览按钮。紧凑排布次序仍待 #154；普通网格微移不在本单范围。原生回归在白板排队并登记专用端口后运行 `HICANVAS_ACTION_PORT=43395 node tools/renderer-preview/actions-check.mjs`，沿用上述已有 Electron 环境；证据位于 `.scratch/actions-smoke/`。

编辑层公开 `canvasActions` 与 `planCanvasAction(id, { records:{getRecord,childIds}, pageId, selectedIds, frame?, canRotate?, canScale? }, {largeStep?})`：规划只读记录，返回可用条件、已有命令和结果选择策略。宿主经 `interaction.getActions()` 读取标签及可用状态，经 `interaction.runAction(id, options?)` 执行同一事务；返回 `applied`、`unchanged` 或带明确原因的 `unavailable`，执行失败抛错。菜单焦点可调用；提交中、活动手势、裁剪或文字编辑期间立即拒绝，不排队。键盘仍先过表单／IME／快捷键开关门禁；实际手形和画笔中的方向键不移动对象，Space+方向键只平移。MCP参数表和正式界面本轮未接入。

预览入口是 `tools/renderer-preview/index.html`，独立 Vite 配置只扫描这个入口；正式构建仍从根 `index.html` 进入，桌面只复制正式 `dist/`，因此预览页不进入应用产物。合成规则复用性能基线的坐标、相机、尺寸、60% 几何／20% 文本／20% 图片构成及 16 张本地 PNG；保留三角形、菱形和 semi 填充，不再转换为矩形和实心。滚轮平移、Ctrl+滚轮或触控板捏合缩放只实现在预览页。只读观察接口 `window.__HICANVAS_RENDERER_PREVIEW__.getState()` 返回 `ready`、`error`、`camera`、`count`、`counts`、`renderedShapes`、`imageCount`、`decodedImages` 的副本，不暴露存储或修改接口；`ready` 等到全部形状、字体和图片解码完成后置为真，供后续测量工具读取。

本地字体由 `renderer/index.js` 的 `prepareCanvasFonts(document, { onWarning })` 准备：宿主先等待成功，再挂载。它从 `renderer/fonts/files/` 加载13份作者原始字体，为16种粗细／斜体注册样式；任一失败会拒绝，宿主应显示错误并允许重试。手写字体使用作者 Shantell 1.011 可变字体的 C 拟合实例，CSS 和 fontkit 共用 `renderer/font-families.js` 的轴值，字形接近旧版但不完全一致。来源、固定提交、SHA-256、轴值及许可见 `licenses/fonts-sources.txt`。启动时用少量合成字复核系统字体类常量，偏差超过0.5px会在控制台警告；宿主通过 `onWarning` 保存本机日志，预览会写入 `.scratch/renderer-font-calibration.log`，日志失败不阻止使用。

无界面宿主先调用 `server/text-layout.mjs` 的 `prepareNodeTextLayout()`（本机服务已接入）；其他宿主可读清单的原始字节，再调用 `renderer/geometry.js` 的 `prepareTextLayout([{ key, weight, style, bytes }])`。随后 `measureText(text, { font, size, weight?, style? })` 返回宽度及未校准字列表，`layoutText(text, { font, size, width?, runs? })` 返回逐行内容、宽度、外框和未校准字；`textLayout(props)` 复用记录字体、缩放及粗体／斜体文字段。显示逐行 nowrap，不再拉伸字距凑估算宽度。编辑宿主使用公开的 `canvasFontStyle`，挂载区域的 contenteditable 明确使用 space-all / no-autospace；编辑时仍由浏览器断行，松手后以统一排版结果为准。富文本标题、列表、下划线、删除线、链接样式及RTL专门整形不在本轮格式支持范围，原始记录保留，排版返回 unsupported 项。画框标题按 ADR 0011 的例外保留 system-ui 和浏览器自然宽缓存，只用于显示截断，不进入保存外框或服务端几何。

规则与取舍见 [ADR 0011](docs/adr/0011-text-layout-computed-by-canvas.md)：fontkit 3.0.0、linebreak 2.0.0、unicode-segmenter 0.17.3（Unicode17）均精确锁定；许可证及 Brotli 的 Apache 声明在 `licenses/text-layout-dependencies.txt`。固定 fontkit 与字体的可变字距适配只在 `renderer/text-variable-metrics.js`，升级时须重跑100项独立DOM参考宽度及两端排版回归。字体构建回归验证13份独立WOFF2及散列，桌面服务包同时携带同样原始字节；正式新界面安装包的最终验收仍在入口切换阶段。

渲染挂载入口 `renderer/index.js` 导出 `mountCanvasRenderer(element, { store, camera?, pageId?, loadGeneratedFrame?, reduceMotion? })`，返回 `setCamera({ x, y, z })`、`getCamera()`、`hitTest({ x, y })`、`setReduceMotion(boolean)`、`unmount()`。宿主可传布尔值 `reduceMotion`（默认 false），之后用 `setReduceMotion` 更新图片播放偏好；渲染层不读取系统设置，偏好不写入画板。可选 `loadGeneratedFrame(html, options)` 由宿主提供生成内容加载能力，返回 `{ attributes, dispose }`；不传时纯内联 HTML 仍用 srcdoc，不探测本机接口。hiCanvas 的公开同名适配器读取启动信息并按开关登记内容实例。传入 `model/` 创建的 Store；调用方管理输入，相机满足 `屏幕坐标 = (画布坐标 + 相机平移) × 缩放`，查询坐标相对于挂载元素左上角，返回顶层形状 ID 或 `null`。挂载和相机变化不修改 Store，卸载释放订阅且不销毁调用方的 Store。支持 20 种几何形状、六种填充、实线／虚线／圆点线、四档线宽与透明度，以及纯文本、图片和带裁剪子形状的框。手绘线型按稳定形状身份生成变宽、圆角和轻微抖动的笔触，填充沿同一边界闭合；几何形状暂不画文字标签。浅色画板配色集中在 `renderer/palette.js`，颜色名取当前 MIT tlschema，数值对照隔离运行的旧版合成画面取色；图案为独立 SVG 实现。正文、箭头标签和便签共用确定的字宽与换行，支持粗体和斜体；便签保留200px纸宽、16px内边距、四档字号、横纵对齐、随文字增高及署名。其余富文本格式和几何形状内文字标签仍待接入。

无界面几何入口 `renderer/geometry.js` 可直接在 Node 使用，不依赖 React 或 DOM：`getShapeContour(shape)` 返回共享闭合轮廓及叉勾装饰线，`getShapeBounds(shape)` 返回局部外框，`getShapePageBounds(snapshot, id)` 返回考虑父子旋转后的画布外框；`shapeToPagePoint`／`pageToShapePoint` 互换局部与画布坐标，`canvasToScreen`／`screenToCanvas` 互换画布与屏幕坐标，`pointInShape` 判断局部点，`hitTestCanvas(snapshot, point, camera?, pageId?)` 查询顶层记录。几何绘制与命中共用轮廓，无填充形状只命中边线和叉勾装饰线；曲线用多边形近似，椭圆／胶囊弦高误差不大于 `max(0.1, 长边/8192)` 画布单位，云形／心形各取 256 点。点中查询尚未接空间索引；文字外框与画面共用纯排版模块；未准备字体时须先执行上述宿主准备步骤。`npm test` 包含几何、边界和合成接口回归；`renderer:smoke` 需已安装的项目 Electron（可用 `HICANVAS_TEST_ELECTRON` 指向已有可执行文件，不会下载运行时），使用自动隔离环境在后台离屏打开三档画板，检查全量图片解码、真实滚轮输入、单记录订阅及卸载，并验证 20 种共享轮廓、六种填充和记录样式更新，结果与三档画板、两张图鉴截图保存到 `.scratch/renderer-smoke/`。截图供检查，不代表人工视觉验收，也不是性能比较报告。

性能基线使用项目锁定版本的 Electron，在后台离屏窗口测量正式构建。先在占用白板登记专用端口，避开其他重任务，再运行（端口按实际登记替换）：

```sh
export HICANVAS_PROJECT_DIR="$PWD/.scratch/perf-data/project"
export HICANVAS_CANVAS_DIR="$PWD/.scratch/perf-data/canvas"
export HICANVAS_SETTINGS_DIR="$PWD/.scratch/perf-data/settings"
export HICANVAS_DESKTOP_CONFIG_DIR="$PWD/.scratch/perf-data/desktop"
npm run build
npm run perf:baseline -- --port 43326 --load-note "测量期间无其他重任务"
# 新旧交替：两个端口都须先登记；每档旧、新相邻，各三轮。
npm run perf:baseline -- --renderer both --port 43326 --preview-port 43328 --load-note "实际同时运行的任务"
```

脚本拒绝缺少上述变量、路径越出本 worktree 的 `.scratch/`、符号链接，以及使用端口 43218/43219。默认 `--renderer legacy` 测旧版正式构建；`preview` 单测新预览，`both` 按「旧 500、新 500、旧 2000、新 2000、旧 5000、新 5000」交替，再重复三轮；后两种须额外指定不同的 `--preview-port`（43300–65535）。新预览通过既有启动入口运行，使用 Vite 开发模式，旧版使用生产 `dist`，这一差别写入报告。

`--dash draw` 将合成画板的几何形状设为手绘线型，默认 `--dash solid`；其余合成规则与测量方法不变。

合成规则、输入轨迹与统计共用：默认 500、2000、5000 个元素（60% 几何图形、20% 文字、20% 图片；复用 16 张本地生成的 256×192 PNG），每项持续 2.5 秒；`--sizes 500,2000,5000 --runs 3 --duration-ms 2500` 可调整，新预览只支持上述三档。合成资料在导航前准备。每次打开用新内存浏览会话，进程和系统文件缓存保持温热；计时从导航开始，到形状数量吻合、字体就绪、图片解码及两帧之后，旧版额外等真实指针选中目标，新版无编辑能力，拖动记为「不适用」。旧版保留原来的可见图片解码口径，新版检查全部图片解码，打开时间均不含应用进程与宿主启动。

两版共用约 60 Hz 的中键平移及 Ctrl+滚轮缩放轨迹；每阶段在计时前重置相机并核对起点，缩放小幅往返并记录实际范围，断言状态变化以拒绝空转 FPS。新预览的中键处理是临时输入，观察钩子额外提供仅供性能测量的 `resetCamera({x,y,z})`，只改视角；只读 `getCamera()` 返回相机副本，逐帧取样不扫描画面，计数只在就绪及阶段前后读取。预览的 ready 已包含双帧等待，观察器不再重复等待。正式编辑器接上输入后须重测。本轮预览保留三角形、菱形与semi填充，文字采用共享fontkit排版；手写字体C实例与旧版的差异、系统后备校准及不挤压标点的取舍随报告保存。

分别记录 rAF 与实际离屏绘制 FPS、各轮原值、中位数、帧间隔、逐样本系统负载和环境。离屏绘制含图像回读开销、最高 60 FPS，不能等同于前台屏幕帧率；新旧骨架对照只是早期信号，不判定切换门槛。输出在 `.scratch/perf-results/run-*/` 的 JSON、每版三档截图与日志中，合成资料结束时清理。页面差异只在 `tools/perf/` 的观察实现中适配，输入、帧时钟和统计保持共用；性能测量不作为普通 CI 的速度门禁。

需要诊断耗时分布时，可在同一隔离环境加 `HICANVAS_PERF_TRACE=1`，例如 `HICANVAS_PERF_TRACE=1 npm run perf:baseline -- --renderer both --sizes 5000 --runs 1 --port 43326 --preview-port 43328 --load-note "诊断追踪，非验收"`。工具通过 Electron 的 Chromium 追踪与 Performance 域，把各阶段时间线写入同一输出目录的 `*.trace.json`，并在样本 `trace.metricsDelta` 中记录脚本、样式和布局耗时及次数；报告 `metadata.diagnosticTracing` 标明是否开启。时间线中的 `hiCanvas-perf-start/end` 标记限定输入阶段；事件可能嵌套、线程可能并行，耗时不能直接相加。开启追踪会明显拖慢运行，测出的帧率不能用来验收；正式对照须关闭该开关。

本次浏览器验证使用合成图片与文字，实际操作了新建、重命名、切换和刷新恢复画板，确认 MCP 修改实时显示；模拟保存断网时切换被阻止、恢复后可继续切换。图片结果独立显示并能放入画板，其他画板保持空结果；1440 和 390 像素窗口中检查了浮层布局及 Escape 后焦点恢复。另在独立 REX 测试服务和合成接收程序中，实际操作画板按钮→终端通知→模拟 Agent 领取→原框写回，验证网页、影片和幻灯片流程；这不等于验证真实语言模型的内容质量。浏览器走查尚未接入持续执行的界面守卫；数据、并发、MCP 和保存切换逻辑由回归测试保护。

## 上游与许可

导入 Cowart `0.1.38`，来源提交 [`38bdafeff47374ddbc11b12bddbc4f1f4cf14587`](https://github.com/zhongerxin/Cowart/tree/38bdafeff47374ddbc11b12bddbc4f1f4cf14587)。保留 Cowart 的 [MIT 许可证](LICENSE) 和原作者版权，拆分原来的大界面文件以便维护。本版未启用 Cowart 自带的遥测发送。

**底层 tldraw 不是 MIT。** 依赖的 5.1.1 版使用[单独许可证](licenses/tldraw.txt)，允许开发/测试，生产环境需要相应授权；保留其官方许可检查和提示，正式交付前须解决授权。该许可证也说明它可能为许可合规收集使用数据。其他依赖遵循各自许可证。

## 项目入口

- 工程与当前工作方式：`AGENTS.md`。
- 视觉基线：`DESIGN.md`，沿用 Cowart，不在此次迁移重新设计。
- 版本记录：`版本管理.md`；候选版本进入 main 后再打同名标签。

### 单画布与旧数据

每个画板只有一张无限画布，界面不再提供页面切换、新建或移动到页面；用位置、画框和分组组织作品，幻灯片自身的页数和演示照常保留。MCP 使用 `open_conversation` 创建或恢复画板，`conversationId` 是画板标识；生成和插入不传 `pageId`，普通形状省略 `parentId` 自动放入画板。

已有多页资料在新版服务首次读取时合到同一画布的横向不同区域，原始完整快照保存在该画板的 `before-single-canvas.json`，重复打开不会重复平移；资源地址和文件保持原样。回退需先停止新版服务，并从该原始快照恢复整份 `state.json`；迁移后的新修改不在原始快照中，应另存当前资料再恢复。不要让旧版服务和新版同时编辑同一份资料。

### Skill 自动部署与 AI 接入

把 hiCanvas.app 放入应用程序后首次打开，应用会自动寻找已有 Skill 目录（共享 `.agents/skills`、Claude、Codex、OpenCode、Pi 及 Documents/skills），并合并符号链接指向的同一目录；已部署的 hicanvas 共享目录优先。`CODEX_HOME` 有效时也参与识别。找不到、已有位置失效，或存在多个独立候选时，弹出目录选择器；请选择技能根目录，应用会放入 `hicanvas/`。取消不影响画板，稍后可在设置 → AI 接入中继续。

部署位置记在应用配置目录的 `skill-preferences.json`，更新记录在 `skill-install.json`；应用升级会更新随附 Skill。遇到用户修改的同名文件会询问保留或备份更新，不改其他技能。备份保存在应用配置目录的 `skill-backup-*`。更改部署目录后，未修改的旧 Skill 目录会改为指向新目录的链接；含用户修改或额外文件的旧目录会保留并提示手动确认。不自动改任何 AI 客户端的真实 MCP 配置。

在设置 → AI 接入点击「复制接入指令」，把指令发给要接入的 AI；它按 Skill 内的 `references/connect.md` 和本机 `installation.json` 配置当前宿主，再通过只读 MCP 工具验证。没有画板时，也可从 macOS 菜单「hiCanvas → AI 接入…」复制指令或选择目录。应用提供 stdio MCP 启动器，不需另装 Node；云端客户端需具备本机 MCP 连接能力。

安装与升级的隔离回归测试已接入 `npm run check`；只用临时目录和模拟选择器，不修改真实客户端配置，不调用收费模型。

桌面隔离测试可同时设置 `HICANVAS_DESKTOP_CONFIG_DIR` 和 `HICANVAS_SKILL_HOME`，后者只在指定的模拟用户目录内发现 Skill，并忽略外部 `CODEX_HOME`。
