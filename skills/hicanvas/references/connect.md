# 接入当前 AI 宿主

1. 读取本技能根目录的 `installation.json`。其中 `command` 是当前应用的 MCP 启动器绝对路径，`skillDirectory` 是存放各技能的集合目录，`skillPath` 是本技能文件夹。检查启动器存在且可执行；不存在时让用户打开或重新安装 hiCanvas，再从设置的「AI 接入」复制指令。不要猜应用安装位置。
2. 确认当前运行的是哪个 AI 客户端、实际使用的配置目录和配置方式。Rex 是终端容器时，配置其中运行的 Codex、Claude Code 等宿主；不要把终端名称当成 AI 宿主。先检查该宿主已有的 `hicanvas` MCP 配置；已经正确连接则直接验证，不重复添加。
3. 优先使用当前宿主自带的 MCP 配置命令，先读本机 `--help`。例如把下方 `<command>` 替换为刚读取的绝对路径，作为一个完整参数传入：
   - Codex CLI：`codex mcp add hicanvas -- <command>`。尊重当前 `CODEX_HOME`，不改其他配置目录。
   - Claude Code：`claude mcp add --transport stdio --scope user hicanvas -- <command>`。
   - 其他支持本机 stdio MCP 的客户端：在其 MCP 配置界面添加名为 `hicanvas` 的服务，传输类型 `stdio`，命令填 `command`，参数留空。JSON 格式按该宿主的实际要求；只增改这一条服务，保留其他配置、环境变量和密钥。
4. 确保当前宿主能发现此技能。若它已从共享目录加载 `hicanvas`，直接复用；否则按宿主的技能目录规范，把现有 `hicanvas` 文件夹链接到该宿主的技能目录。保留唯一技能内容，不为每个 Agent 复制一套。配置真实宿主前遵守当前会话的用户授权规则。
5. 重连或启用 MCP。若宿主必须重启或新建会话才加载，告诉用户具体操作；未发现工具前不要声称已接通。云端客户端不能执行本机命令时，说明需要本机 MCP 连接能力，不把本地 HTTP 地址当作可直接连接的 MCP URL。
6. 通过当前宿主的 MCP 工具调用 `list_conversations` 与 `list_image_models` 验证连接。只读检查，不调用收费模型、不为测试新建画板、不改用户作品。报告宿主、配置位置和两项检查结果。
7. 连接完成后阅读 [SKILL.md](../SKILL.md)，按用户任务创建或复用画板。已有画板持续复用返回的 `conversationId`；批量图片一次提交，交给画板完成占位、生成和排版。

启动器随应用提供 Node 运行环境。应用未打开时，MCP 可启动本机服务；用户要求显示作品时再打开画板窗口。不要另外启动开发服务器或另选端口。
