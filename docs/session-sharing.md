# 会话共享

## 功能边界

会话共享为同一会话生成永久快照链接。创建链接时，仅记录当前可见分支中已经落库的消息；若同一会话已有消息 ID 和顺序完全一致的快照，则直接复用最早创建的原链接，只有可见消息发生变化时才创建新链接。之后新增消息、继续聊天、切换分支、改名、归档或退出登录都不会改变旧链接。这里的“永久”指 token 本身不设过期时间，链接仍会在主动撤销、原会话删除、账户删除/禁用或关联媒体删除时失效。

共享页不展示分享者身份，始终只读。查看者无论是否登录，都不能发送、复制消息或图片、编辑、重试、收藏、加入素材/灵感或进入图片编辑器；可以在灯箱中查看图片，并且只有助手生成/编辑的结果图提供下载。

## 架构与界面复用

- `ChatPage` 继续负责私有会话查询、分支选择、生成任务、编辑器和 `ChatComposer`，以 `mode="workspace"` 使用 `ConversationView`。
- `SharedConversationPage` 只读取公共 DTO，经现有 `buildChatRenderState` 生成渲染项，再以 `mode="shared-readonly"` 使用同一个 `ConversationView`。
- `ConversationView` 复用 `ChatMessage`、`ChatMessageThread`、图片组、时间和灯箱。共享 DTO 会把创建时已经选定的可见分支扁平化为只读主序列，避免私有分支/修订元数据再次影响公共渲染。共享模式通过显式 capabilities 关闭 `copyText`、`copyImage`、`editMessage`、`retry`、`editImage`、`addCase` 和 `addAsset`，而不是仅用 CSS 隐藏。
- 下载菜单在共享模式只接受 `{ type: "shared-image", token, id }`，不会回退到当前登录用户的私有图片接口。
- 已登录查看者由 `WorkbenchShell` 承载 `/share/:token`，保留自己的导航、设置和会话历史；共享会话不会写入其历史。
- 未登录查看者由 `SharedWorkbenchShell` 承载同一路由，复用品牌、导航、侧栏收起和移动抽屉。最近会话区为空，工作台导航统一拦截到登录流程，不加载个人会话或个人设置数据。

## 数据模型

会话共享业务数据保存在 `appDb`：

| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `session_share_links` | `id`, `public_token`, `user_id`, `session_id`, `title`, `created_at` | 保存分享记录、公开 UUID 和创建时的标题快照；用户、会话外键均级联删除 |
| `session_share_messages` | `share_id`, `message_id`, `sort_order` | 保存该链接冻结的消息成员及顺序；同一分享内消息和顺序均唯一 |

新创建的公开链接使用随机 UUID，格式为 `/share/6a59ab65-3c2c-83ee-a47b-fcfdd050b9ca`，UUID 作为不可猜测的 bearer token 存在 `session_share_links.public_token`。HMAC 密钥仍保存在 `configDb.session_share_signing_settings`，仅用于兼容已经发出的 `v1.<share-id-base64url>.<HMAC-SHA256>` 旧链接。

快照冻结的是消息 ID 集合、顺序和标题，不复制消息或媒体文件。这样既能保证后续消息不会进入旧链接，也能让原图片删除后立即无法再通过共享链接访问。

## 页面路由与身份状态

- 公开页面：`/share/:token`。
- 未登录时显示空历史的共享工作台外壳；左下角可登录，右上角可登录或注册。自助注册关闭时隐藏注册入口。
- `/share/:token?auth=login` 和 `/share/:token?auth=register` 复用 `LoginPage`。从共享页头进入认证时，成功后清理 `auth` 参数并返回原共享链接，内容仍为只读。
- 访客从工作台导航进入登录时可附带受白名单约束的 `next`；仅允许 `/`、`/cases`、`/assets`、`/images`、`/prompt-templates`，避免开放重定向。
- 已登录访问者仍通过不携带凭据的公共会话请求读取共享 DTO；其登录身份不会扩大共享媒体权限。

## API 契约

所有下列路径均位于 `/api` 下。

### 登录态管理接口

| 方法与路径 | 请求 | 成功响应 | 说明 |
| --- | --- | --- | --- |
| `GET /sessions/:sessionId` | 无 | `{ "session": ChatSession }` | 独立读取当前会话元数据，保证未加载进侧栏分页的旧会话仍有标题和顶部操作 |
| `POST /sessions/:sessionId/share-links` | `{ "messageIds": string[] }` | `{ "shareLink": SessionShareLink }` | 复用相同快照的原链接；没有匹配项时创建新快照 |
| `GET /session-share-links?limit=&offset=` | 分页查询 | `{ "links": SessionShareLink[], "pageInfo": ... }` | 当前用户的链接，按创建时间倒序 |
| `DELETE /session-share-links/:shareId` | 无 | `{ "ok": true }` | 撤销单条链接，不删除原会话 |
| `DELETE /session-share-links` | 无 | `{ "ok": true, "deleted": number }` | 撤销当前用户的全部链接 |

`SessionShareLink` 只返回管理所需的 `id`、`sessionId`、标题、类型 `chat`、相对路径、可选绝对 URL、消息数和创建时间。创建、单条撤销和全部撤销要求登录，并拒绝跨站 mutation 请求。

### 匿名读取与媒体接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /shared-sessions/:token` | 返回 `{ share: { title, createdAt }, messages }` 公共 DTO |
| `GET /shared-sessions/:token/messages/:messageId/image?variant=thumb\|preview` | 查看消息图片；通用预览接口对所有角色拒绝 `original` |
| `GET /shared-sessions/:token/messages/:messageId/source-references/:index?variant=thumb\|preview` | 查看输入/消息引用的派生图 |
| `GET /shared-sessions/:token/messages/:messageId/image-references/:index?variant=thumb\|preview` | 查看助手结果关联引用的派生图 |
| `GET /shared-sessions/:token/messages/:messageId/image/download-options` | 获取助手结果图的缩略图、预览图和原图下载选项 |
| `GET /shared-sessions/:token/messages/:messageId/image/download?variant=...` | 下载助手结果图 |
| `GET /shared-sessions/:token/result-images/:imageId/download-options` | 按共享局部图片 ID 获取下载选项的兼容接口 |
| `GET /shared-sessions/:token/result-images/:imageId/download?variant=...` | 按共享局部图片 ID 下载的兼容接口 |

公共 DTO 使用 `shared-message-N`、`shared-image-N` 等分享内局部 ID，并只保留渲染需要的角色、文本、时间、尺寸、媒体 URL和安全元数据。`metadata` 不是数据库原值，只允许 `mode`、分享内局部 `jobId` 和用于隐藏引用授权的布尔标记；branch/revision/message 关系会被移除。响应不包含用户身份、provider、任务详情、遮罩、磁盘路径或原始素材内部 ID。

## 快照创建与生命周期

创建时前端从服务端消息构建当前分支，提交其可见且已落库的消息 ID。后端在事务中执行以下校验：

1. 会话属于当前用户、未删除，消息数组非空、无重复且不超过 2,000 条。
2. 先过期处理陈旧任务，再拒绝仍存在运行中图片任务的会话。
3. 所有消息必须属于该会话和用户，角色只能是 `user` 或 `assistant`。
4. 按 `created_at, rowid` 重新排序后必须与前端提交顺序完全一致；任何变化返回冲突，不创建部分快照。

同一会话可拥有多条不同快照链接。创建时按 `created_at, rowid` 从旧到新查找消息数量相同的分享记录，并逐条比较 `message_id` 与 `sort_order`；完全一致时返回最早的原链接，不新增记录。后续消息不会自动追加；可见消息变化后再次分享会生成新链接。改名不改标题快照，归档和继续聊天不影响旧链接。

以下操作会使全部或部分内容立即失效：

- 撤销单条或全部共享链接：删除分享记录，不碰原会话。
- 删除单个结果图：该媒体查询因源文件/图片记录不存在而统一返回 404。
- 删除会话或删除全部会话：先删除该用户相关的分享成员和分享记录。
- 删除账户：清理该用户的全部分享数据；禁用账户时公共 token 查询不再返回活动分享。

## 安全与媒体权限

- 每次公共读取都执行 `token -> 活动分享 -> 快照消息 -> 图片/引用` 校验。隐藏分支、后续消息、跨 token、篡改 token、越界局部 ID 和任意内部图片 ID 均使用相同的 404 响应，避免泄漏对象是否存在。
- 输入图、消息引用和结果关联引用只提供 `thumb`/`preview` 派生图，`original` 返回 404；标记为 `hideReference` 的任务会在 JSON 投影和两个引用媒体端点同时排除用户引用及对应助手结果引用。只有角色为 `assistant` 的结果图能获得下载选项和原图下载响应，前端同源下载菜单负责指定简短文件名；通用预览接口不能绕过下载限流取得原图。
- 公共响应统一设置 `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow, noarchive`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Cross-Origin-Resource-Policy: same-origin`，并通过 CSP `frame-ancestors 'none'` 禁止第三方嵌入。
- 所有匿名分享请求在 token 查询前先按客户端地址限制为 600 次/分钟，避免随机或无效 token 持续制造数据库查询；有效分享再按客户端地址和分享 ID 分桶：会话读取 120 次/分钟、媒体预览 240 次/分钟、下载 40 次/分钟。超限返回 429 和 `Retry-After: 60`。默认以 Bun socket 地址为准并覆盖外部传入的内部地址头。只有在应用仅由可信反向代理访问、且代理会清洗客户端伪造的 `CF-Connecting-IP`、`X-Forwarded-For`、`X-Real-IP` 时，才可设置 `APP_TRUST_PROXY=true` 使用代理提供的客户端地址。
- 创建和撤销写入审计事件；签名密钥不得暴露到前端或日志。共享 URL 本身等同访问凭据，应按敏感链接管理。

## `APP_PUBLIC_URL` 与部署

创建结果中的绝对链接优先使用 `APP_PUBLIC_URL` 的 HTTP(S) origin；未配置或值无效时，依次回退到请求的 `Origin` 和 API 请求 origin。若回退地址为 `localhost`、`127.0.0.1` 或 `::1`，服务端会自动选择可用的非虚拟局域网 IPv4 替换主机名，并保留协议和端口。该配置只取 origin，路径会被忽略，因此应填写例如：

```env
APP_PUBLIC_URL=https://image.example.com
```

- 本机开发：从 `localhost`、`127.0.0.1` 或 `::1` 创建分享时，返回链接会自动使用当前机器可用的局域网 IPv4；若机器没有可用的非回环 IPv4，才保留原地址。
- 局域网：自动选择结果不符合实际访问网卡时，可配置 `http://192.168.x.x:<port>` 覆盖；同时确保服务监听可访问网卡，并开放系统防火墙端口。
- 公网：使用 HTTPS 反向代理，将 `APP_PUBLIC_URL` 配为外部 HTTPS origin，并正确传递协议、Host 与受信客户端地址。若需按真实访客地址限流，仅在反向代理是唯一入口且会覆盖客户端地址头时设置 `APP_TRUST_PROXY=true`。应用页面和 `/api` 应保持同源；当前绝对路由不支持依靠 `APP_PUBLIC_URL` 子路径部署。

## 验证清单

### 自动化

- [ ] `bun test`
- [ ] `bun run check`
- [ ] `bun run build`
- [ ] `git diff --check`

### 快照与生命周期

- [ ] 同一会话未发生内容变化时重复分享返回同一个原链接；新增消息或切换到不同可见分支后生成新链接，旧链接保持原消息集合。
- [ ] 切换分支后创建链接，只出现该分支的可见消息；隐藏分支和跨 token 媒体均返回 404。
- [ ] 生成中、无消息、乱序、重复或非本会话消息均不能创建链接。
- [ ] 改名、归档和退出登录不影响旧链接；标题保持创建时快照。
- [ ] 单条撤销、全部撤销、删除会话、删除全部会话、删除/禁用账户后链接失效。
- [ ] 删除结果图后原图、预览图和下载选项均不可访问。

### 身份与只读界面

- [ ] 无痕窗口无需登录即可查看消息；网络面板中不请求个人会话、个人设置或私有媒体接口。
- [ ] 访客侧栏历史为空，左下角登录、右上角登录/注册和导航登录拦截正确；关闭自助注册后不显示注册入口。
- [ ] 登录/注册完成后返回预期路径；返回共享链接时内容仍只读。
- [ ] 已登录查看者看到自己的侧栏和历史，共享会话不进入历史，也不能借其身份访问私有原图。
- [ ] 从分享管理进入未加载到侧栏首批分页的旧源会话时，顶部操作和以会话标题命名的下载仍正常。
- [ ] 创建分享尚未完成时切换到其他会话，旧请求不得在新会话中弹窗、复制链接或显示错误提示。
- [ ] 首次进入分享页按主对话的方式定位并显示最近的生成结果，不强制滚到页面底部；长内容滚动后显示与主对话一致的一键到顶/到底按钮。
- [ ] 桌面端、移动端侧栏/抽屉、加载、空状态和失效状态显示正确。

### 权限与安全

- [ ] 页面中不存在发送、复制、编辑、重试、收藏、加入素材/灵感和图片编辑入口。
- [ ] 生成结果可进入只读灯箱并下载缩略图、预览图、原图；输入图和引用素材仅能预览。
- [ ] 公共 JSON 不出现分享者、原始 metadata、provider、任务、遮罩、磁盘路径或内部素材 ID。
- [ ] 篡改 token、跨 token、后续消息、隐藏分支、任意图片 ID 和引用越界统一返回 404。
- [ ] 响应安全头、匿名限流、HTTPS 公网地址、局域网地址和 localhost 警告均符合预期。
