# Windows 10 部署文档

本文档用于在 Windows 10 上部署本项目：本地 Bun + React GPT 图片工作台。

生产运行时只需要启动一个 Bun 后端服务。后端会同时提供：

- 前端静态页面：`dist/`
- 后端接口：`/api/*`
- 图片和素材文件访问：`/files/*`
- 配置入口：`/config`

默认启动后，本机和同一局域网都可以访问。

本机访问地址：

- 主应用：`http://127.0.0.1:8787`
- 配置入口：`http://127.0.0.1:8787/config`
- 健康检查：`http://127.0.0.1:8787/api/health`

局域网访问地址：

- 主应用：`http://服务器IP:8787`
- 配置入口：`http://服务器IP:8787/config`

## 1. 环境要求

- Windows 10 1809 或更高版本。
- PowerShell。
- Bun 运行时。没有安装时，`start-update.bat` 会提示是否自动安装。
- 8787 端口未被占用，或准备使用自定义端口。
- 服务器能访问你配置的图片生成上游，例如 Studio、CPA 或自定义接口。

Bun 官方安装文档：<https://bun.sh/docs/installation>

安装 Bun：

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

安装后重新打开 PowerShell，验证：

```powershell
bun --version
```

如果提示找不到 `bun`，先重新打开终端；仍然不行时，检查用户环境变量 `Path` 是否包含 Bun 安装目录。

如果目标机器访问 GitHub 失败，可以在一台已经能运行 Bun 的 Windows 机器上执行：

```powershell
where bun
```

找到 `bun.exe` 后，把它复制到项目目录：

```text
runtime\bun\bun.exe
```

例如目标项目是 `E:\maliang`，最终路径就是：

```text
E:\maliang\runtime\bun\bun.exe
```

`start-update.bat` 会优先使用这个项目内置 Bun。

如果目标机器也无法访问 npm 依赖源，请把开发机上的 `node_modules/` 一起复制到目标项目目录。`start-update.bat` 在依赖安装失败但发现已有 `node_modules/` 时，会继续使用现有依赖构建和启动。

## 2. 准备项目目录

建议把项目放到固定目录，例如：

```text
D:\apps\shenbi-maliang
```

进入项目目录：

```powershell
cd D:\apps\shenbi-maliang
```

生产部署至少需要这些内容：

- `package.json`
- `bun.lock`
- `server/`
- `src/`
- `public/`
- `index.html`
- `vite.config.ts`
- `tsconfig.json`
- `tailwind.config.ts`
- `postcss.config.js`
- `data/`，如果是迁移已有数据


## 3. 安装依赖

首次部署执行：

```powershell
bun install --frozen-lockfile
```

如果本机 `bun.lock` 和 `package.json` 已经不一致，先在开发机确认依赖变化，再决定是否改用：

```powershell
bun install
```

## 4. 一键启动和更新

项目根目录已经提供一键脚本：

```text
start-update.bat
```

`start-update.bat` 默认同时支持本机和局域网访问。

直接双击它，或在 PowerShell / CMD 中执行：

```powershell
.\start-update.bat
```

局域网访问地址是：

```text
http://服务器IP:8787
```

这个 bat 会自动完成：

1. 进入项目根目录。
2. 检查 Bun 是否可用；如果没有 Bun，会提示是否自动安装。
3. 执行 `bun install --frozen-lockfile`。
4. 执行 `bun run build`。
5. 停掉当前端口上的旧服务。
6. 启动 `bun server/index.ts`。

窗口保持打开就代表服务正在运行；关闭窗口或按 `Ctrl+C` 会停止服务。

如果要改端口，先设置 `PORT`：

```powershell
$env:PORT = "8788"
.\start-update.bat
```

## 5. 手动构建前端

如果不用 bat，也可以手动执行构建。

执行：

```powershell
bun run build
```

构建成功后会生成 `dist/`。生产访问前端时，不需要再单独运行 Vite。

如果 Windows 上出现 Vite / esbuild 的 `spawn EPERM`，通常优先检查：

- 是否有杀毒软件或安全软件拦截。
- 当前 PowerShell 是否权限不足。
- 是否有旧的 Bun / Vite 进程占用文件。

可以先关闭旧进程，必要时用管理员 PowerShell 重新执行 `bun run build`。

## 6. 手动启动服务

默认端口是 `8787`：

```powershell
bun run start
```

也可以直接启动后端入口：

```powershell
bun server/index.ts
```

指定端口，例如 `8788`：

```powershell
$env:PORT = "8788"
bun server/index.ts
```

启动成功后访问：

```text
http://127.0.0.1:8787
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

正常返回：

```json
{
  "ok": true
}
```

首次访问 `/config` 时，按页面提示初始化配置入口密码。

## 7. 局域网访问

`start-update.bat` 默认已经允许同一局域网其他电脑访问。其他电脑用服务器 IP：

```text
http://服务器IP:8787
```

需要放行 Windows 防火墙。使用管理员 PowerShell 执行：

```powershell
New-NetFirewallRule -DisplayName "GPT Image Workbench 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
```

如果改了端口，把命令里的 `8787` 一起改掉。

如果防火墙已放行但其他电脑仍然访问不了，先在服务器上确认端口监听情况：

```powershell
netstat -ano | findstr :8787
```

## 8. 后台运行和开机自启

### 方案 A：手动前台运行

适合临时使用：

```powershell
cd D:\apps\shenbi-maliang
bun run start
```

这个窗口不能关闭，关闭后服务会停止。

### 方案 B：用现有重启脚本

项目根目录的一键脚本：

```powershell
.\start-update.bat
```

或者使用已有 PowerShell 脚本：

```powershell
bun run restart
```

它会：

1. 执行 `bun run build`。
2. 查找当前端口上的监听进程。
3. 停掉旧进程。
4. 启动 `bun server/index.ts`。

注意：这个脚本最后也是前台运行，PowerShell 窗口需要保持打开。

### 方案 C：任务计划程序开机自启

适合 Windows 10 本机长期运行。

先准备日志目录：

```powershell
cd D:\apps\shenbi-maliang
New-Item -ItemType Directory -Force logs
```

打开任务计划程序：

```powershell
taskschd.msc
```

建议创建“当前用户登录时”任务，因为 Bun 通常安装在当前用户目录下，任务用当前用户运行时最稳定。

创建任务：

- 名称：`GPT Image Workbench`
- 触发器：登录时
- 安全选项：选择当前用户，勾选“只在用户登录时运行”
- 操作：启动程序
- 程序或脚本：`cmd.exe`
- 添加参数：

```text
/c "cd /d D:\apps\shenbi-maliang && set PORT=8787 && bun server/index.ts >> logs\server.log 2>&1"
```

保存后可以右键任务，选择“运行”测试。

日志位置：

```text
D:\apps\shenbi-maliang\logs\server.log
```

如果项目目录或端口不同，任务参数里的路径和 `PORT` 要同步修改。

如果任务运行后日志里提示找不到 `bun`，先确认 Bun 路径：

```powershell
Get-Command bun
```

然后把任务参数里的 `bun server/index.ts` 改成完整路径，例如：

```text
"C:\Users\你的用户名\.bun\bin\bun.exe" server/index.ts
```

## 9. 数据目录和备份

运行时数据都在 `data/`：

- `data/app.db`：业务数据、用户会话、图片记录等。
- `data/config.db`：配置入口、账号、渠道、CPA、审计日志等。
- `data/config.toml`：少量文件级开关，例如图片编辑调试开关；账号、渠道、CPA 等运行配置以 `data/config.db` 为准。
- `data/files/images/`：生成图片。
- `data/files/assets/`：素材库文件。

建议备份整个 `data/` 目录：

```powershell
New-Item -ItemType Directory -Force D:\backup
Compress-Archive -Path D:\apps\shenbi-maliang\data -DestinationPath D:\backup\gpt-image-data-$(Get-Date -Format yyyyMMdd-HHmmss).zip
```

升级或迁移前，先停服务，再备份 `data/`。

## 10. 更新部署

推荐流程：

1. 停止旧服务。
2. 备份 `data/`。
3. 更新代码。
4. 重新安装依赖。
5. 重新构建。
6. 启动服务。
7. 检查健康接口和页面。

最简单方式：

```powershell
cd D:\apps\shenbi-maliang
.\start-update.bat
```

### 10.1 更新时需要复制哪些文件夹和文件

日常代码更新时，优先更新下面这些内容：

- `src/`
- `server/`
- `public/`
- `scripts/`
- `package.json`
- `bun.lock`
- `index.html`
- `vite.config.ts`
- `tsconfig.json`
- `tailwind.config.ts`
- `postcss.config.js`
- `start-update.bat`
- `docs/`，如果部署文档也有更新

如果只是前端页面、样式、交互改动，通常至少更新：

- `src/`
- `public/`，如果图片、图标、静态资源有变化
- `index.html`，如果入口模板有变化
- 相关配置文件，例如 `vite.config.ts`、`tailwind.config.ts`、`postcss.config.js`

更新后仍然运行：

```powershell
.\start-update.bat
```

脚本会重新安装依赖、重新构建 `dist/` 并启动服务。

### 10.2 不要在日常更新中覆盖这些目录

下面这些不是普通代码更新内容，不要直接覆盖目标机器上的现有目录：

- `data/`：运行数据，包含用户、会话、配置、图片、素材库文件。只能备份或迁移，不能日常覆盖。
- `data/files/images/`：历史生成图片。
- `data/files/assets/`：素材库文件。
- `node_modules/`：依赖目录，优先让脚本通过 `bun install` 处理。
- `runtime/`：本地运行时目录，例如 `runtime/bun/bun.exe`，只有需要更新内置 Bun 时才覆盖。
- `tmp/`、日志文件、`tsconfig.tsbuildinfo`：临时或缓存内容，不需要更新。
- `.env`、`.env.*`：本机环境变量文件，如果目标机器有自己的配置，不要覆盖。

### 10.3 特殊情况

如果目标机器网络不好，无法重新安装依赖，可以在开发机确认能运行后，再把 `node_modules/` 一起复制过去。

如果目标机器没有 Bun，或者需要离线运行，可以复制：

```text
runtime\bun\bun.exe
```

如果目标机器不能构建，也可以复制开发机已经构建好的 `dist/`。但推荐方式仍然是复制源码后运行 `start-update.bat`，让目标机器自己生成新的 `dist/`。

如果需要先备份数据，再手动更新：

```powershell
cd D:\apps\shenbi-maliang

# 备份数据
New-Item -ItemType Directory -Force D:\backup
Compress-Archive -Path .\data -DestinationPath D:\backup\gpt-image-data-$(Get-Date -Format yyyyMMdd-HHmmss).zip

# 安装依赖
bun install --frozen-lockfile

# 构建
bun run build

# 启动
bun run start
```

如果要用现有脚本重启：

```powershell
bun run restart
```

## 11. 常见问题

### 端口被占用

查看 8787 端口：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen
```

停止占用进程：

```powershell
Stop-Process -Id <OwningProcess> -Force
```

也可以换端口：

```powershell
$env:PORT = "8788"
bun server/index.ts
```

### 页面能打开，但生成图片失败

先进入 `/config` 检查：

- 当前模式配置是否选对。
- Studio / CPA / 自定义渠道是否启用。
- Base URL、路径、模型、密钥是否正确。
- CPA 同步是否成功。

再看配置页里的请求日志。请求日志会记录上游 endpoint、状态码、耗时和错误文本。

### `/config` 不能作为健康检查

`/config` 有配置入口密码和登录态，不适合作为服务健康检查。

部署验证优先使用：

```text
http://127.0.0.1:8787/api/health
```

### SQLite journal 文件导致启动异常

如果启动时报 `SQLITE_IOERR_DELETE`，通常是旧 Bun 进程还占着数据库，或遗留了 journal 文件。

处理顺序：

1. 停止所有旧的 Bun 进程。
2. 确认没有服务正在运行。
3. 备份 `data/`。
4. 删除异常的 `data/*.db-journal`。
5. 重新启动服务。

不要在服务运行时直接删除数据库文件。

## 12. 最小部署命令清单

首次部署：

```powershell
cd D:\apps\shenbi-maliang
.\start-update.bat
```

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

日常更新：

```powershell
cd D:\apps\shenbi-maliang
New-Item -ItemType Directory -Force D:\backup
Compress-Archive -Path .\data -DestinationPath D:\backup\gpt-image-data-$(Get-Date -Format yyyyMMdd-HHmmss).zip
.\start-update.bat
```
