import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../../i18n";
import { ToastProvider } from "../../ui";
import { ChatMessage, ChatMessageThread } from "./ChatMessages";
import { visibleAssistantImages } from "./ConversationView";
import type { ChatRenderItem, MessageRevision } from "../../lib/chatRender";
import type { Message } from "../../types";

const message: Message = {
  id: "message-a", role: "assistant", content: "fixture", imageId: "a", imageUrl: "/fixture.png", imagePrompt: "fixture",
  imageKind: "generation", imageSize: "1024x1024", imageQuality: "auto", imageProviderId: "", parentImageId: null,
  metadata: {}, createdAt: "2026-09-28T00:00:00Z"
};
function render(mode: "workspace" | "shared-readonly", grouped = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["zh-CN"], language: "zh-CN" } });
  try {
    return renderToString(<QueryClientProvider client={new QueryClient()}><MemoryRouter><I18nProvider><ToastProvider>
      {grouped ? <ChatMessageThread rootId="user" mode={mode} sharedToken={mode === "shared-readonly" ? "test-token" : undefined} capabilities={{ compareImage: true }} versions={[{
        user: { ...message, id: "user", role: "user", imageId: null, imageUrl: null, metadata: { imageCount: 3 } },
        assistants: [1, 2, 3].map((index) => ({ ...message, id: `msg-${index}`, imageId: `img-${index}`, metadata: { imageIndex: index, imageTotal: 3 } })),
        assistant: message, rootId: "user", branchId: "main", parentBranchId: "", branchForkMessageId: "", branchRootMessageId: "", order: 0
      }]} /> : <ChatMessage message={message} mode={mode} sharedToken={mode === "shared-readonly" ? "test-token" : undefined} capabilities={{ compareImage: true }} />}
    </ToastProvider></I18nProvider></MemoryRouter></QueryClientProvider>);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}
describe("chat comparison entry boundary", () => {
  test("conversation candidates include only completed results from displayed revisions", () => {
    const revision = (id: string): MessageRevision => ({
      user: { ...message, id: `user-${id}`, role: "user", imageId: "reference-image", metadata: { sourceImageIds: ["reference-image"] } },
      assistant: null, assistants: [
        { ...message, id: `${id}-second`, imageId: `${id}-2`, metadata: { imageIndex: 2 } },
        { ...message, id: `${id}-first`, imageId: `${id}-1`, metadata: { imageIndex: 1 } },
        { ...message, id: `${id}-pending`, imageId: "pending", imageUrl: null }
      ], rootId: id, branchId: "main", parentBranchId: "", branchForkMessageId: "", branchRootMessageId: "", order: 0
    });
    const items: ChatRenderItem[] = [
      { type: "message", branchId: "main", message: { ...message, role: "user", imageId: "reference-image" } },
      { type: "message", branchId: "main", message },
      { type: "thread", branchId: "main", rootId: "turn", versions: [revision("shown"), revision("hidden")], activeVersionIndex: 0 }
    ];
    expect(visibleAssistantImages(items).map((item) => item.imageId)).toEqual(["a", "shown-1", "shown-2"]);
  });
  test("private image action appears after copy", () => {
    const html = render("workspace");
    const copy = html.indexOf('aria-label="复制图片"');
    const compare = html.indexOf('aria-label="选图对比"');
    expect(copy).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(copy);
  });
  test("shared images cannot gain the comparison action via capability overrides", () => {
    const html = render("shared-readonly");
    expect(html).not.toContain('aria-label="选图对比"');
    expect(html).not.toContain('aria-label="复制图片"');
  });
  test("group results expose one comparison entry, also disabled on shared pages", () => {
    const html = render("workspace", true);
    expect(html).toContain("assistant-image-group-toolbar");
    expect(html.match(/aria-label="选图对比"/g)?.length).toBe(1);
    expect(html.indexOf('aria-label="选图对比"')).toBeGreaterThan(html.indexOf('aria-label="复制图片"'));
    expect(render("shared-readonly", true)).not.toContain('aria-label="选图对比"');
  });
});
