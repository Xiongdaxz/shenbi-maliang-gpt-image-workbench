import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from chatgpt_web_bridge import ChatGptWebBridge, Requirements, ensure_mask_scope_prompt


class SuccessfulResponse:
    status_code = 200
    text = ""
    reason = "OK"


def bare_bridge(request=None):
    bridge = ChatGptWebBridge.__new__(ChatGptWebBridge)
    bridge.request = request or {}
    return bridge


class ChatGptWebBridgePayloadTests(unittest.TestCase):
    def test_direct_website_headers_omit_proxy_routing_metadata(self):
        bridge = bare_bridge()
        bridge.origin = "https://chatgpt.com"
        bridge.session = SimpleNamespace(headers={"Authorization": "Bearer token"})

        direct_headers = bridge.target_headers("/backend-api/f/conversation/prepare")

        self.assertNotIn("X-OpenAI-Target-Path", direct_headers)
        self.assertNotIn("X-OpenAI-Target-Route", direct_headers)

        bridge.origin = "https://chatgpt-proxy.example.com"
        proxy_headers = bridge.target_headers("/backend-api/f/conversation/prepare")
        self.assertEqual(proxy_headers["X-OpenAI-Target-Path"], "/backend-api/f/conversation/prepare")
        self.assertEqual(proxy_headers["X-OpenAI-Target-Route"], "/backend-api/f/conversation/prepare")

    def test_annotation_prompt_is_not_decorated(self):
        bridge = bare_bridge(
            {
                "payload": {
                    "prompt": "1. (x: 70.0%, y: 30.1%) 把这里稍微调亮",
                    "editIntent": "annotation",
                    "quality": "high",
                }
            }
        )

        self.assertEqual(
            bridge.prompt(),
            "1. (x: 70.0%, y: 30.1%) 把这里稍微调亮",
        )

    def test_remove_prompt_preserves_mask_scope_constraints(self):
        prompt = "移除选定区域\n\n严格只在遮罩选区内修改；未选区域保持原图不变。"
        bridge = bare_bridge(
            {
                "payload": {
                    "prompt": prompt,
                    "editIntent": "remove",
                }
            }
        )

        self.assertEqual(bridge.prompt(), prompt)

    def test_remove_prompt_falls_back_when_missing(self):
        bridge = bare_bridge({"payload": {"prompt": "", "editIntent": "remove"}})

        self.assertEqual(bridge.prompt(), "移除选定区域")

    def test_mask_scope_fallback_is_added_only_when_missing(self):
        fallback = ensure_mask_scope_prompt("移除选定区域")
        self.assertIn("preserve every unselected part of the source image unchanged", fallback)
        self.assertEqual(ensure_mask_scope_prompt(fallback), fallback)

        scoped = "移除选定区域\n\n未选区域保持原图不变。"
        self.assertEqual(ensure_mask_scope_prompt(scoped), scoped)

    def test_attachment_mask_is_identified_in_the_prompt_used_by_run(self):
        bridge = bare_bridge(
            {
                "operation": "edit",
                "payload": {
                    "prompt": "移除选定区域\n\n严格只在遮罩选区内修改；未选区域保持原图不变。",
                    "editIntent": "remove",
                    "images": [{"image_url": "source-image"}],
                    "mask": "mask-image",
                },
            }
        )

        prompt, images = bridge.request_prompt_and_images(False)

        self.assertEqual(images, ["source-image", "mask-image"])
        self.assertIn("final attached image is the edit mask", prompt.lower())
        self.assertEqual(ensure_mask_scope_prompt(prompt, mask_is_attachment=True), prompt)

    def test_true_inpaint_does_not_describe_the_mask_as_an_attachment(self):
        bridge = bare_bridge(
            {
                "operation": "edit",
                "payload": {
                    "prompt": "移除选定区域",
                    "editIntent": "remove",
                    "images": [{"image_url": "source-image"}],
                    "mask": "mask-image",
                },
            }
        )

        prompt, images = bridge.request_prompt_and_images(True)

        self.assertEqual(images, [])
        self.assertNotIn("final attached image is the edit mask", prompt.lower())
        self.assertIn("preserve every unselected part", prompt.lower())

    def test_prepare_payload_matches_current_web_protocol(self):
        bridge = bare_bridge()
        bridge.origin = "https://chatgpt.com"
        bridge.image_headers = Mock(return_value={"Content-Type": "application/json"})
        bridge.standard_request_with_retry = Mock(return_value=SuccessfulResponse())
        requirements = Requirements(token="requirements-token")

        prepared_parent_message_id = bridge.prepare_conversation(
            requirements,
            "gpt-image-2",
            "conversation-id",
            "parent-message-id",
        )

        request_call = bridge.standard_request_with_retry.call_args
        self.assertEqual(request_call.args[:2], ("post", "https://chatgpt.com/backend-api/f/conversation/prepare"))
        body = json.loads(request_call.kwargs["data"])
        self.assertEqual(body["client_prepare_state"], "none")
        self.assertEqual(body["client_prepare_dispatch"], "debounced")
        self.assertEqual(body["client_prepare_source"], "composer_editor_state")
        self.assertEqual(body["model"], "gpt-5-6-thinking")
        self.assertEqual(body["thinking_effort"], "max")
        self.assertEqual(body["local_function_names"], ["local.continue_in_work"])
        self.assertNotIn("partial_query", body)
        self.assertNotIn("fork_from_shared_post", body)
        self.assertEqual(prepared_parent_message_id, "parent-message-id")

    def test_source_reference_uses_transformation_on_f_conversation(self):
        bridge = bare_bridge()
        bridge.origin = "https://chatgpt.com"
        bridge.prepare_conversation = Mock(return_value="source-parent-id")
        bridge.image_headers = Mock(return_value={"Accept": "text/event-stream"})
        bridge.standard_request_with_retry = Mock(return_value=SuccessfulResponse())
        bridge.read_conversation_response = Mock(return_value=("conversation-id", ["file-id"], []))
        requirements = Requirements(token="requirements-token")
        source = {
            "original_file_id": "original-file-id",
            "original_gen_id": "original-gen-id",
            "conversation_id": "source-conversation-id",
            "parent_message_id": "source-parent-id",
        }

        result = bridge.start_source_reference_conversation(
            "1. (x: 70.0%, y: 30.1%) 把这里稍微调亮",
            requirements,
            "gpt-image-2",
            source,
            "source-conversation-id",
            "source-parent-id",
            "message-id",
        )

        bridge.prepare_conversation.assert_called_once_with(
            requirements,
            "gpt-image-2",
            "source-conversation-id",
            "source-parent-id",
            "",
        )
        request_call = bridge.standard_request_with_retry.call_args
        self.assertEqual(request_call.args[:2], ("post", "https://chatgpt.com/backend-api/f/conversation"))
        request_body = json.loads(request_call.kwargs["data"])
        operation = request_body["messages"][0]["metadata"]["dalle"]["from_client"]["operation"]
        self.assertEqual(
            operation,
            {
                "type": "transformation",
                "original_file_id": "original-file-id",
                "original_gen_id": "original-gen-id",
            },
        )
        self.assertEqual(result, ("conversation-id", ["file-id"], [], "message-id"))


if __name__ == "__main__":
    unittest.main()
