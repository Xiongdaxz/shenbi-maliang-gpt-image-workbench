# 图片生成模式与接口总览

本文档用于说明本项目的生图运行模式、渠道类型、真实上游接口，以及参考项目的接口设计。重点区分三件事：

- 本地前端调用本项目后端的接口。
- 本项目后端按渠道配置调用的上游接口。
- 参考项目暴露的 OpenAI 兼容接口和它们实际打到 ChatGPT/CPA 的内部接口。

## 术语

| 名称 | 含义 |
| --- | --- |
| 运行模式 | 配置页里的全局图片模式：`auto`、`cpa`、`chatgpt_web`、`api`。它决定本次运行允许使用哪些渠道。 |
| 渠道 | `provider_configs.channel`，当前分为 `cpa`、`chatgpt_web`、`api`。 |
| 路由模式 | `provider_configs.route_mode`，只对 `cpa` 和 `api` 这类 OpenAI 兼容渠道有直接意义：`images_api`、`responses`、`auto`。 |
| 官网额度策略 | `provider_configs.quota_mode`，只对 `chatgpt_web` 有意义：`codex_first`、`official_first`、`codex_only`、`official_only`。 |
| Images API | OpenAI 兼容图片接口，通常是 `/v1/images/generations` 和 `/v1/images/edits`。 |
| Responses 图片工具 | OpenAI Responses 形态，通常是 `/v1/responses`，请求体里带 `tools: [{ type: "image_generation" }]`。 |
| ChatGPT Web 会话 | ChatGPT 官网网页后端接口，例如 `/backend-api/f/conversation`、`/backend-api/conversation`。 |

## 本项目本地接口

本地前端不直接调用上游图片接口，而是先调用本项目后端。

| 本地接口 | 入口文件 | 作用 | 后续路由 |
| --- | --- | --- | --- |
| `POST /api/images/generate` | `server/imageRoutes.ts` | 文生图，创建用户消息、图片任务和请求快照。 | 通过 `providerChainById()` 选出可用渠道后进入 `callProviderChain()`。 |
| `POST /api/images/edit` | `server/imageRoutes.ts` | 图生图、素材编辑、引用图编辑、遮罩编辑。会组装 `images[]`、`sourceReference`、`webConversationContext`、`mask`。 | 通过 `providerChainById()` 选出可用渠道后进入 `callProviderChain()`。 |
| `POST /api/image-jobs/:id/retry` | `server/imageRoutes.ts` | 失败任务重试。复用 `image_jobs.request_json`。 | 重新走原任务保存的渠道链。带遮罩任务不自动重试，要求重新涂抹。 |
| `GET /api/image-jobs/:id` | `server/imageRoutes.ts` | 查询任务状态。 | 不调用上游。 |

`providerChainById()` 的规则：

- 用户选中具体渠道时，只使用该渠道。
- 用户选择 `auto` 或没有指定渠道时，取当前运行模式下所有启用渠道。
- `auto` 运行模式下渠道顺序固定为：CPA -> ChatGPT 官网 -> API。
- 同一渠道类型内按 `created_at` 升序。

## 本项目运行模式

| 运行模式 | 允许的渠道 | 说明 |
| --- | --- | --- |
| `auto` | `cpa`、`chatgpt_web`、`api` | 自动选择。后端按 CPA -> ChatGPT 官网 -> API 顺序尝试启用渠道。 |
| `cpa` | `cpa` | 只使用 CPA 额度代理渠道。 |
| `chatgpt_web` | `chatgpt_web` | 只使用 ChatGPT 官网逆向渠道。 |
| `api` | `api` | 只使用 OpenAI 兼容或私有 API 渠道。 |

历史兼容：`studio`、`official`、`legacy`、`conversation`、`responses`、`studio_responses` 等旧模式名会被归一为 `chatgpt_web`。

## 本项目默认渠道模板

启动时会确保三类默认模板存在。已有记录不会被覆盖。

| 渠道 | 默认启用 | 默认 Base URL | 默认路由字段 | 默认模型 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `cpa` | 是 | `http://127.0.0.1:8317` | `generation_path=/v1/images/generations`，`edit_path=/v1/images/edits`，`responses_path=/v1/responses`，`route_mode=images_api` | 图片工具 `gpt-image-2`，Responses 主模型 `gpt-5.5` | 本地 CPA 代理，优先用于日常生图。 |
| `chatgpt_web` | 否 | `https://chatgpt.com/backend-api` | `generation_path=/f/conversation`，`edit_path=/f/conversation`，`responses_path=/codex/responses`，`quota_mode=codex_first` | 官网图片 `gpt-image-2`，Codex Responses 主模型 `gpt-5.5` | ChatGPT 官网逆向链路，区分 Codex 额度和官网普通额度。 |
| `api` | 否 | `https://api.openai.com` | `generation_path=/v1/images/generations`，`edit_path=/v1/images/edits`，`responses_path=/v1/responses`，`route_mode=images_api` | 图片工具 `gpt-image-2`，Responses 主模型 `gpt-5.5` | OpenAI 兼容或私有图片服务。 |

旧的 `studio_settings` 不再作为运行时配置使用。ChatGPT 官网 access token、Cookie、account id、额度策略都应保存在 `provider_configs`。

## 本项目 CPA 渠道

CPA 渠道是 OpenAI 兼容渠道，默认面向本地 CPA 代理 `http://127.0.0.1:8317`。

| `route_mode` | 文生图接口 | 图生图接口 | 请求体形态 | 作用 |
| --- | --- | --- | --- | --- |
| `images_api` | `POST {base_url}{generation_path}`，默认 `/v1/images/generations` | `POST {base_url}{edit_path}`，默认 `/v1/images/edits` | 文生图 JSON；图生图 multipart/form-data。 | 走图片专用包装层。支持 `prompt`、`model`、`n`、`size`、`quality` 等。 |
| `responses` | `POST {base_url}{responses_path}`，默认 `/v1/responses` | 同左 | Responses JSON，`tools` 中包含 `image_generation`，`tool_choice={type:"image_generation"}`。 | 走综合 Responses 链路，图片模型放在工具里，主模型走 `responses_model`。 |
| `auto` | 先 `/v1/images/generations`，失败再 `/v1/responses` | 先 `/v1/images/edits`，失败再 `/v1/responses` | 先 Images API，再 Responses。 | 适合兼容 CPA 代理不同版本。只在明确失败时回退。 |

CPA 的 `images_api` 是 Images API 兼容包装层，CLIProxyAPI 底层可能进入 Codex Responses 的 `image_generation` 工具链，但这个入口会先校验请求体 `model` 必须是图片模型，例如 `gpt-image-2`。所以 `responses_model` 不会通过 `/v1/images/generations` 或 `/v1/images/edits` 的 `model` 字段传入；需要明确控制 Responses 主模型时，应使用 `route_mode=responses`，让请求直达 `/v1/responses`。

特殊规则：

- CPA 遮罩编辑优先走 Responses 图片工具，因为本地会把 `mask` 放入 `tool.input_image_mask`。
- CPA `images_api` 在遇到已知流式/上游无图/JSON SSE 解析类错误时，会自动回退到 Responses。
- CPA Responses 如果遇到 `auth_unavailable` 且上游提示 `no auth available`，会尝试用 `gpt-5.4-mini` 作为主模型兜底；图片工具模型仍是 `gpt-image-2`。

## 本项目 API 渠道

API 渠道用于 OpenAI 兼容或私有图片接口，路由字段和 CPA 一样，但没有 CPA 专属额度、账号同步、模型兜底含义。

| `route_mode` | 文生图 | 图生图 | 作用 |
| --- | --- | --- | --- |
| `images_api` | `POST {base_url}{generation_path}` | `POST {base_url}{edit_path}` | 调用兼容 `/v1/images/generations` 和 `/v1/images/edits` 的服务。 |
| `responses` | `POST {base_url}{responses_path}` | 同左 | 调用兼容 `/v1/responses` 的服务，使用 `image_generation` 工具。 |
| `auto` | 先 Images API，失败后 Responses | 先 Images API，失败后 Responses | 用于兼容不确定的私有接口。 |

遮罩编辑补充：

- 如果 `route_mode=responses`，遮罩会作为 `tool.input_image_mask` 发给 Responses。
- 如果走 Images API 且 payload 里带 `sourceReference`，上游不支持时会移除 `sourceReference` 后重试一次 Images API，避免 OpenAI 兼容服务因未知字段失败。

## 本项目 ChatGPT 官网渠道

ChatGPT 官网渠道不是 OpenAI 兼容接口。`route_mode` 不决定它的真实上游接口，真实分支由 `quota_mode` 控制。

### 额度策略

| `quota_mode` | 尝试顺序 |
| --- | --- |
| `codex_first` | 先 Codex 额度，再官网普通额度。默认值。 |
| `official_first` | 先官网普通额度，再 Codex 额度。 |
| `codex_only` | 只走 Codex 额度，不再额外回退到官网会话链路。 |
| `official_only` | 只走官网普通额度。 |

### Codex 额度链路

| 项目 | 值 |
| --- | --- |
| 入口 | Bun 后端直接请求，不走 Python bridge。 |
| 默认接口 | `POST https://chatgpt.com/backend-api/codex/responses`。配置里写 `/v1/responses`、`/f/conversation` 或旧的 `/codex/images/generations` 会自动归一为 `/codex/responses`。 |
| 请求体 | Responses 形态，`stream=true`，`tools=[{ type:"image_generation", action, model:"gpt-image-2" }]`，`tool_choice={type:"image_generation"}`。 |
| 主模型 | 默认 `gpt-5.5`，来自 `responses_model`。 |
| 图片模型 | 默认 `gpt-image-2`，来自 `model`，放在 `image_generation` 工具内。 |
| 适用 | 测 Codex 图片额度，或希望消耗 Codex 额度而不是官网普通图片额度。 |

注意：这里的 `/codex/responses` 是本项目 ChatGPT Web 渠道的官网 Codex 入口，不等同于 CPA 的 `/v1/responses`。

### 官网普通额度链路

官网普通额度由 `scripts/chatgpt_web_bridge.py` 执行，使用 ChatGPT Web 后端接口和浏览器指纹请求。

| 场景 | 主要接口 | 请求形态 | 作用 |
| --- | --- | --- | --- |
| 文生图 | `POST /backend-api/f/conversation/prepare` -> `POST /backend-api/f/conversation` | 普通会话 SSE，`system_hints=["picture_v2"]`。 | 在官网会话中发起图片生成。 |
| 上传图编辑 | `POST /backend-api/files` -> 上传二进制 -> `POST /backend-api/files/{file_id}/uploaded` -> `POST /backend-api/f/conversation/prepare` -> `POST /backend-api/f/conversation` | `content.parts` 里放 `image_asset_pointer`，`metadata.attachments` 记录上传图片。 | 编辑本地上传图或素材图。官网 UI 会表现为上传素材。 |
| 历史图引用编辑 | `POST /backend-api/conversation` | `metadata.dalle.from_client.operation={ type:"edit", original_file_id, original_gen_id }`，并带源图 `conversation_id/parent_message_id`。 | 编辑官网历史消息中的生成图，保持官网引用样式。当前实现强制 body parent 锚到源图消息，优先保证引用不跑偏。 |
| 历史图遮罩编辑 | 上传 mask 到 `dalle_agent` -> `POST /backend-api/conversation` | `metadata.dalle.from_client.operation={ type:"inpainting", original_file_id, original_gen_id, mask_file_id }`。 | 官网历史图局部编辑。body parent 同样锚到源图消息。 |

### `/conversation` 与 `/f/conversation`

`chatgpt2api` 里的分工可以作为判断参考：只要是 `picture_v2` 图片请求，就进入 `_stream_picture_conversation()`，先调 `/backend-api/f/conversation/prepare` 拿 `conduit_token`，再调 `/backend-api/f/conversation`；普通文本/通用会话才由 `_chat_target()` 走 `/backend-api/conversation` 或未登录的 `/backend-anon/conversation`。

| 端点 | 在 `chatgpt2api` 中的用法 | 是否需要 prepare | 适合的图片场景 | 不适合/注意 |
| --- | --- | --- | --- | --- |
| `POST /backend-api/f/conversation` | `system_hints` 包含 `picture_v2` 时使用。请求头会带 `OpenAI-Sentinel-Chat-Requirements-Token`、`X-Conduit-Token`、`X-Oai-Turn-Trace-Id`。 | 需要先 `POST /backend-api/f/conversation/prepare`。 | 文生图、上传图编辑、普通图片会话。 | 2api 没有证明它能正确处理官网历史图 `original_file_id` 引用编辑。 |
| `POST /backend-api/conversation` | 普通已登录 ChatGPT 会话入口，也被官网历史图引用编辑使用。 | 普通文本会话不需要；历史图引用编辑也不走 f-conversation prepare。 | 历史图引用编辑、历史图 inpaint、普通文本会话。 | 用于历史图编辑时，body `parent_message_id` 会影响官网实际引用哪张图，所以本项目强制锚到源图 parent。 |

本项目当前策略：

- 文生图和上传图编辑走 `/f/conversation/prepare` + `/f/conversation`。
- 官网历史图引用编辑和历史图遮罩编辑走 `/conversation`，因为这类请求依赖 `metadata.dalle.from_client.operation.original_file_id`，并且需要让 body parent 和源图上下文保持一致。
- `/backend-api/conversation/{conversation_id}` 是读取会话详情的 GET 接口，用于轮询或解析结果，不是提交图片请求的 POST 入口。

### `sourceReference` 与 `webConversationContext`

编辑请求里有两类上下文：

| 字段 | 作用 |
| --- | --- |
| `sourceReference` | 指向被编辑的官网源图，包含 `original_file_id`、`original_gen_id`、`conversation_id`、`parent_message_id`、`source_account_id`。 |
| `webConversationContext` | 指向本地当前分支希望挂载到官网哪条消息后，包含 `placement`、`conversation_id`、`parent_message_id`、`source_account_id`。 |

当前策略：

- 普通文生图和上传图编辑会尽量使用 `webConversationContext` 维持官网会话位置。
- 官网历史图引用编辑和历史图遮罩编辑会强制使用 `sourceReference.conversation_id + sourceReference.parent_message_id` 作为 body parent。原因是 ChatGPT 官网实际会强依赖 body `parent_message_id` 来判断编辑对象；如果用当前尾节点，可能把其他分支的图片当成源图。
- 不通过偷偷追加提示词来修复引用问题。

## 参考项目：ChatGpt-Image-Studio

该项目仅作为接口设计参考。

### 对外接口

| 接口 | 作用 |
| --- | --- |
| `POST /v1/images/generations` | OpenAI 兼容文生图。 |
| `POST /v1/images/edits` | OpenAI 兼容图生图/上传图编辑。 |
| `POST /v1/chat/completions` | 兼容聊天接口，图片场景也有转换逻辑。 |
| `POST /v1/responses` | OpenAI Responses 兼容接口，可用于图片工具调用。 |
| `GET /v1/models` | 返回可用模型。 |

### 内部上游链路

| 链路名 | 真实接口 | 作用 | 备注 |
| --- | --- | --- | --- |
| 官网 legacy 文生图 | 优先 `POST /backend-api/f/conversation`，必要时回退 `POST /backend-api/conversation` | 用 ChatGPT 官网会话生成图片。 | `GenerateImage()` 先构造 conversation body，再尝试 f-conversation。 |
| 官网上传图编辑 | `POST /backend-api/files` + `POST /backend-api/conversation` | 上传本地图片，再用 multimodal message 编辑。 | 使用 `image_asset_pointer` 和 `metadata.attachments`。 |
| 官网历史图 inpaint | `POST /backend-api/conversation` | 使用 `metadata.dalle.from_client.operation`，字段包括 `original_file_id`、`original_gen_id`、`mask_file_id`。 | `conversationID + parentMessageID` 作为源图上下文传入，没有实现“源图 A，挂载 B”的分离。 |
| 官网 Codex/Responses | `POST https://chatgpt.com/backend-api/codex/responses` | 用 Responses 图片工具生成或编辑。 | Header 带 `Chatgpt-Account-Id`、Codex 风格 UA 等。 |
| CPA `images_api` | `POST {cpa_base}/v1/images/generations` 和 `POST {cpa_base}/v1/images/edits` | 调 CPA 图片包装层。 | `route_strategy=images_api` 时直接使用。 |
| CPA `codex_responses` | `POST {cpa_base}/v1/responses` | 调 CPA 的 Responses 子链路。 | 注意这里不是 `/codex/responses`，只是策略名叫 `codex_responses`。 |
| CPA `auto` | 先 `images_api`，失败再 `codex_responses` | 兼容 CPA 多版本。 | 命中特定错误才回退。 |

### 对我们的启发

- `codex_responses` 在该项目里是 CPA 子路由策略名，真实 HTTP 路径是 `/v1/responses`。
- 官网历史图编辑依赖 `original_file_id/original_gen_id` 和源图 `parent_message_id`，没有单独处理“引用 A、挂载 B”。
- 官网 Codex Responses 和 CPA Responses 是两条不同链路：前者是 ChatGPT 官网 `/backend-api/codex/responses`，后者是 CPA 服务 `/v1/responses`。

## 参考项目：chatgpt2api

该项目仅作为接口设计参考。

### 对外接口

| 接口 | 作用 |
| --- | --- |
| `GET /v1/models` | 返回兼容模型列表，包含 `gpt-image-2`、`codex-gpt-image-2` 等。 |
| `POST /v1/images/generations` | OpenAI 兼容文生图。 |
| `POST /v1/images/edits` | OpenAI 兼容图生图。 |
| `POST /v1/responses` | Responses 兼容接口；带 `image_generation` 工具时进入图片生成流程。 |
| `POST /v1/chat/completions` | 文本聊天兼容接口。 |
| `POST /v1/messages` | Anthropic Messages 兼容接口。 |

### 内部上游链路

| 场景 | 真实接口 | 作用 |
| --- | --- | --- |
| 图片准备 | `POST /backend-api/f/conversation/prepare` | 获取图片会话所需的 conduit token。 |
| 文生图/上传图编辑 | `POST /backend-api/f/conversation` | 使用 `system_hints=["picture_v2"]` 的会话 SSE 生成图片。 |
| 上传输入图 | `POST /backend-api/files` -> 上传二进制 -> `POST /backend-api/files/{file_id}/uploaded` | 把本地图片变成 ChatGPT Web 可引用的 file id。 |
| 轮询结果 | `GET /backend-api/conversation/{conversation_id}` | 从 conversation mapping 中找图片工具输出。 |
| 下载结果 | `GET /backend-api/files/{file_id}/download` 或 `GET /backend-api/conversation/{conversation_id}/attachment/{id}/download` | 获取生成图片 URL。 |
| 普通文本聊天 | `POST /backend-api/conversation` 或 `POST /backend-anon/conversation` | 文本/非图片 Responses 的底层聊天入口。 |

### 对我们的启发

- `codex-gpt-image-2` 在该项目里是模型别名。它仍然通过 ChatGPT Web 会话图片链路发送，不代表存在对外 `/codex/responses` 接口。
- `/v1/responses` 只是它暴露给调用方的兼容接口；当请求带 `image_generation` 工具时，内部仍转成图片会话流程。
- 上传图编辑使用 `image_asset_pointer + metadata.attachments`，这会表现为上传素材样式，不等于官网历史图引用样式。

## 参考项目：CLIProxyAPI

该项目仅作为接口设计参考。

### 对外接口

CLIProxyAPI 同时暴露 OpenAI 兼容入口和 Codex CLI 直连别名：

| 接口 | 作用 |
| --- | --- |
| `GET /v1/models` | 返回统一模型列表。 |
| `POST /v1/images/generations` | OpenAI 兼容文生图入口。内部会转成 Responses 图片工具请求。 |
| `POST /v1/images/edits` | OpenAI 兼容图生图/遮罩编辑入口。内部会转成 Responses 图片工具请求。 |
| `POST /v1/responses` | OpenAI Responses 兼容入口。 |
| `GET /v1/responses` | WebSocket 版 Responses 入口。 |
| `POST /v1/responses/compact` | Responses compact 入口。 |
| `POST /backend-api/codex/responses` | Codex CLI `chatgpt_base_url` 兼容别名，走同一个 Responses handler。 |
| `GET /backend-api/codex/responses` | Codex CLI WebSocket 兼容别名。 |
| `POST /backend-api/codex/responses/compact` | Codex compact 兼容别名。 |

这里的 `/backend-api/codex/responses` 是它本地服务暴露给 Codex CLI 的别名，不代表一定已经是上游官网请求；真实上游还要看 executor。

### Codex 实际上游

| 项目 | 值 |
| --- | --- |
| 默认上游 base URL | `https://chatgpt.com/backend-api/codex`。如果 `codex-api-key.base-url` 或 auth 里 `base_url` 有值，则使用自定义 base URL。 |
| HTTP Responses | `POST {baseURL}/responses`，默认就是 `POST https://chatgpt.com/backend-api/codex/responses`。 |
| HTTP compact | `POST {baseURL}/responses/compact`。 |
| WebSocket Responses | 只有下游也是 WebSocket 且该账号启用 websockets 时才走；由 `{baseURL}/responses` 转成 `wss://.../responses`，并带 `OpenAI-Beta: responses_websockets=2026-02-06`。普通 HTTP 请求不会走这个分支。 |
| 认证 | `Authorization: Bearer <api_key 或 OAuth access_token>`。OAuth 文件账号还会带 `Chatgpt-Account-Id`。 |
| 关键 Header | `Content-Type: application/json`，流式时 `Accept: text/event-stream`，`User-Agent` 默认 `codex_cli_rs/...`，`Originator` 默认 `codex_cli_rs`。 |

### 图片请求形态

CLIProxyAPI 的图片兼容入口不是直连 OpenAI Images API 上游，而是把 `/v1/images/generations`、`/v1/images/edits` 转成 Responses 图片工具：

| 场景 | 内部 Responses 请求 |
| --- | --- |
| 文生图 | `input` 是 user message + prompt；`tools=[{type:"image_generation", action:"generate", model:"gpt-image-2"}]`；`tool_choice={type:"image_generation"}`。 |
| 图生图/遮罩编辑 | `input` 里加入 `input_image` data URL；工具为 `{type:"image_generation", action:"edit", model:"gpt-image-2"}`；mask 进入 `tool.input_image_mask.image_url`。 |
| 默认主模型 | `gpt-5.4-mini`，如果图片模型写成 `prefix/gpt-image-2`，主模型会继承同样前缀。 |
| 请求规范化 | 强制 `stream=true`、`store=false`、`parallel_tool_calls=true`、`include=["reasoning.encrypted_content"]`；删除 Codex 不支持的 token/采样字段；把 `system` role 改成 `developer`。 |
| 自动补工具 | 如果请求没带 `image_generation` 工具，且不是 free plan/spark 模型/禁用图片工具，会自动补 `{"type":"image_generation","output_format":"png"}`。 |

### 对我们的启发

- CLIProxyAPI 也证明要分清两层：对外兼容接口可以是 `/v1/responses`，但 Codex OAuth 的真实上游默认是 `https://chatgpt.com/backend-api/codex/responses`。
- 它额外暴露 `/backend-api/codex/responses` 本地别名，是为了让 Codex CLI 的 `chatgpt_base_url` 能直接指向代理；这个别名在代理内部仍复用 Responses handler。
- 它没有把 Codex 图片额度转成 `/backend-api/f/conversation`；Codex 图片走 Responses + `image_generation` 工具。
- `codex-api-key.base-url` 只替换 base URL，实际 path 仍然追加 `/responses` 或 `/responses/compact`。

## 四套系统接口对照

| 类型 | 本项目 | ChatGpt-Image-Studio | chatgpt2api | CLIProxyAPI |
| --- | --- | --- | --- | --- |
| 本地文生图入口 | `POST /api/images/generate` | `POST /v1/images/generations` | `POST /v1/images/generations` | `POST /v1/images/generations` |
| 本地图生图入口 | `POST /api/images/edit` | `POST /v1/images/edits` | `POST /v1/images/edits` | `POST /v1/images/edits` |
| OpenAI Images API 上游 | CPA/API 用配置的 `/v1/images/generations`、`/v1/images/edits` | CPA `images_api` 用 `/v1/images/generations`、`/v1/images/edits` | 对外暴露这两个接口，内部转 ChatGPT Web 会话 | 对外暴露这两个接口，内部转 Responses 图片工具 |
| OpenAI Responses 上游 | CPA/API 用配置的 `/v1/responses` | CPA `codex_responses` 用 `/v1/responses` | 对外暴露 `/v1/responses`，内部可转图片会话 | 对外暴露 `/v1/responses`，Codex executor 默认上游 `/backend-api/codex/responses` |
| ChatGPT 官网普通额度 | Python bridge：`/backend-api/f/conversation/prepare` + `/backend-api/f/conversation` | legacy：`/backend-api/f/conversation`，必要时 `/backend-api/conversation` | `/backend-api/f/conversation/prepare` + `/backend-api/f/conversation` | 不作为 Codex 图片路径使用 |
| ChatGPT 官网 Codex 额度 | Bun 直连 `/backend-api/codex/responses` | `ResponsesClient` 直连 `/backend-api/codex/responses` | 未作为单独路径暴露；`codex-gpt-image-2` 是模型别名 | Codex executor 默认直连 `/backend-api/codex/responses`，也暴露同名本地别名 |
| 官网历史图引用编辑 | `/backend-api/conversation` + `metadata.dalle.from_client.operation.original_file_id`，body parent 锚到源图 | `/backend-api/conversation` + `metadata.dalle.from_client.operation`，源图上下文直接传入 | 未看到完善的历史图引用编辑分离逻辑 | 未看到历史图引用编辑分离逻辑；更偏通用 Codex/Responses 代理 |
| 上传素材式编辑 | 上传 `/backend-api/files` 后走 `/backend-api/f/conversation` | 上传 `/backend-api/files` 后走 conversation | 上传 `/backend-api/files` 后走 `/backend-api/f/conversation` | `/v1/images/edits` 输入图会变成 Responses `input_image` data URL |

## 排查时看哪里

| 想确认的问题 | 主要文件/字段 |
| --- | --- |
| 当前全局模式是什么 | `providerRuntime.ts` 的 `imageGenerationSettings()` 和 `providerMatchesImageMode()`。 |
| 自动模式为什么选了某个渠道 | `providerRuntime.ts` 的 `providerChannelSort()`、`providerChainById()`、`callProviderChain()`。 |
| CPA/API 到底走 Images 还是 Responses | `provider_configs.route_mode`，以及 `providerRuntime.ts` 的 `callProvider()`。 |
| 官网模式先走 Codex 还是官网普通额度 | `provider_configs.quota_mode`，以及 `chatGptWebQuotaOrder()`。 |
| 官网 Codex 实际 URL | `provider_configs.responses_path`，归一后默认 `/codex/responses`。 |
| 官网普通额度实际请求 | `scripts/chatgpt_web_bridge.py`。 |
| 引用图为什么挂到源图节点 | `sourceReference` 官网历史图编辑会强制使用源图 `conversation_id/parent_message_id`，避免引用跑偏。 |
| 请求和响应证据 | `provider_request_logs` 记录真实 endpoint、route_mode、status、duration、错误。`image_jobs.request_json/response_json` 保存任务侧快照。 |
