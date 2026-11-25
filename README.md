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

统一入口运行数据/API 回归测试、设计规范检查、生成令牌一致性检查、继承样式之外的颜色/尺寸检查、生产构建和资源路径检查，以及源码行数、文档位置、规则入口和私人文件检查。数据测试使用自动清理的临时目录和本机模拟生图服务，不调用真实供应商。包括真实 HTTP 的画板隔离、恢复、损坏保护、版本冲突，以及 MCP stdio 协议、重复绑定、HTML/影片/Slides 原框写回、请求领取与恢复、16 张占位网格、并发上限、模型固定、删框找回和重启不重复收费。测试未显式提供隔离资料库时，生图服务会在读取或恢复任务前拒绝启动。设计令牌由 `npm run design:tokens` 重新生成。

`npm test` 先检查测试入口，再预加载 `tools/test-sandbox.mjs`，为每个进程建立独有临时目录；主目录、资料、模型设置和桌面配置路径均指向其中，子进程继承隔离环境，退出时自动清理。每个 `*.test.mjs` 的第一条导入也必须是该模块，因此可单独运行 `node --test server/storage.test.mjs`；业务模块的静态导入会先于正文执行，不能在正文中才设置隔离路径。工程检查会拦住缺失或顺序错误的导入。

本机默认与当前提交比较；检查已提交改动时用 `npm run check -- --base <基点提交>`。CI 使用 PR 的目标提交或推送前的提交。首次克隆后启用提交前检查：

```sh
git config core.hooksPath .githooks
```

提交前跑快检查，CI 跑完整入口。仓库为公开仓库，GitHub Actions 使用云端 Ubuntu 检查机运行完整入口。本地检查通过后仍需核对 PR 的远程检查结果。

性能基线使用项目锁定版本的 Electron，在后台离屏窗口测量正式构建。先在占用白板登记专用端口，避开其他重任务，再运行（端口按实际登记替换）：

```sh
export HICANVAS_PROJECT_DIR="$PWD/.scratch/perf-data/project"
export HICANVAS_CANVAS_DIR="$PWD/.scratch/perf-data/canvas"
export HICANVAS_SETTINGS_DIR="$PWD/.scratch/perf-data/settings"
export HICANVAS_DESKTOP_CONFIG_DIR="$PWD/.scratch/perf-data/desktop"
npm run build
npm run perf:baseline -- --port 43326 --load-note "测量期间无其他重任务"
```

脚本拒绝缺少上述变量、路径越出本 worktree 的 `.scratch/`、符号链接，以及使用端口 43218/43219。默认生成 500、2000、5000 个元素的合成画板（60% 几何图形、20% 文字、20% 图片；图片复用 16 张本地生成的 256×192 PNG），各测 3 次、每项操作持续 2.5 秒；可用 `--sizes 500,2000,5000 --runs 3 --duration-ms 2500` 调整。每次打开用新内存浏览会话，进程和系统文件缓存保持温热；打开时间从导航开始，到元素、字体、可见图片解码完成且真实指针输入选中元素为止，不含应用进程启动。平移、滚轮缩放和拖动用固定约 60 Hz 的原生输入；缩放在初始视角附近小幅往返并记录实际范围，断言画板状态确实变化；分别记录 rAF 与实际离屏绘制 FPS，并报告各轮中位数、帧间隔和环境。离屏绘制含图像回读开销、最高 60 FPS，不能等同于前台屏幕帧率。输出保存在 `.scratch/perf-results/run-*/` 的 JSON、截图和日志中，合成资料在结束时清理。换编辑器后保留相同数据与输入，替换 `tools/perf/page-probe.mjs` 的就绪／状态观察接口再重跑；性能测量不作为普通 CI 的速度门禁。

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
