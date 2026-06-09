# Shenbi Maliang GPT Image Workbench

[简体中文](README.md) | English

Shenbi Maliang GPT Image Workbench is an AI image generation and image editing workbench designed for private team deployments.

## ✨ Highlights

- 🖼️ AI image generation and editing workbench for real team workflows.
- 💬 User workspace design and conversational interaction inspired by ChatGPT Web.
- 🧭 Separate user workspace and admin console: users create, admins configure and maintain.
- 🧩 Unified management for image providers, team accounts, assets, cases, and prompt templates.
- 🔌 Supports OpenAI-compatible APIs, CPA proxies, ChatGPT Web routes, and private image endpoints.
- 🔐 Local-first runtime data, suitable for internal team use, private deployment, and customization.

## 🎬 Demo Video

- Demo video: coming soon.
- Suggested walkthrough: portable package startup, user image generation and editing, asset/case management, provider and account-pool configuration.
- Suggested screenshot location: `docs/images/`, so README can reference them later.

## 🧭 Online Preview

- GitHub Pages: <https://xiongdaxz.github.io/shenbi-maliang-gpt-image-workbench/>

The online URL is a static frontend preview for checking the interface and product style. Login, admin configuration, image generation, and file storage require a local backend deployment.

## 🚀 Quick Start

```bash
bun install
bun run build
bun run start
```

Open:

- User workspace: http://127.0.0.1:8787
- Admin console: http://127.0.0.1:8787/config
- Health check: http://127.0.0.1:8787/api/health

For development, run backend and frontend dev servers separately:

```bash
bun run dev:api
bun run dev:web
```

## 🧑‍💻 First Run

1. Open `http://127.0.0.1:8787/config`.
2. Initialize the admin password.
3. Configure an image provider, such as an OpenAI-compatible API, CPA proxy, ChatGPT Web route, or private image endpoint.
4. Create user accounts, or enable registration according to your deployment needs.
5. Return to the user workspace, sign in with a user account, and start generating or editing images.

## 🖌️ User Workspace

The user workspace is for image creation and asset management:

- 💬 Conversational text-to-image generation.
- 🪄 Continue editing from existing images.
- 🖼️ Upload local images as references.
- 🗂️ Choose reference assets from the asset library.
- 🕘 View chat history and generated images.
- ⭐ Favorite, download, preview, and manage generated images.
- 💡 Add selected images to inspiration cases.
- 🧱 Use prompt templates to generate structured prompts.
- 👥 Manage personal and shared assets.

## ⚙️ Admin Console

The admin console is available at `/config` and is for administrators and deployment maintainers:

- 👤 Manage users, teams, and account status.
- 🎛️ Configure image providers, models, sizes, qualities, routing modes, and retry settings.
- 🔀 Manage CPA, ChatGPT Web, API, and other image channels.
- 🧮 Manage account pools, quota refresh, and request logs.
- 📮 Configure proxy, email, SMS, registration, and password reset settings.
- 🧰 Manage inspiration cases, shared asset review, and branding assets.
- 📊 View admin audit logs, image request logs, and model request logs.
- 🕹️ Adjust global switches and selected runtime settings.

## 💾 Runtime Data

The app creates a local `data/` directory:

- `data/app.db`: users, chats, images, assets, cases, and business data.
- `data/config.db`: admin password, providers, secrets, account pools, proxy, email/SMS settings.
- `data/files/`: generated images, uploaded assets, masks, and reference images.

When migrating or backing up the app, back up the entire `data/` directory.

## 🗃️ Project Structure

```text
server/   Backend APIs, image routing, database initialization, file service
src/      User/admin pages, components, state management, API client
public/   Static assets
scripts/  Helper scripts
docs/     Routing, database, and project documentation
data/     Local runtime data directory, created automatically
```

## 📦 Release Packages

Official versions provide portable archives in GitHub Releases:

- `shenbi-maliang-windows-x64-portable.zip`: unzip, open the `shenbi-maliang` directory, and double-click `ShenbiMaliang.exe`.
- `shenbi-maliang-linux-x64-portable.zip`: unzip, open the `shenbi-maliang` directory, then run `chmod +x ./shenbi-maliang && ./shenbi-maliang`.
- `shenbi-maliang-macos-arm64-portable.zip` / `shenbi-maliang-macos-x64-portable.zip`: download the archive for your CPU architecture, unzip it, open the `shenbi-maliang` directory, then run `chmod +x ./shenbi-maliang && ./shenbi-maliang`.
- `shenbi-maliang-source-run.zip`: source run package without an executable. Run `start-update.bat` on Windows or `bash ./start.sh` on Linux/macOS. You can also run `bun install --frozen-lockfile`, `bun run build`, and `bun run start` manually.

GitHub Releases also provide the raw `Source code (zip)` and `Source code (tar.gz)` automatically. Use `shenbi-maliang-source-run.zip` if you want to run the project with commands, or `git clone` if you want the full repository history. Runtime data is created in `data/`. Back up `data/` before upgrading.

## 🙏 Acknowledgements

This project references the following open-source projects for image API compatibility, ChatGPT Web image routing, and CPA/Responses routing design:

- [ChatGpt-Image-Studio](https://github.com/peiyizhi0724/ChatGpt-Image-Studio)
- [chatgpt2api](https://github.com/basketikun/chatgpt2api)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## 📄 License

MIT. See [LICENSE](LICENSE).
