# 数据库结构说明

本文档记录本项目运行时 SQLite 数据库、数据表职责和主要字段。以后只要修改 `server/schema.ts` 中的建表、加字段、删表或字段语义，就必须同步更新本文档。

## 维护规则

- `data/app.db` 保存业务数据：用户、会话、消息、图片、素材、灵感空间等。
- `data/config.db` 保存配置数据：后台登录、渠道配置、请求日志、CPA 同步、更新日志等。
- `data/config.toml` 只保留文件级调试开关，不作为数据库结构来源。
- 旧表 `studio_settings` 不再作为运行时配置使用；启动迁移会先把遗留数据并入 `provider_configs`，然后删除该表。
- 旧表 `asset_groups` 已废弃，启动时会删除。

## app.db

### teams

用户团队。

| 字段 | 说明 |
| --- | --- |
| `id` | 团队 ID |
| `name` | 团队名称 |
| `description` | 团队说明 |
| `created_at` / `updated_at` | 创建和更新时间 |

### users

普通用户账号。

| 字段 | 说明 |
| --- | --- |
| `id` | 用户 ID |
| `team_id` | 所属团队 |
| `account` | 登录账号，唯一 |
| `username` | 展示名称，唯一 |
| `email` | 用户邮箱，非空时唯一；自助邮箱注册时同时作为 `account` |
| `phone` | 用户手机号，非空时唯一；自助手机号注册时同时作为 `account` |
| `password_hash` | 登录密码哈希 |
| `avatar_path` / `avatar_mime_type` | 用户头像加密文件路径和 MIME 类型 |
| `appearance_mode` | 用户工作台主题偏好，`system`、`dark`、`light`、`maliang` 或 `chunyu` |
| `disabled` | 是否禁用，`0` 否、`1` 是 |
| `has_config_access` | 是否允许访问后台配置，`0` 否、`1` 是 |
| `email_verified_at` | 邮箱验证时间 |
| `phone_verified_at` | 手机号验证时间 |
| `last_login_at` | 最近登录时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

### user_avatar_history

用户历史头像，保留最近 3 个已被替换的头像；头像文件与当前头像一样加密保存。

| 字段 | 说明 |
| --- | --- |
| `id` | 历史头像 ID |
| `user_id` | 所属用户 ID |
| `path` / `mime_type` | 加密文件路径和 MIME 类型 |
| `created_at` | 头像被替换、归档的时间 |

### user_preferences

用户个性化偏好，按用户单行保存。

| 字段 | 说明 |
| --- | --- |
| `user_id` | 用户 ID，主键 |
| `language` | 用户界面语言偏好：`auto` 自动检测，或 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`、`es-ES`、`fr-FR`、`de-DE`、`pt-BR`、`ru-RU`、`fa-IR` |
| `image_preview_wheel_mode` | 完整图片预览的滚轮行为：`zoom` 缩放图片、`pan` 平移查看超出窗口的区域；新偏好默认 `pan` |
| `image_preview_open_mode` | 完整图片预览的默认打开方式：`contain` 适应窗口、`actual` 按 100% 原始尺寸显示 |
| `edit_suggestions_enabled` | 对话页图片续改建议开关，`0` 关闭、`1` 开启 |
| `edit_suggestion_tone` | 图片续改建议倾向：`default` 默认均衡、`practical` 实用优化、`creative` 创意扩展、`detail` 细节修复 |
| `auto_upload_pasted_assets` | 输入框粘贴图片是否自动保存到素材库，`0` 关闭、`1` 开启；关闭后仅作为本次消息引用素材保存 |
| `image_task_sound_enabled` | 图片任务成功或失败提示音开关，`0` 关闭、`1` 开启；默认开启 |
| `image_task_browser_notification_enabled` | 图片任务成功或失败浏览器系统通知开关，`0` 关闭、`1` 开启；默认关闭，开启时还需浏览器通知权限 |
| `image_task_sound_volume` | 图片任务提示音和试听音量，范围 `0`–`100`；新用户默认 `70`，已有用户保留已保存值 |
| `image_task_success_sound_id` | 图片任务成功时选择的后台提示音 ID；所选音频不可用时运行时回退到第一个已启用音频，没有可用音频时为空 |
| `image_task_failure_sound_id` | 图片任务失败时选择的后台提示音 ID；所选音频不可用时优先回退到第二个已启用音频，没有可用音频时为空 |
| `prompt_optimize_styles_json` | 用户自定义 AI优化风格 JSON，保存主风格、子风格、排序、显示状态和自定义优化指令；为空时使用系统默认风格 |
| `prompt_optimize_custom_instruction` | 用户在输入区 AI优化风格里的自定义补充指令 |
| `updated_at` | 更新时间 |

### app_migrations

应用数据库的一次性迁移记录。当前用于标记已执行过的偏好默认值迁移和灵感风格默认项初始化，避免启动时重复批量更新或重新创建已由管理员删除的默认风格。

| 字段 | 说明 |
| --- | --- |
| `id` | 迁移 ID，主键 |
| `created_at` | 执行时间 |

### user_auth_sessions

前台用户登录会话。

| 字段 | 说明 |
| --- | --- |
| `id` | 会话 Token |
| `user_id` | 用户 ID |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |

### oauth_clients

神笔马良 Remote MCP 的 OAuth 2.0 动态注册客户端。客户端是公开 PKCE 客户端，不保存 Client Secret。

| 字段 | 说明 |
| --- | --- |
| `id` | OAuth `client_id`，随机 UUID |
| `application_type` | 动态注册客户端类型：`native` 的 loopback 回调使用授权页后台衔接，WorkBuddy 官方私有回调使用标准浏览器 303 交给操作系统唤起客户端；`web` 使用标准浏览器 303 重定向且回调必须为 HTTPS；旧记录默认为 `native` |
| `client_name` | 授权确认页和插件管理中展示的客户端名称 |
| `client_uri` | 客户端动态注册时提供的应用主页；未提供时为空 |
| `software_id` / `software_version` | 客户端提供的软件标识和版本；版本未显式提供时可从 User-Agent 推断 |
| `device_name` | 客户端提供的设备名称；Codex、Claude Code、TRAE Work、WorkBuddy 和标准 MCP 安装智能体都会读取本机真实主机名，并通过动态注册字段、固定 MCP 请求头或授权后的 `maliang_report_device` 上报。服务端不再用操作系统类型或客户端名称冒充设备名称 |
| `device_type` | 设备操作系统类型；优先采用动态注册字段、MCP 固定请求头或 `maliang_report_device` 上报的 Windows、macOS、Linux、iOS、Android 等实际类型，首次授权时仍可由浏览器 User-Agent 补充 |
| `user_agent` | 动态注册请求的 User-Agent，用于向用户展示设备和应用来源 |
| `redirect_uris_json` | 精确允许的回调地址 JSON；接受 HTTPS、loopback HTTP，以及仅限 `native` 客户端的 `workbuddy://workbuddy/mcp/{connectorId}/oauth/callback`。WorkBuddy 的 `{connectorId}` 只允许单个安全路径段，并限制为 `custom-mcp:` 或 `connector:` 前缀；Token 交换仍须与授权码记录中的回调地址逐字一致 |
| `grant_types_json` | 注册允许的授权类型；必须包含 `authorization_code`，`refresh_token` 可选。动态注册未提供 `grant_types` 时只按 `authorization_code` 处理；Token 端严格按已保存能力签发和刷新 |
| `response_types_json` | 允许的响应类型，当前为 `code` |
| `token_endpoint_auth_method` | 当前固定为 `none`，配合 PKCE S256 |
| `created_at` / `updated_at` | 创建和更新时间 |

### oauth_grants

用户对某个 MCP OAuth 客户端的授权关系；同一用户和客户端只有一条记录，可撤销后重新授权。

| 字段 | 说明 |
| --- | --- |
| `id` | 授权关系 ID |
| `user_id` / `client_id` | 授权用户和 OAuth 客户端 |
| `scope` | 空格分隔的授权范围，当前支持 `profile:read`、`images:generate` |
| `user_label` | 用户为该连接设置的备注名称；为空时展示客户端原始名称 |
| `last_access_at` | 该授权最近一次成功换取/刷新令牌，或访问 Remote MCP、图片接口的时间；尚未完成客户端连接时为空 |
| `last_access_ip` | 最近一次成功换取/刷新令牌或访问接口时的原始客户端地址；由服务端连接地址或受信代理头解析，可能是内网地址 |
| `last_access_public_ip` | 最近一次访问对应的已确认客户端公网 IP；仅采用公网 TCP 来源地址，或在 `APP_TRUST_PROXY` 开启时采用可信代理头；内网来源不使用马良服务器出口 IP 补全 |
| `last_access_region` | 根据 `last_access_public_ip` 解析的国家、地区和城市摘要 |
| `last_access_geo_at` | 公网 IP 与地区最近一次成功解析时间，用于控制刷新频率 |
| `last_user_agent` | 最近一次成功访问时客户端提交的 User-Agent，用于补充客户端版本等详情 |
| `last_refresh_at` | 最近一次成功使用 Refresh Token 并完成令牌轮换的时间；用于标记客户端刷新能力已经实际验证 |
| `last_refresh_error` / `last_refresh_error_at` | 最近一次可归属到该授权关系的刷新失败摘要和时间；后续刷新成功时清空，不保存原始 Token |
| `credential_version` | 授权凭据代次；每次失效或重新授权递增，使旧 Token 之外的短期签名结果链接也永久失效 |
| `revoked_at` | 撤销时间；为空表示授权有效 |
| `created_at` / `updated_at` | 创建和更新时间 |

相关唯一索引：`oauth_grants_user_client_idx` 保证同一用户和客户端只存在一个授权关系。

“已连接设备”只展示至少成功签发过一次 Access Token 或 Refresh Token 的授权关系。用户允许授权后、客户端尚未换取 Token 时，短期授权关系不会显示；Authorization Code 过期后仍未签发过任何 Token，则在读取设备列表时自动删除该无用授权关系。动态注册后 24 小时内既未发起授权、也未形成授权关系的孤立 `oauth_clients` 会自动清理，避免匿名注册长期堆积；仍在授权流程或已经连接的客户端不会被此清理影响。同一客户端重新授权时，旧 Access Token、Refresh Token 和尚未消费的 Authorization Code 不会自动重新激活；权限范围变化时会额外立即撤销仍有效的旧凭据，不能继续保留旧权限。

设备列表不直接把动态注册的 `client_id` 当作物理设备 ID。服务端在设备已上报真实主机名后，使用“客户端家族 + 规范化系统 + 规范化主机名”计算稳定的逻辑设备 ID；TRAE、TRAE Work 归为 `trae` 家族，各类 Codex 名称归为 `codex` 家族。同一账号、同一客户端家族和同一主机的多个 `oauth_clients` 聚合为一台设备，未知或占位设备仍按独立 `client_id` 展示，避免误合并。逻辑设备 ID 为运行时派生值，不新增数据库列。

“断开”会保留逻辑设备下的 `oauth_grants`、备注和访问历史，撤销该设备全部活动授权关联的 Access Token、Refresh Token，并永久消费尚未兑换的 Authorization Code；按钮随后变为“恢复”。“恢复”只重新启用仍未过期、且 `revoked_at` 与最近一次设备断开时间精确一致的 Access Token，或未消费的 Refresh Token；过期、已消费或因其他原因提前撤销的凭据不会复活。没有可恢复凭据时保持断开并要求客户端重新授权。“移除”会永久删除该逻辑设备下当前用户的全部授权关系及其关联令牌，仅当对应 OAuth 客户端不再被任何用户授权时才清理 `oauth_clients`。

### oauth_authorization_requests

授权确认页的一次性短期请求，绑定当前网站登录用户、客户端、回调地址、PKCE challenge 和 MCP resource。

| 字段 | 说明 |
| --- | --- |
| `id` | 一次性授权请求 ID |
| `user_id` / `client_id` | 发起授权的用户和客户端 |
| `redirect_uri` | 已按客户端注册信息精确校验的回调地址 |
| `scope` / `state` | 请求权限和原样回传的 OAuth state |
| `code_challenge` / `code_challenge_method` | PKCE challenge；方法固定为 `S256` |
| `resource` | 受保护的 Remote MCP 资源地址 |
| `expires_at` | 过期时间，当前请求有效期 10 分钟 |
| `consumed_at` | 用户允许或拒绝后的消费时间；非空时不可再次使用 |
| `created_at` | 创建时间 |

### oauth_authorization_codes

授权确认后签发的 5 分钟一次性 Authorization Code。原始 Code 不入库，只保存 SHA-256 摘要。

| 字段 | 说明 |
| --- | --- |
| `id` | 授权码记录 ID |
| `code_hash` | Authorization Code 的 SHA-256 摘要，唯一 |
| `request_id` / `grant_id` | 来源授权请求和用户授权关系 |
| `user_id` / `client_id` | 所属用户和客户端 |
| `redirect_uri` / `scope` / `resource` | 换取 Token 时必须匹配的回调、权限和资源 |
| `code_challenge` | 换取 Token 时校验的 PKCE S256 challenge |
| `expires_at` / `consumed_at` | 过期时间和单次消费时间 |
| `created_at` | 创建时间 |

### oauth_access_tokens

Remote MCP Bearer Access Token，默认有效期 7 天，可在后台设置为 1～365 天。原始 Token 只返回客户端，数据库仅保存 SHA-256 摘要；设置变化只影响之后新签发或刷新的 Token，不改写已有记录。

| 字段 | 说明 |
| --- | --- |
| `id` | Access Token 记录 ID |
| `token_hash` | Access Token 的 SHA-256 摘要，唯一 |
| `family_id` | Token 轮换家族 ID；Refresh Token 重放时用于整组撤销 |
| `grant_id` / `user_id` / `client_id` | 授权关系、用户和客户端 |
| `scope` / `resource` | Token 权限和限定的 MCP 资源 |
| `expires_at` / `revoked_at` | 过期和撤销时间 |
| `created_at` | 创建时间 |

过期 Access Token 会在 OAuth 清理周期按批次删除；Refresh Token 轮换链中的过期节点会先解除后继节点的 `parent_token_id` 引用再按批次删除，因此长期活跃连接也不会无限保留已过期的祖先节点。`oauth_access_tokens_expiry_idx`、`oauth_refresh_tokens_expiry_idx` 和 `oauth_refresh_tokens_parent_idx` 为清理查询提供索引。

### oauth_refresh_tokens

Remote MCP Refresh Token，默认有效期 90 天，可在后台设置为 30～3650 天，并在每次使用时轮换和重新计算有效期。只有动态注册声明 `refresh_token` 的客户端才会获得 Refresh Token。原始 Token 不入库，重复使用已消费 Token 会撤销整个家族。

| 字段 | 说明 |
| --- | --- |
| `id` | Refresh Token 记录 ID |
| `token_hash` | Refresh Token 的 SHA-256 摘要，唯一 |
| `family_id` / `parent_token_id` | 轮换家族和上一个 Refresh Token |
| `grant_id` / `user_id` / `client_id` | 授权关系、用户和客户端 |
| `scope` / `resource` | Token 权限和限定的 MCP 资源；刷新时只能缩小权限 |
| `expires_at` | 过期时间 |
| `consumed_at` | 被正常轮换消费的时间；重复消费视为重放 |
| `revoked_at` | 主动撤销或重放检测撤销时间 |
| `created_at` | 创建时间 |

### mcp_image_uploads

AI 客户端改图时使用的一次性本地图片上传记录。上传链接默认 15 分钟有效，原始上传 Token 不入库。

| 字段 | 说明 |
| --- | --- |
| `id` | 返回 MCP 客户端的 `uploadId` |
| `user_id` | 所属马良用户，后续改图必须同用户 |
| `upload_token_hash` | 一次性上传 Token 的 SHA-256 摘要，唯一 |
| `asset_id` | 上传成功后创建或复用的用户私有素材 ID |
| `original_name` / `mime_type` / `size` | 上传文件名、MIME 类型和字节数 |
| `status` | 持久化为 `pending` 待上传、`uploading` 处理中、`uploaded` 已完成；查询已过期的 `pending` 记录时返回派生状态 `expired` |
| `expires_at` | 上传链接过期时间 |
| `used_at` | 首次用于 MCP 改图的时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

每个账号最多同时保留 8 个未完成且未过期的上传。创建新上传时按最多 250 条一批清理：已过期超过 24 小时的 `pending` / `uploading` 记录，以及完成或使用超过 30 天的 `uploaded` 记录；关联素材仍按素材库自身生命周期保留。

`mcp_image_uploads_user_expiry_idx` 支持账号未完成上传上限检查，`mcp_image_uploads_status_expiry_updated_idx` 支持分批生命周期清理。

### auth_verification_codes

验证码记录，用于自助注册和找回密码，邮箱和手机号共用。

| 字段 | 说明 |
| --- | --- |
| `id` | 验证码记录 ID |
| `purpose` | 用途：`register` 注册、`password_reset` 找回密码 |
| `target_type` | 目标类型：`email` 邮箱、`phone` 手机号 |
| `target` | 目标邮箱或手机号；邮箱按小写保存，手机号按中国大陆 11 位号码保存 |
| `code_hash` | 验证码哈希 |
| `expires_at` | 过期时间 |
| `cooldown_until` | 再次发送冷却截止时间 |
| `attempts` | 已验证尝试次数 |
| `send_count` | 发送次数 |
| `consumed_at` | 消费时间；为空表示未使用 |
| `created_at` / `updated_at` | 创建和更新时间 |

### search_history

搜索历史，按用户和使用场景去重。

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `user_id` | 用户 ID |
| `scope` | 搜索场景：`chat` 聊天、`cases` 灵感空间、`assets` 素材库、`images` 我的图片 |
| `keyword` | 原始关键词 |
| `normalized_keyword` | 归一化关键词 |
| `searched_at` / `created_at` | 搜索和创建时间 |

### starter_daily_copies

对话空白页每日互动文案缓存，全站每天一套。

| 字段 | 说明 |
| --- | --- |
| `date` | 上海时区日期，主键，格式 `YYYY-MM-DD` |
| `copies_json` | 当日中文候选文案 JSON 数组 |
| `copies_en_json` | 当日英文候选文案 JSON 数组，非中文界面优先读取 |
| `source` | 文案来源，当前为 `ai` |
| `provider_name` / `model` | 生成中文文案使用的供应商名称和模型；英文翻译可能使用独立场景分配，以模型请求日志为准 |
| `status` | 生成状态：`success` 成功、`failed` 失败 |
| `error` | 失败信息 |
| `generated_at` | 生成时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

### sessions

聊天会话。

| 字段 | 说明 |
| --- | --- |
| `id` | 会话 ID |
| `user_id` | 用户 ID |
| `client_request_id` | 创建新会话时的客户端请求标识；同一用户内非空值唯一，用于避免重复创建和关联快速取消请求 |
| `title` | 会话标题 |
| `title_status` | 标题状态：`pending` 后台生成中，`ready` 已生成或已使用截取兜底，`manual` 用户手动修改 |
| `pinned_at` | 置顶时间；为空表示未置顶 |
| `archived_at` | 归档时间 |
| `deleted_at` | 删除时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

相关索引：`sessions_user_client_request_unique_idx` 保证同一用户内非空客户端请求标识唯一；其余会话索引支撑归档、可见状态、置顶和更新时间排序。

### messages

聊天消息。

| 字段 | 说明 |
| --- | --- |
| `id` | 消息 ID |
| `session_id` | 会话 ID |
| `user_id` | 用户 ID |
| `role` | 消息角色：`user`、`assistant` |
| `content` | 文本内容 |
| `image_id` | 关联图片 |
| `metadata` | JSON 元数据 |
| `created_at` | 创建时间 |

相关索引：`messages_session_user_time_idx` 支撑会话消息按创建时间读取；`messages_session_user_role_idx` 支撑用户消息元数据读取。

### session_share_links

会话共享链接。创建分享时会按分享范围、同一会话的消息 ID 和顺序查找完全一致的已有快照，命中后复用最早创建的原链接；只有分享范围或消息快照发生变化时才新增记录并保存当时的标题。同一会话可保留多条不同快照，公开地址使用随机 UUID `public_token`，删除记录即立即撤销。旧版 HMAC 长链接仍可通过记录 ID校验访问。

| 字段 | 说明 |
| --- | --- |
| `id` | 分享记录 ID |
| `public_token` | 对外分享 UUID，仅作为不可猜测的链接凭据使用 |
| `user_id` | 分享创建者 ID |
| `session_id` | 原会话 ID |
| `title` | 创建分享时的会话标题快照 |
| `includes_branches` | 是否包含会话全部分支，`0` 仅当前分支、`1` 全部分支 |
| `created_at` | 分享时间 |

相关索引：`session_share_links_public_token_idx` 保证公开 UUID 唯一；`session_share_links_user_time_idx` 支撑数据管理按用户、创建时间倒序分页；`session_share_links_session_idx` 支撑删除会话时显式撤销关联链接。

### session_share_messages

共享链接包含的消息集合。前端按所选范围提交当前分支或全部分支的已保存消息 ID，后端按数据库时间顺序复核后，以 `sort_order` 冻结这次分享的消息范围；后续新增消息不会进入旧链接。

| 字段 | 说明 |
| --- | --- |
| `share_id` | 分享记录 ID，与 `message_id` 组成主键 |
| `message_id` | 被分享的原消息 ID |
| `sort_order` | 分享内消息顺序，同一分享内唯一 |

匿名读取只通过带作用域的签名 token 访问本表已选消息，并为消息、分支和媒体重新生成分享内局部标识；不会复用私有文件权限或返回原始消息 `metadata`。

### image_jobs

图片生成或编辑任务。

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `user_id` | 用户 ID |
| `session_id` | 会话 ID |
| `type` | 任务类型：`generation` 生成、`edit` 编辑 |
| `status` | 任务状态：`running` 运行中、`succeeded` 成功、`failed` 失败、`cancelled` 已取消 |
| `prompt` | 用户提示词 |
| `source_image_ids` | 来源图片、素材、灵感引用 JSON |
| `provider_id` | 用户选择或实际使用的渠道 ID |
| `client_request_id` | 客户端请求标识；用于把生成请求、任务与取消意图关联起来 |
| `error` | 失败信息 |
| `result_image_id` | 首张结果图片 ID |
| `request_json` | 请求摘要，图片 data URL 会脱敏 |
| `response_json` | 响应摘要，图片 base64 会替换为占位文本 |
| `auto_retry_count` | 任务实际发生的自动重试次数；第一次成功为 `0` |
| `manual_retry_count` | 用户在失败卡片上手动点击重试的次数 |
| `recovery_count` | 服务重启后自动接管任务的次数；用于阻止连续重启造成重复调用 |
| `max_auto_retries` | 创建或最近一次执行任务时使用的后台自动重试次数快照 |
| `succeeded_on_retry` | 最终是否由自动重试或手动重试后成功，`0` 否、`1` 是 |
| `created_at` / `updated_at` | 创建和更新时间 |

相关索引：`image_jobs_session_user_status_time_idx` 支撑对话页和侧边栏按会话、用户、状态轮询任务；`image_jobs_user_client_request_idx` 支撑按用户和客户端请求标识查找待取消任务；`image_jobs_user_updated_idx` 支撑事件流断线后按用户和更新时间补发任务结果。

### image_job_cancel_requests

生成或编辑任务的取消意图。当前端在任务记录创建前发起取消时，该记录会阻止同一客户端请求继续创建任务；过期记录由服务按 24 小时窗口清理，删除账户时会在同一数据库事务中同步删除。

| 字段 | 说明 |
| --- | --- |
| `user_id` | 用户 ID，与 `client_request_id` 组成主键 |
| `client_request_id` | 客户端请求标识 |
| `created_at` | 取消意图创建时间 |

相关索引：`image_job_cancel_requests_created_idx` 支撑按创建时间清理过期取消意图。

### images

生成和编辑后的图片记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 图片 ID |
| `user_id` | 用户 ID |
| `session_id` | 会话 ID |
| `job_id` | 来源任务 |
| `path` | 加密文件相对路径 |
| `prompt` | 生成或编辑提示词 |
| `suggested_case_title` | 图片生成成功后自动生成的灵感标题建议，用于加入灵感空间时预填 |
| `suggested_case_category_ids_json` | 图片生成成功后自动判断的灵感风格 ID JSON 数组，用于加入灵感空间时预填 |
| `suggested_asset_category_ids_json` | 图片生成成功后或打开加入素材库弹窗时自动判断的素材标签 ID JSON 数组，用于加入素材库时预填；为空时下次打开会重新生成 |
| `kind` | 图片类型：`generation` 生成、`edit` 编辑 |
| `size` / `quality` | 请求尺寸和质量；`size` 默认 `auto`，按 GPT Image 2 文档使用 `WIDTHxHEIGHT`，常用 `1024x1024`、`1536x2048`、`1152x2048`、`2048x1536`、`2048x1152`；`quality` 默认可选 `low`、`medium`、`high`，具体也可由渠道配置扩展 |
| `provider_id` | 实际渠道 ID |
| `mime_type` | 图片 MIME 类型 |
| `parent_image_id` | 编辑来源图片 |
| `provider_file_id` / `provider_gen_id` | 上游图片上下文字段 |
| `provider_conversation_id` / `provider_parent_message_id` | 上游会话上下文字段 |
| `provider_source_account_id` | 上游账号来源 |
| `image_width` / `image_height` / `image_file_size` | 图片尺寸和文件大小 |
| `generated_attempt_no` | 这张图片来自本轮第几次尝试；第一次请求为 `1`，自动重试成功通常大于 `1` |
| `generated_by_retry` | 这张图片是否由重试生成；自动重试或手动重试成功时为 `1` |
| `created_at` | 创建时间 |

相关索引：`images_user_created_id_idx` 支撑“我的图片”按用户、创建时间和稳定 ID 游标分页；`images_session_created_id_idx` 支撑按会话进入图片编辑时的相邻图片加载。

### image_favorites

我的图片收藏关系。

| 字段 | 说明 |
| --- | --- |
| `id` | 收藏 ID |
| `user_id` | 收藏用户 |
| `image_id` | 图片 ID |
| `created_at` | 收藏时间 |

### image_edit_suggestions

图片续改建议缓存。图片生成或编辑完成后会在后台预生成；用户请求时会按需补齐或按新的建议倾向刷新。

| 字段 | 说明 |
| --- | --- |
| `image_id` | 图片 ID，主键 |
| `user_id` | 图片所属用户 |
| `suggestions_json` | 固定 3 条续改建议 JSON 数组，每条包含按钮文案和编辑提示词 |
| `preference_key` | 生成该缓存时使用的建议倾向；用户切换倾向后会按新值重新生成 |
| `created_at` / `updated_at` | 创建和更新时间 |

### image_asset_references

图片任务中使用的素材快照。

| 字段 | 说明 |
| --- | --- |
| `id` | 引用 ID |
| `image_id` | 结果图片 ID |
| `user_id` | 用户 ID |
| `source_type` | 来源类型：`image` 图片、`asset` 素材、`case` 灵感、`message-source-reference` 消息引用快照；空字符串表示旧数据未记录来源类型 |
| `source_id` | 来源 ID |
| `source_asset_id` | 原素材 ID |
| `source_case_item_id` | 来源灵感 ID |
| `source_name` | 来源名称 |
| `path` / `mime_type` / `size` | 快照文件信息 |
| `image_width` / `image_height` | 快照尺寸 |
| `sort_order` | 排序 |
| `created_at` | 创建时间 |

### message_source_references

用户消息里的素材或灵感引用快照。

| 字段 | 说明 |
| --- | --- |
| `id` | 引用 ID |
| `message_id` | 消息 ID |
| `job_id` | 图片任务 ID |
| `user_id` | 用户 ID |
| `source_type` | 来源类型：`image` 图片、`asset` 素材、`case` 灵感 |
| `source_id` / `source_case_item_id` | 来源记录 |
| `source_name` | 来源名称 |
| `path` / `mime_type` / `size` | 快照文件信息 |
| `image_width` / `image_height` | 快照尺寸 |
| `sort_order` | 排序 |
| `created_at` | 创建时间 |

### image_derivatives

图片、素材、引用图和品牌图的派生缩略图或预览文件。

| 字段 | 说明 |
| --- | --- |
| `source_type` | 来源类型：`image` 图片、`asset` 素材、`image-reference` 图片引用快照、`message-source-reference` 消息引用快照、`branding` 品牌资源 |
| `source_id` | 来源 ID |
| `variant` | 派生规格：`thumb` 缩略图、`preview` 预览图 |
| `path` / `mime_type` / `size` | 派生文件信息 |
| `image_width` / `image_height` | 派生图尺寸 |
| `created_at` / `updated_at` | 创建和更新时间 |

### assets

素材库图片。

| 字段 | 说明 |
| --- | --- |
| `id` | 素材 ID |
| `user_id` | 上传用户 |
| `space` | 素材空间：`private` 私有、`shared` 共享 |
| `shared` | 是否已审核通过并对共享区可见，`0` 否、`1` 是；`space='shared'` 的旧共享素材仍视为已公开 |
| `share_status` | 共享审核状态：`none` 未申请、`pending` 待审核、`approved` 已通过、`rejected` 未通过 |
| `share_requested_at` | 用户提交共享审核时间 |
| `share_reviewed_at` / `share_reviewed_by` | 后台审核时间和审核来源 |
| `share_reject_reason` | 共享审核拒绝原因 |
| `name` | 素材名称 |
| `path` / `mime_type` / `size` | 文件信息 |
| `content_hash` | 原始图片内容 SHA-256 哈希，用于上传时识别重复素材；旧素材会在启动迁移时尽量补齐 |
| `image_width` / `image_height` | 图片尺寸 |
| `has_transparency` | 是否包含透明像素：`1` 透明、`0` 不透明、`NULL` 尚未识别或识别失败；识别成功后持久化复用 |
| `created_at` | 创建时间 |

相关索引：`assets_user_created_id_idx` 支撑素材库按用户、创建时间和稳定 ID 游标分页；`assets_share_created_id_idx` 支撑共享素材筛选和按时间加载。

### case_categories

灵感空间和素材标签分类。

普通用户仍可从灵感空间或素材库新增全局分类；后台“分类管理”可以统一改名、排序、合并和删除。隐藏的 `casecat_uncategorized` 是灵感未分类占位项，不进入后台列表且不可修改。

| 字段 | 说明 |
| --- | --- |
| `id` | 分类 ID |
| `type` | 分类类型：`case` 灵感空间、`asset` 素材库 |
| `name` | 分类名称 |
| `slug` | 唯一标识 |
| `sort_order` | 排序 |

后台删除分类时可选择直接删除或迁移后删除。直接删除灵感风格时，灵感内容保留并关联到内部无风格占位项，前台表现为未选择任何风格且仍可在“全部”中查看；直接删除素材标签时，素材保留且仅解除对应的 `asset_categories` 关系；两种类型都会移除图片中对应的自动推荐分类 ID。迁移后删除会在同一事务内迁移 `case_items` 或 `asset_categories` 关联，去重同一灵感/素材上的目标分类，替换图片中的自动推荐分类 ID，并在完成后删除源分类。分类改名保持 `id` 和 `slug` 不变。

### case_items

灵感空间条目。

| 字段 | 说明 |
| --- | --- |
| `id` | 条目 ID |
| `group_id` | 稳定灵感组 ID；同一个灵感属于多个风格时，多条 `case_items` 共用同一个组 |
| `category_id` | 主分类 |
| `user_id` | 创建用户 |
| `image_id` | 封面来源图片 |
| `asset_id` | 封面来源素材 |
| `include_references` | 是否携带引用素材，`0` 否、`1` 是 |
| `review_status` | 灵感审核状态：`pending` 待审核、`approved` 已公开、`rejected` 未通过 |
| `review_requested_at` | 提交审核时间 |
| `reviewed_at` / `reviewed_by` | 后台审核时间和审核来源 |
| `reject_reason` | 灵感审核拒绝原因 |
| `title` | 标题 |
| `prompt` | 灵感提示词 |
| `image_url` | 封面展示图片地址 |
| `created_at` | 创建时间 |

相关索引：`case_items_review_created_id_idx`、`case_items_approved_created_id_idx`、`case_items_user_created_id_idx`、`case_items_category_created_id_idx` 支撑灵感空间审核、我的、分类和时间游标加载；`case_items_group_idx`、`case_items_group_created_id_idx` 支撑多图灵感按组聚合和翻页。

### case_group_images

灵感组内图片。单图灵感也会有一条组内图片记录，多图灵感用多条记录保存排序和封面。

| 字段 | 说明 |
| --- | --- |
| `id` | 组内图片记录 ID |
| `group_id` | 灵感组 ID，对应 `case_items.group_id` |
| `user_id` | 创建用户 |
| `image_id` | 来源图片 |
| `asset_id` | 来源素材 |
| `image_url` | 展示图片地址 |
| `sort_order` | 组内排序 |
| `is_cover` | 是否封面图，`0` 否、`1` 是 |
| `created_at` | 创建时间 |

### case_asset_suggestion_cache

从灵感图片加入素材库时的自动标签推荐缓存。缓存按稳定灵感 ID 保存，并把来源图片、提示词和当前素材标签列表纳入指纹；来源或候选标签变化后会自动重新生成。只有非空推荐会保存；空推荐不缓存，用户下次打开时可结合新增标签重新判断。

| 字段 | 说明 |
| --- | --- |
| `case_item_id` | 稳定灵感条目或灵感组 ID，主键 |
| `source_fingerprint` | 来源类型、来源 ID、提示词和当前素材标签列表的摘要 |
| `category_ids_json` | 推荐的素材标签 ID JSON 数组，可为空数组 |
| `updated_at` | 最近生成时间 |

### case_prompt_usage_events

灵感提示词被使用的记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `case_item_id` | 灵感条目 |
| `source_user_id` / `source_type` / `source_id` | 来源身份；`source_type` 为 `image` 图片、`asset` 素材、`url` 外部地址、`case_group` 多图灵感组 |
| `original_prompt_snapshot` | 原提示词快照 |
| `submitted_prompt` | 实际提交提示词 |
| `used_by_user_id` | 使用者 |
| `job_id` | 图片任务 ID |
| `request_type` | 请求类型：`generation` 生成、`edit` 编辑 |
| `created_at` | 创建时间 |

### case_favorites

灵感空间收藏关系。

| 字段 | 说明 |
| --- | --- |
| `id` | 收藏 ID |
| `user_id` | 收藏用户 |
| `source_user_id` / `source_type` / `source_id` | 被收藏的来源身份；`source_type` 为 `image` 图片、`asset` 素材、`url` 外部地址、`case_group` 多图灵感组 |
| `created_at` | 收藏时间 |

### prompt_reference_links

提示词站点或参考链接。

| 字段 | 说明 |
| --- | --- |
| `id` | 链接 ID |
| `title` | 用户维护标题 |
| `url` | 链接地址 |
| `thumbnail_url` | 手动缩略图 |
| `metadata_title` / `metadata_image_url` / `metadata_icon_url` | 抓取元数据 |
| `metadata_fetched_at` | 元数据抓取时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

首次启动且表内没有链接时，系统会写入“即梦AI”和“Midjourney Explore”。初始化状态会单独保存；用户删除默认链接后不会再次补回。

### prompt_reference_link_state

灵感链接默认项的一次性初始化状态。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `defaults_initialized_at` | 默认链接已完成初始化或已确认无需初始化的时间；存在该记录后不再自动补回默认链接 |

### prompt_color_schemes

对话页“色系选择”库。系统默认色系和用户自建色系都按用户保存为独立行，设置页个性化中维护；对话页可多选色系，选择时只把结构化色彩要求注入当前提示词，不主动触发 AI 优化。

| 字段 | 说明 |
| --- | --- |
| `id` | 色系 ID |
| `user_id` | 所属用户 |
| `builtin_key` | 系统默认色系键；用户自建为空 |
| `name` / `description` / `category` | 色系名称、适用场景和分类 |
| `colors_json` | 单色色卡 JSON，包含名称、用途和 HEX |
| `gradients_json` | 渐变组合 JSON，包含名称、用途和多个 HEX |
| `prompt` | 注入提示词时追加的补充要求 |
| `visible` | 是否在对话页选择器中显示，`0` 隐藏、`1` 显示 |
| `sort_order` | 同分类排序 |
| `is_builtin` | 是否系统默认色系，`0` 自建、`1` 默认 |
| `created_at` / `updated_at` | 创建和更新时间 |

默认色系由接口按用户补齐；“恢复默认”只重置 `is_builtin = 1` 的行，用户自建色系不受影响。

### prompt_templates

创作提示词表单模板。

| 字段 | 说明 |
| --- | --- |
| `id` | 模板 ID |
| `user_id` | 创建用户 |
| `visibility` | 可见性：`private` 私有、`shared` 共享 |
| `name` / `description` / `category` | 模板名称、说明和分类 |
| `icon` | 模板图标 |
| `optimize_style` | 该模板默认 AI优化风格。支持主风格：`standard` 标准、`realistic` 写实、`cinematic` 电影、`anime` 动漫、`artistic` 艺术、`commercial` 商业、`series` 组图、`composition` 构图、`detailed` 细节、`creative` 创意；也支持 `主风格:子风格`，例如 `cinematic:cyberpunk`、`anime:ghibli`、`series:logo-design`、`composition:rule-of-thirds` |
| `components_json` | 表单组件 JSON；组件类型支持 `text`、`textarea`、`select`、`image`、`color`、`section`，其中 `color` 可保存 `colorOptions`、`gradientOptions`、`allowCustomColor` |
| `rules_json` | 基础提示词拼接规则 JSON |
| `output_json` | 输出配置 JSON |
| `created_at` / `updated_at` | 创建和更新时间 |

内置默认模板也使用同一张表保存。默认模板的内容版本通过 `prompt_template_default_seeds` 控制；当默认内容种子升级时，历史默认模板会按新版预设重置 `description`、`icon`、`optimize_style`、`components_json`、`rules_json`、`output_json`，但保留模板 `id`、创建时间、共享状态和历史结果引用。新版默认模板可内置 `color` 色彩选择组件，无需数据库迁移。

### prompt_template_form_drafts

创作提示词表单填写草稿，按用户和模板各保存一份，避免共享表单被不同用户互相覆盖。前端自动保存时只写入该表；旧版本浏览器 `localStorage` 中的 `prompt-template-form-draft:*` 草稿会在应用启动时清理，不再作为读取来源。

| 字段 | 说明 |
| --- | --- |
| `template_id` | 表单模板 ID |
| `user_id` | 填写用户 ID |
| `form_values_json` | 当前填写的表单值 JSON，包含文本、下拉选项、色彩选择和素材字段引用信息 |
| `created_at` / `updated_at` | 创建和更新时间 |

### prompt_template_base_translations

基础提示词英文翻译缓存，按模板和用户保留最近一次翻译结果。

| 字段 | 说明 |
| --- | --- |
| `template_id` | 模板 ID |
| `user_id` | 用户 ID |
| `signature` | 表单输入签名，用于判断缓存是否仍匹配 |
| `base_prompt` / `base_prompt_en` | 基础正向提示词原文和英文译文 |
| `negative_prompt` / `negative_prompt_en` | 基础反向提示词原文和英文译文 |
| `provider_name` / `model` | 执行翻译的模型配置名称和模型 |
| `updated_at` | 更新时间 |

### asset_categories

素材和分类的多对多关系。

| 字段 | 说明 |
| --- | --- |
| `asset_id` | 素材 ID |
| `category_id` | 分类 ID |
| `created_at` | 创建时间 |

相关索引：`asset_categories_category_asset_idx` 支撑素材按标签筛选和数量统计。

## config.db

### config_admin

后台配置入口账号。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定 ID |
| `password_hash` | 后台密码哈希 |
| `created_at` / `updated_at` | 创建和更新时间 |

### config_auth_sessions

后台配置登录会话。

| 字段 | 说明 |
| --- | --- |
| `id` | 会话 Token |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |

### session_share_signing_settings

旧版会话共享长 token 的持久化签名配置，启动时首次生成。新链接使用 `session_share_links.public_token` 中的 UUID；密钥继续用于兼容已经发出的 HMAC 长链接，且不会进入 API响应。

| 字段 | 说明 |
| --- | --- |
| `id` | 配置 ID，固定为 `default` |
| `signing_secret` | 32 字节随机密钥的 Base64URL 文本 |
| `created_at` / `updated_at` | 创建和更新时间 |

### external_mcp_signing_settings

神笔马良 Remote MCP 图片结果原图链接的签名配置。签名链接绑定指定用户、图片和 OAuth 授权关系，默认 1 小时失效；连接失效或移除后立即不可再下载。签名密钥不会进入 MCP 工具结果、前端接口或日志。

| 字段 | 说明 |
| --- | --- |
| `id` | 配置 ID，固定为 `default` |
| `signing_secret` | 32 字节随机密钥的 Base64URL 文本 |
| `created_at` / `updated_at` | 创建和更新时间 |

### image_task_sounds

后台维护的全局图片任务提示音目录。仓库和发行包不携带音频；管理员上传的文件以原始音频格式保存在 Git 忽略的 `data/files/image-task-sounds/`，只能通过登录鉴权接口访问，不进入 `public` 或 `dist`。升级时会把早期版本已加密的提示音原地转换为普通音频文件，成功转换后删除加密源文件，并清理 `data/files/secure/image-task-sounds/` 下没有数据库引用的 `.gaud` 残留；迁移失败但仍由数据库引用的旧加密文件会继续进入数据备份，只有无引用残留会被排除。若检测到旧版 `public/sounds/image-task/maliang-*.mp3`，会在文件安全落盘后保留原 ID 写入本表，再把旧文件移入 `data/legacy-sound-backup/`。全新安装没有旧文件时保持空表。

| 字段 | 说明 |
| --- | --- |
| `id` | 提示音 ID；旧音频保留原 `maliang-*` ID，新上传音频使用系统生成 ID |
| `name` | 前台和后台显示名称，后台改名不会改变 ID |
| `path` | `data` 下的普通音频文件相对路径，格式为 `files/image-task-sounds/*.{mp3,wav,ogg}` |
| `original_file_name` | 上传或迁移前的原始文件名，仅用于后台展示 |
| `mime_type` | 服务端按文件头识别的 `audio/mpeg`、`audio/wav` 或 `audio/ogg` |
| `size` | 原始音频字节数，单文件最大 5MB |
| `sha256` | 原始音频 SHA-256，用于重复上传检测和文件响应 ETag |
| `enabled` | 是否进入前台可选目录，`0` 停用、`1` 启用 |
| `created_at` / `updated_at` | 创建和更新时间 |

相关索引：`image_task_sounds_sha256_idx` 防止相同音频重复入库；`image_task_sounds_enabled_time_idx` 支撑前台按启用状态和创建顺序加载。

### branding_assets

全站品牌图片资源。系统默认资源保留为 `builtin`，指向内置静态资源 URL，运行时优先从 `dist/` 读取并兜底到 `public/`；后台上传资源为 `uploaded`，文件保存到本地加密文件目录。

| 字段 | 说明 |
| --- | --- |
| `id` | 品牌资源 ID |
| `type` | 资源类型：`logo` Logo、`favicon` 浏览器图标、`login_title` 登录标题图、`login_background_light` 浅色登录背景、`login_background_dark` 暗色登录背景 |
| `source` | 来源：`builtin` 系统默认、`uploaded` 后台上传 |
| `name` | 后台展示名称 |
| `path` | 上传资源的加密文件相对路径；系统默认资源为空 |
| `url` | 系统默认资源的静态 URL；上传资源为空，运行时通过 `/api/files/branding/:id` 读取 |
| `mime_type` / `size` | MIME 类型和文件大小 |
| `image_width` / `image_height` | 图片尺寸；系统默认资源可为 `0` |
| `enabled` | 是否可用，`0` 否、`1` 是 |
| `sort_order` | 后台列表和默认背景池排序 |
| `created_at` / `updated_at` | 创建和更新时间 |

### branding_settings

全站品牌展示配置。未配置时自动使用当前默认站点名、默认 Logo、默认登录标题图和 `public/login` 下的现有背景图。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `site_name` | 站点名称，默认 `神笔马良` |
| `active_logo_asset_id` | 当前工作台和配置中心 Logo 资源 |
| `active_favicon_asset_id` | 当前浏览器图标资源 |
| `active_login_title_light_asset_id` | 浅色登录页标题图资源 |
| `active_login_title_dark_asset_id` | 暗色登录页标题图资源 |
| `login_background_light_ids_json` | 浅色登录背景轮播资源 ID JSON 数组；为空或失效时回退默认背景 |
| `login_background_dark_ids_json` | 暗色登录背景轮播资源 ID JSON 数组；为空或失效时回退默认背景 |
| `updated_at` | 更新时间 |

### site_settings

全站公开访问地址配置，固定使用 `default` 单行。该地址用于插件安装、Remote MCP/OAuth 元数据和会话分享绝对链接；保存后运行时立即读取，无需重启。地址优先级为 `APP_PUBLIC_URL`、兼容环境变量 `MALIANG_PUBLIC_BASE_URL`、本表 `public_base_url`、当前请求自动识别。`APP_TRUST_PROXY` 仍是环境变量安全配置，不写入数据库。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `public_base_url` | 后台配置的 HTTP(S) origin；留空表示自动识别。公网地址必须使用 HTTPS，本机或私有局域网地址可使用 HTTP；不允许路径、查询参数或锚点 |
| `updated_at` | 更新时间 |

### external_mcp_settings

Remote MCP OAuth 令牌有效期配置，固定使用 `default` 单行。保存后立即用于新签发和刷新的令牌，无需重启；已签发令牌的现有到期时间保持不变。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `access_token_ttl_days` | Access Token 有效期天数；默认 7，允许 1～365；范围由服务端校验，存储层不固定上限，便于后续调整 |
| `refresh_token_ttl_days` | Refresh Token 滚动有效期天数；默认 90，允许 30～3650；范围由服务端校验，存储层不固定上限，便于后续调整 |
| `updated_at` | 更新时间 |

### global_switch_settings

系统级布尔总开关的唯一运行时来源。迁移时会把旧表里的总开关值写入对应 `type`，补齐默认值后删除旧 `registration_settings` 表。

| 字段 | 说明 |
| --- | --- |
| `type` | 开关类型，主键 |
| `enabled` | 是否开启，`0` 否、`1` 是 |
| `updated_at` | 更新时间 |

当前 `type`：

| 类型 | 默认值 | 说明 |
| --- | --- | --- |
| `self_registration` | 关闭 | 自助注册；优先迁移旧 `registration_settings.enabled`，关闭后 C 端注册验证码和注册提交接口会被后端拦截 |
| `asset_review` | 开启 | 素材共享审核；关闭后新共享素材直接公开 |
| `case_review` | 开启 | 灵感空间审核；关闭后新提交灵感直接公开 |
| `starter_copy_generation` | 开启 | 每日灵感文案生成；迁移 `starter_copy_settings.enabled` |
| `prompt_safety_review` | 关闭 | 文本安全审核；迁移 `safety_review_settings.enabled` |
| `smtp_service` | 关闭 | SMTP 邮件服务；迁移 `smtp_settings.enabled` |
| `sms_service` | 关闭 | 短信服务；迁移 `sms_settings.enabled` |
| `proxy_service` | 关闭 | 全局代理；迁移 `proxy_settings.enabled` |
| `cpa_sync` | 关闭 | CPA 账号同步；迁移 `cpa_accounts.enabled` |
| `github_entry` | 开启 | 用户设置“关于”中的 GitHub 仓库入口；关闭后隐藏入口并改用更新日志图标 |
| `ai_client_install_entry` | 开启 | 新对话空白页中的 AI 客户端安装推荐入口；关闭不影响 `/mcp`、`/plugin` 直达安装页 |
| `debug_image_edit_mask` | 关闭 | 图片编辑 mask 调试；迁移 `debug_settings.image_edit_mask` |

### smtp_settings

邮箱验证码 SMTP 发送配置。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定 ID |
| `enabled` | 旧兼容字段；运行时总开关来自 `global_switch_settings.smtp_service`，保存接口会同步写入 |
| `use_proxy` | 是否使用代理配置发送邮件，`0` 否、`1` 是 |
| `host` | SMTP 服务器地址 |
| `port` | SMTP 端口 |
| `secure` | 是否使用 SSL/TLS，`0` 否、`1` 是 |
| `username` | SMTP 账号 |
| `password_secret` | SMTP 密码或授权码 |
| `from_name` | 发件人名称 |
| `from_email` | 发件邮箱 |
| `test_recipient_email` | 测试邮件收件邮箱，后台发送测试邮件时默认使用 |
| `updated_at` | 更新时间 |

### sms_settings

手机号验证码短信发送配置。当前实现腾讯云短信。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定 ID |
| `enabled` | 旧兼容字段；运行时总开关来自 `global_switch_settings.sms_service`，保存接口会同步写入 |
| `provider` | 短信供应商，当前为 `tencent` |
| `secret_id` | 腾讯云访问密钥 SecretId |
| `secret_key_secret` | 腾讯云访问密钥 SecretKey |
| `region` | 腾讯云地域，默认 `ap-guangzhou` |
| `sms_sdk_app_id` | 腾讯云短信应用 ID |
| `sign_name` | 审核通过的短信签名名称 |
| `register_template_id` | 注册验证码短信模板 ID |
| `password_reset_template_id` | 找回密码验证码短信模板 ID；为空时复用注册模板 |
| `template_param_order` | 模板变量顺序，逗号分隔；`code` 表示验证码，`minutes` 表示 10 分钟 |
| `test_phone` | 后台测试短信收件手机号 |
| `updated_at` | 更新时间 |

### provider_configs

图片渠道配置，覆盖 CPA、ChatGPT Web 和 API 直连。

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 渠道 ID 和名称 |
| `type` | 兼容旧配置的渠道类型，常用 `cpa`、`chatgpt_web`、`api`；运行时主要以 `channel` 为准 |
| `channel` | 渠道类型：`cpa`、`chatgpt_web`、`api`；旧值 `studio`、`official` 会迁移为 `chatgpt_web`，`custom` 会迁移为 `api` |
| `enabled` | 是否启用，`0` 否、`1` 是 |
| `base_url` | 渠道根地址 |
| `api_key_env` / `api_key_value` | API Key 来源 |
| `route_mode` | 路由模式：`images_api`、`responses`、`auto`；首次初始化和新建 CPA 渠道时默认为 `auto` |
| `generation_path` / `edit_path` / `responses_path` | 上游接口路径 |
| `model` / `responses_model` | 图片模型和 Responses 主模型 |
| `sizes` / `qualities` | 可选尺寸和质量 JSON |
| `default_size` / `default_quality` | 默认尺寸和质量 |
| `response_image_path` | 显式图片字段路径 |
| `proxy_enabled` | 渠道自身是否允许代理，`0` 否、`1` 是；实际请求还需要全局代理启用，并且 `proxy_settings.apply_*` 允许该渠道类型 |
| `quota_mode` | ChatGPT Web 额度策略：`codex_first`、`official_first`、`codex_only`、`official_only` |
| `fallback_to_conversation` | 旧官网回退开关，`0` 否、`1` 是 |
| `web_account_id` / `web_account_ids` / `web_account_mode` | 官网账号选择；`web_account_mode` 为 `priority` 优先级、`round_robin` 轮询、`random` 随机 |
| `web_cookies` | 官网 Cookie |
| `created_at` / `updated_at` | 创建和更新时间 |

### image_generation_settings

图片整体模式和请求策略。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `mode` | 图片模式：`auto`、`cpa`、`chatgpt_web`、`api`；旧值 `studio`、`official`、`studio_legacy`、`studio_responses`、`responses` 会迁移为 `chatgpt_web`，`custom` 会迁移为 `api` |
| `result_retry_count` | 图片接口调用或结果保存失败后的自动重试次数；默认值为 `1`，`null` 表示不自动重试，范围 `0` 到 `10` |
| `updated_at` | 更新时间 |

### prompt_optimizer_providers

语言模型供应商配置，供提示词优化、翻译、命名、分类、每日文案和安全审核等文本模型场景复用，独立于图片渠道。

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 模型配置 ID 和名称 |
| `enabled` | 是否启用，`0` 否、`1` 是 |
| `base_url` / `endpoint_path` | Chat Completions 兼容接口地址 |
| `api_key_env` / `api_key_value` | API Key 来源 |
| `model` | 供应商默认语言模型；用于配置测试，以及没有单独场景分配时的运行时默认值 |
| `models_json` | 从供应商 `/models` 接口获取并缓存的可选模型列表，保存后配置页可直接展示 |
| `availability_status` | 供应商可用状态：`unknown` 未测试、`normal` 正常、`abnormal` 异常 |
| `availability_error` | 最近一次获取模型或测试供应商失败时的错误信息 |
| `availability_checked_at` | 最近一次获取模型或测试供应商的检查时间 |
| `stream_enabled` | 是否用 SSE 流式读取并返回前端，`0` 否、`1` 是 |
| `thinking_enabled` | DeepSeek 思考模式开关，`0` 关闭、`1` 开启，默认开启；每日文案生成和翻译遵循该开关，开启时请求超时为 300 秒，关闭时为 60 秒 |
| `temperature` | 采样温度；为空时不向上游传该参数，使用模型默认值 |
| `max_tokens` | 最大输出 Token，`0` 表示不限制、不向上游传 `max_tokens` |
| `retry_count` | 文本模型请求遇到网络错误、`429` 或 `5xx` 等临时失败时的重试次数，默认 `2`，范围 `0` 到 `10` |
| `sort_order` | 排序；尚未保存全局默认或全局默认失效时，最靠前的启用配置及其默认模型作为兼容回退 |
| `created_at` / `updated_at` | 创建和更新时间 |

### language_model_assignments

语言模型全局默认和场景分配。`global.default` 保存管理员在按供应商分组的模型列表中选择的全局默认；具体场景没有对应记录时跟随该默认。全局默认尚未保存或配置失效时，兼容回退到排序最靠前的启用供应商及其默认模型；场景分配失效时回退到解析后的全局默认，同时保留原记录供后台重新选择。

| 字段 | 说明 |
| --- | --- |
| `usage_key` | 主键；`global.default` 表示全局默认，其余场景为 `prompt.optimize`、`template.optimize`、`template.translate`、`image.edit_suggestions`、`title.chat`、`title.case`、`title.asset`、`identity.username`、`classify.case_style`、`classify.asset_tag`、`starter.copy.generate`、`starter.copy.translate`、`safety.review` |
| `provider_id` | 选用的 `prompt_optimizer_providers.id`；不设数据库外键，以便供应商变更后保留失效分配并在后台提示 |
| `model` | 选中的模型名称；配置页按供应商分组展示供应商默认模型和缓存模型，已有的列表外模型仍可保留并解析 |
| `updated_at` | 更新时间 |

### safety_review_settings

对话提示词文本审核配置。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `enabled` | 旧兼容字段；运行时总开关来自 `global_switch_settings.prompt_safety_review`，保存接口会同步写入 |
| `failure_policy` | 审核服务异常时策略：`allow` 放行、`block` 拦截；默认 `allow` |
| `block_message` | 用户侧拦截提示文案 |
| `updated_at` | 更新时间 |

### safety_review_logs

对话提示词文本审核记录。V1 只记录 `/api/images/generate` 和 `/api/images/edit` 中用户提交的 prompt，不处理素材、共享审核、OCR 或图片内容。

| 字段 | 说明 |
| --- | --- |
| `id` | 审核记录 ID |
| `user_id` / `session_id` / `job_id` | 用户、对话和任务关联；拦截发生在任务创建前时 `job_id` 为空 |
| `scene` | 审核场景：`image_generation` 生图、`image_edit` 图生图 |
| `prompt_excerpt` | 用户提示词短摘录 |
| `decision` | 模型结论：`allow`、`review`、`block`；异常时可为空 |
| `risk_level` | 风险等级：`none`、`low`、`medium`、`high` |
| `categories_json` | 命中的风险类别 JSON |
| `confidence` | 模型置信度 |
| `reason` | 审核原因摘要 |
| `matched_text_json` | 命中的关键短语 JSON |
| `suggested_action` | 模型建议动作：`continue`、`manual_review`、`reject` |
| `action` | 实际动作：`allow`、`record`、`block`、`failure_allow`、`failure_block` |
| `provider_id` / `provider_name` | 使用的文本模型配置 |
| `duration_ms` | 审核耗时 |
| `error` | 审核异常信息 |
| `created_at` | 创建时间 |

### starter_copy_settings

对话空白页每日互动文案配置。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `enabled` | 旧兼容字段；运行时总开关来自 `global_switch_settings.starter_copy_generation`，保存接口会同步写入 |
| `copy_count` | 每次生成候选文案数量，范围 `0` 到 `100`，默认 `50` |
| `updated_at` | 更新时间 |

### file_security_settings

本地加密文件设置。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定 ID |
| `encryption_key` | 文件加密密钥 |
| `created_at` / `updated_at` | 创建和更新时间 |

### debug_settings

调试开关。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `image_edit_mask` | 旧兼容字段；运行时总开关来自 `global_switch_settings.debug_image_edit_mask`，保存接口会同步写入 |
| `image_edit_response` | 旧响应调试开关，`0` 否、`1` 是；响应摘要现在默认写入 `image_jobs.response_json` |
| `updated_at` | 更新时间 |

### proxy_settings

代理配置。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `enabled` | 旧兼容字段；运行时总开关来自 `global_switch_settings.proxy_service`，保存接口会同步写入 |
| `url` | 代理地址 |
| `retry_count` | 代理请求失败重试次数，范围 `0` 到 `10` |
| `apply_chatgpt_web` / `apply_cpa` / `apply_api` | 全局代理允许作用的渠道类型，`0` 否、`1` 是；还需要对应 `provider_configs.proxy_enabled=1` |
| `updated_at` | 更新时间 |

### image_accounts

图片账号号池，主要用于 ChatGPT Web / CPA 账号同步和额度观察。

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 账号 ID 和名称 |
| `remote_name` | CPA 远端文件名 |
| `channel_id` | 关联渠道 |
| `email` / `account_type` | 账号邮箱和套餐类型 |
| `status` | 账号状态：`normal` 正常、`limited` Codex 限流、`abnormal` 异常、`disabled` 禁用 |
| `quota` / `used_quota` | 旧额度字段 |
| `usage_success_count` / `usage_failure_count` | 本地成功和失败计数 |
| `usage_recent_requests` | 最近请求 JSON |
| `codex_5h_used_percent` / `codex_5h_reset_at` | Codex 5 小时窗口 |
| `codex_week_used_percent` / `codex_week_reset_at` | Codex 周窗口 |
| `codex_credits_balance` / `codex_credits_unlimited` | Credits 额度；`codex_credits_unlimited` 为 `0` 否、`1` 是 |
| `codex_usage_windows` / `codex_usage_updated_at` / `codex_usage_error` | 额度详情 |
| `priority` | 使用优先级 |
| `access_token` | 账号访问令牌；ChatGPT Web 号池调用和 Codex 额度刷新优先使用该字段 |
| `auth_json` | 原始账号授权 JSON；本地单个/批量导入和 CPA 同步都会保留可解析的授权载荷，运行时可从中兜底提取 `access_token`、邮箱、套餐、账号 ID、Cookie |
| `auth_info_json` | 附加认证信息 JSON，主要保存 CPA 同步或导入记录里的 `id_token`、账号类型等补充信息；只生图时可为空，运行时仅在 `access_token` / `auth_json` 没有 token 时兜底解析 |
| `note` | 备注 |
| `sync_status` | 同步来源状态：`local` 本地创建、`synced` CPA 同步；历史或异常值按原样保留 |
| `last_refreshed_at` | 最近刷新时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

### cpa_accounts

CPA 同步配置。

| 字段 | 说明 |
| --- | --- |
| `id` | 配置 ID |
| `enabled` | 旧兼容字段；运行时总开关来自 `global_switch_settings.cpa_sync`，保存接口会同步写入 |
| `account_name` | 配置名称 |
| `sync_url` | CPA 管理地址 |
| `username` | 用户名 |
| `password_secret` / `token_secret` | 访问密钥 |
| `frequency_minutes` | 同步频率 |
| `last_status` | 最近同步状态：通常为 `skipped`、`succeeded`、`failed`，也可能为空 |
| `updated_at` | 更新时间 |

### cpa_sync_runs

CPA 同步执行记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 执行 ID |
| `status` | 执行状态：`skipped` 跳过、`succeeded` 成功、`failed` 失败 |
| `message` | 执行结果 |
| `started_at` / `finished_at` | 开始和结束时间 |

### backup_settings

数据备份配置。默认启用每日自动备份，默认保留 3 天；默认备份目录是项目根目录下的 `backups`，不放在 `data` 下。

| 字段 | 说明 |
| --- | --- |
| `id` | 固定为 `default` |
| `enabled` | 是否启用每日自动备份，`0` 否、`1` 是 |
| `run_time` | 每日备份时间，格式 `HH:mm` |
| `retention_days` | 备份保留天数，当前限制为 `1` 到 `3650` |
| `backup_dir` | 备份目录；相对路径按项目根目录解析，绝对路径按原路径使用 |
| `updated_at` | 更新时间 |

### backup_runs

数据备份执行记录。备份包为无压缩 `.tar` 归档，包内包含 `manifest.json`、`app.db`、`config.db`、`files/secure/**`、`files/image-masks/**` 以及数据库仍直接引用的旧版非 secure 文件；不包含 `data/config.toml`、`data/debug/**`、历史备份包和备份临时目录。

| 字段 | 说明 |
| --- | --- |
| `id` | 备份执行 ID |
| `source` | 触发来源：`manual` 手动、`scheduled` 定时 |
| `status` | 执行状态：`running` 运行中、`succeeded` 成功、`failed` 失败、`deleted` 已删除 |
| `backup_dir` | 本次备份使用的目录配置 |
| `file_name` | 备份包文件名 |
| `file_size` | 备份包大小 |
| `file_count` | 归档内文件数量，后台显示为“文件数”，包含 `manifest.json` 和两个数据库快照 |
| `error` | 失败信息 |
| `started_at` / `finished_at` | 开始和结束时间；后台显示的“耗时”由这两个时间计算，不单独落库 |
| `deleted_at` | 删除时间；为空表示未删除 |

### changelog_entries

后台维护的更新日志。

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `version` | 版本号，唯一 |
| `release_date` | 发布日期 |
| `content` | Markdown 内容 |
| `created_at` / `updated_at` | 创建和更新时间 |

### config_audit_logs

后台配置审计记录。

| 字段 | 说明 |
| --- | --- |
| `id` | 日志 ID |
| `action` | 操作类型；当前代码写入 `config.setup`、`config.login`、`config.user_access`、`team.create`、`team.update`、`team.delete`、`user.create`、`user.update`、`user.reset_password`、`user.delete`、`user.self_register`、`user.password_reset`、`registration_settings.save`、`global_switch.save`、`site_settings.save`、`external_mcp_settings.save`、`smtp_settings.save`、`smtp_settings.test`、`sms_settings.save`、`sms_settings.test`、`image_account.refresh_usage`、`image_account.create`、`image_account.update`、`image_account.delete`、`image_mode.save`、`provider.save`、`prompt_optimizer.save`、`prompt_optimizer.models`、`prompt_optimizer.test`、`proxy.save`、`debug.save`、`cpa.save`、`cpa.sync`、`backup.settings.save`、`backup.run`、`backup.delete`、`safety_review.save`、`asset.share.approve`、`asset.share.reject`、`case.review.approve`、`case.review.reject`、`changelog.create`、`changelog.update`、`changelog.delete` |
| `detail` | JSON 详情 |
| `created_at` | 创建时间 |

### provider_request_logs

图片渠道请求日志。

| 字段 | 说明 |
| --- | --- |
| `id` | 请求日志 ID |
| `provider_id` / `provider_name` | 渠道信息 |
| `channel` | 渠道类型：`cpa`、`chatgpt_web`、`api` |
| `route_mode` | 实际路由：常见为 `images_api`、`responses`、`auto`，ChatGPT Web 还会记录具体官网子路由标识 |
| `operation` | 操作类型：`generation` 生成、`edit` 编辑 |
| `job_id` | 关联图片任务 ID，用于把请求日志和 `image_jobs`、`images` 串起来 |
| `attempt_no` | 当前任务本轮第几次请求；第一次请求为 `1`，自动重试第一次为 `2` |
| `max_attempts` | 当前任务本轮最多尝试次数，等于后台自动重试次数加首次请求 |
| `is_retry` | 当前请求是否为自动重试请求，`0` 否、`1` 是 |
| `source_account_id` | 来源图片账号 |
| `user_id` | 请求用户 |
| `endpoint` | 实际请求地址 |
| `status_code` | HTTP 状态码 |
| `duration_ms` | 耗时 |
| `success` | 是否成功，`0` 否、`1` 是 |
| `cancelled` | 请求是否对应用户主动取消的图片任务，`0` 否、`1` 是；旧取消任务日志会在启动迁移时尽量回填 |
| `error` | 错误信息 |
| `response_snapshot` | 图片请求 HTTP 成功但后处理失败时保存的脱敏响应快照，图片 base64 会被占位文本替换 |
| `created_at` | 创建时间 |

### model_request_logs

语言模型调用日志。用于后台“模型日志”菜单查看提示词优化、表单优化、标题生成、每日文案、安全审核，以及模型列表获取和供应商测试等调用记录。该表只保存调用元信息、状态、耗时和错误摘要，不保存 prompt、messages、响应正文或生成结果正文。

| 字段 | 说明 |
| --- | --- |
| `id` | 日志 ID |
| `purpose` | 调用类型：`config.models` 获取模型、`config.test` 供应商测试、`prompt.optimize` 提示词优化、`prompt.translate` 提示词翻译、`template.optimize` 表单优化、`template.translate` 表单翻译、`title.generate` 标题生成、`identity.username` 昵称生成、`category.classify` 自动分类、`suggestion.generate` 续改建议、`starter.copy` 每日文案、`safety.review` 安全审核 |
| `provider_id` / `provider_name` | 模型供应商信息 |
| `model` | 实际请求模型 |
| `endpoint` | 实际请求地址 |
| `method` | HTTP 方法，通常为 `POST`，模型列表为 `GET` |
| `stream_enabled` | 是否使用 SSE 流式读取，`0` 否、`1` 是 |
| `retry_count` | 当前供应商配置的重试次数 |
| `attempt_count` | 本次调用实际发起的请求次数；配置缺失等未发出请求的失败可为 `0` |
| `status_code` | HTTP 状态码；未发出请求或网络错误时为空 |
| `duration_ms` | 耗时 |
| `success` | 是否成功，`0` 否、`1` 是 |
| `error` | 截断后的错误摘要，不包含请求/响应正文 |
| `user_id` | 请求用户；系统任务或配置测试为空 |
| `job_id` | 关联业务 ID，例如提示词模板 ID 或图片任务 ID |
| `source` | 来源模块或稳定的语言模型场景键，例如 `config`、`prompt-optimizer`、`prompt-template`、`prompt-template-export`、`title.chat`、`classify.asset_tag`、`starter.copy.translate` |
| `created_at` | 创建时间 |
