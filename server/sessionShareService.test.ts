import { describe, expect, test } from "bun:test";
import type { Message } from "../src/types";
import { caseSessionShareAssociationAction, caseShareMessageIds, SessionShareError } from "./sessionShareService";

function message(
  id: string,
  role: "user" | "assistant",
  metadata: Record<string, unknown>,
  imageId: string | null = null
): Message {
  return {
    id,
    role,
    content: id,
    imageId,
    imageUrl: null,
    imagePrompt: null,
    imageKind: imageId ? "generation" : null,
    imageSize: null,
    imageQuality: null,
    imageProviderId: null,
    parentImageId: null,
    metadata,
    createdAt: `2026-09-21T00:00:${id.padStart(2, "0")}.000Z`
  };
}

describe("case conversation share snapshot", () => {
  test("keeps the main branch only through the selected result", () => {
    const messages = [
      message("1", "user", { jobId: "job-1", revisionRootId: "1" }),
      message("2", "assistant", { jobId: "job-1", revisionRootId: "1" }, "image-1"),
      message("3", "user", { jobId: "job-2", revisionRootId: "3" }),
      message("4", "assistant", { jobId: "job-2", revisionRootId: "3" }, "image-2")
    ];
    expect(caseShareMessageIds(messages, ["image-1"])).toEqual(["1", "2"]);
  });

  test("keeps branch ancestors while excluding the replaced main turn, sibling branches, and later messages", () => {
    const messages = [
      message("1", "user", { jobId: "job-base", revisionRootId: "1" }),
      message("2", "assistant", { jobId: "job-base", revisionRootId: "1" }, "image-base"),
      message("3", "user", { jobId: "job-main", revisionRootId: "3" }),
      message("4", "assistant", { jobId: "job-main", revisionRootId: "3" }, "image-main"),
      message("5", "user", {
        jobId: "job-branch",
        revisionRootId: "3",
        branchId: "branch-a",
        parentBranchId: "main",
        branchForkMessageId: "3",
        branchRootMessageId: "3"
      }),
      message("6", "assistant", { jobId: "job-branch", branchId: "branch-a", revisionRootId: "3" }, "image-branch"),
      message("7", "user", {
        jobId: "job-sibling",
        revisionRootId: "3",
        branchId: "branch-b",
        parentBranchId: "main",
        branchForkMessageId: "3",
        branchRootMessageId: "3"
      }),
      message("8", "assistant", { jobId: "job-sibling", branchId: "branch-b", revisionRootId: "3" }, "image-sibling"),
      message("9", "user", { jobId: "job-later", branchId: "branch-a", revisionRootId: "9" }),
      message("10", "assistant", { jobId: "job-later", branchId: "branch-a", revisionRootId: "9" }, "image-later")
    ];
    expect(caseShareMessageIds(messages, ["image-branch"])).toEqual(["1", "2", "5", "6"]);
  });

  test("includes multiple selected results through the last result", () => {
    const messages = [
      message("1", "user", { jobId: "job-1", revisionRootId: "1" }),
      message("2", "assistant", { jobId: "job-1", revisionRootId: "1" }, "image-1"),
      message("3", "assistant", { jobId: "job-1", revisionRootId: "1" }, "image-2"),
      message("4", "user", { jobId: "job-2", revisionRootId: "4" })
    ];
    expect(caseShareMessageIds(messages, ["image-1", "image-2"])).toEqual(["1", "2", "3"]);
  });

  test("rejects results from different branches or missing result messages", () => {
    const messages = [
      message("1", "user", { jobId: "job-main", revisionRootId: "1" }),
      message("2", "assistant", { jobId: "job-main", revisionRootId: "1" }, "image-main"),
      message("3", "user", { jobId: "job-branch", branchId: "branch-a", parentBranchId: "main", branchForkMessageId: "1", branchRootMessageId: "1", revisionRootId: "1" }),
      message("4", "assistant", { jobId: "job-branch", branchId: "branch-a", revisionRootId: "1" }, "image-branch")
    ];
    expect(() => caseShareMessageIds(messages, ["image-main", "image-branch"])).toThrow(SessionShareError);
    expect(() => caseShareMessageIds(messages, ["missing-image"])).toThrow("绘画结果消息不存在");
  });
});

describe("case conversation share association updates", () => {
  const current = { shareId: "share-1", includeReferences: true };

  test("preserves an existing snapshot for ordinary case edits", () => {
    expect(caseSessionShareAssociationAction({ current, nextEnabled: true, nextIncludeReferences: true })).toBe("preserve");
  });

  test("rebuilds only when enabling sharing or changing the reference policy", () => {
    expect(caseSessionShareAssociationAction({ current: null, nextEnabled: true, nextIncludeReferences: true })).toBe("attach");
    expect(caseSessionShareAssociationAction({ current, nextEnabled: true, nextIncludeReferences: false })).toBe("attach");
  });

  test("detaches only an existing association when sharing is disabled", () => {
    expect(caseSessionShareAssociationAction({ current, nextEnabled: false, nextIncludeReferences: true })).toBe("detach");
    expect(caseSessionShareAssociationAction({ current: null, nextEnabled: false, nextIncludeReferences: true })).toBe("preserve");
  });
});
