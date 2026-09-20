# ChatGPT Web Python 运行环境

ChatGPT Web 的 Codex Responses 路径由 Bun 后端直接请求；官网普通额度回退由 `scripts/chatgpt_web_bridge.py` 执行。后者需要 Python 3.10+。直接依赖记录在 `scripts/requirements-chatgpt-web.txt`，自动部署使用包含传递依赖精确版本的 `scripts/requirements-chatgpt-web.lock.txt`。

## 源码部署

Windows 使用 `start-update.bat`，Linux/macOS 使用 `start.sh`。启动流程会在停止旧服务之前执行 `bun run setup:chatgpt-web`：

1. 优先复用 `runtime/chatgpt-web-venv`。
2. 首次运行时从 `py -3` / `python`（Windows）或 `python3` / `python`（Linux/macOS）查找 Python 3.10+ 并创建 VENV。
3. 当锁定依赖文件哈希变化或导入检查失败时执行 `pip install --requirement scripts/requirements-chatgpt-web.lock.txt`。
4. 安装完成后执行 `pip check` 和实际导入检查，成功后才更新哈希标记。
5. 服务入口把 VENV 的解释器绝对路径写入 `CHATGPT_WEB_BRIDGE_PYTHON`，确保 Bun 与桥接脚本使用同一个 Python。

第二次及后续启动只做本地哈希和导入检查，不重复安装，也不要求联网。多个启动进程会通过 `runtime/chatgpt-web-python-runtime.lock` 串行准备环境，避免同时创建 VENV 或执行 pip。

如果 Python 不存在或依赖准备失败，启动器会记录警告并继续启动主服务，同时将失败原因传给当前服务进程。准备失败发生在停止旧服务之前；新进程不会在旧服务停止后重复执行同一轮安装。CPA、API 和 Codex Responses 路径不受影响；官网普通额度回退会立即返回明确的环境错误，不再重新调用不确定的系统 Python。

## 环境变量

- `CHATGPT_WEB_BASE_PYTHON`：仅用于首次创建项目 VENV，值为 Python 可执行文件完整路径。
- `CHATGPT_WEB_BRIDGE_PYTHON`：显式指定桥接运行时；设置后不会创建项目 VENV，但仍会验证并按需安装依赖到该解释器。

不要把 `runtime/chatgpt-web-venv` 提交到 Git，也不要在不同机器间复制 VENV。部署新机器时应由启动流程重新创建。

## 故障恢复

如果 VENV 被破坏，先停止服务，将 `runtime/chatgpt-web-venv` 移出项目目录，再重新执行启动脚本。若 Linux 报告缺少 `venv` 模块，先安装系统对应的 `python3-venv` 包。

便携版会尝试准备相同的项目 VENV；若机器没有 Python 或依赖安装失败，应用仍会启动，但官网普通额度回退不可用，CPA、API 和 Codex Responses 路径不受影响。
