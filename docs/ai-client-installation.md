# AI 客户端安装入口

神笔马良对用户只提供一个安装地址，复制指令保持为简短的“访问安装地址，安装神笔马良”。智能体读取地址后，会从机器安装清单的 `execution` 策略得知必须继续修改当前客户端的真实配置、触发加载并完成验证，不能只总结页面或把配置步骤交回用户。用户只负责浏览器账号登录、OAuth 允许，以及操作系统明确要求的权限确认。

- `/install`：AI 读取机器清单，并根据当前客户端能力选择 Codex 插件或 Remote MCP。

`/mcp`、`/plugin` 及其 JSON 清单是统一入口内部使用的分发路由，不作为需要用户记忆或复制的独立入口。

## 选择规则

- Codex 默认安装完整 Codex 插件。插件已包含 Skill 与 Remote MCP，不重复添加全局 `maliang` MCP。
- Codex 用户明确说明“只安装 MCP”时，仅安装 Remote MCP。
- 当前只提供 Codex 专用插件包；Claude Code、TRAE Work、WorkBuddy 和其他客户端统一安装 Remote MCP，不能复用 Codex 插件包。
- 以后为某个客户端提供专用神笔马良插件包时，再把该客户端及其插件分发信息加入机器清单，由模型自动选择。

机器清单以当前正在执行任务的客户端身份为准，不能仅因同一台电脑存在 `codex` 命令就把 Codex 插件安装到其他 App。

`/install/install.json`、`/mcp/install.json` 和 `/plugin/install.json` 都包含 `execution` 策略，要求当前智能体直接执行安装，并禁止把“读取到清单”“打开授权页”或“OAuth 动态注册成功”误报为安装完成。Codex、Claude Code、TRAE Work、WorkBuddy 以及未知的标准 MCP 客户端都必须由当前智能体写入真实配置、触发重新加载并完成验证；不得用 Python、`urllib`、`curl` 或临时 OAuth 回调脚本代替客户端内的真实安装。

## TRAE Work 项目级 MCP

TRAE Work 分支优先让当前智能体定位客户端真实的“设置 > MCP”管理入口；`<project>/.trae/mcp.json` 只是项目配置候选，写入前后都必须确认当前 TRAE Work 版本和当前项目确实加载该文件。使用项目配置时必须启用项目级 MCP：智能体具备客户端操作能力时直接完成；只有 TRAE Work 明确弹出智能体无法代为确认的客户端权限时，才由用户确认。确认后智能体保持同一安装流程继续重载和验证，不要求用户再发送“继续”。

配置只把 `maliang` 合并进已有 `mcpServers`，保留其他 MCP；整份 JSON 手工粘贴只能作为最后兜底，不能覆盖现有配置。Remote HTTP 配置使用 `url` 与设备 `headers`，不写入 `accessToken`、`refreshToken` 或 `tokenEndpoint`，OAuth 凭据完全由 TRAE Work 原生 Remote MCP OAuth 流程管理。写入完成不代表加载成功：清单要求先确认 `maliang` 已出现在 TRAE Work 当前 MCP 列表，再等待 Token 交换、MCP initialize、工具发现、设备上报和账号状态验证。

TRAE Work 的 OAuth `client_name` 使用正式产品名称 `TRAE Work`，`software_id` 使用 `trae-work`，不附加随机数、时间戳、设备主机名或其他生成后缀。客户端名称与设备名称是两个概念：真实主机名只进入 `X-Maliang-Device-Name` 和 `maliang_report_device`。若 TRAE Work 原生 OAuth 实际提交了不同的注册信息，智能体应报告宿主行为，不得手工调用 `/oauth/register` 或用临时脚本重新注册来伪造名称。

## 手动添加 MCP Server

`/install` 和 `/mcp` 页面同时展示可复制的 `mcpServers` JSON，供提供“手动添加”或“JSON 配置”入口的 Remote HTTP MCP 客户端使用。`mcpServers` 是客户端配置约定，不是 MCP 协议规定的统一配置文件 Schema；不同客户端可能另外使用 `headers`、`type` 或 `transport` 等私有字段。网页因此只展示最小、可直接粘贴的 `mcpServers.maliang.url`，避免加入降低兼容性的客户端专属参数。

手动配置不包含 `accessToken`、`refreshToken`、`tokenEndpoint` 或其他 OAuth 凭据，保存后由当前客户端自己的 Remote MCP OAuth 流程完成授权。网页也不展示设备名占位符：浏览器无法安全读取访问者电脑的真实主机名，使用服务器主机名或让用户误复制模板值都会产生错误设备记录。连接与工具加载完成后，当前智能体调用 `maliang_report_device` 上报真实主机名，再调用 `maliang_account_status` 验证账号。

## 公共地址

安装页、OAuth 元数据、MCP endpoint、帮助文章和插件下载包共用同一个公开访问地址。推荐在“后台 → 系统 → 品牌设置 → 站点访问设置”填写站点的 HTTPS origin，例如 `https://image.example.com`；保存后立即生效，无需重启。留空时才根据当前请求的 HTTP(S) origin 自动识别。

公开地址的优先级依次为 `APP_PUBLIC_URL`、兼容环境变量 `MALIANG_PUBLIC_BASE_URL`、后台站点访问设置、当前请求自动识别。环境变量适合由部署平台统一管理的场景，并会接管、锁定后台输入框；如果两个环境变量同时存在，规范化后的 origin 必须相同，否则安装、MCP 与 OAuth 路由会明确拒绝冲突配置。环境变量或后台设置中的非法地址也会明确报错，不会静默回退。

反向代理场景下，公开访问地址可直接在后台填写；只有需要服务端信任代理传入的协议、Host 或真实客户端地址时，才在可信代理是唯一入口且会清洗伪造请求头的前提下配置 `APP_TRUST_PROXY=true`。启用后服务端才会读取 `X-Forwarded-Host` 和 `X-Forwarded-Proto`。

未配置外部地址且通过 `localhost`、`127.0.0.1` 或 `::1` 访问时，安装入口会自动选择可用的非虚拟局域网 IPv4，并保留当前协议与端口。例如本机地址 `http://127.0.0.1:8787/mcp` 会展示为同一服务的 `http://192.168.x.x:8787/mcp`，方便同一局域网内的 AI 客户端读取教程。公开域名或公网 IP 的 MCP/OAuth origin 必须使用 HTTPS；HTTP 只允许 loopback、私有局域网、链路本地或 CGNAT 测试地址。无法安全解析时服务端拒绝发布 OAuth 元数据，而不是静默生成公网 HTTP 地址。

Codex 插件 ZIP 由 `/plugin/download/latest` 根据本次请求 origin 动态生成，并同步计算 `/plugin/latest.json` 中的 SHA-256。静态打包脚本与在线分发使用同一套公开地址校验：公网必须使用 HTTPS，本机和私有局域网测试地址仍可使用 HTTP。`distribution/codex-marketplace` 只保存带占位符的开源模板，不保存部署域名。

## 显示开关

配置中心“品牌设置”中的 `AI 客户端安装入口` 默认开启。关闭后只隐藏新对话空白页的“插件”按钮，不影响 `/install` 及其内部安装清单访问。

## OAuth 浏览器兜底

Codex 插件 Marketplace 使用 `ON_INSTALL` 授权策略。安装时优先由 Codex 发起 OAuth，并通过操作系统默认浏览器打开授权页；Codex Browser、Chrome 和 Computer Use 不是插件的硬依赖。`Added plugin` 只表示插件已加入，不能代替 OAuth 成功结果。

授权流程现在由安装清单中的 `loginBehavior` 状态机约束：登录命令必须在可见前台保持运行，系统浏览器 5 秒内没有出现时，优先使用 Codex 内置 Browser 打开同一命令输出的原始授权 URL，再依次尝试已连接 Chrome、Computer Use 和用户可点击链接。兜底浏览器不能创建或修复 OAuth 请求；命令一旦超时或退出，loopback 回调停止，旧 URL 即使还能打开也必须作废并重新生成。

## WorkBuddy 私有回调

WorkBuddy 桌面端的 Remote MCP OAuth 可以使用 `workbuddy://workbuddy/mcp/{connectorId}/oauth/callback` 把浏览器授权结果交回应用。服务端只为 `application_type=native` 接受这一条客户端专属格式；`connectorId` 必须是以 `custom-mcp:` 或 `connector:` 开头的单个安全路径段。端口、账号信息、查询参数、锚点、控制字符、反斜杠、编码斜杠、其他 host、其他路径和其他私有 scheme 全部拒绝。该规则不依赖可伪造的 User-Agent，也不意味着任意桌面客户端都能注册自定义协议。

授权确认页对 WorkBuddy 使用 `workbuddy:` CSP scheme source，显示 `workbuddy://workbuddy` 而不是 URL API 对非 HTTP(S) 协议产生的 `null` origin。用户允许后，服务端以 `303 See Other` 返回原始私有回调，由操作系统唤起 WorkBuddy；普通 native loopback 客户端仍使用授权页后台交付和 Token 状态轮询。Authorization Code 保存的 `redirect_uri` 与 Token 请求提交的值必须逐字一致，不能在 WorkBuddy 私有回调和 loopback 地址之间替换或做等价归一化。

这项适配只消除 WorkBuddy 在私有回调被拒绝后回退、又在 Token 阶段重读原始地址造成的不一致。动态注册成功或浏览器显示允许成功仍不代表安装完成；必须继续确认 WorkBuddy 已获得 Token、完成 MCP initialize 和工具发现，并由当前安装智能体调用 `maliang_report_device` 与 `maliang_account_status`。Codex、TRAE Work、Claude Code 和其他客户端继续优先使用各自已经验证的 HTTPS 或 loopback 回调；只有拿到某个客户端稳定、可验证且边界明确的官方私有协议格式后，才单独增加适配。

## 所有客户端的设备名称上报

设备上报是所有客户端的统一完成门槛，不是 TRAE Work 特例。机器清单要求安装智能体先在本机读取真实主机名：Windows 使用 `[System.Net.Dns]::GetHostName()`，macOS/Linux 使用 `hostname`；再使用真实值及 `Windows`、`macOS` 或 `Linux`。设备名不能填写操作系统名称、客户端名称、`localhost`、未知标签或模板占位符。

各分支会尽可能提前写入 `X-Maliang-Device-Name`、`X-Maliang-Device-Os` 固定请求头：Codex 插件或 MCP-only 配置使用环境变量头，Claude Code 使用原生 `--header`，TRAE Work、WorkBuddy 和标准 MCP 客户端使用各自配置模板。服务端可在 OAuth 动态注册或首次已授权 MCP 请求时保存这些信息。

固定请求头不是唯一依赖。Remote MCP 还提供通用 `maliang_report_device` 工具；任意客户端在新 OAuth 安装、Token 交换和工具发现完成后，都必须由当前智能体在同一安装流程中使用刚读取的真实主机名立即调用该工具，再调用 `maliang_account_status`，不得等待用户另发一条消息。服务端把 OAuth 后第一次已授权工具调用作为兜底门槛：设备仍未知时，账号状态和所有图片工具会先要求当前智能体完成 `maliang_report_device`，`reported=true` 后再重试原工具。同一 OAuth 客户端只需上报一次，除非真实设备发生变化；不得在每次任务、生图或改图前重复上报。客户端重新动态注册并获得新 `client_id` 时，新授权仍需完成一次设备绑定；绑定后，服务端按客户端家族、系统和真实主机名生成稳定逻辑设备 ID，因此 TRAE 或 Codex 的重复注册会回到各自原设备记录，不要求宿主保存服务端生成的 `client_id`。即使某个客户端不支持固定请求头，也不能省略设备回填。只有设备上报成功、账号授权有效且全部必需工具可见时，安装才算完成。

设备管理中的“断开”保留设备记录并立即停用该逻辑设备下的活动凭据，按钮变为“恢复”；显式恢复只重新启用本次断开且仍有效的凭据。凭据已过期或 Refresh Token 已消费时，服务端不会伪造恢复成功，客户端必须重新 OAuth。“移除”才会永久删除该逻辑设备的授权记录和关联令牌。TRAE、Codex 与其他受支持客户端共用这套服务端逻辑。

## 插件版本更新

插件版本只从 `.codex-plugin/plugin.json` 读取，服务端 latest 清单、动态 ZIP 文件名、ZIP 内清单和静态打包脚本不再各自维护版本常量。`/plugin/latest.json` 提供 stable 版本、SHA-256 和机器可读更新元数据；`/plugin/install.json` 提供检查、应用、回滚与 OAuth 保留规则。

更新默认使用受信任的插件 `PreToolUse` Hook 自动执行：调用马良工具时检查 stable 版本，24 小时内最多联网一次。自动更新清单、ZIP、插件 homepage 与 MCP resource 必须全部位于同一个受信任 origin：公开与生产地址强制使用 HTTPS；用户明确选择的 `localhost`、loopback、私有局域网、link-local、CGNAT 或 IPv6 ULA 开发地址可以使用 HTTP。公开 HTTP 部署即使清单和 ZIP 哈希一致也只保留当前版本并安全跳过自动更新。兼容更新按 SemVer 比较并事务式替换本地 Marketplace，普通更新失败保留旧版且不中断图片调用，新版本在下个任务或重启 Codex 后生效；用户仍可显式切换为 `notify` 或 `off`。当前 Codex CLI 没有独立的 `plugin update` 命令，本地 Marketplace 通过下载校验、同级暂存、旧目录备份、固定目录切换和精确 selector 刷新完成；验证失败恢复旧目录。详细设计见 [神笔马良 Codex 插件版本与更新设计](./maliang-plugin-versioning.md)。

`0.3.0` 是首个带自动更新 Hook 的版本。已经安装的 `0.2.x` 或更早版本不会凭空获得本地 Hook，发布后需要先人工更新一次；完成这次引导更新并信任 Hook 后，后续兼容 stable 版本才会在使用时自动更新。

## 图片结果显示

`maliang_get_image_job` 成功后返回轻量的标准 `resource_link` 内容块，并在结构化元数据中提供带签名的原图 `downloadUrl`，不再返回体积较大的 base64 图片数据，避免客户端把工具响应序列化成文本后截断下载信息。链接默认 1 小时有效并绑定当前 OAuth 授权关系，连接失效后立即不可用；`resource_link.description` 使用北京时间方便用户阅读，机器字段 `expiresAt` 继续使用标准 UTC ISO 8601 格式。升级兼容期仍保留 `previewUrl` 字段，但它和 `downloadUrl` 指向同一个原始文件，不再返回 `preview` 派生图。Codex 宿主会先把图片保存到 `$CODEX_HOME/generated_images/<task>/`，最终回复再引用绝对本地路径。`0.4.4` 起，马良插件由 Codex 自动启动 bundled `maliang_local` stdio MCP；成功任务的 `downloadUrl` 与 `imageId` 只通过 Codex 托管的 MCP stdio 交给 `save_image_result`，后者复用 `maliang-helper.mjs` 的同源、大小、签名和格式校验，优先保存到 `$CODEX_HOME/generated_images/maliang/`，最终用绝对本地文件路径直接显示。

Codex 不要把 `resource_link`、局域网 `downloadUrl` 或兼容字段 `previewUrl` 直接写成 Markdown 图片；局域网 HTTP 地址可能被 URL 安全检查拦截。签名地址只能进入 `maliang_local.save_image_result`，不能进入 Shell 参数、临时文件、日志或浏览器。其他 MCP 客户端可以按自身能力展示 `resource_link` 或受管下载原图。

轮询期间可以等待，但最终成功查询必须放在一个新的独立 `functions.exec` 调用中，建议设置 `// @exec: {"yield_time_ms": 30000}`。不要在同一个调用里先长时间等待再查询图片，否则调用可能先进入 `functions.wait`。查询成功后调用 `maliang_local.save_image_result`，确认返回可读的绝对路径，再在最终回复中引用它；不能只看任务状态就声称图片已经交付。生成结果保存失败时必须报告交付未完成，绝不自动打开 Codex Browser、Chrome、Computer Use 或系统浏览器。Windows 返回的原生路径形如 `C:\Users\name\...\image.png`，写入 Codex Markdown 图片目标时必须规范化为 `/C:/Users/name/.../image.png`：使用正斜杠，并在盘符前保留一个 `/`。直接把反斜杠路径放进 Markdown 会产生无法加载的空图片框。

## Codex 本地附件自动上传

Remote MCP 运行在马良服务器，不能直接读取 Codex 所在电脑的本地路径。一次性 `uploadUrl` 仍作为短时、单用途的安全传输边界，但从 `0.4.7` 起不再由智能体启动额外 Node/Bun 子进程：当 Codex 当前消息已经提供可读的附件绝对路径时，插件先创建一次性地址，再把 `uploadUrl`、`uploadId` 和附件路径通过 Codex 托管的 stdio 交给 `maliang_local.upload_local_image`。本地 MCP 继续复用随包的 `maliang-helper.mjs`，以 `POST multipart/form-data` 的 `file` 字段提交图片；帮助器只接受实际内容与扩展名一致的 PNG、JPG、WebP 普通文件，最大 20 MB，并且只允许访问打包时绑定的马良 origin 下 `/mcp/upload/` 与 `/mcp/image-result/` 路径。一次性上传 URL 只能进入 `maliang_local.upload_local_image`，签名下载 URL 只能进入 `maliang_local.save_image_result`，两者都不能放入 argv、Shell 命令字符串、临时文件或日志。上传端还必须返回 JSON `status: uploaded` 与同一个 `uploadId`，任意 2xx HTML 页面或不匹配的 `uploadId` 都不能误报为成功。

自动上传完成后，插件仍调用 `maliang_get_image_upload` 核对同一个 `uploadId`，再把它交给 `maliang_edit_image`。只有宿主没有暴露任何本地可读路径，或 Node 20+ 未能启动 bundled `maliang_local` 时，才把原始一次性页面作为兜底交给用户；格式、同源、服务响应或 `uploadId` 校验失败时应报告准确错误，不能用浏览器绕过。

## Windows、macOS 与 Linux

三个平台使用同一个神笔马良插件 ZIP、同一个 Remote MCP endpoint、同一套 OAuth PKCE，以及同一份普通 ESM 本地帮助器 `maliang-helper.mjs`，不为不同平台或语言维护另一套上传或下载实现。Remote MCP、OAuth、生成、改图与任务轮询不依赖本地脚本运行时；Codex 用 Node 20+ 从插件根目录启动 bundled `maliang_local` stdio MCP，本地附件上传和原图保存都由该 MCP 调用同一份帮助器完成。Node 不可用时，本地附件只能使用一次性上传页；生成结果交付仍不得降级到浏览器，`maliang_local` 不可用或保存失败时只能准确报告交付未完成。

`0.4.0` 是本地能力收敛到单一 `.mjs` 权威实现的首个版本。过渡期继续随包保留 `auto-update.ts` 与 `windows-update-gate.ts`，只用于让已安装的 `0.3.x` 校验并升级；业务上传和保存不再运行 TypeScript 文件，也不维护完整 Python 双实现。

`0.4.2` 在 `0.4.1` 的 MCP 2026-07-28 兼容基础上进一步加固上传、结果链接、DCR 能力执行、本地帮助器同源约束、专用 Marketplace 更新和插件归档缓存。用户复制的安装指令保持不变。

Remote MCP OAuth 使用统一有效期策略：Access Token 默认 7 天，后台可设置 1～365 天；客户端动态注册声明 `refresh_token` 时，额外签发默认 90 天、可设置 30～3650 天的滚动 Refresh Token。Codex 已验证会在需要时自动刷新；其他客户端是否已经实际刷新，以用户设置“插件”连接详情中的“刷新能力”和“最近刷新”为准。服务重启不会主动清除数据库中的授权，配置变化只影响之后新签发或刷新的 Token。

`0.4.3` 禁止缓存授权绑定的图片结果，固定本地帮助器的文件大小与输出目录边界，并对 Node/Bun/PowerShell 自动更新下载执行流式硬限长。用户复制的安装指令仍保持不变。

`0.4.4` 把生成原图保存接入 Codex 托管的 bundled `maliang_local` stdio MCP：默认保存到 `generated_images` 后直接在任务中显示，删除生成结果的浏览器交付降级。用户复制的安装指令仍保持不变。

`0.4.5` 让远程 `maliang` 与本地 `maliang_local` MCP 都使用 Codex `approve` 模式；用户在任务中明确要求生图后，提交、轮询、保存和内联显示可按内置生图工具的流程直接完成，不再由非交互客户端取消生成调用。

`0.4.6` 移除远程结果指令中残留的浏览器回退，生成原图只通过 bundled `maliang_local` 保存到 `generated_images` 后以内联本地路径显示；同时统一 Marketplace 回滚备份保留规则，并让本地 MCP 只协商服务器明确支持的协议版本。

`0.4.7` 把本地附件自动上传接入同一个 bundled `maliang_local`：`upload_local_image` 通过 Codex 托管的 stdio 接收一次性地址、`uploadId` 和当前消息提供的附件路径，复用 `maliang-helper.mjs` 完成校验与提交，不再由智能体启动额外子进程。

平台差异只在本地路径和 Shell：

- Windows Marketplace：`%LOCALAPPDATA%\ShenbiMaliang\codex-marketplace`；图片默认位于 `%CODEX_HOME%\generated_images\maliang`，未设置时使用用户目录下的 `.codex`。
- macOS Marketplace：`~/Library/Application Support/ShenbiMaliang/codex-marketplace`；图片默认位于 `${CODEX_HOME:-$HOME/.codex}/generated_images/maliang`。`Application Support` 含空格，传给命令时必须解析成绝对路径并作为一个完整参数引用，不能照抄 PowerShell 或 Windows 反斜杠路径。
- Linux Marketplace：`~/.local/share/shenbi-maliang/codex-marketplace`；图片默认位于 `${CODEX_HOME:-$HOME/.codex}/generated_images/maliang`。

最终 Markdown 必须使用帮助器返回的当前平台绝对路径；Windows 只转换 Markdown 表示形式，不改变或移动本地文件。路径含空格时用尖括号包住目标。macOS 不需要也不允许通过 `xattr`、Gatekeeper 绕过或关闭 TLS 校验来安装此插件。公开/生产地址必须使用 HTTPS；`http://192.168.x.x` 只适用于用户明确选择的可信私有局域网测试服务。

机器安装清单要求 AI 在授权未完成时前台执行 `codex mcp login maliang`。如果命令输出了 HTTPS 授权地址但没有自动打开浏览器，AI 可以用当前可用的浏览器能力打开这个原始地址，或把它作为可点击链接交给用户。不得自行拼接、改写或复用授权地址，因为其中包含本次登录专属的回调地址、`state` 和 PKCE 参数。

如果登录命令没有输出授权地址，而是返回 OAuth 元数据、动态注册或 TLS 错误，应停止安装并报告原始错误；切换浏览器不能修复服务端协议或部署问题。只有命令明确报告成功并且 `maliang_account_status` 可用后，才能声明授权完成。

授权页首次提交后会立即锁定两个按钮并显示处理中，同时保留用户本次选择的“允许”或“取消”值。这样可避免本机回调尚未完成时因重复点击产生第二次 POST，覆盖第一次成功响应并把页面误导为“授权请求已失效”。处理中不要刷新、返回或再次提交；失败或超时时结束旧登录命令，再发起一次全新的登录并只使用新页面。

WorkBuddy 私有回调和 web HTTPS 回调在授权表单处理完成后使用 `303 See Other`，明确要求浏览器把表单 POST 转换为回调 GET，避免依赖 `302` 对 POST 的兼容性行为。普通 native loopback 回调继续由同源成功页在后台发起 GET，并轮询服务端确认授权码已经换成 Token 后再显示成功。

授权页的 CSP `form-action` 除 `'self'` 外，只加入本次动态注册并校验通过的精确 HTTP(S) 回调 origin（例如 `http://127.0.0.1:57553`），或 WorkBuddy 专用的 `workbuddy:` scheme source。不能只保留 `'self'`，否则浏览器可能接受授权 POST、服务端也生成授权码，却静默拦截后续回调；也不能使用宽泛的 `http:`、任意私有 scheme 或任意来源放开回调。

插件目录更新采用“下载并校验 -> 同级暂存解压 -> 保留旧目录 -> 切换 -> 安装验证”的事务式流程。切换或安装失败时恢复旧目录；ZIP 和暂存目录在切换结束后清理，始终保留最近一个旧 Marketplace 备份，下一次兼容更新开始前才清理更早的备份。
