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
3. 在“图片通道 / 账号池”中配置图片 Provider，例如 OpenAI 兼容接口、CPA 代理、ChatGPT Web 或私有图片接口。
4. 如果使用 CPA 账号池，在“CPA 同步”中填写同步地址和访问凭据，开启同步并先手动同步一次，让后台拉取账号、额度和可用状态。
5. 在“模型配置”中配置文本模型，用于提示词优化、标题生成、每日灵感文案和安全审核等后台能力。推荐优先使用 `DeepSeek`；轻量文本任务也可以使用 `v4Flash`。
6. 创建普通用户账号，或按你的部署方式开放用户注册。
7. 回到前台工作台，用普通用户账号登录后开始生图和编辑图片。

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

正式版本会在 GitHub Releases 提供以下发布包：

| 类型 | 平台/架构 | 包名 | 格式 | 启动方式 |
| --- | --- | --- | --- | --- |
| 便携运行包 | Windows x64 | `shenbi-maliang-X.Y.Z-windows-x64-portable.zip` | zip + exe | 解压后进入 `shenbi-maliang` 目录，双击 `ShenbiMaliang.exe` |
| 便携运行包 | Windows ARM64 | `shenbi-maliang-X.Y.Z-windows-arm64-portable.zip` | zip + exe | 适合 Windows ARM 设备，解压后进入 `shenbi-maliang` 目录，双击 `ShenbiMaliang.exe` |
| 便携运行包 | Linux x64 | `shenbi-maliang-X.Y.Z-linux-x64-portable.zip` | zip + 可执行文件 | 解压后进入 `shenbi-maliang` 目录，执行 `chmod +x ./shenbi-maliang && ./shenbi-maliang` |
| 便携运行包 | macOS Intel | `shenbi-maliang-X.Y.Z-macos-x64-portable.zip` | zip + 可执行文件 | 解压后进入 `shenbi-maliang` 目录，执行 `chmod +x ./shenbi-maliang && ./shenbi-maliang` |
| 便携运行包 | macOS Apple Silicon | `shenbi-maliang-X.Y.Z-macos-arm64-portable.zip` | zip + 可执行文件 | 解压后进入 `shenbi-maliang` 目录，执行 `chmod +x ./shenbi-maliang && ./shenbi-maliang` |
| 源码运行包 | Windows / Linux / macOS | `shenbi-maliang-X.Y.Z-source-run.zip` | zip + 源码 | Windows 执行 `start-update.bat`；Linux/macOS 执行 `bash ./start.sh` |

`shenbi-maliang-X.Y.Z-source-run.zip` 不包含 exe、`node_modules` 和构建产物，也可以手动执行 `bun install --frozen-lockfile`、`bun run build`、`bun run start`。GitHub Release 页面还会自动提供原始 `Source code (zip)` 和 `Source code (tar.gz)`；如果要查看完整仓库历史，建议直接 `git clone`。运行数据会自动创建到 `data/`，升级前请先备份 `data/`。

## 🙏 鸣谢

本项目的前台页面设计和对话交互体验参考了 ChatGPT Web 端。

项目在 ChatGPT Web 图片链路、CPA/Responses 路由和接口兼容设计上参考了以下开源项目，特此感谢：

- [chatgpt2api](https://github.com/basketikun/chatgpt2api)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## ⚠️ 免责声明

本项目主要用于学习研究、技术交流、内部技术验证、私有部署和二次开发参考，不提供任何官方模型服务、账号额度、API Key 或商业服务承诺。

- 本项目不是 OpenAI、ChatGPT 或相关服务商的官方项目，也未获得其官方背书。
- 使用者应自行遵守所在地区法律法规，以及 OpenAI、ChatGPT、模型供应商、代理服务和第三方接口的服务条款、使用政策与内容规范。
- 请勿将本项目用于未授权的商业化服务、违法违规内容生成、侵犯他人权益、绕过访问控制、批量滥用接口或其他违反服务条款的用途。
- 使用账号、Cookie、代理、逆向接口或自动化请求能力时，可能触发第三方服务的风控、验证码、限速、额度扣减、临时限制、账号封禁或服务终止等风险。请仅使用你有权使用的账号和接口，不建议使用重要主账号或生产账号进行测试。
- 使用者应自行管理 API Key、Cookie、账号凭据、代理配置和运行数据，因配置泄露、账号风险、接口费用、生成内容或数据合规问题造成的后果由使用者自行承担。
- AI 生成内容可能存在不准确、不适宜、侵权或不符合预期的情况。将生成内容用于公开发布、生产环境或商业场景前，请自行进行人工审核、版权确认和合规评估。
- 本免责声明不构成法律意见。如需用于商业或生产环境，请根据实际业务场景咨询专业法律或合规意见。
- 本项目按现状提供，不承诺稳定性、可用性、适配性或结果准确性。任何部署、改造、集成和使用行为均由使用者自行判断并承担风险。

## 📄 许可证

MIT。详见 [LICENSE](LICENSE)。
