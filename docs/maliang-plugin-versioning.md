# 神笔马良 Codex 插件版本与更新设计

## 目标

- 登录、安装和更新流程由机器清单与测试约束，不依赖模型临场补全步骤。
- 更新默认自动执行，但只作用于神笔马良自己的 stable Marketplace 和精确插件 selector，不覆盖其他 Marketplace 或 MCP 配置。
- 下载或校验失败不触碰当前版本；切换后验证失败可以恢复旧版本。
- 兼容更新尽量复用现有 OAuth，只有刷新后的 MCP 明确返回 `Auth required` 才重新授权。

## 单一版本源

`distribution/codex-marketplace/plugins/maliang-image-generator/.codex-plugin/plugin.json` 的 `version` 是唯一版本源。

服务端 `/plugin/latest.json`、动态 ZIP 文件名、ZIP 内插件清单和 `scripts/package-maliang-codex-plugin.ts` 都在运行时读取这个值。打包脚本仍可接收期望版本，但该参数只用于防误发校验，不再提供默认版本或覆盖插件清单。

发布前必须满足：

1. 版本符合 SemVer。
2. `/plugin/latest.json`、ZIP 文件名和 ZIP 内 `plugin.json` 版本一致。
3. ZIP 的字节数与 SHA-256 和 latest 清单一致。
4. 安装清单的浏览器授权状态机、更新策略和完成门槛测试通过。

## 版本规则

当前处于 `0.x`：

- `PATCH`：不改变工具名、MCP endpoint 和目录结构的缺陷修复、Skill 指令修正、文案或测试增强。
- `MINOR`：新增工具、能力、安装协议字段或需要客户端重新加载的兼容功能。
- 不兼容变更：优先通过一段兼容期和迁移字段完成；若必须修改 technical ID、MCP 名称、requiredTools 或归档根目录，单独提供迁移清单，不能伪装成普通补丁更新。

每次稳定发布应记录 `releasedAt` 和面向用户的简短 release notes。未来增加 beta 时使用独立 `/plugin/channels/beta/latest.json`，stable 客户端不得自动跟随 beta。

## 分发清单

`/plugin/latest.json` 是 stable 指针，至少包含：

- `version`、`channel`、`releasedAt`；
- `downloadUrl`、`size`、`sha256`、`archiveRoot`；
- 插件 selector、MCP resource 和认证策略；
- `update.protocolVersion`、版本比较规则、是否允许自动更新、是否需要用户批准和重启要求。
- 默认模式、支持模式、检查间隔、生效时机、兼容性、失败策略和首次 Hook 信任要求。

`/plugin/install.json` 在 latest 基础上提供完整 `updatePolicy`，把检查、应用、回滚和 OAuth 保留规则拆成独立字段，供能力较弱的模型逐项执行。

生产环境通过 HTTPS 同源获取清单与 ZIP，SHA-256 防止下载损坏或清单不匹配。更新器强制检查插件 homepage、清单、ZIP 和 MCP resource 使用同一个受信任 origin：公开与生产地址必须使用 HTTPS；用户明确选择的 `localhost`、loopback、私有局域网、link-local、CGNAT 或 IPv6 ULA 开发地址可以使用 HTTP。公开 HTTP 地址即使同源且哈希一致也会在触碰当前安装前失败并保留旧版，因为攻击者可以同时替换清单与 ZIP。若未来需要跨源 CDN 或离线镜像，应再增加带 `keyId` 的 Ed25519 清单签名；不能把 SHA-256 当作脱离可信清单后的发布者签名。

## 更新状态机

### 1. 检查

1. 用户首次安装或 Hook 定义变化后审查并信任插件 Hook；Codex 未信任时会跳过，不能宣称自动检查已经运行。
2. 受信任的 `PreToolUse` Hook 在 `mcp__maliang__.*` 工具调用前运行；默认 `auto`，通过 `PLUGIN_DATA/update-state.json` 保证 24 小时内最多联网检查一次。
3. 用当前插件 `plugin.json` 读取已加载版本，用 `codex plugin list --json` 找到精确 selector `maliang-image-generator@maliang-internal` 和已安装版本。
4. 只从插件 `homepage` 同源的 `/plugin/latest.json` 获取 stable 清单并按 SemVer 比较；latest 小于或等于当前版本时结束。
5. `auto` 自动应用兼容更新，`notify` 只提示，`off` 不检查。缺少设置时使用 `auto`；用户可通过 `PLUGIN_DATA/update-settings.json` 或 `MALIANG_PLUGIN_UPDATE_MODE` 显式覆盖。

### 2. 准备

1. 下载 ZIP 到临时文件，校验 `size` 与 `sha256`。
2. 解压到 durable Marketplace 的同级暂存目录。
3. 校验 `archiveRoot`、Marketplace 名称、插件名称、版本、同源 homepage、MCP endpoint、Hook 入口、更新器和两个 Skill 入口，并递归拒绝符号链接。
4. 任一检查失败即删除或保留临时诊断文件，不触碰当前安装。

### 3. 切换

1. 将当前神笔马良 Marketplace 目录改名为带旧版本和时间戳的备份。
2. 把暂存目录原子切换到固定 durable 目录。
3. 执行 `codex plugin add maliang-image-generator@maliang-internal --json` 刷新精确插件；当前 Codex CLI 没有独立的 `plugin update` 命令，因此不能编造该命令，也不能用只面向 Git Marketplace 的 `marketplace upgrade` 代替本地目录更新。
4. 不删除或修改其他插件、Marketplace 和全局 MCP。

### 4. 验证

1. `codex plugin list --json` 显示目标版本并处于 enabled。
2. 当前任务继续使用已经加载的旧工具目录，不宣称热更新，也不中断本次普通图片调用。
3. 重启 Codex 或新建任务后，确认 `codex mcp get maliang --json` 仍指向清单中的 MCP resource，requiredTools 全部可见。
4. `maliang_account_status` 确认账号授权；只有收到 `Auth required` 才运行新的 OAuth 浏览器状态机。

### 5. 提交或回滚

- ZIP 和暂存目录在切换结束后清理；始终保留最近一个旧 Marketplace 备份，下一次兼容更新开始前才安全清理更早的备份。这样普通工具调用不需要额外的 `PostToolUse` 进程。
- 目录切换、插件刷新或 MCP 初始化失败时，恢复旧目录并重新加载旧 selector，报告实际仍在使用的版本。
- 网络、清单、下载、解压、文件系统或刷新失败默认保留当前版本并继续本次工具调用；只有清单同时标记 `incompatible`、`critical` 和 `blockOldVersion` 时才阻断旧工具并要求人工迁移。
- OAuth 成功但工具未热刷新属于“等待客户端重载”，不是更新成功的完整证据，也不应立即清除备份。

## Hook 生命周期与信任

插件通过 `.codex-plugin/plugin.json` 的 `hooks` 字段加载 `hooks/hooks.json`。当前 Codex 只执行同步 command Hook，因此更新检查在 `PreToolUse` 内完成，不能标记为异步，也不能声称后台热更新。

`0.3.0` 是第一个包含自动更新 Hook 的版本。已经安装的 `0.2.x` 或更早版本没有本地 Hook，服务端不能隔空执行用户电脑上的更新器，因此发布后必须先人工更新一次到 `0.3.0` 或更高版本；从这次引导更新之后，兼容 stable 更新才默认自动完成。

Hook 命令从 `PLUGIN_ROOT` 运行受版本控制的更新器，只把设置、检查状态、锁和诊断日志写入可写的 `PLUGIN_DATA`。macOS/Linux 优先用 Node 20+ 执行 `auto-update.mjs`，Node 不满足时由 Bun 执行过渡兼容的 `auto-update.ts`，分别通过 `ditto`/`unzip` 解压；两者都不存在时安全跳过更新检查，不影响 Remote MCP。Windows 直接进入 `auto-update.ps1`，脚本内部读取模式与 24 小时缓存，再由 PowerShell 执行 `Invoke-WebRequest`、`Expand-Archive` 和精确的 `codex plugin add`，完全不要求 Node 或 Bun。插件首次安装或 Hook 定义发生变化后，用户必须审查并信任该 Hook；信任的是精确定义，未信任时 Codex 会跳过。

`0.4.0` 开始，本地附件上传和原图持久化统一由普通 ESM 文件 `maliang-helper.mjs` 实现，Node 20+ 与 Bun 执行同一份代码，不维护 Python 或 TypeScript 业务副本。`auto-update.ts` 和 `windows-update-gate.ts` 暂时保留在 ZIP 中，仅用于兼容已安装 `0.3.x` 的更新包校验；新版校验器同时要求 `auto-update.mjs` 与 `maliang-helper.mjs` 存在，避免安装缺少权威运行文件的归档。

`0.4.1` 要求自动更新全链路使用同源 HTTPS；本地帮助器只从标准输入接收一次性或签名 URL，并严格验证服务端上传确认。MCP server info、latest 清单、ZIP 文件名和 ZIP 内清单都读取同一个插件版本源，避免客户端同时看到不同版本。

`0.4.2` 在 MCP 2026-07-28 兼容基础上进一步加固上传、结果链接、DCR 能力执行、本地帮助器同源约束、专用 Marketplace 更新和插件归档缓存。

`0.4.3` 进一步禁止缓存授权绑定的图片结果，固定本地帮助器的上传、下载和输出目录边界，并让 Node、Bun 与 PowerShell 更新器在读取远程清单和 ZIP 时按流量硬限长，避免无 `Content-Length` 响应耗尽内存或磁盘。

`0.4.4` 增加由 Codex 从插件根目录启动的 bundled `maliang_local` stdio MCP。成功任务的签名原图地址只通过 Codex 托管的 MCP stdio 进入 `save_image_result`，继续复用 `maliang-helper.mjs` 的唯一下载实现，保存到 `$CODEX_HOME/generated_images/maliang` 后用绝对路径直接显示。生成结果不再自动打开任何浏览器；本地保存不可用时按未完成交付报告。

`0.4.5` 为远程 `maliang` MCP 补齐 Codex `approve` 模式，与 bundled `maliang_local` 保持一致。用户已经在任务中要求生图时，Codex 可直接提交生成、轮询、持久化并内联显示，不再让非交互任务把生图调用误报为“用户取消”；自动更新在切换前也会验证这一配置。

`0.4.6` 删除远程图片结果中残留的浏览器交付回退，签名原图地址只允许进入 bundled `maliang_local.save_image_result`，保存后按绝对本地路径内联显示；安装清单统一为保留最近一个 Marketplace 回滚备份到下一次兼容更新前，本地 MCP 对未知客户端协议版本回退到服务器支持版本。

`0.4.7` 把本地附件上传也接入已有的 bundled `maliang_local` stdio MCP：Codex 通过 `upload_local_image` 传递一次性地址、`uploadId` 和当前消息提供的附件绝对路径，由同一份 `maliang-helper.mjs` 完成格式、大小、同源与上传响应校验。智能体不再为上传启动 Node/Bun 子进程；只有附件没有可读路径或本地 MCP 未启动时才打开一次性上传页。

`0.4.8` 让自动更新器与服务端公开地址校验保持一致：HTTPS 继续用于公开与生产部署；用户明确选定的 `localhost`、loopback、私有局域网、link-local、CGNAT 与 IPv6 ULA HTTP 开发地址可以执行同源、SHA-256 和归档校验后的自动更新，公开 HTTP 地址仍被拒绝。

更新器的正常输出保持安静。只有发现更新、完成更新、更新失败或出现强制不兼容迁移时，才通过 Hook 结构化输出告知当前任务。普通错误 fail-open，不能因为更新服务暂时不可用而让文生图、改图或任务查询不可用。

## OAuth 浏览器状态机

更新后的 Skill 与安装清单统一使用以下顺序：

1. 前台、可见、可持续读取输出地运行 `codex mcp login maliang`，保持进程和 loopback 回调存活。
2. 允许系统默认浏览器先尝试；沙箱限制 GUI 时申请本次命令所需的窄权限，不得无证据宣称已打开。
3. 5 秒内未出现系统浏览器且当前命令已经输出原始授权 URL 时，依次使用 Codex 内置 Browser、已连接 Chrome、Computer Use、用户可点击链接。
4. 浏览器兜底必须使用同一登录进程生成的原始 URL，且在进程超时前完成；命令退出后旧 URL 立即作废并重新发起。
5. 完成门槛是 CLI 成功、endpoint 正确、工具已加载、账号已授权四项全部成立。

## 发布流程

1. 修改 Skill、Hook、帮助器或清单，并按版本规则更新唯一 `plugin.json` 版本。
2. 更新 release notes 与 `releasedAt`。
3. 运行插件分发、OAuth、上传和结果保存测试。
4. 运行 `bun run check`、`bun run build`、`git diff --check`。
5. 用正式 public base URL 生成候选 ZIP，复核 SHA-256、大小和内容清单。
6. 在隔离的 Codex 配置或测试机验证“旧版本检查 -> 更新 -> OAuth 复用/必要时重新授权 -> 新任务工具加载 -> 生图”。
7. 只有候选验证完成后才部署 stable 清单和 ZIP；源代码完成不等于已发布或用户端已更新。
