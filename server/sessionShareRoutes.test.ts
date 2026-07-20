import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { buildChatRenderState } from "../src/lib/chatRender";
import type { Message } from "../src/types";
import {
  createSessionShareToken,
  normalizeSessionSharePublicToken,
  resolveSessionSharePublicOrigin,
  resolveSessionShareClientAddress,
  safeSharedMessageMetadata,
  sessionShareMutationOriginAllowed,
  sessionShareSnapshotMatches,
  sessionShareIdFromToken,
  sessionShareTokenForLink,
  sessionShareTokenLookup,
  sharedAssistantReferencesHidden,
  sharedImageViewUrls,
  sharedInlineImageVariantAllowed,
  sharedMessageHidesReferences,
  withinShareLookupRateLimit
} from "./sessionShareRoutes";

describe("session share token", () => {
  const secret = "test-session-share-secret";

  test("uses a UUID-shaped public token for new short links", () => {
    const publicToken = "6a59ab65-3c2c-83ee-a47b-fcfdd050b9ca";
    expect(normalizeSessionSharePublicToken(publicToken.toUpperCase())).toBe(publicToken);
    expect(sessionShareTokenForLink("share_example", publicToken, secret)).toBe(publicToken);
    expect(sessionShareTokenLookup(publicToken, secret)).toEqual({ publicToken, shareId: null });
    expect(sessionShareTokenLookup("not-a-share-token", secret)).toBeNull();
  });

  test("round trips a scoped v1 token", () => {
    const token = createSessionShareToken("share_example", secret);
    expect(token.startsWith("v1.")).toBe(true);
    expect(sessionShareIdFromToken(token, secret)).toBe("share_example");
    expect(sessionShareTokenForLink("share_example", "", secret)).toBe(token);
    expect(sessionShareTokenLookup(token, secret)).toEqual({ publicToken: null, shareId: "share_example" });
  });

  test("rejects a different secret or a tampered payload", () => {
    const token = createSessionShareToken("share_example", secret);
    const parts = token.split(".");
    const changedId = Buffer.from("share_other", "utf8").toString("base64url");
    expect(sessionShareIdFromToken(token, "other-secret")).toBeNull();
    expect(sessionShareIdFromToken(`${parts[0]}.${changedId}.${parts[2]}`, secret)).toBeNull();
  });

  test("rejects malformed and unsupported tokens", () => {
    const token = createSessionShareToken("share_example", secret);
    expect(sessionShareIdFromToken("", secret)).toBeNull();
    expect(sessionShareIdFromToken("v2.a.b", secret)).toBeNull();
    expect(sessionShareIdFromToken("v1.a", secret)).toBeNull();
    expect(sessionShareIdFromToken(`${token}!`, secret)).toBeNull();
  });
});

describe("session share snapshot reuse", () => {
  test("reuses only an identical ordered message snapshot", () => {
    expect(sessionShareSnapshotMatches(["message_1", "message_2"], ["message_1", "message_2"])).toBe(true);
    expect(sessionShareSnapshotMatches(["message_2", "message_1"], ["message_1", "message_2"])).toBe(false);
    expect(sessionShareSnapshotMatches(["message_1"], ["message_1", "message_2"])).toBe(false);
    expect(sessionShareSnapshotMatches(["message_1", "message_2", "message_3"], ["message_1", "message_2"])).toBe(false);
  });
});

describe("session share public origin", () => {
  test("replaces loopback hosts with the selected LAN address", () => {
    expect(resolveSessionSharePublicOrigin("http://127.0.0.1:8787", "192.168.0.87")).toBe("http://192.168.0.87:8787");
    expect(resolveSessionSharePublicOrigin("http://localhost:8787", "192.168.0.87")).toBe("http://192.168.0.87:8787");
    expect(resolveSessionSharePublicOrigin("http://[::1]:8787", "192.168.0.87")).toBe("http://192.168.0.87:8787");
  });

  test("preserves configured network hosts and falls back safely without a LAN address", () => {
    expect(resolveSessionSharePublicOrigin("https://image.example.com", "192.168.0.87")).toBe("https://image.example.com");
    expect(resolveSessionSharePublicOrigin("http://10.0.0.8:8787", "192.168.0.87")).toBe("http://10.0.0.8:8787");
    expect(resolveSessionSharePublicOrigin("http://127.0.0.1:8787", "")).toBe("http://127.0.0.1:8787");
    expect(resolveSessionSharePublicOrigin("not-a-url", "192.168.0.87")).toBe("");
  });
});

describe("session share mutation origin", () => {
  test("accepts browser-confirmed same-origin requests behind an HTTPS reverse proxy", () => {
    expect(
      sessionShareMutationOriginAllowed({
        secFetchSite: "same-origin",
        origin: "https://image.example.com",
        requestUrl: "http://127.0.0.1:8787/api/sessions/session_1/share-links"
      })
    ).toBe(true);
  });

  test("rejects cross-site requests and keeps the origin fallback for other clients", () => {
    expect(
      sessionShareMutationOriginAllowed({
        secFetchSite: "cross-site",
        origin: "http://127.0.0.1:8787",
        requestUrl: "http://127.0.0.1:8787/api/sessions/session_1/share-links"
      })
    ).toBe(false);
    expect(
      sessionShareMutationOriginAllowed({
        secFetchSite: "same-site",
        origin: "https://image.example.com",
        requestUrl: "http://127.0.0.1:8787/api/sessions/session_1/share-links",
        configuredOrigin: "https://image.example.com"
      })
    ).toBe(true);
    expect(
      sessionShareMutationOriginAllowed({
        origin: "https://attacker.example",
        requestUrl: "http://127.0.0.1:8787/api/sessions/session_1/share-links",
        configuredOrigin: "https://image.example.com"
      })
    ).toBe(false);
  });
});

describe("session share lookup rate limit", () => {
  test("limits public token lookups before share resolution", () => {
    const context = {
      req: { header: () => "session-share-rate-limit-test-client" }
    } as unknown as Context;
    let allowed = 0;
    for (let index = 0; index < 600; index += 1) {
      if (withinShareLookupRateLimit(context)) allowed += 1;
    }
    expect(allowed).toBe(600);
    expect(withinShareLookupRateLimit(context)).toBe(false);
  });
});

describe("shared message projection", () => {
  test("flattens branch and revision metadata into the main sequence", () => {
    const rawMetadata = {
      mode: "edit",
      jobId: "job_private",
      branchId: "branch_private",
      parentBranchId: "main",
      branchForkMessageId: "msg_private_root",
      branchRootMessageId: "msg_private_root",
      revisionRootId: "msg_private_root",
      editedMessageId: "msg_private_old"
    };
    const metadata = safeSharedMessageMetadata(rawMetadata, "shared-job-1");
    expect(metadata).toEqual({ mode: "edit", jobId: "shared-job-1" });

    const baseMessage = {
      content: "",
      imageId: null,
      imageUrl: null,
      imagePrompt: null,
      imageKind: null,
      imageSize: null,
      imageQuality: null,
      imageProviderId: null,
      parentImageId: null,
      createdAt: "2026-07-17T00:00:00.000Z"
    };
    const messages = [
      { ...baseMessage, id: "shared-message-1", role: "user", metadata },
      { ...baseMessage, id: "shared-message-2", role: "assistant", metadata }
    ] as Message[];
    expect(buildChatRenderState(messages).visibleMessages.map((message) => message.id)).toEqual([
      "shared-message-1",
      "shared-message-2"
    ]);
  });

  test("treats only boolean hideReference as an authorization flag", () => {
    expect(sharedMessageHidesReferences({ hideReference: true })).toBe(true);
    expect(sharedMessageHidesReferences(JSON.stringify({ hideReference: true }))).toBe(true);
    expect(sharedMessageHidesReferences({ hideReference: "true" })).toBe(false);
    expect(safeSharedMessageMetadata({ mode: "edit", hideReference: true })).toEqual({
      mode: "edit",
      hideReference: true
    });
  });

  test("applies a hidden source job to assistant image references", () => {
    const hiddenJobs = new Set(["job_hidden"]);
    expect(sharedAssistantReferencesHidden({ jobId: "job_hidden" }, hiddenJobs)).toBe(true);
    expect(sharedAssistantReferencesHidden({}, hiddenJobs, "job_hidden")).toBe(true);
    expect(sharedAssistantReferencesHidden({ jobId: "job_visible" }, hiddenJobs)).toBe(false);
    expect(sharedAssistantReferencesHidden({}, hiddenJobs)).toBe(false);
  });

  test("exposes only derivatives through the generic image view URL", () => {
    const urls = sharedImageViewUrls("token", 0);
    expect(urls.imageUrl.endsWith("?variant=preview")).toBe(true);
    expect(urls.imageOriginalUrl.endsWith("?variant=preview")).toBe(true);
    expect(urls.imagePreviewUrl.endsWith("?variant=preview")).toBe(true);
    expect(urls.imageThumbnailUrl.endsWith("?variant=thumb")).toBe(true);
    expect(sharedInlineImageVariantAllowed("thumb")).toBe(true);
    expect(sharedInlineImageVariantAllowed("preview")).toBe(true);
    expect(sharedInlineImageVariantAllowed("original")).toBe(false);
  });

  test("uses the socket address unless proxy trust is explicitly enabled", () => {
    expect(
      resolveSessionShareClientAddress({
        socketAddress: "192.0.2.10",
        trustProxy: false,
        forwardedFor: "203.0.113.50"
      })
    ).toBe("192.0.2.10");
    expect(
      resolveSessionShareClientAddress({
        socketAddress: "192.0.2.10",
        trustProxy: true,
        cfConnectingIp: "203.0.113.60",
        forwardedFor: "203.0.113.50, 192.0.2.10"
      })
    ).toBe("203.0.113.60");
    expect(
      resolveSessionShareClientAddress({
        socketAddress: "192.0.2.10",
        trustProxy: true,
        forwardedFor: "203.0.113.50, 192.0.2.10"
      })
    ).toBe("203.0.113.50");
    expect(resolveSessionShareClientAddress({ trustProxy: false })).toBe("");
  });
});
