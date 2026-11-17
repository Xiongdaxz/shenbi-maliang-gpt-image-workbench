# WorkBuddy 单一远程 MCP 图片交付

2026-11-17，按用户要求移除独立 `maliang_workbuddy`，WorkBuddy 只保留原远程 `maliang`。本轮只修改本地源码及本机 WorkBuddy 配置，未发布、部署或重启马良服务。

## 当前实现

- 原 MCP 的服务说明、`maliang_get_image_job` 说明和安装清单统一使用客户端已有能力：支持原生预览时直接展示；需要落盘或无法预览时，使用宿主下载、文件工具或已有 Bash/PowerShell 保存二进制原图，再调用 `present_files` 展示真实绝对本地路径。
- `imageResults` 同时保留在文本 JSON 和 `structuredContent`，原有 `resource_link` 保留，支持只向模型转发文本的客户端。不返回图片 base64。临时链接仅用于工具调用，不另行写入正文、日志或长期存储。
- 删除独立工具源码、分发文件、构建脚本、许可证文件和对应测试；删除安装与下载入口、`workBuddyDeliveryChallenge`、交付票据及专用图片 POST 路由。远程 OAuth 的 WorkBuddy 回调兼容仍保留。
- Codex 插件已有的 `maliang_local` 上传与保存流程保留。
- 本机 `~/.workbuddy/mcp.json` 先备份再仅移除 `maliang_workbuddy`，校验剩余配置与移除前完全一致。当前 `mcpServers` 只有 `maliang`，独立工具进程数为零。

## 验证

- `bun run check` 通过。
- 图片任务、原图结果、OAuth、分发、Codex 本地工具及安全边界相关 99 项测试通过。
- `MALIANG_MCP_SMOKE_IMAGE_PATH` 指向上次已有的 `puppy.png`，运行 `bun run smoke:mcp` 通过。测试只连接一个远程 MCP，用内存数据库和临时本地服务验证：仅从文本 JSON 获取原图地址、宿主文件工具模拟保存、资源链接与结构化结果一致、失败任务的部分图片可交付、旧工具下载路由不可用。OAuth 回调、新旧协议发现和跨协议请求去重也通过。
- 原图与保存结果均为 2,481,104 字节，SHA-256：`e5a52c9e64ecff0b36c29a8e888f75f3621d42bd9a2eef85aa75742d007b07bd`。未调用真实生图、改图或上传接口。
- WorkBuddy 桌面界面复验未完成：窗口截图首次返回 `FrameArrived timed out`，刷新窗口并激活后仍返回 `window capture timed out`，按工具恢复规则停止。上述图片保存验证属于协议与文件字节验证，不代表本轮已观察到新的桌面图片卡片。

历史上未安装独立工具时，WorkBuddy 曾用自带 Bash 下载同一小狗原图，再以 `present_files` 成功登记本地产物。该记录证明“宿主保存后展示”曾成功，不能据此声称所有 WorkBuddy 版本均支持直接预览远程资源链接。
