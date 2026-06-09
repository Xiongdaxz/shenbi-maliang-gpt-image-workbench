import base64
import hashlib
import json
import random
import re
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from io import BytesIO
from typing import Any
from urllib.parse import quote

import requests as std_requests
from curl_cffi import requests
from PIL import Image


BASE_ORIGIN = "https://chatgpt.com"
DEFAULT_POW_SCRIPT = "https://chatgpt.com/backend-api/sentinel/sdk.js"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
)
CLIENT_VERSION = "prod-be885abbfcfe7b1f511e88b3003d9ee44757fbad"
CLIENT_BUILD_NUMBER = "5955942"
CORES = [8, 16, 24, 32]
DOCUMENT_KEYS = ["_reactListeningo743lnnpvdg", "location"]
NAVIGATOR_KEYS = [
    "webdriver-false",
    "cookieEnabled-true",
    "vendor-Google Inc.",
    "language-en-US",
    "hardwareConcurrency-32",
    "pdfViewerEnabled-true",
]
WINDOW_KEYS = ["window", "self", "document", "location", "navigator", "performance", "crypto", "fetch"]


class BridgeError(Exception):
    def __init__(self, message: str, status_code: int | None = None, endpoint: str = "") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.endpoint = endpoint


class ScriptSrcParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.script_sources: list[str] = []
        self.data_build = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "script":
            return
        attrs_dict = dict(attrs)
        src = attrs_dict.get("src")
        if not src:
            return
        self.script_sources.append(src)
        match = re.search(r"c/[^/]*/_", src)
        if match:
            self.data_build = match.group(0)


@dataclass
class Requirements:
    token: str
    proof_token: str = ""
    turnstile_token: str = ""
    so_token: str = ""


@dataclass
class ConversationState:
    text: str = ""
    conversation_id: str = ""
    file_ids: list[str] = None
    sediment_ids: list[str] = None
    blocked: bool = False
    tool_invoked: bool | None = None
    turn_use_case: str = ""

    def __post_init__(self) -> None:
        if self.file_ids is None:
            self.file_ids = []
        if self.sediment_ids is None:
            self.sediment_ids = []


@dataclass
class ImageQuota:
    remaining: int
    reset_after: str | None
    unknown: bool
    default_model_slug: str = ""


@dataclass
class ImageResultPointer:
    file_id: str = ""
    sediment_id: str = ""
    gen_id: str = ""
    message_id: str = ""
    revised_prompt: str = ""


def parse_pow_resources(html: str) -> tuple[list[str], str]:
    parser = ScriptSrcParser()
    parser.feed(html)
    script_sources = parser.script_sources or [DEFAULT_POW_SCRIPT]
    data_build = parser.data_build
    if not data_build:
        match = re.search(r'<html[^>]*data-build="([^"]*)"', html)
        if match:
            data_build = match.group(1)
    return script_sources, data_build


def legacy_parse_time() -> str:
    now = datetime.now(timezone(timedelta(hours=-5)))
    return now.strftime("%a %b %d %Y %H:%M:%S") + " GMT-0500 (Eastern Standard Time)"


def build_pow_config(user_agent: str, script_sources: list[str], data_build: str) -> list[Any]:
    perf_counter = time.perf_counter() * 1000
    return [
        random.choice([3000, 4000, 5000]),
        legacy_parse_time(),
        4294705152,
        0,
        user_agent,
        random.choice(script_sources or [DEFAULT_POW_SCRIPT]),
        data_build,
        "en-US",
        "en-US,es-US,en,es",
        0,
        random.choice(NAVIGATOR_KEYS),
        random.choice(DOCUMENT_KEYS),
        random.choice(WINDOW_KEYS),
        perf_counter,
        str(uuid.uuid4()),
        "",
        random.choice(CORES),
        time.time() * 1000 - perf_counter,
    ]


def b64_json_bytes(data: bytes) -> str:
    return base64.b64encode(data).decode()


def pow_generate(seed: str, difficulty: str, config: list[Any], limit: int = 500000) -> tuple[str, bool]:
    target = bytes.fromhex(difficulty)
    diff_len = len(difficulty) // 2
    seed_bytes = seed.encode()
    static_1 = (json.dumps(config[:3], separators=(",", ":"), ensure_ascii=False)[:-1] + ",").encode()
    static_2 = ("," + json.dumps(config[4:9], separators=(",", ":"), ensure_ascii=False)[1:-1] + ",").encode()
    static_3 = ("," + json.dumps(config[10:], separators=(",", ":"), ensure_ascii=False)[1:]).encode()
    for index in range(limit):
        final_json = static_1 + str(index).encode() + static_2 + str(index >> 1).encode() + static_3
        encoded = base64.b64encode(final_json)
        digest = hashlib.sha3_512(seed_bytes + encoded).digest()
        if digest[:diff_len] <= target:
            return encoded.decode(), True
    fallback = "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D" + base64.b64encode(json.dumps(seed).encode()).decode()
    return fallback, False


def build_requirements_token(user_agent: str, script_sources: list[str], data_build: str) -> str:
    config = build_pow_config(user_agent, script_sources, data_build)
    answer, _ = pow_generate(str(random.random()), "0fffff", config)
    return "gAAAAAC" + answer


def build_proof_token(seed: str, difficulty: str, user_agent: str, script_sources: list[str], data_build: str) -> str:
    config = build_pow_config(user_agent, script_sources, data_build)
    answer, solved = pow_generate(seed, difficulty, config)
    if not solved:
        raise BridgeError(f"failed to solve proof token: difficulty={difficulty}")
    return "gAAAAAB" + answer


def decode_data_url(value: str) -> tuple[bytes, str]:
    if value.startswith("data:"):
        header, payload = value.split(",", 1)
        mime_match = re.match(r"data:([^;,]+)", header)
        mime_type = mime_match.group(1) if mime_match else "image/png"
        return base64.b64decode(payload), mime_type
    return base64.b64decode(value), "image/png"


def image_size(data: bytes) -> tuple[int, int, str]:
    image = Image.open(BytesIO(data))
    mime_type = Image.MIME.get(image.format, "image/png")
    return image.width, image.height, mime_type


def ensure_ok(response: requests.Response, context: str) -> None:
    if 200 <= response.status_code < 300:
        return
    text = response.text[:1000] if response.text else response.reason
    if text.lstrip().lower().startswith("<!doctype") or text.lstrip().lower().startswith("<html"):
        text = "HTML protection page"
    raise BridgeError(f"{context} returned {response.status_code}: {text}", response.status_code, response.url)


def extract_image_quota(limits_progress: Any, default_model_slug: str = "") -> ImageQuota:
    if isinstance(limits_progress, list):
        for item in limits_progress:
            if isinstance(item, dict) and item.get("feature_name") == "image_gen":
                try:
                    remaining = int(item.get("remaining") or 0)
                except (TypeError, ValueError):
                    remaining = 0
                reset_after = str(item.get("reset_after") or item.get("resets_at") or item.get("reset_at") or "").strip() or None
                return ImageQuota(remaining=remaining, reset_after=reset_after, unknown=False, default_model_slug=default_model_slug)
    return ImageQuota(remaining=0, reset_after=None, unknown=True, default_model_slug=default_model_slug)


def iter_sse_payloads(text: str) -> list[str]:
    payloads: list[str] = []
    for chunk in re.split(r"\r?\n\r?\n", text):
        lines = [line[5:].strip() for line in chunk.splitlines() if line.startswith("data:")]
        if not lines:
            continue
        payload = "\n".join(lines).strip()
        if not payload or payload == "[DONE]":
            continue
        payloads.append(payload)
    return payloads


def iter_sse_json(text: str) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for payload in iter_sse_payloads(text):
        try:
            data = json.loads(payload)
            if isinstance(data, dict):
                frames.append(data)
        except json.JSONDecodeError:
            continue
    return frames


def decode_response_line(raw_line: Any) -> str:
    if isinstance(raw_line, bytes):
        return raw_line.decode("utf-8", errors="ignore")
    return str(raw_line)


def extract_conversation_ids(payload: str) -> tuple[str, list[str], list[str]]:
    conversation_match = re.search(r'"conversation_id"\s*:\s*"([^"]+)"', payload)
    conversation_id = conversation_match.group(1) if conversation_match else ""
    file_ids = re.findall(r"(file[-_][A-Za-z0-9_-]+)", payload)
    sediment_ids = re.findall(r"sediment://([A-Za-z0-9_-]+)", payload)
    return conversation_id, file_ids, sediment_ids


def collect_pointers(value: Any) -> tuple[list[str], list[str]]:
    file_ids: list[str] = []
    sediment_ids: list[str] = []

    def push(target: list[str], item: str) -> None:
        if item and item not in target and item != "file_upload":
            target.append(item)

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                visit(child)
            return
        if isinstance(node, dict):
            pointer = str(node.get("asset_pointer") or "")
            if pointer.startswith("file-service://"):
                push(file_ids, pointer.removeprefix("file-service://"))
            if pointer.startswith("sediment://"):
                push(sediment_ids, pointer.removeprefix("sediment://"))
            for child in node.values():
                visit(child)
            return
        if isinstance(node, str):
            for hit in re.findall(r"(file[-_][A-Za-z0-9_-]+)", node):
                push(file_ids, hit)
            for hit in re.findall(r"file-service://([A-Za-z0-9_-]+)", node):
                push(file_ids, hit)
            for hit in re.findall(r"sediment://([A-Za-z0-9_-]+)", node):
                push(sediment_ids, hit)

    visit(value)
    return file_ids, sediment_ids


def add_unique(values: list[str], candidates: list[str]) -> None:
    for candidate in candidates:
        if candidate and candidate not in values:
            values.append(candidate)


def is_image_tool_message(message: Any) -> bool:
    if not isinstance(message, dict):
        return False
    metadata = message.get("metadata") or {}
    author = message.get("author") or {}
    return author.get("role") == "tool" and metadata.get("async_task_type") == "image_gen"


def is_image_tool_event(event: dict[str, Any]) -> bool:
    value = event.get("v")
    message = event.get("message") or (value.get("message") if isinstance(value, dict) else None)
    return is_image_tool_message(message)


def assistant_message_text(message: dict[str, Any]) -> str:
    content = message.get("content") or {}
    parts = content.get("parts") or []
    if not isinstance(parts, list):
        return ""
    return "".join(part for part in parts if isinstance(part, str))


def apply_patch_op(operation: dict[str, Any], current_text: str) -> str:
    op = operation.get("o")
    value = str(operation.get("v") or "")
    if op == "append":
        return current_text + value
    if op == "replace":
        return value
    return current_text


def apply_text_patch(event: dict[str, Any], current_text: str = "") -> str:
    if event.get("p") == "/message/content/parts/0":
        return apply_patch_op(event, current_text)
    operations = event.get("v")
    if isinstance(operations, str) and current_text and not event.get("p") and not event.get("o"):
        return current_text + operations
    if event.get("o") == "patch" and isinstance(operations, list):
        text = current_text
        for item in operations:
            if isinstance(item, dict):
                text = apply_text_patch(item, text)
        return text
    if not isinstance(operations, list):
        return current_text
    text = current_text
    for item in operations:
        if isinstance(item, dict):
            text = apply_text_patch(item, text)
    return text


def assistant_text(event: dict[str, Any], current_text: str = "") -> str:
    for candidate in (event, event.get("v")):
        if not isinstance(candidate, dict):
            continue
        message = candidate.get("message")
        if not isinstance(message, dict):
            continue
        role = str((message.get("author") or {}).get("role") or "").strip().lower()
        if role != "assistant":
            continue
        text = assistant_message_text(message)
        if text:
            return text
    return apply_text_patch(event, current_text)


def update_conversation_state(state: ConversationState, payload: str, event: dict[str, Any] | None = None) -> None:
    conversation_id, file_ids, sediment_ids = extract_conversation_ids(payload)
    if conversation_id and not state.conversation_id:
        state.conversation_id = conversation_id
    if isinstance(event, dict) and is_image_tool_event(event):
        add_unique(state.file_ids, file_ids)
        add_unique(state.sediment_ids, sediment_ids)
    if not isinstance(event, dict):
        return
    state.conversation_id = str(event.get("conversation_id") or state.conversation_id)
    value = event.get("v")
    if isinstance(value, dict):
        state.conversation_id = str(value.get("conversation_id") or state.conversation_id)
    if event.get("type") == "moderation":
        moderation = event.get("moderation_response")
        if isinstance(moderation, dict) and moderation.get("blocked") is True:
            state.blocked = True
    if event.get("type") == "server_ste_metadata":
        metadata = event.get("metadata")
        if isinstance(metadata, dict):
            if isinstance(metadata.get("tool_invoked"), bool):
                state.tool_invoked = metadata["tool_invoked"]
            state.turn_use_case = str(metadata.get("turn_use_case") or state.turn_use_case)
    next_text = assistant_text(event, state.text)
    if next_text != state.text:
        state.text = next_text


def conversation_image_tool_pointers(conversation: dict[str, Any]) -> tuple[list[str], list[str]]:
    records: list[tuple[float, list[str], list[str]]] = []
    mapping = conversation.get("mapping") or {}
    if not isinstance(mapping, dict):
        return [], []
    for node in mapping.values():
        message = (node or {}).get("message") if isinstance(node, dict) else None
        if not is_image_tool_message(message):
            continue
        file_ids, sediment_ids = collect_pointers(message)
        records.append((float(message.get("create_time") or 0), file_ids, sediment_ids))
    final_file_ids: list[str] = []
    final_sediment_ids: list[str] = []
    for _, file_ids, sediment_ids in sorted(records, key=lambda item: item[0]):
        add_unique(final_file_ids, file_ids)
        add_unique(final_sediment_ids, sediment_ids)
    return final_file_ids, final_sediment_ids


def broad_conversation_image_pointers(conversation: dict[str, Any], exclude_file_ids: set[str], include_sediment: bool) -> tuple[list[str], list[str]]:
    file_ids, sediment_ids = collect_pointers(conversation)
    file_ids = [file_id for file_id in file_ids if file_id not in exclude_file_ids]
    if not include_sediment:
        sediment_ids = []
    return file_ids, sediment_ids


def file_id_from_pointer(pointer: str, prefix: str) -> str:
    return pointer.removeprefix(prefix).strip() if pointer.startswith(prefix) else ""


def image_result_pointers_from_message(message: dict[str, Any], exclude_file_ids: set[str]) -> list[ImageResultPointer]:
    author = message.get("author") or {}
    role = str(author.get("role") or "").strip().lower()
    if role in ("user", "system"):
        return []
    status = str(message.get("status") or "").strip()
    if status and status != "finished_successfully":
        return []
    content = message.get("content") or {}
    if content.get("content_type") != "multimodal_text":
        return []
    parts = content.get("parts") or []
    if not isinstance(parts, list):
        return []
    records: list[ImageResultPointer] = []
    message_id = str(message.get("id") or "").strip()
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("content_type") != "image_asset_pointer":
            continue
        pointer = str(part.get("asset_pointer") or "").strip()
        file_id = file_id_from_pointer(pointer, "file-service://")
        sediment_id = file_id_from_pointer(pointer, "sediment://")
        result_id = file_id or sediment_id
        if not result_id or result_id in exclude_file_ids:
            continue
        metadata = part.get("metadata") or {}
        dalle = metadata.get("dalle") if isinstance(metadata, dict) else {}
        dalle = dalle if isinstance(dalle, dict) else {}
        records.append(
            ImageResultPointer(
                file_id=file_id,
                sediment_id=sediment_id,
                gen_id=str(dalle.get("gen_id") or dalle.get("generation_id") or "").strip(),
                message_id=message_id,
                revised_prompt=str(dalle.get("prompt") or "").strip(),
            )
        )
    return records


def conversation_messages(
    conversation: dict[str, Any],
    root_message_id: str = "",
) -> list[dict[str, Any]]:
    mapping = conversation.get("mapping") or {}
    if not isinstance(mapping, dict):
        return []
    root_message_id = str(root_message_id or "").strip()

    def message_from_node(node: Any) -> dict[str, Any] | None:
        if not isinstance(node, dict):
            return None
        message = node.get("message")
        return message if isinstance(message, dict) else None

    if not root_message_id:
        messages = [message for node in mapping.values() if (message := message_from_node(node))]
        return sorted(messages, key=lambda item: float(item.get("create_time") or 0))

    root_node_ids: list[str] = []
    if root_message_id in mapping:
        root_node_ids.append(root_message_id)
    for node_id, node in mapping.items():
        message = message_from_node(node)
        if message and str(message.get("id") or "").strip() == root_message_id:
            add_unique(root_node_ids, [str(node_id)])

    if not root_node_ids:
        return []

    messages: list[dict[str, Any]] = []
    seen: set[str] = set()

    def visit(node_id: str) -> None:
        if not node_id or node_id in seen:
            return
        node = mapping.get(node_id)
        if not isinstance(node, dict):
            return
        seen.add(node_id)
        message = message_from_node(node)
        if message:
            messages.append(message)
        children = node.get("children") or []
        if isinstance(children, list):
            for child_id in children:
                visit(str(child_id or ""))

    for node_id in root_node_ids:
        visit(node_id)
    return sorted(messages, key=lambda item: float(item.get("create_time") or 0))


def conversation_image_result_pointers(
    conversation: dict[str, Any],
    exclude_file_ids: set[str],
    include_sediment: bool = True,
    root_message_id: str = "",
    min_create_time: float = 0.0,
) -> list[ImageResultPointer]:
    messages = conversation_messages(conversation, root_message_id)
    records: list[ImageResultPointer] = []
    seen: set[str] = set()
    for message in messages:
        if min_create_time and message_create_time(message) < min_create_time:
            continue
        for record in image_result_pointers_from_message(message, exclude_file_ids):
            if record.sediment_id and not include_sediment:
                continue
            key = record.file_id or f"sediment:{record.sediment_id}"
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
    return records


def broad_image_result_pointers_from_messages(
    conversation: dict[str, Any],
    exclude_file_ids: set[str],
    include_sediment: bool = True,
    min_create_time: float = 0.0,
) -> list[ImageResultPointer]:
    records: list[ImageResultPointer] = []
    seen: set[str] = set()
    for message in conversation_messages(conversation):
        if min_create_time and message_create_time(message) < min_create_time:
            continue
        author = message.get("author") or {}
        role = str(author.get("role") or "").strip().lower() if isinstance(author, dict) else ""
        if role in ("user", "system"):
            continue
        status = str(message.get("status") or "").strip()
        if status and status != "finished_successfully":
            continue
        file_ids, sediment_ids = collect_pointers(message)
        message_id = str(message.get("id") or "").strip()
        for file_id in file_ids:
            if not file_id or file_id in exclude_file_ids or file_id in seen:
                continue
            seen.add(file_id)
            records.append(ImageResultPointer(file_id=file_id, message_id=message_id))
        if include_sediment:
            for sediment_id in sediment_ids:
                key = f"sediment:{sediment_id}"
                if not sediment_id or key in seen:
                    continue
                seen.add(key)
                records.append(ImageResultPointer(sediment_id=sediment_id, message_id=message_id))
    return records


def download_url_from_json(data: Any) -> str:
    if isinstance(data, dict):
        for key in ("download_url", "url", "downloadUrl", "signed_url", "signedUrl", "href"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for value in data.values():
            nested = download_url_from_json(value)
            if nested:
                return nested
    if isinstance(data, list):
        for item in data:
            nested = download_url_from_json(item)
            if nested:
                return nested
    return ""


def message_create_time(message: dict[str, Any] | None) -> float:
    if not isinstance(message, dict):
        return 0.0
    try:
        return float(message.get("create_time") or 0)
    except (TypeError, ValueError):
        return 0.0


def message_id_from_node(node_id: str, node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    message = node.get("message")
    if isinstance(message, dict):
        message_id = str(message.get("id") or "").strip()
        if message_id:
            return message_id
    return str(node_id or "").strip()


def conversation_current_leaf_message_id(conversation: dict[str, Any], fallback_message_id: str = "") -> str:
    mapping = conversation.get("mapping") or {}
    if not isinstance(mapping, dict):
        return fallback_message_id

    current_node_id = str(
        conversation.get("current_node")
        or conversation.get("current_node_id")
        or conversation.get("currentNode")
        or ""
    ).strip()
    if current_node_id and current_node_id in mapping:
        current_message_id = message_id_from_node(current_node_id, mapping[current_node_id])
        if current_message_id:
            return current_message_id

    leaves: list[tuple[float, str]] = []
    for node_id, node in mapping.items():
        if not isinstance(node, dict):
            continue
        children = node.get("children") or []
        if isinstance(children, list) and len(children) > 0:
            continue
        message = node.get("message")
        if not isinstance(message, dict):
            continue
        author = message.get("author") or {}
        role = str(author.get("role") or "").strip().lower() if isinstance(author, dict) else ""
        if role in ("system", "tool"):
            continue
        message_id = message_id_from_node(str(node_id), node)
        if message_id:
            leaves.append((message_create_time(message), message_id))

    if leaves:
        leaves.sort(key=lambda item: item[0])
        return leaves[-1][1]
    return fallback_message_id


def conversation_branch_parent_message_id(conversation: dict[str, Any], anchor_message_id: str) -> str:
    mapping = conversation.get("mapping") or {}
    if not isinstance(mapping, dict):
        return ""
    anchor_message_id = str(anchor_message_id or "").strip()
    if not anchor_message_id:
        return ""

    def node_message(node: Any) -> dict[str, Any] | None:
        if not isinstance(node, dict):
            return None
        message = node.get("message")
        return message if isinstance(message, dict) else None

    def message_role(node_id: str) -> str:
        message = node_message(mapping.get(node_id))
        author = (message or {}).get("author") or {}
        return str(author.get("role") or "").strip().lower() if isinstance(author, dict) else ""

    anchor_node_id = ""
    if anchor_message_id in mapping:
        anchor_node_id = anchor_message_id
    else:
        for node_id, node in mapping.items():
            message = node_message(node)
            if message and str(message.get("id") or "").strip() == anchor_message_id:
                anchor_node_id = str(node_id)
                break
    if not anchor_node_id:
        return ""

    user_node_id = anchor_node_id
    for _ in range(20):
        if message_role(user_node_id) == "user":
            break
        node = mapping.get(user_node_id)
        if not isinstance(node, dict):
            return ""
        parent_id = str(node.get("parent") or "").strip()
        if not parent_id:
            return ""
        user_node_id = parent_id
    if message_role(user_node_id) != "user":
        return ""

    user_node = mapping.get(user_node_id)
    if not isinstance(user_node, dict):
        return ""
    branch_parent_node_id = str(user_node.get("parent") or "").strip()
    if not branch_parent_node_id:
        return "client-created-root"
    branch_parent_node = mapping.get(branch_parent_node_id)
    if isinstance(branch_parent_node, dict):
        return message_id_from_node(branch_parent_node_id, branch_parent_node)
    return branch_parent_node_id


def conversation_tail_parent_message_id(conversation: dict[str, Any], anchor_message_id: str) -> str:
    mapping = conversation.get("mapping") or {}
    if not isinstance(mapping, dict):
        return ""
    anchor_message_id = str(anchor_message_id or "").strip()
    if not anchor_message_id:
        return ""

    def node_message(node: Any) -> dict[str, Any] | None:
        if not isinstance(node, dict):
            return None
        message = node.get("message")
        return message if isinstance(message, dict) else None

    def node_role(node_id: str) -> str:
        message = node_message(mapping.get(node_id))
        author = (message or {}).get("author") or {}
        return str(author.get("role") or "").strip().lower() if isinstance(author, dict) else ""

    anchor_node_id = ""
    if anchor_message_id in mapping:
        anchor_node_id = anchor_message_id
    else:
        for node_id, node in mapping.items():
            message = node_message(node)
            if message and str(message.get("id") or "").strip() == anchor_message_id:
                anchor_node_id = str(node_id)
                break
    if not anchor_node_id:
        return ""

    current_node_id = anchor_node_id
    seen: set[str] = set()
    for _ in range(20):
        if current_node_id in seen:
            break
        seen.add(current_node_id)
        node = mapping.get(current_node_id)
        if not isinstance(node, dict):
            break
        children = [str(item or "").strip() for item in (node.get("children") or [])]
        tool_children: list[tuple[float, str]] = []
        for child_id in children:
            if not child_id or child_id in seen:
                continue
            role = node_role(child_id)
            if role == "user":
                continue
            child_message = node_message(mapping.get(child_id))
            tool_children.append((message_create_time(child_message), child_id))
        if not tool_children:
            break
        tool_children.sort(key=lambda item: item[0])
        current_node_id = tool_children[-1][1]

    current_node = mapping.get(current_node_id)
    if isinstance(current_node, dict):
        return message_id_from_node(current_node_id, current_node)
    return current_node_id


def conversation_state_from_mapping(conversation: dict[str, Any]) -> ConversationState:
    state = ConversationState()
    state.conversation_id = str(conversation.get("conversation_id") or conversation.get("id") or "")
    mapping = conversation.get("mapping") or {}
    if not isinstance(mapping, dict):
        return state
    messages: list[dict[str, Any]] = []
    for node in mapping.values():
        message = (node or {}).get("message") if isinstance(node, dict) else None
        if isinstance(message, dict):
            messages.append(message)
    messages.sort(key=lambda item: float(item.get("create_time") or 0))
    for message in messages:
        metadata = message.get("metadata") or {}
        if is_image_tool_message(message):
            file_ids, sediment_ids = collect_pointers(message)
            add_unique(state.file_ids, file_ids)
            add_unique(state.sediment_ids, sediment_ids)
        if isinstance(metadata, dict):
            if isinstance(metadata.get("tool_invoked"), bool):
                state.tool_invoked = metadata["tool_invoked"]
            if metadata.get("turn_use_case"):
                state.turn_use_case = str(metadata.get("turn_use_case") or "")
        role = str((message.get("author") or {}).get("role") or "").strip().lower()
        if role == "assistant":
            text = assistant_message_text(message)
            if text:
                state.text = text
    return state


class ChatGptWebBridge:
    def __init__(self, request: dict[str, Any]) -> None:
        self.request = request
        self.access_token = str(request.get("accessToken") or "").strip()
        self.cookies = str(request.get("cookies") or "").strip()
        self.base_url = str(request.get("baseUrl") or "https://chatgpt.com/backend-api").rstrip("/")
        self.origin = self.base_url.removesuffix("/backend-api")
        if not self.origin:
            self.origin = BASE_ORIGIN
        self.user_agent = DEFAULT_USER_AGENT
        self.device_id = str(uuid.uuid4())
        self.session_id = str(uuid.uuid4())
        self.script_sources = [DEFAULT_POW_SCRIPT]
        self.data_build = ""
        self.last_conversation_debug: dict[str, Any] = {}
        try:
            retry_count = int(float(request.get("retryCount") or 0))
        except (TypeError, ValueError):
            retry_count = 0
        self.retry_count = max(0, min(10, retry_count))
        proxy = str(request.get("proxy") or "").strip()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        self.standard_proxies = proxies
        self.session = requests.Session(impersonate=str(request.get("impersonate") or "edge101"), proxies=proxies, verify=True)
        self.session.headers.update(
            {
                "User-Agent": self.user_agent,
                "Origin": BASE_ORIGIN,
                "Referer": BASE_ORIGIN + "/",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Content-Type": "application/json",
                "Sec-CH-UA": '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                "Sec-CH-UA-Mobile": "?0",
                "Sec-CH-UA-Platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "OAI-Device-Id": self.device_id,
                "OAI-Session-Id": self.session_id,
                "OAI-Language": "zh-CN",
                "OAI-Client-Version": CLIENT_VERSION,
                "OAI-Client-Build-Number": CLIENT_BUILD_NUMBER,
            }
        )
        if self.access_token:
            self.session.headers["Authorization"] = "Bearer " + self.access_token
        if self.cookies:
            self.session.headers["Cookie"] = self.cookies

    def request_with_retry(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        last_error: Exception | None = None
        for attempt in range(self.retry_count + 1):
            try:
                return getattr(self.session, method)(url, **kwargs)
            except Exception as error:
                last_error = error
                if attempt >= self.retry_count:
                    raise
                time.sleep(min(1.5, 0.3 * (attempt + 1)))
        raise last_error or BridgeError("request failed")

    def standard_request_with_retry(self, method: str, url: str, **kwargs: Any) -> std_requests.Response:
        last_error: Exception | None = None
        if self.standard_proxies:
            kwargs.setdefault("proxies", self.standard_proxies)
        for attempt in range(self.retry_count + 1):
            try:
                return std_requests.request(method.upper(), url, **kwargs)
            except Exception as error:
                last_error = error
                if attempt >= self.retry_count:
                    raise
                time.sleep(min(1.5, 0.3 * (attempt + 1)))
        raise last_error or BridgeError("request failed")

    def target_headers(self, path: str, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = dict(self.session.headers)
        headers["X-OpenAI-Target-Path"] = path
        headers["X-OpenAI-Target-Route"] = path
        if extra:
            headers.update(extra)
        return headers

    def browser_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = dict(self.session.headers)
        if extra:
            headers.update(extra)
        return headers

    def bootstrap(self) -> None:
        response = self.request_with_retry(
            "get",
            self.origin + "/",
            headers={
                "User-Agent": self.user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Sec-CH-UA": self.session.headers["Sec-CH-UA"],
                "Sec-CH-UA-Mobile": self.session.headers["Sec-CH-UA-Mobile"],
                "Sec-CH-UA-Platform": self.session.headers["Sec-CH-UA-Platform"],
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            },
            timeout=30,
        )
        ensure_ok(response, "bootstrap")
        self.script_sources, self.data_build = parse_pow_resources(response.text)

    def chat_requirements(self) -> Requirements:
        path = "/backend-api/sentinel/chat-requirements"
        body = {"p": build_requirements_token(self.user_agent, self.script_sources, self.data_build)}
        response = self.request_with_retry(
            "post",
            self.origin + path,
            headers=self.target_headers(path, {"Content-Type": "application/json"}),
            json=body,
            timeout=30,
        )
        ensure_ok(response, "chat-requirements")
        data = response.json()
        if (data.get("arkose") or {}).get("required"):
            raise BridgeError("chat-requirements requires arkose token")
        proof_token = ""
        pow_info = data.get("proofofwork") or {}
        if pow_info.get("required"):
            proof_token = build_proof_token(
                str(pow_info.get("seed") or ""),
                str(pow_info.get("difficulty") or ""),
                self.user_agent,
                self.script_sources,
                self.data_build,
            )
        token = str(data.get("token") or "").strip()
        if not token:
            raise BridgeError(f"chat-requirements missing token: {data}")
        return Requirements(
            token=token,
            proof_token=proof_token,
            turnstile_token="",
            so_token=str(data.get("so_token") or ""),
        )

    def image_headers(self, path: str, requirements: Requirements, conduit_token: str = "", accept: str = "*/*") -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": accept,
            "OpenAI-Sentinel-Chat-Requirements-Token": requirements.token,
        }
        if requirements.proof_token:
            headers["OpenAI-Sentinel-Proof-Token"] = requirements.proof_token
        if requirements.turnstile_token:
            headers["OpenAI-Sentinel-Turnstile-Token"] = requirements.turnstile_token
        if requirements.so_token:
            headers["OpenAI-Sentinel-SO-Token"] = requirements.so_token
        if conduit_token:
            headers["X-Conduit-Token"] = conduit_token
        if accept == "text/event-stream":
            headers["X-Oai-Turn-Trace-Id"] = str(uuid.uuid4())
        return self.target_headers(path, headers)

    def image_model_slug(self, model: str) -> str:
        model = str(model or "").strip()
        if model == "gpt-image-2":
            return "gpt-5-3"
        if model == "codex-gpt-image-2":
            return model
        return model or "auto"

    def prepare_conversation(
        self,
        prompt: str,
        requirements: Requirements,
        model: str,
        conversation_id: str = "",
        parent_message_id: str = "",
        message_id: str = "",
        variant_purpose: str = "",
    ) -> str:
        path = "/backend-api/f/conversation/prepare"
        parent_message_id = parent_message_id or str(uuid.uuid4())
        message_id = message_id or str(uuid.uuid4())
        payload = {
            "action": "next",
            "fork_from_shared_post": False,
            "parent_message_id": parent_message_id,
            "model": self.image_model_slug(model),
            "client_prepare_state": "success",
            "timezone_offset_min": -480,
            "timezone": "Asia/Shanghai",
            "conversation_mode": {"kind": "primary_assistant"},
            "system_hints": ["picture_v2"],
            "partial_query": {
                "id": message_id,
                "author": {"role": "user"},
                "content": {"content_type": "text", "parts": [prompt]},
            },
            "supports_buffering": True,
            "supported_encodings": ["v1"],
            "client_contextual_info": {"app_name": "chatgpt.com"},
        }
        if conversation_id:
            payload["conversation_id"] = conversation_id
        if variant_purpose:
            payload["variant_purpose"] = variant_purpose
        response = self.request_with_retry(
            "post",
            self.origin + path,
            headers=self.image_headers(path, requirements),
            json=payload,
            timeout=60,
        )
        ensure_ok(response, path)
        return str(response.json().get("conduit_token") or "")

    def process_upload_stream(self, file_id: str, use_case: str, file_name: str) -> None:
        path = "/backend-api/files/process_upload_stream"
        payload = {
            "file_id": file_id,
            "use_case": use_case,
            "index_for_retrieval": False,
            "file_name": file_name,
        }
        response = self.standard_request_with_retry(
            "post",
            self.origin + path,
            headers=self.browser_headers({"Content-Type": "application/json", "Accept": "text/event-stream"}),
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            timeout=120,
        )
        ensure_ok(response, path)

    def upload_image(
        self,
        image_value: str,
        file_name: str,
        use_case: str = "multimodal",
        process_upload_stream: bool = False,
    ) -> dict[str, Any]:
        data, mime_type = decode_data_url(image_value)
        width, height, detected_mime = image_size(data)
        mime_type = detected_mime or mime_type
        path = "/backend-api/files"
        preupload_payload = {
            "file_name": file_name,
            "file_size": len(data),
            "use_case": use_case,
        }
        if process_upload_stream:
            preupload_payload["timezone_offset_min"] = -480
            preupload_payload["reset_rate_limits"] = False
        else:
            preupload_payload["mime_type"] = mime_type
        response = self.standard_request_with_retry(
            "post",
            self.origin + path,
            headers=self.browser_headers({"Content-Type": "application/json", "Accept": "application/json"}),
            data=json.dumps(preupload_payload, separators=(",", ":")).encode("utf-8"),
            timeout=60,
        )
        ensure_ok(response, path)
        meta = response.json()
        upload_response = self.standard_request_with_retry(
            "put",
            meta["upload_url"],
            headers={
                "Content-Type": mime_type,
                "x-ms-blob-type": "BlockBlob",
                "x-ms-version": "2020-04-08",
                "Origin": self.origin,
                "Referer": self.origin + "/",
                "User-Agent": self.user_agent,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.8",
            },
            data=data,
            timeout=120,
        )
        ensure_ok(upload_response, "image_upload")
        if process_upload_stream:
            self.process_upload_stream(str(meta["file_id"]), use_case, file_name)
            return {
                "file_id": meta["file_id"],
                "file_name": file_name,
                "file_size": len(data),
                "mime_type": mime_type,
                "width": width,
                "height": height,
            }
        confirm_path = f"/backend-api/files/{meta['file_id']}/uploaded"
        confirm_response = self.standard_request_with_retry(
            "post",
            self.origin + confirm_path,
            headers=self.browser_headers({"Content-Type": "application/json", "Accept": "application/json"}),
            data="{}",
            timeout=60,
        )
        ensure_ok(confirm_response, confirm_path)
        return {
            "file_id": meta["file_id"],
            "file_name": file_name,
            "file_size": len(data),
            "mime_type": mime_type,
            "width": width,
            "height": height,
        }

    def prompt(self) -> str:
        payload = self.request.get("payload") or {}
        prompt = str(payload.get("prompt") or "").strip()
        size = str(payload.get("size") or "")
        quality = str(payload.get("quality") or "")
        if size and size not in ("auto", "1024x1024"):
            prompt = f"Generate an image with size {size}. {prompt}"
        if quality in ("hd", "high"):
            prompt = f"Generate a high-quality, detailed image: {prompt}"
        if "不要只回复文字" not in prompt and "do not reply with text only" not in prompt.lower():
            prompt = f"{prompt}\n\n请直接生成图片，不要只回复文字说明。"
        return prompt

    def source_reference(self) -> dict[str, str]:
        payload = self.request.get("payload") or {}
        source = payload.get("sourceReference") if isinstance(payload, dict) else None
        if not isinstance(source, dict):
            return {}
        return {
            key: str(source.get(key) or "").strip()
            for key in ("original_file_id", "original_gen_id", "conversation_id", "parent_message_id", "source_account_id")
        }

    def web_conversation_context(self) -> dict[str, str]:
        payload = self.request.get("payload") or {}
        context = payload.get("webConversationContext") if isinstance(payload, dict) else None
        if not isinstance(context, dict):
            return {}
        return {
            key: str(context.get(key) or "").strip()
            for key in ("placement", "conversation_id", "parent_message_id", "source_account_id")
        }

    def can_use_true_inpaint(self) -> bool:
        payload = self.request.get("payload") or {}
        if self.request.get("operation") != "edit" or not isinstance(payload, dict):
            return False
        if not str(payload.get("mask") or "").strip():
            return False
        source = self.source_reference()
        return bool(source.get("original_file_id") and source.get("source_account_id"))

    def can_use_source_reference_edit(self) -> bool:
        payload = self.request.get("payload") or {}
        if self.request.get("operation") != "edit" or not isinstance(payload, dict):
            return False
        if str(payload.get("mask") or "").strip():
            return False
        source = self.source_reference()
        return bool(source.get("original_file_id") and source.get("source_account_id"))

    def input_images(self, include_mask: bool = True) -> list[str]:
        payload = self.request.get("payload") or {}
        images = payload.get("images") if isinstance(payload, dict) else []
        result: list[str] = []
        if isinstance(images, list):
            for item in images:
                if isinstance(item, str):
                    result.append(item)
                elif isinstance(item, dict) and item.get("image_url"):
                    result.append(str(item["image_url"]))
        mask = str(payload.get("mask") or "").strip() if isinstance(payload, dict) else ""
        if include_mask and mask:
            result.append(mask)
        return result

    def conversation_payload(
        self,
        prompt: str,
        model: str,
        uploads: list[dict[str, Any]],
        conduit_token: str,
        message_id: str,
        conversation_id: str = "",
        parent_message_id: str = "",
        variant_purpose: str = "",
    ) -> dict[str, Any]:
        parts = [
            {
                "content_type": "image_asset_pointer",
                "asset_pointer": f"file-service://{item['file_id']}",
                "width": item["width"],
                "height": item["height"],
                "size_bytes": item["file_size"],
            }
            for item in uploads
        ]
        parts.append(prompt)
        content = {"content_type": "multimodal_text", "parts": parts} if uploads else {"content_type": "text", "parts": [prompt]}
        metadata: dict[str, Any] = {
            "developer_mode_connector_ids": [],
            "selected_github_repos": [],
            "selected_all_github_repos": False,
            "system_hints": ["picture_v2"],
            "serialization_metadata": {"custom_symbol_offsets": []},
        }
        if uploads:
            metadata["attachments"] = [
                {
                    "id": item["file_id"],
                    "mimeType": item["mime_type"],
                    "name": item["file_name"],
                    "size": item["file_size"],
                    "width": item["width"],
                    "height": item["height"],
                }
                for item in uploads
            ]
        body: dict[str, Any] = {
            "action": "next",
            "messages": [
                {
                    "id": message_id,
                    "author": {"role": "user"},
                    "create_time": time.time(),
                    "content": content,
                    "metadata": metadata,
                }
            ],
            "parent_message_id": parent_message_id or str(uuid.uuid4()),
            "model": self.image_model_slug(model),
            "client_prepare_state": "sent",
            "timezone_offset_min": -480,
            "timezone": "Asia/Shanghai",
            "conversation_mode": {"kind": "primary_assistant"},
            "enable_message_followups": True,
            "system_hints": ["picture_v2"],
            "supports_buffering": True,
            "supported_encodings": ["v1"],
            "client_contextual_info": {
                "is_dark_mode": False,
                "time_since_loaded": 1200,
                "page_height": 1072,
                "page_width": 1724,
                "pixel_ratio": 1.2,
                "screen_height": 1440,
                "screen_width": 2560,
                "app_name": "chatgpt.com",
            },
            "paragen_cot_summary_display_override": "allow",
            "force_parallel_switch": "auto",
        }
        if conversation_id:
            body["conversation_id"] = conversation_id
        if variant_purpose:
            body["variant_purpose"] = variant_purpose
        return body

    def inpaint_conversation_payload(
        self,
        prompt: str,
        model: str,
        source: dict[str, str],
        mask_upload: dict[str, Any],
        message_id: str,
        conversation_id: str = "",
        parent_message_id: str = "",
        variant_purpose: str = "",
    ) -> dict[str, Any]:
        operation: dict[str, Any] = {
            "type": "inpainting",
            "original_file_id": source["original_file_id"],
            "mask_file_id": mask_upload["file_id"],
        }
        if source.get("original_gen_id"):
            operation["original_gen_id"] = source["original_gen_id"]
        if source.get("conversation_id"):
            operation["conversation_id"] = source["conversation_id"]
        if source.get("parent_message_id"):
            operation["parent_message_id"] = source["parent_message_id"]
        parent_message_id = parent_message_id or "client-created-root"
        body: dict[str, Any] = {
            "action": "next",
            "messages": [
                {
                    "id": message_id,
                    "author": {"role": "user"},
                    "create_time": time.time(),
                    "content": {"content_type": "text", "parts": [prompt]},
                    "metadata": {
                        "system_hints": ["picture_v2"],
                        "serialization_metadata": {"custom_symbol_offsets": []},
                        "dalle": {"from_client": {"operation": operation}},
                    },
                }
            ],
            "parent_message_id": parent_message_id,
            "model": self.image_model_slug(model),
            "client_prepare_state": "sent",
            "timezone_offset_min": -480,
            "timezone": "Asia/Shanghai",
            "conversation_mode": {"kind": "primary_assistant"},
            "enable_message_followups": True,
            "system_hints": ["picture_v2"],
            "supports_buffering": True,
            "supported_encodings": ["v1"],
            "client_contextual_info": {
                "is_dark_mode": False,
                "time_since_loaded": 1200,
                "page_height": 1072,
                "page_width": 1724,
                "pixel_ratio": 1.2,
                "screen_height": 1440,
                "screen_width": 2560,
                "app_name": "chatgpt.com",
            },
            "paragen_cot_summary_display_override": "allow",
            "force_parallel_switch": "auto",
        }
        if conversation_id:
            body["conversation_id"] = conversation_id
        if variant_purpose:
            body["variant_purpose"] = variant_purpose
        return body

    def source_reference_conversation_payload(
        self,
        prompt: str,
        model: str,
        source: dict[str, str],
        message_id: str,
        conversation_id: str = "",
        parent_message_id: str = "",
        variant_purpose: str = "",
    ) -> dict[str, Any]:
        operation: dict[str, Any] = {
            "type": "edit",
            "original_file_id": source["original_file_id"],
        }
        if source.get("original_gen_id"):
            operation["original_gen_id"] = source["original_gen_id"]
        if source.get("conversation_id"):
            operation["conversation_id"] = source["conversation_id"]
        if source.get("parent_message_id"):
            operation["parent_message_id"] = source["parent_message_id"]
        parent_message_id = parent_message_id or "client-created-root"
        body: dict[str, Any] = {
            "action": "next",
            "messages": [
                {
                    "id": message_id,
                    "author": {"role": "user"},
                    "create_time": time.time(),
                    "content": {"content_type": "text", "parts": [prompt]},
                    "metadata": {
                        "system_hints": ["picture_v2"],
                        "serialization_metadata": {"custom_symbol_offsets": []},
                        "dalle": {"from_client": {"operation": operation}},
                    },
                }
            ],
            "parent_message_id": parent_message_id,
            "model": self.image_model_slug(model),
            "client_prepare_state": "sent",
            "timezone_offset_min": -480,
            "timezone": "Asia/Shanghai",
            "conversation_mode": {"kind": "primary_assistant"},
            "enable_message_followups": True,
            "system_hints": ["picture_v2"],
            "supports_buffering": True,
            "supported_encodings": ["v1"],
            "client_contextual_info": {
                "is_dark_mode": False,
                "time_since_loaded": 1200,
                "page_height": 1072,
                "page_width": 1724,
                "pixel_ratio": 1.2,
                "screen_height": 1440,
                "screen_width": 2560,
                "app_name": "chatgpt.com",
            },
            "paragen_cot_summary_display_override": "allow",
            "force_parallel_switch": "auto",
        }
        if conversation_id:
            body["conversation_id"] = conversation_id
        if variant_purpose:
            body["variant_purpose"] = variant_purpose
        return body

    def read_conversation_response(self, response: requests.Response) -> tuple[str, list[str], list[str]]:
        state = ConversationState()
        file_ids: list[str] = []
        sediment_ids: list[str] = []
        payload_count = 0
        payload_samples: list[str] = []
        first_non_data_line = ""
        try:
            for raw_line in response.iter_lines():
                line = decode_response_line(raw_line).strip()
                if not line:
                    continue
                if not line.startswith("data:"):
                    if not first_non_data_line:
                        first_non_data_line = line[:300]
                    continue
                sse_payload = line[5:].strip()
                if not sse_payload or sse_payload == "[DONE]":
                    continue
                payload_count += 1
                if len(payload_samples) < 5 and sse_payload != '"v1"':
                    payload_samples.append(sse_payload[:300])
                next_conversation_id, raw_file_ids, raw_sediment_ids = extract_conversation_ids(sse_payload)
                if next_conversation_id and not state.conversation_id:
                    state.conversation_id = next_conversation_id
                try:
                    frame = json.loads(sse_payload)
                except json.JSONDecodeError:
                    update_conversation_state(state, sse_payload)
                    continue
                if not isinstance(frame, dict):
                    update_conversation_state(state, sse_payload)
                    continue
                update_conversation_state(state, sse_payload, frame)
                if not is_image_tool_event(frame):
                    continue
                next_files, next_sediments = collect_pointers(frame)
                add_unique(next_files, raw_file_ids)
                add_unique(next_sediments, raw_sediment_ids)
                add_unique(file_ids, next_files)
                add_unique(sediment_ids, next_sediments)
        finally:
            response.close()
        previous_debug = dict(self.last_conversation_debug)
        self.last_conversation_debug = {
            **{key: value for key, value in previous_debug.items() if key in ("route_mode",)},
            "payload_count": payload_count,
            "payload_samples": payload_samples,
            "first_non_data_line": first_non_data_line,
            "content_type": response.headers.get("content-type") or "",
            "assistant_text": state.text[:500],
            "blocked": state.blocked,
            "tool_invoked": state.tool_invoked,
            "turn_use_case": state.turn_use_case,
        }
        return state.conversation_id, file_ids, sediment_ids

    def start_conversation(
        self,
        prompt: str,
        requirements: Requirements,
        conduit_token: str,
        model: str,
        uploads: list[dict[str, Any]],
        conversation_id: str = "",
        parent_message_id: str = "",
        message_id: str = "",
        variant_purpose: str = "",
    ) -> tuple[str, list[str], list[str], str]:
        path = "/backend-api/f/conversation"
        message_id = message_id or str(uuid.uuid4())
        response = self.request_with_retry(
            "post",
            self.origin + path,
            headers=self.image_headers(path, requirements, conduit_token, "text/event-stream"),
            json=self.conversation_payload(
                prompt,
                model,
                uploads,
                conduit_token,
                message_id,
                conversation_id,
                parent_message_id,
                variant_purpose,
            ),
            timeout=300,
            stream=True,
        )
        ensure_ok(response, path)
        conversation_id, file_ids, sediment_ids = self.read_conversation_response(response)
        return conversation_id, file_ids, sediment_ids, message_id

    def start_inpaint_conversation(
        self,
        prompt: str,
        requirements: Requirements,
        model: str,
        source: dict[str, str],
        mask_upload: dict[str, Any],
        conversation_id: str = "",
        parent_message_id: str = "",
        message_id: str = "",
        variant_purpose: str = "",
    ) -> tuple[str, list[str], list[str], str]:
        path = "/backend-api/conversation"
        message_id = message_id or str(uuid.uuid4())
        response = self.request_with_retry(
            "post",
            self.origin + path,
            headers=self.image_headers(path, requirements, "", "text/event-stream"),
            json=self.inpaint_conversation_payload(
                prompt,
                model,
                source,
                mask_upload,
                message_id,
                conversation_id,
                parent_message_id,
                variant_purpose,
            ),
            timeout=300,
            stream=True,
        )
        ensure_ok(response, path)
        conversation_id, file_ids, sediment_ids = self.read_conversation_response(response)
        return conversation_id, file_ids, sediment_ids, message_id

    def start_source_reference_conversation(
        self,
        prompt: str,
        requirements: Requirements,
        model: str,
        source: dict[str, str],
        conversation_id: str = "",
        parent_message_id: str = "",
        message_id: str = "",
        variant_purpose: str = "",
    ) -> tuple[str, list[str], list[str], str]:
        path = "/backend-api/conversation"
        message_id = message_id or str(uuid.uuid4())
        response = self.request_with_retry(
            "post",
            self.origin + path,
            headers=self.image_headers(path, requirements, "", "text/event-stream"),
            json=self.source_reference_conversation_payload(
                prompt,
                model,
                source,
                message_id,
                conversation_id,
                parent_message_id,
                variant_purpose,
            ),
            timeout=300,
            stream=True,
        )
        ensure_ok(response, path)
        conversation_id, file_ids, sediment_ids = self.read_conversation_response(response)
        return conversation_id, file_ids, sediment_ids, message_id

    def get_conversation(self, conversation_id: str) -> dict[str, Any]:
        path = f"/backend-api/conversation/{conversation_id}"
        response = self.request_with_retry(
            "get",
            self.origin + path,
            headers=self.target_headers(path, {"Accept": "application/json"}),
            timeout=60,
        )
        ensure_ok(response, path)
        return response.json()

    def current_conversation_leaf_id(self, conversation_id: str, fallback_message_id: str = "") -> str:
        if not conversation_id:
            return fallback_message_id
        conversation = self.get_conversation(conversation_id)
        return conversation_current_leaf_message_id(conversation, fallback_message_id)

    def branch_parent_message_id(self, conversation_id: str, anchor_message_id: str) -> str:
        if not conversation_id or not anchor_message_id:
            return ""
        conversation = self.get_conversation(conversation_id)
        return conversation_branch_parent_message_id(conversation, anchor_message_id)

    def tail_parent_message_id(self, conversation_id: str, anchor_message_id: str) -> str:
        if not conversation_id or not anchor_message_id:
            return ""
        conversation = self.get_conversation(conversation_id)
        return conversation_tail_parent_message_id(conversation, anchor_message_id)

    def poll_pointers(self, conversation_id: str, exclude_file_ids: set[str], timeout_secs: float = 180.0) -> tuple[list[str], list[str]]:
        start = time.time()
        file_ids: list[str] = []
        sediment_ids: list[str] = []
        include_broad_sediment = len(exclude_file_ids) == 0
        while time.time() - start < timeout_secs:
            conversation = self.get_conversation(conversation_id)
            next_files, next_sediments = conversation_image_tool_pointers(conversation)
            if not next_files and not next_sediments:
                broad_files, broad_sediments = broad_conversation_image_pointers(
                    conversation,
                    exclude_file_ids,
                    include_broad_sediment,
                )
                self.last_conversation_debug.update({
                    "broad_file_ids": len(broad_files),
                    "broad_sediment_ids": len(broad_sediments),
                })
                next_files = broad_files
                next_sediments = broad_sediments
            mapped_state = conversation_state_from_mapping(conversation)
            self.last_conversation_debug.update({
                "poll_attempts": int(self.last_conversation_debug.get("poll_attempts") or 0) + 1,
                "assistant_text": mapped_state.text[:500] or self.last_conversation_debug.get("assistant_text", ""),
                "tool_invoked": mapped_state.tool_invoked if mapped_state.tool_invoked is not None else self.last_conversation_debug.get("tool_invoked"),
                "turn_use_case": mapped_state.turn_use_case or self.last_conversation_debug.get("turn_use_case", ""),
            })
            add_unique(file_ids, [file_id for file_id in next_files if file_id not in exclude_file_ids])
            add_unique(sediment_ids, next_sediments)
            if file_ids or sediment_ids:
                return file_ids, sediment_ids
            time.sleep(4)
        return file_ids, sediment_ids

    def poll_image_result_pointers(
        self,
        conversation_id: str,
        exclude_file_ids: set[str],
        root_message_id: str = "",
        timeout_secs: float = 180.0,
        min_create_time: float = 0.0,
    ) -> list[ImageResultPointer]:
        start = time.time()
        include_broad_sediment = len(exclude_file_ids) == 0
        while time.time() - start < timeout_secs:
            conversation = self.get_conversation(conversation_id)
            records = conversation_image_result_pointers(
                conversation,
                exclude_file_ids,
                include_broad_sediment,
                root_message_id,
                min_create_time,
            )
            if not records:
                records = broad_image_result_pointers_from_messages(
                    conversation,
                    exclude_file_ids,
                    include_broad_sediment,
                    min_create_time,
                )
            mapped_state = conversation_state_from_mapping(conversation)
            self.last_conversation_debug.update({
                "poll_attempts": int(self.last_conversation_debug.get("poll_attempts") or 0) + 1,
                "root_message_id": root_message_id,
                "min_create_time": min_create_time,
                "assistant_text": mapped_state.text[:500] or self.last_conversation_debug.get("assistant_text", ""),
                "tool_invoked": mapped_state.tool_invoked if mapped_state.tool_invoked is not None else self.last_conversation_debug.get("tool_invoked"),
                "turn_use_case": mapped_state.turn_use_case or self.last_conversation_debug.get("turn_use_case", ""),
                "broad_file_ids": len([item for item in records if item.file_id]),
                "broad_sediment_ids": len([item for item in records if item.sediment_id]),
            })
            if records:
                return records
            time.sleep(4)
        return []

    def download_url_for_file(self, file_id: str, conversation_id: str = "") -> str:
        path = f"/backend-api/files/{file_id}/download"
        first_error = ""
        try:
            response = self.request_with_retry(
                "get",
                self.origin + path,
                headers=self.target_headers(path, {"Accept": "application/json"}),
                timeout=60,
            )
            ensure_ok(response, path)
            data = response.json()
            url = download_url_from_json(data)
            if url:
                return url
        except Exception as error:
            first_error = str(error)
        if conversation_id:
            fallback_path = (
                f"/backend-api/files/download/{quote(file_id)}"
                f"?conversation_id={quote(conversation_id)}&inline=false"
            )
            response = self.request_with_retry(
                "get",
                self.origin + fallback_path,
                headers=self.target_headers(fallback_path, {"Accept": "application/json"}),
                timeout=60,
            )
            ensure_ok(response, fallback_path)
            data = response.json()
            url = download_url_from_json(data)
            if url:
                return url
        if first_error:
            raise BridgeError(first_error)
        return ""

    def download_url_for_attachment(self, conversation_id: str, attachment_id: str) -> str:
        path = f"/backend-api/conversation/{conversation_id}/attachment/{attachment_id}/download"
        first_error = ""
        try:
            response = self.request_with_retry(
                "get",
                self.origin + path,
                headers=self.target_headers(path, {"Accept": "application/json"}),
                timeout=60,
            )
            ensure_ok(response, path)
            data = response.json()
            url = download_url_from_json(data)
            if url:
                return url
        except Exception as error:
            first_error = str(error)
        try:
            url = self.download_url_for_file(attachment_id, conversation_id)
            if url:
                return url
        except Exception as error:
            if first_error:
                first_error = f"{first_error}; {error}"
            else:
                first_error = str(error)
        if first_error:
            self.last_conversation_debug["download_url_error"] = first_error[:300]
        return ""

    def download_data_url(self, url: str) -> str:
        response = self.request_with_retry("get", url, timeout=120)
        ensure_ok(response, "image_download")
        content_type = response.headers.get("content-type") or "image/png"
        return f"data:{content_type};base64,{base64.b64encode(response.content).decode()}"

    def image_items_from_records(
        self,
        conversation_id: str,
        records: list[ImageResultPointer],
        retry_download: bool = True,
        timeout_secs: float = 180.0,
    ) -> list[dict[str, Any]]:
        start = time.time()
        while True:
            items: list[dict[str, Any]] = []
            download_errors: list[str] = []
            empty_url_count = 0
            for record in records:
                try:
                    if record.file_id:
                        url = self.download_url_for_file(record.file_id, conversation_id)
                    elif conversation_id and record.sediment_id:
                        url = self.download_url_for_attachment(conversation_id, record.sediment_id)
                    else:
                        url = ""
                    if not url:
                        empty_url_count += 1
                        continue
                    items.append({
                        "b64_json": self.download_data_url(url),
                        "revised_prompt": record.revised_prompt,
                        "file_id": record.file_id or record.sediment_id,
                        "gen_id": record.gen_id,
                        "conversation_id": conversation_id,
                        "parent_message_id": record.message_id,
                    })
                except Exception as error:
                    download_errors.append(str(error)[:200])
            if items:
                return items
            if empty_url_count:
                self.last_conversation_debug["empty_download_urls"] = empty_url_count
            if download_errors:
                self.last_conversation_debug["download_errors"] = download_errors[:3]
            if not retry_download or time.time() - start >= timeout_secs:
                return []
            self.last_conversation_debug["download_poll_attempts"] = int(self.last_conversation_debug.get("download_poll_attempts") or 0) + 1
            self.last_conversation_debug["poll_attempts"] = int(self.last_conversation_debug.get("poll_attempts") or 0) + 1
            time.sleep(4)

    def wait_for_image_items(
        self,
        conversation_id: str,
        exclude_file_ids: set[str],
        root_message_id: str = "",
        fallback_root_message_id: str = "",
        min_create_time: float = 0.0,
        timeout_secs: float = 180.0,
    ) -> list[dict[str, Any]]:
        start = time.time()
        while time.time() - start < timeout_secs:
            conversation = self.get_conversation(conversation_id)
            records = conversation_image_result_pointers(conversation, exclude_file_ids, True, root_message_id)
            if not records and fallback_root_message_id and fallback_root_message_id != root_message_id:
                records = conversation_image_result_pointers(conversation, exclude_file_ids, True, fallback_root_message_id)
            if not records and min_create_time:
                records = conversation_image_result_pointers(conversation, exclude_file_ids, True, "", min_create_time)
            if not records:
                records = broad_image_result_pointers_from_messages(conversation, exclude_file_ids, True, min_create_time)
            mapped_state = conversation_state_from_mapping(conversation)
            self.last_conversation_debug.update({
                "poll_attempts": int(self.last_conversation_debug.get("poll_attempts") or 0) + 1,
                "root_message_id": root_message_id,
                "fallback_root_message_id": fallback_root_message_id,
                "min_create_time": min_create_time,
                "assistant_text": mapped_state.text[:500] or self.last_conversation_debug.get("assistant_text", ""),
                "tool_invoked": mapped_state.tool_invoked if mapped_state.tool_invoked is not None else self.last_conversation_debug.get("tool_invoked"),
                "turn_use_case": mapped_state.turn_use_case or self.last_conversation_debug.get("turn_use_case", ""),
                "broad_file_ids": len([item for item in records if item.file_id]),
                "broad_sediment_ids": len([item for item in records if item.sediment_id]),
            })
            if records:
                items = self.image_items_from_records(conversation_id, records, False)
                if items:
                    return items
            time.sleep(4)
        return []

    def resolve_image_items(
        self,
        conversation_id: str,
        file_ids: list[str],
        sediment_ids: list[str],
        exclude_file_ids: set[str],
        root_message_id: str = "",
        fallback_root_message_id: str = "",
        min_create_time: float = 0.0,
    ) -> list[dict[str, Any]]:
        file_ids = [file_id for file_id in file_ids if file_id not in exclude_file_ids]
        records: list[ImageResultPointer] = []
        if conversation_id:
            try:
                conversation = self.get_conversation(conversation_id)
                records = conversation_image_result_pointers(conversation, exclude_file_ids, True, root_message_id)
                if not records and fallback_root_message_id and fallback_root_message_id != root_message_id:
                    records = conversation_image_result_pointers(conversation, exclude_file_ids, True, fallback_root_message_id)
                if not records and min_create_time:
                    records = conversation_image_result_pointers(conversation, exclude_file_ids, True, "", min_create_time)
                if not records:
                    records = broad_image_result_pointers_from_messages(conversation, exclude_file_ids, True, min_create_time)
                self.last_conversation_debug.update({
                    "root_message_id": root_message_id,
                    "fallback_root_message_id": fallback_root_message_id,
                    "min_create_time": min_create_time,
                    "broad_file_ids": len([item for item in records if item.file_id]),
                    "broad_sediment_ids": len([item for item in records if item.sediment_id]),
                })
            except Exception as error:
                self.last_conversation_debug["conversation_fetch_error"] = str(error)[:300]
            if not records and not file_ids and not sediment_ids:
                records = self.poll_image_result_pointers(conversation_id, exclude_file_ids, root_message_id, min_create_time=min_create_time)
            if not records and fallback_root_message_id and fallback_root_message_id != root_message_id and not file_ids and not sediment_ids:
                records = self.poll_image_result_pointers(conversation_id, exclude_file_ids, fallback_root_message_id, min_create_time=min_create_time)
            if not records and min_create_time and not file_ids and not sediment_ids:
                records = self.poll_image_result_pointers(conversation_id, exclude_file_ids, "", min_create_time=min_create_time)
        if not records:
            records = [
                *[ImageResultPointer(file_id=file_id) for file_id in file_ids],
                *[ImageResultPointer(sediment_id=sediment_id) for sediment_id in sediment_ids],
            ]
        items = self.image_items_from_records(conversation_id, records)
        if not items and conversation_id and records:
            items = self.wait_for_image_items(
                conversation_id,
                exclude_file_ids,
                root_message_id,
                fallback_root_message_id,
                min_create_time,
            )
        return items

    def source_reference_placeholder_leaked(self, source: dict[str, str]) -> bool:
        combined = str(self.last_conversation_debug.get("assistant_text") or "")
        return "<<file_" in combined

    def run(self) -> dict[str, Any]:
        if not self.access_token:
            raise BridgeError("access_token is required")
        payload = self.request.get("payload") or {}
        prompt = self.prompt()
        true_inpaint = self.can_use_true_inpaint()
        web_context = self.web_conversation_context()
        if self.request.get("operation") == "edit" and payload.get("mask") and not true_inpaint:
            prompt = (
                prompt
                + "\n\nThe last attached image is an edit mask. Apply changes only inside the transparent/selected mask area and preserve the rest of the source image."
            )
        model = str(payload.get("model") or self.request.get("model") or "gpt-image-2")
        if true_inpaint:
            images = []
        elif self.request.get("operation") == "edit":
            images = self.input_images(include_mask=True)
        else:
            images = []
        uploads = [self.upload_image(image, f"image_{index}.png") for index, image in enumerate(images, start=1)]
        upload_file_ids = {str(item.get("file_id") or "") for item in uploads}
        self.bootstrap()
        requirements = self.chat_requirements()
        endpoint = self.origin + "/backend-api/f/conversation"
        submitted_message_id = ""
        image_items: list[dict[str, Any]] = []
        conversation_id = ""
        file_ids: list[str] = []
        sediment_ids: list[str] = []
        if true_inpaint:
            source = self.source_reference()
            mask_value = str(payload.get("mask") or "").strip() if isinstance(payload, dict) else ""
            mask_upload = self.upload_image(mask_value, "mask.png", "dalle_agent", True)
            upload_file_ids.add(str(mask_upload.get("file_id") or ""))
            upload_file_ids.add(source.get("original_file_id", ""))
            endpoint = self.origin + "/backend-api/conversation"
            placement = web_context.get("placement", "")
            source_conversation_id = source.get("conversation_id", "")
            source_parent_message_id = source.get("parent_message_id", "")
            candidate_conversation_id = web_context.get("conversation_id") or source_conversation_id
            candidate_parent_id = web_context.get("parent_message_id")
            if placement == "branch" and not candidate_parent_id:
                candidate_parent_id = source_parent_message_id
            elif placement == "source" and not candidate_parent_id:
                candidate_parent_id = source_parent_message_id
            elif placement not in ("branch", "source") and not candidate_parent_id and candidate_conversation_id:
                try:
                    candidate_parent_id = self.current_conversation_leaf_id(
                        candidate_conversation_id,
                        source_parent_message_id,
                    )
                except Exception as error:
                    self.last_conversation_debug["same_conversation_fetch_error"] = str(error)[:300]
            if source_conversation_id and source_parent_message_id:
                if (
                    (candidate_conversation_id and candidate_conversation_id != source_conversation_id)
                    or (candidate_parent_id and candidate_parent_id != source_parent_message_id)
                ):
                    self.last_conversation_debug["inpaint_requested_placement"] = (
                        placement if placement in ("branch", "tail", "source") else "same_conversation"
                    )
                    self.last_conversation_debug["inpaint_requested_conversation_id"] = candidate_conversation_id
                    self.last_conversation_debug["inpaint_requested_parent_message_id"] = candidate_parent_id
                    self.last_conversation_debug["inpaint_enforced_source_parent"] = True
                candidate_conversation_id = source_conversation_id
                candidate_parent_id = source_parent_message_id
                placement = "source"
            variant_purpose = "comparison_implicit" if placement == "branch" else ""
            if placement == "branch" and candidate_conversation_id and candidate_parent_id:
                branch_anchor_id = candidate_parent_id
                try:
                    branch_parent_id = self.branch_parent_message_id(candidate_conversation_id, branch_anchor_id)
                    if branch_parent_id:
                        candidate_parent_id = branch_parent_id
                        self.last_conversation_debug["branch_anchor_message_id"] = branch_anchor_id
                        self.last_conversation_debug["branch_parent_message_id"] = branch_parent_id
                    else:
                        candidate_conversation_id = ""
                        candidate_parent_id = ""
                        self.last_conversation_debug["branch_parent_missing"] = True
                except Exception as error:
                    candidate_conversation_id = ""
                    candidate_parent_id = ""
                    self.last_conversation_debug["branch_parent_fetch_error"] = str(error)[:300]
            elif placement not in ("source", "tail") and candidate_conversation_id and candidate_parent_id:
                tail_anchor_id = candidate_parent_id
                try:
                    tail_parent_id = self.tail_parent_message_id(candidate_conversation_id, tail_anchor_id)
                    if tail_parent_id:
                        candidate_parent_id = tail_parent_id
                        self.last_conversation_debug["tail_anchor_message_id"] = tail_anchor_id
                        self.last_conversation_debug["tail_parent_message_id"] = tail_parent_id
                except Exception as error:
                    self.last_conversation_debug["tail_parent_fetch_error"] = str(error)[:300]
            if candidate_parent_id:
                self.last_conversation_debug["conversation_parent_message_id"] = candidate_parent_id

            if candidate_conversation_id and candidate_parent_id:
                try:
                    submitted_message_id = str(uuid.uuid4())
                    conversation_id, file_ids, sediment_ids, submitted_message_id = self.start_inpaint_conversation(
                        prompt,
                        requirements,
                        model,
                        source,
                        mask_upload,
                        candidate_conversation_id,
                        candidate_parent_id,
                        submitted_message_id,
                        variant_purpose,
                    )
                    self.last_conversation_debug["inpaint_placement"] = (
                        placement if placement in ("branch", "tail", "source") else "same_conversation"
                    )
                    image_items = self.resolve_image_items(conversation_id, file_ids, sediment_ids, upload_file_ids, submitted_message_id)
                except BridgeError as conversation_error:
                    self.last_conversation_debug["conversation_inpaint_error"] = str(conversation_error)[:300]
                if not image_items:
                    self.last_conversation_debug["conversation_inpaint_empty"] = True

            if not image_items:
                submitted_message_id = str(uuid.uuid4())
                conversation_id, file_ids, sediment_ids, submitted_message_id = self.start_inpaint_conversation(
                    prompt,
                    requirements,
                    model,
                    source,
                    mask_upload,
                    "",
                    "",
                    submitted_message_id,
                )
                self.last_conversation_debug["inpaint_placement"] = "isolated"
                image_items = self.resolve_image_items(conversation_id, file_ids, sediment_ids, upload_file_ids, submitted_message_id)
        if not image_items and not true_inpaint:
            endpoint = self.origin + "/backend-api/f/conversation"
            source = self.source_reference()
            placement = web_context.get("placement", "")
            conversation_id_hint = web_context.get("conversation_id", "")
            parent_message_id_hint = web_context.get("parent_message_id", "")
            if placement == "branch" and not parent_message_id_hint:
                conversation_id_hint = conversation_id_hint or source.get("conversation_id", "")
                parent_message_id_hint = source.get("parent_message_id", "")
            elif placement == "source" and not parent_message_id_hint:
                conversation_id_hint = conversation_id_hint or source.get("conversation_id", "")
                parent_message_id_hint = source.get("parent_message_id", "")
            elif placement != "source" and not parent_message_id_hint and source.get("conversation_id"):
                conversation_id_hint = conversation_id_hint or source.get("conversation_id", "")
                try:
                    parent_message_id_hint = self.current_conversation_leaf_id(
                        conversation_id_hint,
                        source.get("parent_message_id", ""),
                    )
                except Exception as error:
                    self.last_conversation_debug["conversation_tail_fetch_error"] = str(error)[:300]
            variant_purpose = "comparison_implicit" if placement == "branch" else ""
            if placement == "branch" and conversation_id_hint and parent_message_id_hint:
                branch_anchor_id = parent_message_id_hint
                try:
                    branch_parent_id = self.branch_parent_message_id(conversation_id_hint, branch_anchor_id)
                    if branch_parent_id:
                        parent_message_id_hint = branch_parent_id
                        self.last_conversation_debug["branch_anchor_message_id"] = branch_anchor_id
                        self.last_conversation_debug["branch_parent_message_id"] = branch_parent_id
                    else:
                        conversation_id_hint = ""
                        parent_message_id_hint = ""
                        self.last_conversation_debug["branch_parent_missing"] = True
                except Exception as error:
                    conversation_id_hint = ""
                    parent_message_id_hint = ""
                    self.last_conversation_debug["branch_parent_fetch_error"] = str(error)[:300]
            elif placement not in ("source", "tail") and conversation_id_hint and parent_message_id_hint:
                tail_anchor_id = parent_message_id_hint
                try:
                    tail_parent_id = self.tail_parent_message_id(conversation_id_hint, tail_anchor_id)
                    if tail_parent_id:
                        parent_message_id_hint = tail_parent_id
                        self.last_conversation_debug["tail_anchor_message_id"] = tail_anchor_id
                        self.last_conversation_debug["tail_parent_message_id"] = tail_parent_id
                except Exception as error:
                    self.last_conversation_debug["tail_parent_fetch_error"] = str(error)[:300]
            if conversation_id_hint and parent_message_id_hint:
                self.last_conversation_debug["conversation_placement"] = (
                    placement if placement in ("branch", "tail", "source") else "same_conversation"
                )
                self.last_conversation_debug["conversation_parent_message_id"] = parent_message_id_hint
            source_reference_error = ""
            use_source_reference_edit = self.can_use_source_reference_edit()
            if use_source_reference_edit:
                source_context_conversation_id = source.get("conversation_id", "")
                source_context_parent_message_id = source.get("parent_message_id", "")
                if source_context_conversation_id and source_context_parent_message_id:
                    if (
                        (conversation_id_hint and conversation_id_hint != source_context_conversation_id)
                        or (parent_message_id_hint and parent_message_id_hint != source_context_parent_message_id)
                    ):
                        self.last_conversation_debug["source_reference_requested_placement"] = (
                            placement if placement in ("branch", "tail", "source") else "same_conversation"
                        )
                        self.last_conversation_debug["source_reference_requested_conversation_id"] = conversation_id_hint
                        self.last_conversation_debug["source_reference_requested_parent_message_id"] = parent_message_id_hint
                        self.last_conversation_debug["source_reference_enforced_source_parent"] = True
                    source_conversation_id = source_context_conversation_id
                    source_parent_message_id = source_context_parent_message_id
                    source_variant_purpose = ""
                    source_placement = "source"
                else:
                    if not conversation_id_hint:
                        conversation_id_hint = source_context_conversation_id
                    if not parent_message_id_hint:
                        parent_message_id_hint = source_context_parent_message_id
                    source_conversation_id = conversation_id_hint if conversation_id_hint and parent_message_id_hint else ""
                    source_parent_message_id = parent_message_id_hint if source_conversation_id else ""
                    source_variant_purpose = variant_purpose if source_conversation_id else ""
                    source_placement = placement if source_conversation_id and placement in ("branch", "tail", "source") else (
                        "same_conversation" if source_conversation_id else "isolated"
                    )
                try:
                    endpoint = self.origin + "/backend-api/conversation"
                    request_started_at = time.time() - 2
                    submitted_message_id = str(uuid.uuid4())
                    upload_file_ids.add(source.get("original_file_id", ""))
                    self.last_conversation_debug["route_mode"] = f"chatgpt_web_official_source_reference_edit_{source_placement}"
                    conversation_id, file_ids, sediment_ids, submitted_message_id = self.start_source_reference_conversation(
                        prompt,
                        requirements,
                        model,
                        source,
                        source_conversation_id,
                        source_parent_message_id,
                        submitted_message_id,
                        source_variant_purpose,
                    )
                    conversation_id = conversation_id or source_conversation_id
                    self.last_conversation_debug["source_reference_edit_placement"] = source_placement
                    self.last_conversation_debug["conversation_parent_message_id"] = source_parent_message_id
                    image_items = self.resolve_image_items(
                        conversation_id,
                        file_ids,
                        sediment_ids,
                        upload_file_ids,
                        submitted_message_id,
                        source_parent_message_id,
                        request_started_at,
                    )
                    if image_items and self.source_reference_placeholder_leaked(source):
                        self.last_conversation_debug["source_reference_placeholder_leaked"] = True
                        image_items = []
                except BridgeError as reference_error:
                    source_reference_error = str(reference_error)
                    self.last_conversation_debug["source_reference_edit_error"] = source_reference_error[:300]
                if not image_items:
                    self.last_conversation_debug["source_reference_edit_empty"] = True
                    detail = (
                        "ChatGPT 官网引用编辑已提交，但本地未解析到生成图片"
                        f" (conversation_id={conversation_id or conversation_id_hint or 'missing'}, "
                        f"submitted_message_id={submitted_message_id or 'missing'}, "
                        f"parent_message_id={source_parent_message_id or parent_message_id_hint or 'missing'}, "
                        f"poll_attempts={self.last_conversation_debug.get('poll_attempts', 0)}, "
                        f"download_poll_attempts={self.last_conversation_debug.get('download_poll_attempts', 0)}, "
                        f"broad_file_ids={self.last_conversation_debug.get('broad_file_ids', 0)}, "
                        f"broad_sediment_ids={self.last_conversation_debug.get('broad_sediment_ids', 0)}, "
                        f"empty_download_urls={self.last_conversation_debug.get('empty_download_urls', 0)}, "
                        f"placeholder_leaked={bool(self.last_conversation_debug.get('source_reference_placeholder_leaked'))}"
                        f"{'; ' + source_reference_error if source_reference_error else ''})"
                    )
                    raise BridgeError(detail, status_code=200, endpoint=endpoint)
            if not image_items:
                submitted_message_id = str(uuid.uuid4())
                self.last_conversation_debug["route_mode"] = (
                    f"chatgpt_web_official_{self.request.get('operation')}_conversation_"
                    f"{self.last_conversation_debug.get('conversation_placement') or 'isolated'}"
                )
                conduit_token = self.prepare_conversation(
                    prompt,
                    requirements,
                    model,
                    conversation_id_hint,
                    parent_message_id_hint,
                    submitted_message_id,
                    variant_purpose,
                )
                conversation_id, file_ids, sediment_ids, submitted_message_id = self.start_conversation(
                    prompt,
                    requirements,
                    conduit_token,
                    model,
                    uploads,
                    conversation_id_hint,
                    parent_message_id_hint,
                    submitted_message_id,
                    variant_purpose,
                )
                image_items = self.resolve_image_items(conversation_id, file_ids, sediment_ids, upload_file_ids, submitted_message_id)
        if not image_items:
            debug = self.last_conversation_debug
            assistant_message = str(debug.get("assistant_text") or "").strip()
            if assistant_message and (debug.get("blocked") or debug.get("tool_invoked") is False):
                raise BridgeError(
                    f"ChatGPT 官网会话返回文本而非图片：{assistant_message[:500]}",
                    status_code=200,
                    endpoint=endpoint,
                )
            samples = debug.get("payload_samples")
            sample_text = " | ".join(str(item) for item in samples[:3]) if isinstance(samples, list) else ""
            detail = (
                f"conversation returned no image data "
                f"(conversation_id={conversation_id or 'missing'}, file_ids={len(file_ids)}, "
                f"sediment_ids={len(sediment_ids)}, payloads={debug.get('payload_count', 0)}, "
                f"poll_attempts={debug.get('poll_attempts', 0)}, "
                f"download_poll_attempts={debug.get('download_poll_attempts', 0)}, "
                f"broad_file_ids={debug.get('broad_file_ids', 0)}, broad_sediment_ids={debug.get('broad_sediment_ids', 0)}, "
                f"empty_download_urls={debug.get('empty_download_urls', 0)}, "
                f"tool_invoked={debug.get('tool_invoked')}, turn_use_case={debug.get('turn_use_case') or ''}, "
                f"content_type={debug.get('content_type') or 'unknown'}, "
                f"sample={sample_text or debug.get('first_non_data_line') or 'empty'})"
            )
            raise BridgeError(detail, status_code=200, endpoint=endpoint)
        return {
            "ok": True,
            "endpoint": endpoint,
            "route_mode": (
                f"chatgpt_web_official_inpaint_{self.last_conversation_debug.get('inpaint_placement')}"
                if true_inpaint and self.last_conversation_debug.get("inpaint_placement")
                else (
                    f"chatgpt_web_official_source_reference_edit_{self.last_conversation_debug.get('source_reference_edit_placement')}"
                    if self.last_conversation_debug.get("source_reference_edit_placement")
                    else (
                        f"chatgpt_web_official_{self.request.get('operation')}_conversation_{self.last_conversation_debug.get('conversation_placement')}"
                        if self.last_conversation_debug.get("conversation_placement")
                        else str(self.last_conversation_debug.get("route_mode") or "")
                    )
                )
            ),
            "status_code": 200,
            "data": [
                {
                    **item,
                    "revised_prompt": item.get("revised_prompt") or prompt,
                }
                for item in image_items
            ],
        }


def main() -> int:
    bridge: ChatGptWebBridge | None = None
    try:
        raw = sys.stdin.read()
        request = json.loads(raw)
        bridge = ChatGptWebBridge(request)
        result = bridge.run()
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        status_code = error.status_code if isinstance(error, BridgeError) else None
        endpoint = error.endpoint if isinstance(error, BridgeError) else ""
        route_mode = ""
        if bridge is not None:
            route_mode = str(bridge.last_conversation_debug.get("route_mode") or "")
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(error),
                    "status_code": status_code,
                    "endpoint": endpoint,
                    "route_mode": route_mode,
                },
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
