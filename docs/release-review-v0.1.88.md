# v0.1.88 本地发布审核

日期：2026-11-17。本记录为发布前源码验证快照。正式发布包通过 GitHub Actions 构建，发布执行结果另行记录；业务部署与服务重启单独处理。

## 版本与内容

- 应用版本：`0.1.88`；随应用提供的 Codex 插件版本：`0.6.0`。
- 更新日志已写入 `docs/changelog.md`，包含中文和英文。
- 对话添加菜单提供顺时针旋转和关闭复位动画，旋转结束后显示独立的清晰 ×。创作提示词各入口统一使用官方 `PencilSparkles`；图标库锁定为 `lucide-react@1.73.0`，GitHub 品牌标志及其许可证一并更新。详见 [图标升级审查](lucide-upgrade-review-20261117.md)。
- WorkBuddy 只使用远程 `maliang`，图片信息同时出现在文本 JSON 和结构化结果中；使用客户端已有工具保存原图，再用 `present_files` 展示。
- 移除独立 `maliang_workbuddy` 及其安装、下载、交付票据和构建入口。
- MCP 使用官方 v2 SDK，保留旧协议兼容；本次源码还包含请求去重、设备授权连接隔离和 Codex 插件分发改进。可选 CIMD 和 issuer 响应声明保持默认关闭。
- 插件所需的 `.mcp.json`、本地 MCP 生成文件、第三方许可证、Hook 和 Skills 已一并准备。源码部署使用 `distribution/codex-marketplace/` 生成默认及可移植插件下载包，不依赖 `distribution/releases/` 中的历史 ZIP，无需额外手工打插件包。

## Bun 源码部署需要更新的内容

以正式 v0.1.87（`b6d87a7d979bf3cb6d636ef234af45db484b9145`）为比较基线。完整逐文件清单见 [部署文件清单](release-v0.1.88-files.json)。

| 路径 | 更新方式与作用 |
| --- | --- |
| `server/` | 同步本次源码；包括 `externalMcp*`、`internalDistributionRoutes.ts` 和 `schema.ts`。新增的连接、去重和 CIMD 模块必须一并带上。 |
| `scripts/` | 同步本次脚本，新增 Codex 本地 MCP 的构建入口、源文件及单一远程 MCP 冒烟脚本；移除下列旧 WorkBuddy 文件。 |
| `distribution/codex-marketplace/` | 整体同步，包括隐藏的 `.codex-plugin`、`.mcp.json`、本地 MCP 文件、许可证、Hook 和 Skills。服务端会从这里提供插件安装与下载。 |
| `docs/changelog.md` | 更新为含 v0.1.88 的日志；同步本次 MCP 安装、兼容性及发布说明。 |
| 根目录 `package.json`、`bun.lock`、`tsconfig.json` | 一并替换，分别提供新版版本号、依赖锁定和构建入口。 |
| 清单列出的 `src/` 文件 | 同步添加菜单动画、创作提示词图标和设置页 GitHub 标志；新增 `src/components/GithubMarkIcon.tsx`。 |
| `public/third-party-notices/github-octicons.txt` | 新增 GitHub 官方图形的 MIT 许可证，生产构建会复制到 `dist/third-party-notices/`。 |

`src/` 和 `public/` 应按逐文件清单覆盖，避免漏掉本轮图标改动。主目录里此前未发布的系列创作素材不属于本次清单。源码部署在目标机器重新生成 `node_modules/` 和 `dist/`，不需要复制本地构建目录。

### 从旧版本移除的文件

```text
scripts/WORKBUDDY_MCP_NOTICES.txt
scripts/build-workbuddy-mcp.ts
scripts/maliang-workbuddy-file-store.mjs
scripts/maliang-workbuddy-mcp-entry.mjs
scripts/maliang-workbuddy-mcp.mjs
scripts/smoke-workbuddy-delivery.ts
server/externalMcpWorkBuddy.test.ts
```

## 部署步骤

1. 停止旧服务并备份 `data/`。保留部署机器现有的 `.env`、`runtime/` 和自定义启动配置。
2. 按上述清单同步源码并移除旧文件。
3. 在部署目录执行 `bun install --frozen-lockfile`，再执行 `bun run check`、`bun run build`，最后按原有方式启动服务（源码启动命令为 `bun run start`）。
4. 首次启动会自动补齐 MCP 任务去重表和授权连接字段、迁移对应索引，保留原授权关系。无需手工执行 SQL；若回滚到旧源码，应一并恢复升级前备份的数据。
5. 在后台更新日志中点击“从 Markdown 同步”，勾选 `v0.1.88`。修改 Markdown 不会自动改写运行中的更新日志数据库。
6. WorkBuddy 重新加载远程 MCP 工具说明；曾安装额外 `maliang_workbuddy` 的客户端仅移除该条目，保留原 `maliang` 和 OAuth 授权。用已有图片核实保存与原生卡片展示。

## 此前验证

- 623 项项目回归通过，生产构建和服务端构建入口检查通过。
- 版本升为 0.1.88 后，类型与插件生成文件一致性检查、生产构建再次通过。
- 单一远程 MCP 的已有原图交付、文本兼容、部分结果、新旧协议和 OAuth 冒烟已通过；原图保存前后字节一致。
- 最终版本再次通过 MCP 冒烟；默认及可移植插件归档的内容检查通过，隐藏配置、插件版本、原图帮助器和第三方许可证均已核对。
- WorkBuddy 桌面卡片尚未完成本轮实机复验：窗口截图工具连续超时。上述原图验证属于协议和文件保存验证。

上述为发布前验证结果，实际发布状态以 GitHub Release 及后续发布记录为准。

## 此前本地清理结果

- 清理本轮生成的 7 个测试或临时审核目录及 TypeScript 缓存，共 1,533 个文件、722,955,231 字节（689.46 MiB）。保留源码、当前网页构建、历史发布基线和运行数据。
- 删除本地 `backup/gitee-master-before-github-merge`：已确认提交全部包含在 `master`。
- 删除本地 `github-main`：相同提交仍由 `github/main` 远程跟踪引用保存。
- 本地只剩 `master`；未改变当前提交，未推送或删除任何远程分支。

## 本轮最终复核（图标升级后）

- 审查了待发布的图标、动画、MCP 结果交付、插件分发及更新脚本改动，未发现仍需修复的发布阻断问题。
- 修正旧部署说明遗漏 `src/`、`public/` 的问题，补齐中英文更新日志和逐文件部署清单，重新计算文件大小及 SHA-256。
- `bun run check`、清理后的 `bun run build` 通过，本地 MCP 生成文件与源码一致。
- 全量回归覆盖 117 个文件、623 项测试：622 项通过，1 项创作上下文清理集成测试在 30 秒限制下超时；该项独立复跑约 4 秒通过，没有修改测试断言或放宽超时。
- 以 GitHub v0.1.87 为基线的独立公开发布检出另行验证：113 个文件、618 项测试全部通过，类型检查、生产构建及 MCP 冒烟全部通过。前述 623 项为开发工作区的统计。
- 本地 MCP 冒烟通过：验证新旧协议、授权、请求去重、已有原图保存、部分结果交付及旧辅助下载路由移除；仅使用隔离数据库、模拟任务和测试原图。
- 图标和动画的 210 个 SVG 静态渲染检查及桌面/手机、深浅主题验证结果见[图标审查记录](lucide-upgrade-review-20261117.md)。
- 本轮删除 56 处临时构建、旧审核副本依赖缓存和隔离测试数据，共 146,908 个文件、3,543,413,950 字节（约 3.30 GiB）。源码、Git 检出和历史、补丁、当前 `node_modules/` 与 `dist/`、业务数据、运行环境、生成作品和历史发布包均保留。逐项记录见[清理清单](project-cleanup-20261117.json)。

本地审查、构建和清理已完成；本记录本身不代表已经发布版本、迁移业务数据库或重启服务。
