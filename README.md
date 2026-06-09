# 神笔马良 GPT Image Workbench

简体中文 | [English](README.en.md)

神笔马良 GPT Image Workbench 是一个面向团队内部私有部署的 AI 图片生成与图片编辑工作台。

## ✨ 亮点功能

- 🖼️ AI 图片生成与图片编辑工作台，面向真实团队创作流程。
- 💬 前台页面设计和对话交互体验参考 ChatGPT Web 端，上手成本低。
- 🧭 前台工作台与后台配置中心分离，普通用户创作，管理员统一维护。
- 🧩 统一管理图片生成入口、团队账号、素材、案例和提示词模板。
- 🔌 支持接入 OpenAI 兼容接口、CPA 代理、ChatGPT Web 或私有图片接口。
- 🔐 数据默认保存在本地，适合团队内部使用、私有部署和二次开发。

## 🎬 项目演示

- 演示视频：录制完成后补充。
- 视频建议展示：便携包启动、前台图片生成与编辑、素材/案例管理、后台 Provider 和账号池配置。
- 截图素材建议放在 `docs/images/`，README 后续可以直接引用。

## 🧭 在线预览

- GitHub Pages: <https://xiongdaxz.github.io/shenbi-maliang-gpt-image-workbench/>

在线地址是静态前端预览，用于查看界面和项目风格；登录、后台配置、图片生成、文件存储等完整功能需要按下面步骤本地部署后使用。

## 🚀 快速启动

```bash
bun install
bun run build
bun run start
```

启动后访问：

- 前台工作台：http://127.0.0.1:8787
- 后台配置：http://127.0.0.1:8787/config
- 健康检查：http://127.0.0.1:8787/api/health

开发调试时可以分别启动后端和前端：

```bash
bun run dev:api
bun run dev:web
```

## 🧑‍💻 第一次使用

1. 打开 `http://127.0.0.1:8787/config`。
2. 按页面提示初始化后台管理密码。
3. 在后台配置图片 Provider，例如 OpenAI 兼容接口、CPA 代理、ChatGPT Web 或私有图片接口。
4. 创建普通用户账号，或按你的部署方式开放用户注册。
5. 回到前台工作台，用普通用户账号登录后开始生图和编辑图片。

## 🖌️ 前台功能

前台面向普通使用者，主要用于图片创作和素材管理：

- 💬 对话式文生图。
- 🪄 基于已有图片继续编辑。
- 🖼️ 上传本地图片作为参考图。
- 🗂️ 从素材库选择参考素材。
- 🕘 查看历史对话和生成图片。
- ⭐ 收藏、下载、预览和管理生成图片。
- 💡 将满意的图片加入灵感案例。
- 🧱 使用提示词模板快速生成结构化提示词。
- 👥 管理个人素材和共享素材。

## ⚙️ 后台功能

后台入口是 `/config`，面向管理员和部署维护者：

- 👤 管理普通用户、团队分组和账号状态。
- 🎛️ 配置图片 Provider、模型、尺寸、质量、路由模式和重试策略。
- 🔀 管理 CPA、ChatGPT Web、API 等不同图片通道。
- 🧮 配置账号池、额度刷新和请求日志。
- 📮 配置代理、邮件、短信、注册和找回密码。
- 🧰 管理灵感案例、共享素材审核和品牌资源。
- 📊 查看后台审计日志、图片请求日志和模型请求日志。
- 🕹️ 调整全局开关和部分运行时配置。

## 💾 运行数据

项目会在本地生成 `data/` 目录：

- `data/app.db`：普通用户、对话、图片、素材、案例等业务数据。
- `data/config.db`：后台密码、Provider、密钥、账号池、代理、邮件/短信等配置。
- `data/files/`：生成图片、上传素材、遮罩和引用图。

迁移或备份时，优先备份整个 `data/` 目录。

## 🗃️ 项目结构

```text
server/   后端接口、图片路由、数据库初始化、文件服务
src/      前台和后台页面、组件、状态管理、API client
public/   静态资源
scripts/  辅助脚本
docs/     路由、数据库等说明文档
data/     本地运行数据目录，启动后自动生成
```

## 📦 发布包

正式版本会在 GitHub Releases 提供便携压缩包：

- `shenbi-maliang-windows-x64-portable.zip`：解压后进入 `shenbi-maliang` 目录，双击 `ShenbiMaliang.exe`。
- `shenbi-maliang-linux-x64-portable.zip`：解压后进入 `shenbi-maliang` 目录，执行 `chmod +x ./shenbi-maliang && ./shenbi-maliang`。
- `shenbi-maliang-macos-arm64-portable.zip` / `shenbi-maliang-macos-x64-portable.zip`：按芯片架构下载，解压后进入 `shenbi-maliang` 目录，执行 `chmod +x ./shenbi-maliang && ./shenbi-maliang`。

GitHub Release 页面也会自动提供 `Source code (zip)` 和 `Source code (tar.gz)`，方便开发者下载源码或二次开发。便携包会在可执行文件旁自动创建 `data/` 目录，升级前请先备份 `data/`。

## 🙏 鸣谢

本项目在图片接口兼容、ChatGPT Web 图片链路和 CPA/Responses 路由设计上参考了以下开源项目，特此感谢：

- [ChatGpt-Image-Studio](https://github.com/peiyizhi0724/ChatGpt-Image-Studio)
- [chatgpt2api](https://github.com/basketikun/chatgpt2api)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## 📄 许可证

MIT。详见 [LICENSE](LICENSE)。
