---
name: maliang-connection-help
description: Diagnose and safely complete Shenbi Maliang Codex plugin installation, Remote MCP setup, OAuth authorization, and tool loading. Use for login or browser-opening failures, Auth required, missing Maliang tools, duplicate or conflicting MCP configuration, No authorization support detected, dynamic registration failures, TLS or certificate errors, HTTP 404 responses, callback timeouts, or post-install verification.
---

# Maliang connection help

Treat the Codex CLI as the owner of OAuth state. Browser capabilities only display the authorization URL created by the CLI; they do not create or repair the OAuth request.

## Diagnose

1. Run `codex plugin list --json` and `codex mcp get maliang --json` before changing configuration.
2. Confirm that `maliang-image-generator@maliang-internal` is installed and that `maliang` points to the expected HTTP(S) `/api/external-mcp/mcp` endpoint. Require HTTPS for public or production deployments; accept HTTP only when the user explicitly selected a trusted private-LAN development service such as the local `/install` address.
3. Do not add a global `maliang` MCP when the plugin already provides it.
4. If `maliang-image-generator@personal` exists, report the legacy plugin and ask before removing only that exact selector.
5. If an existing `maliang` entry points somewhere else, stop and report the conflict. Do not overwrite an unrelated configuration.

## Authorize

1. Allow the plugin's `ON_INSTALL` policy to start OAuth during installation. Do not treat `Added plugin` as proof that OAuth succeeded.
2. Unless the current install explicitly reports a successful OAuth login, run `codex mcp login maliang` in a visible foreground process with streaming output. Keep that exact process and its loopback callback listener alive; do not use a short timeout that reveals the URL only after the process was killed.
3. Let Codex try the operating system's default browser for up to 5 seconds. When a sandbox blocks GUI launch, request narrowly scoped permission for this login command and browser launch. Do not claim a browser opened without evidence.
4. If no system browser appears and the still-running command prints an HTTP(S) authorization URL, immediately use the first available fallback in this order: Codex in-app Browser, connected Chrome, Computer Use, user-facing clickable link. Open the exact URL; browser capabilities display the CLI-owned OAuth request but do not create or repair it.
5. Keep the same foreground command alive while the user enters credentials and approves access. The authorization form should lock after the first submission and show a processing message; tell the user not to refresh, go back, or submit again while the callback completes. Never read, request, copy, or relay the password, access token, refresh token, authorization code, or cookies.
6. Never construct, shorten, rewrite, upgrade, downgrade, or reuse the authorization URL. Its client id, callback, state, and PKCE parameters belong to one login attempt. Public deployments must already be HTTPS; an explicitly selected trusted private-LAN development service may remain HTTP.
7. If the callback wait times out, the command exits, or the loopback listener stops, mark that URL stale immediately. Run one fresh foreground login attempt and use only its new URL, even if the old web page still opens.
8. If the command prints no authorization URL, stop browser switching and report the original protocol, registration, TLS, metadata, or deployment error.

## Classify failures

- `No authorization support detected`: verify the protected-resource metadata and authorization-server metadata. All public `resource`, `issuer`, and endpoint URLs must be HTTPS and share the deployed public origin.
- Dynamic registration failure or invalid JSON: inspect `POST /oauth/register`; require a JSON response with `client_id` and the registered redirect metadata.
- TLS or certificate verification failure: require the server to present a valid full certificate chain. Do not disable certificate verification.
- HTTP 404: verify that the current backend and reverse proxy expose `/.well-known/*`, `/oauth/*`, and `/api/external-mcp/mcp`; switching browsers is not a fix.
- An expired-request page immediately after approval: check whether the authorization form was submitted more than once. Stop the stale foreground login, start one fresh attempt, and use only its new page. Do not reuse the old URL or ask the user to keep clicking.
- `Auth required` after the CLI reports success: confirm the endpoint did not change, then restart Codex or open a new task so the refreshed credential and tools load.
- Missing Maliang tools with a valid MCP entry: restart Codex or open a new task. Do not claim that installation is fully usable until the tools are visible.

## Verify completion

Require all of the following evidence:

1. The login command explicitly reports success.
2. `codex mcp get maliang --json` still shows the expected endpoint, using HTTPS for public/production deployments or the exact explicitly selected private-LAN HTTP origin.
3. The current or a new task exposes `maliang_account_status` and the required image tools.
4. In the same installation turn immediately after tools load, the agent reads the actual local hostname (`[System.Net.Dns]::GetHostName()` on Windows, `hostname` on macOS/Linux) and `maliang_report_device` returns `reported=true`; do not wait for another user message. An OS name, client name, `localhost`, unknown label, or template placeholder is not a hostname.
5. `maliang_account_status` confirms an authorized Maliang account.

Report partial states precisely: distinguish plugin installed, MCP configured, browser opened, user authorized, tools loaded, and image generation verified.

Once `maliang_report_device` has returned `reported=true`, do not repeat it before every task or image call for the same OAuth client. Repeat only for a new OAuth client, an explicit server `device report required` response, or an actual device change.

## Update

1. Automatic updates default to `auto` through the plugin's trusted `PreToolUse` Hook. It checks the stable channel before Maliang tool use, with a 24-hour cache; equal or older remote SemVer versions are a no-op.
2. Version `0.3.0` is the first release that contains this Hook. An installed `0.2.x` or older plugin cannot bootstrap code it does not have; update it manually once to `0.3.0` or newer, then use the automatic flow.
3. The Hook must be reviewed and trusted after first installation or when its definition changes. If Codex reports that a Hook needs review, inspect it through `/hooks`; do not report automatic updating as active while Codex is skipping the Hook.
4. A compatible update follows `/plugin/install.json` `updatePolicy`: verify same-origin manifest and download, size and SHA-256 before touching the current install; extract beside the durable Marketplace; reject symbolic links; validate archive root, Marketplace, plugin identity/version, MCP endpoint, and Hook/Skill entries; preserve the old directory; atomically switch; refresh only `maliang-image-generator@maliang-internal`.
5. Do not hot-replace the current task's loaded MCP catalog. Continue the current tool call, then restart Codex or open a new task and verify the installed version, endpoint, required tools, and account status. Keep the most recent rollback copy; remove the older retained copy only before a later compatible update.
6. Network, download, validation, extraction, filesystem, and refresh failures keep the current version and ordinary Maliang calls continue. Only an update marked `incompatible`, `critical`, and `blockOldVersion` may block the old tool and require manual migration.
7. Preserve OAuth state across compatible updates. Reauthorize only when the refreshed MCP returns `Auth required`; never clear unrelated credentials or other plugins.
8. Use `PLUGIN_DATA/update-settings.json` or `MALIANG_PLUGIN_UPDATE_MODE` to explicitly select `auto`, `notify`, or `off`; missing settings mean `auto`.

## Boundaries

- Do not hide the login command in a background process.
- Do not let a model-side timeout kill the login command before the browser fallback has used its URL.
- Do not bypass OAuth with shared API keys, copied cookies, disabled TLS verification, or credentials pasted into chat.
- Do not switch browser tools repeatedly when the CLI produced no authorization URL; preserve and report the protocol or deployment error instead.
- Do not remove or modify other plugins, Marketplaces, or MCP servers.
