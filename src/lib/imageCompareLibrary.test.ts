import { describe, expect, test } from "bun:test";
import { changeCompareMembers, createCompareDraft } from "./imageCompare";
import { compareLibraryCandidates, rememberCompareCandidates, type CompareLibrarySnapshot } from "./imageCompareLibrary";

describe("historical comparison candidates", () => {
  const old = { id: "old", thumbnailUrl: "/old-thumb.png", title: "Historical result" };
  const recent = { id: "new", thumbnailUrl: "/new-thumb.png", title: "Recent result" };
  test("deselecting the last historical image preserves its card and allows reselecting it", () => {
    let draft = createCompareDraft([old.id])!;
    let snapshot = rememberCompareCandidates({ ownerId: "alice", candidates: [] }, "alice", [old]);
    draft = changeCompareMembers(draft, old.id).draft;
    snapshot = rememberCompareCandidates(snapshot, "alice", []);
    const cards = compareLibraryCandidates(snapshot, [recent]);
    expect(draft.imageIds).toEqual([]);
    expect(cards).toEqual([old, recent]);
    draft = changeCompareMembers(draft, cards[0].id).draft;
    expect(draft.imageIds).toEqual([old.id]);
    expect(draft.activeId).toBe(old.id);
  });
  test("a later page supplies the canonical card without duplicating the remembered candidate", () => {
    const snapshot = rememberCompareCandidates({ ownerId: "alice", candidates: [] }, "alice", [old]);
    const refreshed = { ...old, title: "Updated prompt" };
    expect(compareLibraryCandidates(snapshot, [recent, refreshed])).toEqual([recent, refreshed]);
    expect(rememberCompareCandidates(snapshot, "alice", [old])).toBe(snapshot);
  });
  test("late detail metadata updates the card and remembered candidates never cross accounts", () => {
    let snapshot: CompareLibrarySnapshot = { ownerId: "alice", candidates: [{ ...old, thumbnailUrl: "", title: "Image A" }] };
    snapshot = rememberCompareCandidates(snapshot, "alice", [old]);
    expect(snapshot.candidates).toEqual([old]);
    expect(rememberCompareCandidates(snapshot, "bob", [recent])).toEqual({ ownerId: "bob", candidates: [recent] });
  });
});
