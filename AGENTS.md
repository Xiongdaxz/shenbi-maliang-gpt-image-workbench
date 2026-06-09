# AGENTS.md

## Project Notes

- This repository is the local Bun + React GPT image workbench.
- `repo-src-full/` is a read-only reference checkout. Use it to inspect Go behavior, but do not edit files under it unless the user explicitly changes that instruction.
- Put durable implementation notes and rollout docs under `docs/`.

## Image Routing

The app supports three image-generation channel types:

1. `CPA`: channel config with `channel = "cpa"` and `route_mode = "images_api"`, `responses`, or `auto`.
2. `ChatGPT Web`: channel config with `channel = "chatgpt_web"` for ChatGPT website reverse-engineered image routes.
3. `API`: channel config with `channel = "api"` for OpenAI-compatible or private image endpoints.

Runtime mode is one of `auto`, `cpa`, `chatgpt_web`, or `api`. `auto` tries enabled channels in this order: CPA, ChatGPT Web, API.

Do not add new `studio_settings` usage. ChatGPT website access token, cookies, account id, quota mode, and conversation fallback settings belong in `provider_configs`.

## Editing Guidance

- Preserve existing user changes in dirty files; do not reset or revert unrelated edits.
- Prefer small, scoped changes that match the existing `server/index.ts`, `src/ConfigApp.tsx`, and `src/api.ts` patterns.
- For config UI, use the existing project-styled controls, dialogs, custom selects, and centered toast feedback instead of browser-native prompts or confirms.
- When adding generated documentation, default to `docs/`.
