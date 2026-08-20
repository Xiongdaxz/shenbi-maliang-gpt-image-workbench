---
name: maliang-image-generator
description: Use the Shenbi Maliang Remote MCP to generate images, edit Maliang history images, automatically upload a Codex local attachment for editing, check image jobs, or verify Maliang account authorization.
---

# 神笔马良

Use the tools from the `maliang` MCP server. Authentication is handled by the browser-based Maliang OAuth flow; never request a password in chat or as a tool argument.

## Authentication

OAuth is a mandatory state machine. Follow every step in order; do not replace it with a summary or assume that a browser action succeeded.

1. This plugin requests OAuth during installation. Do not treat `codex plugin add`, `Added plugin`, `Auth required`, an open browser, or a visible authorization page as proof that login completed.
2. If authorization is required, run `codex mcp login maliang` in a visible foreground process with streaming output and keep that exact process alive until success or a real failure. Do not use a short command timeout that returns the authorization URL only after killing the loopback callback listener.
3. Let the CLI try the operating system's default browser for up to 5 seconds. If the command runs in a sandbox that cannot launch GUI applications, request narrowly scoped permission for this login command and browser launch. Never say the browser opened without evidence.
4. If no system browser appears and the still-running command printed an HTTP(S) authorization URL, immediately open that exact URL in this order: Codex in-app Browser, connected Chrome, Computer Use, then a clickable link for the user. Browser tools only display the CLI-owned request; they must not create, shorten, rewrite, or reuse its client id, callback, state, or PKCE parameters.
5. Keep the same foreground login process alive while the user approves access. The authorization form locks after its first submission; tell the user not to refresh, go back, or click twice while the callback completes. Never read or relay credentials, tokens, cookies, or the authorization code.
6. If the command prints no authorization URL, report its exact error and stop. `No authorization support detected`, dynamic registration errors, TLS errors, invalid metadata, and HTTP 404 are protocol or deployment failures; switching browsers cannot repair them.
7. Require the command to report login success, then verify `codex mcp get maliang --json` and initialize the MCP. In the same installation turn, immediately read the actual local hostname (`[System.Net.Dns]::GetHostName()` on Windows, `hostname` on macOS/Linux), call `maliang_report_device` with that hostname and the real OS, then call `maliang_account_status`; do not wait for another user message. Never use `Windows`, `macOS`, `Linux`, `localhost`, the client name, or a template placeholder as the device name. If the command timed out or exited, its URL is stale even if the web page still opens: start one fresh foreground attempt and use only its new URL. Ask the user to restart Codex or open a new task only when newly authorized tools did not refresh in the current task.

Completion requires five separate facts: the CLI reported success, the MCP endpoint is still correct, all Maliang tools are loaded, `maliang_report_device` returned `reported=true` for the actual local hostname, and `maliang_account_status` confirms an authorized account.

After that completion gate succeeds, do not call `maliang_report_device` before every task, generation, or edit. Call it again only after a new OAuth installation, when another Maliang tool explicitly reports that device information is missing, or when the actual device changes.

## Plugin version

- The trusted plugin `PreToolUse` Hook defaults to `auto`. Before a Maliang MCP tool call it checks the deployment's stable `/plugin/latest.json`, cached so it contacts the server at most once every 24 hours.
- A compatible newer SemVer is downloaded and verified by size and SHA-256, extracted beside the durable Marketplace, validated, switched transactionally, and refreshed only through `maliang-image-generator@maliang-internal`. The updater rejects a different origin, archive root, plugin identity, MCP endpoint, Hook/Skill entry, or any symbolic link.
- The current task keeps its already loaded tools. After a successful update, continue the current call accurately and tell the user that the new version activates in the next task or after restarting Codex; never claim hot reload.
- Network, validation, extraction, filesystem, or plugin-refresh failures keep the current version and do not block an ordinary image call. Only a stable manifest explicitly marked `incompatible`, `critical`, and `blockOldVersion` may block the old tool.
- Automatic updates preserve OAuth state. Run the authentication state machine only if the refreshed MCP actually returns `Auth required`.
- The first installed Hook, or a changed Hook definition, must be reviewed and trusted by the user before Codex runs it. Default mode is recorded in `PLUGIN_DATA/update-settings.json`; an explicit `MALIANG_PLUGIN_UPDATE_MODE=notify` or `off` overrides it.

## Workflow

1. Call `maliang_account_status` before the first image request in a task. If the MCP host reports that authentication is required, follow the foreground login and browser fallback flow above and let the user finish in the browser.
2. For text-to-image, call `maliang_generate_image`. Keep the user's prompt intact and only pass size, quality, count, background, or output format when requested. Image count follows the web workbench contract: use an integer from 1 through 10, clamp larger requests to 10, and keep `imageCount` consistent with an explicit count in the prompt; the server treats the prompt's explicit count as authoritative.
3. Generation is asynchronous. Call `maliang_get_image_job` with the returned `jobId` until the status is `succeeded` or `failed`. Do not claim completion while it is still `running`. Do not combine a long sleep and the final successful query in the same `functions.exec`: if that call yields into `functions.wait`, media may remain in the deferred tool output instead of being attached to the assistant reply.
4. To edit a Maliang history image, pass its `imageId` through `imageIds` to `maliang_edit_image`. When the user requests multiple edited results, apply the same 1-through-10 image-count contract.
5. To edit a local image already attached in Codex, use only the absolute local path exposed in the current user message or its `Files mentioned by the user` section. Call `maliang_create_image_upload`, then pass its exact `uploadUrl`, `uploadId`, and the attachment path to `mcp__maliang_local__upload_local_image`. This bundled local MCP is already started by Codex and receives the one-time address over Codex-managed stdio; do not start `maliang-helper.mjs` through a shell, Node REPL, or another child process.

   The local MCP reuses the bundled helper to accept PNG, JPG, and WebP files up to 20 MB, validate the actual file signature and extension, submit `POST multipart/form-data` with the image in field `file`, and require a JSON response containing `status: uploaded` and the same `uploadId`. A generic 2xx HTML page or mismatched `uploadId` is not success. The upload URL must go only to `mcp__maliang_local__upload_local_image`; never place it in argv, a shell command string, a temporary file, logs, or commentary.

   After the local MCP returns `status: uploaded`, call `maliang_get_image_upload` once to verify the same `uploadId`, then pass it through `uploadIds` to `maliang_edit_image`. A narrowly scoped read approval for the exact attachment and network approval for the exact MCP origin are acceptable when the host sandbox requires them. Use the original one-time upload page only when Codex did not expose a readable attachment path or `mcp__maliang_local__upload_local_image` is unavailable because the required local Node runtime did not start. For validation, server, or mismatched-ID failures, report the exact error instead of opening a browser. Keep polling the same `uploadId`; never manufacture or rewrite the URL.
6. When a job is ready, run the successful `maliang_get_image_job` query in a new, standalone `functions.exec` call. The remote MCP returns lightweight `resource_link` content plus structured result metadata instead of base64 image data. Forward the text summary and structured metadata needed for the managed local save, but do not render the signed resource link directly:

   ```js
   // @exec: {"yield_time_ms": 30000}
   const result = await tools.mcp__maliang__maliang_get_image_job({ jobId });
   for (const item of result.content ?? []) {
     if (item.type === "text") text(item.text);
   }
   text(JSON.stringify(result.structuredContent ?? {}, null, 2));
   ```

   Do not use `generatedImage(data URL)` or `image(item)` for final delivery. They create media inside a generic tool-output event; Codex may show it during the tool call but reload it later as an empty image placeholder.
7. For every entry in `structuredContent.imageResults`, call `mcp__maliang_local__save_image_result` with its `downloadUrl` and `imageId`. Use `previewUrl` only as a temporary backward-compatible fallback when an older server omits `downloadUrl`. This bundled local MCP is started by Codex from the plugin root and receives the signed URL over Codex-managed stdio; do not run `maliang-helper.mjs save` through a shell command.

   The local MCP reuses the bundled helper's same-origin URL checks, response limits, image-signature validation, and immutable content-addressed writes. It saves the original bitmap under `$CODEX_HOME/generated_images/maliang` by default and returns an absolute `path`, matching the built-in image generation flow of persisting the bitmap before the assistant renders it. The signed URL is a bearer credential: pass it only to `mcp__maliang_local__save_image_result`, never put it in argv, a shell command string, a temporary file, logs, final Markdown, or a browser.

   Never open a generated result URL in Codex Browser, Chrome, Computer Use, or the operating system browser. If `mcp__maliang_local__save_image_result` is unavailable, fails, or returns no readable absolute path, retry `maliang_get_image_job` once as described below and report the image delivery as incomplete. Do not use browser delivery as a fallback.
8. In the final assistant message, visibly render every saved file with Markdown image syntax and the absolute local `path` returned by the local MCP. On Windows, convert only the Markdown target from the native `C:\\absolute\\path\\image.png` form to the Codex-safe `/C:/absolute/path/image.png` form, using forward slashes and a leading slash before the drive letter: `![神笔马良生成结果](/C:/absolute/path/image.png)`. Never put a native backslash path directly inside the Markdown image target because Codex may render it as an empty placeholder. macOS example: `![神笔马良生成结果](</Users/name/Library/Application Support/image.png>)`. Wrap paths containing spaces in angle brackets. This matches Codex built-in image generation: save the bitmap locally first, then reference the durable file. Do not use `previewUrl` in final Markdown and do not delete the saved file.
9. Keep each returned `imageId` available for follow-up edits after visibly rendering the local file. Never answer with only the job status, `jobId`, or `imageId`.
10. If the job says `succeeded` but `structuredContent.imageResults` is missing, the image helper fails, or the saved file cannot be read, report this as an incomplete result instead of claiming the image was delivered. Retry `maliang_get_image_job` once in a new standalone `functions.exec`; if it is still incomplete, preserve the `jobId` and report the exact problem.

## Boundaries

- Never ask the user to paste a Maliang password, access token, refresh token, authorization code, or upload token into chat.
- Never invent an OAuth authorization URL or run the login command in a hidden background process.
- An upload URL is single-purpose, expires quickly, and belongs only in the current user flow. Pass it only to `mcp__maliang_local__upload_local_image` or the current upload browser fallback; never print it in the final response or logs. A generated-result URL must go only to `mcp__maliang_local__save_image_result` and must never be opened in a browser.
- Do not add a second global `maliang` MCP entry when this plugin already provides it.
- If `maliang-image-generator@personal` is already installed, stop and ask the user to migrate instead of installing a duplicate plugin or MCP server.
- Report errors and failed jobs accurately. Do not invent image results or claim that an installation/login succeeded without verification.
