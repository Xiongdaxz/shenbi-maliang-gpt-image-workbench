# 小马良版本提醒动画

## 视觉方向

- 角色延续项目现有国风绘本语言：Q 版小画师、米白汉服、青绿色腰封和飘带、黑金白毫神笔。
- 页面文字、版本号和按钮全部由 React 渲染，生成图片只承载透明背景角色动作。
- 六帧依次为：探头挥手、发现更新、抓住卡片、用力拉动、后退站稳、指向卡片。

## 资源

- `frames/maliang-update-frame-01.png` 至 `06.png` 是马良生成并人工检查的透明原始帧。
- `maliang-character-master.png` 是角色定稿，`prompts.md` 保存可复用的生成约束和动作分镜。
- 待机提醒使用 `maliang-update-idle-01.webp` 的静态挥手姿势；鼠标移入小马良时轻微放大并抬起，提示用户可以点击，不播放待机循环。拉卡片时仍使用 `maliang-update-sprite.webp` 的六帧动作。
- `idle/` 保存曾用于动作探索的待机原始帧，当前运行时和构建脚本都只使用第一张静态挥手图。
- 重新生成精灵图：`bun run build:app-update-sprite`。

## 动画契约

- 桌面端角色从右下角出现，点击后在 760ms 内向左拉出卡片。
- 关闭卡片、关闭日志或选择稍后更新时，用 520ms 反向动画收回卡片并恢复小马良入口；只有刷新成功后入口才消失。
- 移动端沿用同一静态挥手图，卡片从底部向上出现。
- `prefers-reduced-motion: reduce` 时跳过逐帧和位移动画，直接显示最终姿态。
- 不要改变六帧顺序或精灵图的横向布局；CSS 使用 `steps(5, end)` 从第一帧播放至第六帧。

## 本地预览

先确保当前前端已经构建，然后停止占用目标端口的正式服务，执行：

```powershell
bun run preview:app-update
```

预览命令不会修改 `package.json`，默认把服务端模拟成当前版本的下一个补丁版本，例如 `0.1.79 → 0.1.80`。脚本内设置的服务端模拟版本不会污染父 PowerShell；若还用 `VITE_APP_VERSION_OVERRIDE` 构建了前端，测试后必须恢复 `dist`，否则普通的 `bun run start` 仍会加载模拟版本的前端。

需要指定其他目标版本时，可在当前 PowerShell 会话设置 `GPT_IMAGE_APP_VERSION_OVERRIDE`；测试结束后用 `Remove-Item Env:GPT_IMAGE_APP_VERSION_OVERRIDE` 清除手动设置。

要完整模拟“点击刷新后提醒消失”，需要让 `dist` 也切换到新版本：

```powershell
# 先启动 preview:app-update，旧页面保持打开
$env:VITE_APP_VERSION_OVERRIDE = "0.1.80"
bun run build
Remove-Item Env:VITE_APP_VERSION_OVERRIDE
```

然后回到旧页面点击“刷新并更新”。这次刷新会加载刚构建的 `0.1.80` 前端，版本提醒才会消失；如果只启动 `preview:app-update` 而不重新构建 `dist`，刷新后仍然是 `0.1.79` 前端，提醒再次出现是预期行为。

预览日志数据可以用下面的幂等命令写入本地 `data/config.db`：

```powershell
bun run seed:app-update-preview
```

它会写入 `v0.1.80` 和 `v0.1.81` 两条示例记录；重复执行会跳过已存在的版本，不覆盖任何现有日志。清理时也只删除 ID、版本、日期和内容均保持原样的预览记录；手工修改过的记录会保留。日志预览使用现有 `data/config.db`，因此不要把预览内容当作正式发布日志。

测试完成后停止预览服务，移除脚本创建的预览记录，并在不带版本覆盖的环境中重新构建前端：

```powershell
bun run seed:app-update-preview --clear
Remove-Item Env:GPT_IMAGE_APP_VERSION_OVERRIDE -ErrorAction SilentlyContinue
Remove-Item Env:VITE_APP_VERSION_OVERRIDE -ErrorAction SilentlyContinue
bun run build
```

之后再运行 `bun run start`。普通构建会把前端版本恢复为 `package.json` 中的真实版本。正式发布新版本前，还需在后台将对应的 `docs/changelog.md` 记录同步到更新日志数据库；未同步时提醒仍会出现，但日志窗口会显示“更新日志还在整理”。

## 马良生成方式

先生成一个透明背景角色定稿，再以同一个历史图片 ID 和高输入保真分别编辑六种动作。动作帧必须保持人物身份、服装、发髻、配色、镜头距离和脚底基线一致，不生成卡片、文字、场景或阴影。
