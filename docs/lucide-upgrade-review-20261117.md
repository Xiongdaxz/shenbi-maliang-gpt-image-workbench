# Lucide 图标库升级与代码审查（2026-11-17）

## 变更

- 将 `lucide-react` 从 `0.562.0` 升级并锁定为 `1.73.0`，同步更新 `bun.lock`。与执行前保存的工作区依赖文件比较，仅此依赖的版本与校验记录变化。
- 六个组件直接从 `lucide-react` 引入官方 `PencilSparkles`，删除 `InlineIcons.tsx` 中临时复制的图形路径。
- 新版不再导出 `Github`。设置导航和 GitHub 链接改用 GitHub 官方 Octicons 标志，保留尺寸、主题跟色、装饰性图标的无障碍属性与引用转发。
- GitHub 图形的 MIT 声明保留在组件源文件，并放入 `public/third-party-notices/github-octicons.txt`，由 Vite 复制到构建产物。
- 保留加号旋转及旋转结束后显示独立 × 的实现。新版 `Plus`、`X` 的路径与此前使用的路径一致。

## 审查

审查范围为本次依赖升级、提示词图标引用、GitHub 标志兼容，以及前两次修改的加号动画。

- 类型与导出：生产构建的 TypeScript 检查通过；扫描项目全部直接图标引用，210 个运行时图标均可通过 React 静态渲染生成指定尺寸的 SVG，没有缺失导出。
- 图标维护：已移除本地 `PencilSparkles` 封装和旧 `Github` 导入；表单自选图标映射继续使用原有名称。
- 动画状态：展开状态仍由原有 `aria-expanded` 驱动；没有新增计时器、事件监听或异步状态。已验证关闭路径与快速反向切换。
- 品牌标志：使用官方 SVG 路径，随父元素颜色变化；`aria-hidden`、`focusable` 和引用类型检查通过。原有 GitHub 入口开关逻辑继续生效。
- 依赖范围：本次安装仅更新一个包，使用 `--ignore-scripts`，没有修改其他依赖版本。

已处理兼容问题，未发现本次改动仍有需要修复的问题。

## 验证

- `bun run build`：通过。保留既有的大包体积提示；主脚本 gzip 从 729.26 kB 增至 732.68 kB，CSS 构建内容未变。
- `bun test src`：54 个文件、257 个测试通过，0 失败。
- 210 个项目引用图标的静态渲染检查：通过。
- 本机 Chrome：使用实际 React 组件和生产构建 CSS，接口使用内存测试数据；桌面与 375px 手机视口均通过。
- 界面检查覆盖：对话快捷菜单、提示词面板、更多菜单、功能介绍、设置关于页及 GitHub 链接。
- 动画检查覆盖：按钮开关、Esc、外部点击、选择菜单项、快速连续开关和减少动态效果设置。
- GitHub 标志的浅色、深色显示检查通过；浏览器无页面异常或控制台错误。

## 参考

- https://www.npmjs.com/package/lucide-react/v/1.73.0
- https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg
- https://github.com/primer/octicons/blob/main/LICENSE
