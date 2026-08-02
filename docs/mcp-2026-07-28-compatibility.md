# MCP 2026-07-28 兼容性决策

核对日期：2026-07-31。

官方最新稳定规范是 [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)，变更摘要见 [官方 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) 与 [GitHub Release](https://github.com/modelcontextprotocol/modelcontextprotocol/releases/tag/2026-07-28)。该版本是一次协议级大改：核心传输改为无状态，移除 initialize 与 session id，新增 `server/discover`、`subscriptions/listen`、`resultType`、MRTR 多轮输入，并把 Tasks 移到正式扩展 `io.modelcontextprotocol/tasks`；Roots、Sampling 和 Logging 进入弃用流程。

## 当前落地

神笔马良本轮继续使用生态稳定的 TypeScript SDK v1，并升级到 `@modelcontextprotocol/sdk` 1.30.0。SDK v2 仍为 beta，且要求 Node 20+；Codex、TRAE Work、Claude Code、WorkBuddy 与其他现有 MCP 客户端尚不能假定已经统一支持 2026-07-28 的无状态握手，因此生产 endpoint 不伪造 v2 能力。

本轮加入不会破坏旧客户端的 OAuth 兼容增强：

- 授权成功与拒绝响应保留 RFC 9207 `iss`；授权服务器元数据暂不声明 `authorization_response_iss_parameter_supported`，以兼容 Codex 0.146.0 内置的 rmcp 1.8.0 回调处理。PKCE、state、resource 与 issuer 校验仍保留。
- 动态客户端注册接受、持久化并返回 `application_type`；旧客户端未发送时按 `native` 兼容。普通 `native` 客户端由同源授权页后台交付 loopback 回调，并仅在服务端确认本次授权码已消费且令牌已签发后显示“授权成功”；WorkBuddy `native` 客户端仅允许 `workbuddy://workbuddy/mcp/{connectorId}/oauth/callback` 官方私有回调，并通过浏览器 303 交给操作系统唤起客户端；`web` 客户端的回调必须使用 HTTPS，并通过标准浏览器 303 重定向交付授权结果。私有协议不按 User-Agent 或任意 scheme 泛化放行，Token 交换继续要求 `redirect_uri` 与授权码逐字一致。
- 匿名注册增加 16 KB 请求体限制、数组与 URL 数量限制、按来源地址的短时限流，以及 24 小时孤立客户端清理。
- 授权确认、Token 与撤销端点仅接受有大小和字段上限的 URL 编码表单；权限变化会使旧令牌和待交换授权码失效，过期 Access Token 与 Refresh Token 轮换节点会持续清理。
- DCR 注册必须包含 `authorization_code` / `code`，`refresh_token` 为可选能力；服务端只向显式注册该能力的客户端签发和接受 Refresh Token。
- 公开 MCP/OAuth origin 对公网强制 HTTPS；插件自动更新链路强制同源，公开与生产地址必须使用 HTTPS，用户明确选择的本地或可信私网开发地址可以使用 HTTP，公开 HTTP 地址仍被拒绝。

## 暂缓能力

- `server/discover`、`subscriptions/listen`、MRTR 与 `resultType`：等待 SDK v2 GA 和主流宿主真实互操作后再做双协议迁移，不能只在 v1 响应中增加同名字段来冒充支持。
- Tasks 扩展：图片任务已经有稳定的 `jobId` 与轮询工具。迁移前需要确认客户端扩展协商、恢复语义、取消语义和任务持久化边界。
- Client ID Metadata Documents：长期可替代已弃用的 DCR，但服务器需要安全抓取客户端元数据。实现前必须先完成 DNS 重绑定、私网地址、重定向和响应大小限制，避免引入 SSRF。
- OpenTelemetry `_meta`、`ttlMs` 与 `cacheScope`：等 v2 结果类型和缓存协商稳定后统一加入，当前不向不识别这些字段的客户端扩大响应面。

## 后续迁移门槛

只有同时满足以下条件才启用 2026-07-28 endpoint：SDK v2 发布 GA；至少 Codex、TRAE Work 与 Claude Code 的真实客户端通过互操作；OAuth、工具发现、生图、改图、上传、任务恢复与取消全部完成回归；旧 v1 endpoint 有明确兼容窗口和可回滚开关。源代码能编译不等于协议已经可用。
