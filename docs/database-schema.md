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
| `appearance_mode` | 用户工作台主题偏好，`system`、`dark`、`light` 或 `maliang` |
| `disabled` | 是否禁用，`0` 否、`1` 是 |
| `has_config_access` | 是否允许访问后台配置，`0` 否、`1` 是 |
| `email_verified_at` | 邮箱验证时间 |
| `phone_verified_at` | 手机号验证时间 |
| `last_login_at` | 最近登录时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

### user_preferences

用户个性化偏好，按用户单行保存。

| 字段 | 说明 |
| --- | --- |
| `user_id` | 用户 ID，主键 |
| `edit_suggestions_enabled` | 对话页图片续改建议开关，`0` 关闭、`1` 开启 |
| `edit_suggestion_tone` | 图片续改建议倾向：`default` 默认均衡、`practical` 实用优化、`creative` 创意扩展、`detail` 细节修复 |
| `prompt_optimize_styles_json` | 用户自定义 AI 优化风格 JSON，保存主风格、子风格、排序、显示状态和自定义优化指令；为空时使用系统默认风格 |
| `updated_at` | 更新时间 |

### user_auth_sessions

前台用户登录会话。

| 字段 | 说明 |
| --- | --- |
| `id` | 会话 Token |
| `user_id` | 用户 ID |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |

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
| `copies_json` | 当日候选文案 JSON 数组 |
| `source` | 文案来源，当前为 `ai` |
| `provider_name` / `model` | 生成文案使用的模型配置名称和模型 |
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
| `title` | 会话标题 |
| `archived_at` | 归档时间 |
| `deleted_at` | 删除时间 |
| `created_at` / `updated_at` | 创建和更新时间 |

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

### image_jobs

图片生成或编辑任务。

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `user_id` | 用户 ID |
| `session_id` | 会话 ID |
| `type` | 任务类型：`generation` 生成、`edit` 编辑 |
| `status` | 任务状态：`running` 运行中、`succeeded` 成功、`failed` 失败 |
| `prompt` | 用户提示词 |
| `source_image_ids` | 来源图片、素材、灵感引用 JSON |
| `provider_id` | 用户选择或实际使用的渠道 ID |
| `error` | 失败信息 |
| `result_image_id` | 首张结果图片 ID |
| `request_json` | 请求摘要，图片 data URL 会脱敏 |
| `response_json` | 响应摘要，图片 base64 会替换为占位文本 |
| `auto_retry_count` | 任务实际发生的自动重试次数；第一次成功为 `0` |
| `manual_retry_count` | 用户在失败卡片上手动点击重试的次数 |
| `max_auto_retries` | 创建或最近一次执行任务时使用的后台自动重试次数快照 |
| `succeeded_on_retry` | 最终是否由自动重试或手动重试后成功，`0` 否、`1` 是 |
| `created_at` / `updated_at` | 创建和更新时间 |

相关索引：`image_jobs_session_user_status_time_idx` 支撑对话页和侧边栏按会话、用户、状态轮询任务。

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
| `size` / `quality` | 请求尺寸和质量；`size` 默认 `auto`，常用 `1024x1024`、`1536x2048`、`1152x2048`、`2048x1536`、`2048x1152`；`quality` 默认可选 `low`、`medium`、`high`，具体也可由渠道配置扩展 |
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

### image_favorites

我的图片收藏关系。

| 字段 | 说明 |
| --- | --- |
| `id` | 收藏 ID |
| `user_id` | 收藏用户 |
| `image_id` | 图片 ID |
| `created_at` | 收藏时间 |

### image_edit_suggestions

图片续改建议缓存，只在用户请求某张图片建议后写入。

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

图片、素材、引用图的派生缩略图或预览文件。

| 字段 | 说明 |
| --- | --- |
| `source_type` | 来源类型：`image` 图片、`asset` 素材、`image-reference` 图片引用快照、`message-source-reference` 消息引用快照 |
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
| `image_width` / `image_height` | 图片尺寸 |
| `created_at` | 创建时间 |

### case_categories

灵感空间和素材标签分类。

| 字段 | 说明 |
| --- | --- |
| `id` | 分类 ID |
| `type` | 分类类型：`case` 灵感空间、`asset` 素材库 |
| `name` | 分类名称 |
| `slug` | 唯一标识 |
| `sort_order` | 排序 |

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

### prompt_templates

创作提示词表单模板。

| 字段 | 说明 |
| --- | --- |
| `id` | 模板 ID |
| `user_id` | 创建用户 |
| `visibility` | 可见性：`private` 私有、`shared` 共享 |
| `name` / `description` / `category` | 模板名称、说明和分类 |
| `icon` | 模板图标 |
| `optimize_style` | 该模板默认 AI 优化风格。支持主风格：`standard` 标准、`realistic` 写实、`cinematic` 电影、`anime` 动漫、`artistic` 艺术、`commercial` 商业、`series` 组图、`composition` 构图、`detailed` 细节、`creative` 创意；也支持 `主风格:子风格`，例如 `cinematic:cyberpunk`、`anime:ghibli`、`series:logo-design`、`composition:rule-of-thirds` |
| `components_json` | 表单组件 JSON |
| `rules_json` | 基础提示词拼接规则 JSON |
| `output_json` | 输出配置 JSON |
| `created_at` / `updated_at` | 创建和更新时间 |

### prompt_template_form_drafts

创作提示词表单填写草稿，按用户和模板各保存一份，避免共享表单被不同用户互相覆盖。前端自动保存时只写入该表；旧版本浏览器 `localStorage` 中的 `prompt-template-form-draft:*` 草稿会在应用启动时清理，不再作为读取来源。

| 字段 | 说明 |
| --- | --- |
| `template_id` | 表单模板 ID |
| `user_id` | 填写用户 ID |
| `form_values_json` | 当前填写的表单值 JSON，包含文本、下拉选项和素材字段引用信息 |
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

### branding_assets

全站品牌图片资源。系统默认资源保留为 `builtin`，指向当前 `public/` 静态资源；后台上传资源为 `uploaded`，文件保存到本地加密文件目录。

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
| `route_mode` | 路由模式：`images_api`、`responses`、`auto` |
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

提示词模板优化使用的语言模型配置，独立于图片渠道。

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 模型配置 ID 和名称 |
| `enabled` | 是否启用，`0` 否、`1` 是 |
| `base_url` / `endpoint_path` | Chat Completions 兼容接口地址 |
| `api_key_env` / `api_key_value` | API Key 来源 |
| `model` | 语言模型名称 |
| `models_json` | 从供应商 `/models` 接口获取并缓存的可选模型列表，保存后配置页可直接展示 |
| `availability_status` | 供应商可用状态：`unknown` 未测试、`normal` 正常、`abnormal` 异常 |
| `availability_error` | 最近一次获取模型或测试供应商失败时的错误信息 |
| `availability_checked_at` | 最近一次获取模型或测试供应商的检查时间 |
| `stream_enabled` | 是否用 SSE 流式读取并返回前端，`0` 否、`1` 是 |
| `thinking_enabled` | DeepSeek 思考模式开关，`0` 关闭、`1` 开启，默认开启 |
| `temperature` | 采样温度；为空时不向上游传该参数，使用模型默认值 |
| `max_tokens` | 最大输出 Token，`0` 表示不限制、不向上游传 `max_tokens` |
| `retry_count` | 文本模型请求遇到网络错误、`429` 或 `5xx` 等临时失败时的重试次数，默认 `2`，范围 `0` 到 `10` |
| `sort_order` | 排序，最靠前的启用配置会被使用 |
| `created_at` / `updated_at` | 创建和更新时间 |

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
| `copy_count` | 每次生成候选文案数量，范围 `0` 到 `100`，默认 `20` |
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
| `status` | 账号状态：`normal` 正常、`limited` 限流、`abnormal` 异常、`disabled` 禁用 |
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
| `action` | 操作类型；当前代码写入 `config.setup`、`config.login`、`config.user_access`、`team.create`、`team.update`、`team.delete`、`user.create`、`user.update`、`user.reset_password`、`user.delete`、`user.self_register`、`user.password_reset`、`registration_settings.save`、`global_switch.save`、`smtp_settings.save`、`smtp_settings.test`、`sms_settings.save`、`sms_settings.test`、`image_account.refresh_usage`、`image_account.create`、`image_account.update`、`image_account.delete`、`image_mode.save`、`provider.save`、`prompt_optimizer.save`、`prompt_optimizer.models`、`prompt_optimizer.test`、`proxy.save`、`debug.save`、`cpa.save`、`cpa.sync`、`safety_review.save`、`asset.share.approve`、`asset.share.reject`、`case.review.approve`、`case.review.reject`、`changelog.create`、`changelog.update`、`changelog.delete` |
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
| `error` | 错误信息 |
| `response_snapshot` | 图片请求 HTTP 成功但后处理失败时保存的脱敏响应快照，图片 base64 会被占位文本替换 |
| `created_at` | 创建时间 |

### model_request_logs

语言模型调用日志。用于后台“模型日志”菜单查看提示词优化、表单优化、标题生成、每日文案、安全审核，以及模型列表获取和供应商测试等调用记录。该表只保存调用元信息、状态、耗时和错误摘要，不保存 prompt、messages、响应正文或生成结果正文。

| 字段 | 说明 |
| --- | --- |
| `id` | 日志 ID |
| `purpose` | 调用场景：`config.models` 获取模型、`config.test` 供应商测试、`prompt.optimize` 提示词优化、`prompt.translate` 提示词翻译、`template.optimize` 表单优化、`template.translate` 表单翻译、`title.generate` 标题生成、`starter.copy` 每日文案、`safety.review` 安全审核 |
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
| `source` | 来源模块，例如 `config`、`prompt-optimizer`、`prompt-template`、`prompt-template-export`、`starter-copy`、`image_generation` |
| `created_at` | 创建时间 |
