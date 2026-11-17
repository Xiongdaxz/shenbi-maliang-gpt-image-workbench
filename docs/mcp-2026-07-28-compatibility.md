# MCP 2026-07-28 兼容性决策

最初核对与实现日期：2026-10-10；2026-11-17 随应用 v0.1.88 更新核对。插件版本：0.6.0。

## 当前实现

- 远程服务使用官方 @modelcontextprotocol/server 2.4.0，通过 createMcpHandler 在同一 /api/external-mcp/mcp 入口处理 2026-07-28 与旧版 stateless 请求。原有 OAuth resource 和常用图片工具名不变。开发验证使用 @modelcontextprotocol/client 2.4.0 的 legacy 模式模拟旧客户端，旧 @modelcontextprotocol/sdk 依赖已移除。
- 新协议的 server/discover、请求元数据、Mcp-Method/Mcp-Name 一致性校验、resultType、缓存字段由 SDK 负责。工具目录使用私有缓存提示；授权绑定的图片结果仍不得缓存。
- 本地 stdio 使用同一官方 SDK 的 serveStdio。源文件在 scripts/maliang-local-mcp-entry.mjs，通过 build:maliang-local-mcp 打包成免安装 npm 依赖的插件文件，并附依赖许可证。Node.js 要求 20+。
- 生图/改图增加可选 requestKey。新版 Skill 每次新用户请求生成一个 key，网络重试复用；旧调用可省略以保留兼容。持久化预留防止并发重复提交，响应丢失时按 client_request_id 恢复已创建任务；无法确认是否接受的请求不会自动重新提交。
- 所有远程工具提供 outputSchema 和 structuredContent，保留文本结果兼容旧调用。

## OAuth 与设备

设备记录移动到 oauth_grants；保留已存在的 grant ID、令牌与撤销语义。原 DCR 连接使用空 connection_key；共享客户端身份的每次 CIMD 授权使用独立 connection_key。设备显示、备注、访问地理信息和撤销均按对应连接处理。

CIMD 已实现受限的 Codex 支持，但默认关闭。只有设置 MALIANG_MCP_CIMD=true 才声明并接受 https://chatgpt.com/oauth/codex/.../client.json。元数据抓取要求 HTTPS、固定受信任 URL 形状、公开 DNS 地址与连接地址一致、禁止重定向、超时、16 KiB 限制、client_id 精确匹配，并仅接受声明的 loopback 回调（允许动态端口）。未在白名单内的客户端需要显式使用 DCR；混合客户端部署在完成互操作前保持此开关关闭。

RFC 9207 iss 继续随授权响应返回。MALIANG_MCP_ISSUER_RESPONSE=true 单独控制是否声明 authorization_response_iss_parameter_supported，默认关闭，保留旧 rmcp 客户端兼容行为。

## 分发

默认 Codex ZIP 保留 .codex-plugin/plugin.json、.mcp.json、精确 selector、工具批准策略和既有自动更新器契约，增加 onboardingSkill。可移植 Agent Plugins ZIP 在 /plugin/download/portable 单独提供：根 plugin.json + mcp.json，显式 transport type，与默认包共用版本源及工具实现。可移植宿主负责更新与工具审批，OpenAI 扩展显式关闭 Codex 自更新 Hook；它不替换默认 stable 下载。当前 bundled Skills 与本地文件交付仍面向 Codex；可移植清单不代表所有宿主都已通过验证。

## 发布边界

本地协议与持久化测试不等于各宿主的真实 OAuth/生图互操作。当前机器的 Codex 0.148.0 将 mcp_2026_07_28 标记为开发中且未启用；不替用户打开该开关。正式发布前验证现有 Codex、TRAE Work、Claude Code 与 WorkBuddy 的授权、刷新、工具发现、上传、生成、保存，以及旧版更新到新版。

CIMD 与 issuer 声明先在测试部署启用，完成浏览器授权后再逐步发布。启用 CIMD 并创建同用户同 client_id 的多个连接后，回滚旧服务需要配套数据库恢复方案；不能重新建立旧的二列唯一索引来删除或合并连接。

Tasks 与 MCP Events 是后续可选能力，本次不声明对应扩展。图片任务继续以 image_jobs 与 jobId 轮询为准。Events 当前官方产品支持面包含 Work Cloud，不应承诺本地 Codex 的后台唤醒。

## 本轮验证与复审

- 完整 Bun 回归：566 通过、0 失败，覆盖 103 个测试文件；使用隔离目录与内存数据库。
- `bun run check` 通过，包含 TypeScript 与本地 SDK 分发文件/许可证一致性检查；`bun run build` 通过，保留现有前端大 chunk 提示。
- `bun run smoke:mcp` 通过：旧 SDK 客户端、2026-07-28 discovery/工具调用、私有目录缓存、请求头不一致拒绝、跨协议生图提交去重；生图路由使用本地假实现，不调用付费提供方。
- 本地 stdio 新旧协议、真实 Node 进程上传/保存、OAuth 连接隔离、迁移重复执行、ZIP 内两种清单与旧更新器契约通过回归；两个 Skill 通过结构校验。
- 复审修复了请求去重记录的账号删除级联清理，并核对了连接级地理信息更新和共享 client_id 的独立撤销。当前实现范围未留下已知阻塞问题。
- 候选包位于 `distribution/releases/maliang-internal-marketplace-0.6.0.zip` 与 `distribution/releases/maliang-agent-plugin-0.6.0.zip`。未部署服务、未替换本机已安装插件，也未声称真实账号 OAuth、提供方生图或跨宿主安装已完成验证。

## 官方依据

- [MCP 2026-07-28 变更](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [TypeScript SDK 发行记录](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- [Codex 插件打包与 onboarding](https://developers.openai.com/plugins/build/plugins)
- [Codex OAuth / CIMD](https://learn.chatgpt.com/docs/extend/mcp)
- [MCP Events 支持范围](https://developers.openai.com/plugins/build/mcp-events)
