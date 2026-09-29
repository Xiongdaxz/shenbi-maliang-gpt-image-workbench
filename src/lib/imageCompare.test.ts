import { describe, expect, test } from "bun:test";
import { changeCompareMembers, galleryCompareImageIds, initialCompareImageIds, clampCompareView, compareFitScale, compareImageContainsPoint, compareLayoutColumns, compareLibraryScrollTop, compareMaxZoom, compareNeedsOriginal, compareOriginalView, compareScale, compareViewIsAdjusted, compareWantsOriginal, createCompareDraft, defaultCompareView, panCompareView, parseCompareDraft, replaceCompareSlot, shouldToggleCompareOnRelease, zoomCompareView } from "./imageCompare";
import imageCompareMessages from "../i18n/messages/imageCompareMessages";
import { enabledLocales } from "../i18n/locales";

const square = { width: 1024, height: 1024, viewportWidth: 536, viewportHeight: 536 };
const portrait = { width: 1024, height: 2048, viewportWidth: 536, viewportHeight: 536 };

describe("full-page comparison layout", () => {
  test("uses four columns to enlarge the four portrait posters from the reported screen", () => {
    const posters = Array.from({ length: 4 }, () => ({ width: 1086, height: 1448 }));
    expect(compareLayoutColumns(posters, 1920, 929)).toBe(4);
    expect(compareLayoutColumns(posters, 1440, 900)).toBe(4);
  });
  test("uses two rows when landscape images have more visible area that way", () => {
    const landscapes = Array.from({ length: 4 }, () => ({ width: 1600, height: 900 }));
    expect(compareLayoutColumns(landscapes, 1920, 929)).toBe(2);
  });
  test("keeps mobile observation panes stacked and avoids narrow desktop columns", () => {
    expect(compareLayoutColumns([square, portrait], 390, 844)).toBe(1);
    expect(compareLayoutColumns([square, portrait, square, portrait], 800, 900)).toBe(2);
    expect(compareLayoutColumns([square, portrait, square, portrait], 656, 900, false)).toBe(2);
  });
});

describe("comparison coordinates", () => {
  test("preview/original selection preserves enlarged geometry and honors an explicit preview", () => {
    const view = Object.freeze({ mode: "actual" as const, zoom: 2, u: 0.6, v: 0.4 });
    const before = { ...view };
    expect(compareWantsOriginal("auto", view, square)).toBe(true);
    expect(compareWantsOriginal("preview", view, square)).toBe(false);
    expect(compareWantsOriginal("original", view, square)).toBe(true);
    expect(compareWantsOriginal("preview", view, square)).toBe(false);
    expect(view).toEqual(before);
    expect(compareScale(view, square)).toBe(2);
    expect(clampCompareView(view, square)).toEqual(before);
  });
  test("explicit original works while fitted, and preview does not trigger hidden automatic upgrades", () => {
    expect(compareWantsOriginal("auto", defaultCompareView(), square)).toBe(false);
    expect(compareWantsOriginal("original", defaultCompareView(), square)).toBe(true);
    expect(compareWantsOriginal("preview", defaultCompareView(), undefined, false)).toBe(false);
    expect(compareWantsOriginal("auto", defaultCompareView(), undefined, false)).toBe(true);
  });
  test("manual scale covers the editor's 10 to 300 percent range below and above fit", () => {
    expect(compareScale({ mode: "actual", zoom: 0.1, u: 0.5, v: 0.5 }, square)).toBe(0.1);
    expect(compareScale({ mode: "actual", zoom: 0.01, u: 0.5, v: 0.5 }, square)).toBe(0.1);
    expect(compareScale({ mode: "actual", zoom: 4, u: 0.5, v: 0.5 }, square)).toBe(3);
    const restored = createCompareDraft(["a"])!;
    restored.views.a = { mode: "actual", zoom: 0.01, u: 0.5, v: 0.5 };
    expect(parseCompareDraft(restored)?.views.a.zoom).toBe(0.1);
  });
  test("the shared toggle enters 100 percent at the top and returns to the fitted state", () => {
    expect(compareViewIsAdjusted(defaultCompareView())).toBe(false);
    const original = compareOriginalView(portrait);
    expect(original.zoom).toBe(1);
    expect(original.u).toBe(0.5);
    expect(original.v * portrait.height).toBe(portrait.viewportHeight / 2);
    expect(compareViewIsAdjusted(original)).toBe(true);
    expect(compareViewIsAdjusted({ ...defaultCompareView(), zoom: 0.5 })).toBe(true);
    expect(compareOriginalView({ ...square, width: 100, height: 100 }).v).toBe(0.5);
  });
  test("fit is relative to each image, while actual is an image-pixel scale", () => {
    expect(compareFitScale(square)).toBe(0.5);
    expect(compareFitScale(portrait)).toBe(0.25);
    expect(compareScale({ ...defaultCompareView(), zoom: 2 }, portrait)).toBe(0.5);
    expect(compareScale({ ...defaultCompareView(), mode: "actual" }, portrait)).toBe(1);
  });
  test("shared fit zoom stops at the strictest image's native scale ceiling", () => {
    expect(compareMaxZoom("fit", [square, portrait])).toBe(6);
    expect(compareScale({ ...defaultCompareView(), zoom: 6 }, square)).toBe(3);
    expect(compareScale({ ...defaultCompareView(), zoom: 6 }, portrait)).toBe(1.5);
  });
  test("pan centers small content and constrains large content to its edge", () => {
    expect(panCompareView(defaultCompareView(), square, 999, -999)).toEqual(defaultCompareView());
    const moved = panCompareView({ ...defaultCompareView(), mode: "actual" }, square, 999, -999);
    expect(moved.u).toBeCloseTo(536 / 2048);
    expect(moved.v).toBeCloseTo(1 - 536 / 2048);
    const wide = { width: 8000, height: 200, viewportWidth: 500, viewportHeight: 500 };
    const position = clampCompareView({ mode: "actual", zoom: 1, u: 0, v: 0 }, wide);
    expect(position.u).toBeCloseTo(500 / 16000);
    expect(position.v).toBe(0.5);
  });
  test("zoom keeps the pointer's original image coordinate fixed", () => {
    const view = { ...defaultCompareView(), mode: "actual" as const };
    const point = { x: 320, y: 350 };
    const next = zoomCompareView(view, square, 2, point);
    const imageXBefore = view.u + (point.x - 268) / 1024;
    const imageXAfter = next.u + (point.x - 268) / 2048;
    const imageYBefore = view.v + (point.y - 268) / 1024;
    const imageYAfter = next.v + (point.y - 268) / 2048;
    expect(imageXAfter).toBeCloseTo(imageXBefore);
    expect(imageYAfter).toBeCloseTo(imageYBefore);
  });
  test("preview quality threshold is based on original dimensions", () => {
    const huge = { ...square, width: 4096, height: 4096 };
    expect(compareNeedsOriginal(defaultCompareView(), huge)).toBe(false);
    expect(compareNeedsOriginal({ ...defaultCompareView(), zoom: 4 }, huge)).toBe(true);
    expect(compareNeedsOriginal({ ...defaultCompareView(), mode: "actual" }, square)).toBe(true);
  });
});

describe("comparison library active-image positioning", () => {
  test("can target an unmounted middle row without loading the whole library", () => {
    expect(compareLibraryScrollTop(50, 100, 400, 100)).toBe(6260);
  });
  test("clamps the first, last and short-list positions to the scrollable extent", () => {
    expect(compareLibraryScrollTop(0, 100, 400, 100)).toBe(0);
    expect(compareLibraryScrollTop(99, 100, 400, 100)).toBe(12392);
    expect(compareLibraryScrollTop(1, 100, 400, 2)).toBe(0);
  });
});

describe("comparison image click versus drag", () => {
  test("only a click inside the visible image can enter the enlarged view", () => {
    expect(compareImageContainsPoint(defaultCompareView(), portrait, { x: 268, y: 268 })).toBe(true);
    expect(compareImageContainsPoint(defaultCompareView(), portrait, { x: 20, y: 268 })).toBe(false);
    expect(compareImageContainsPoint(defaultCompareView(), portrait, { x: 268, y: 0 })).toBe(false);
  });
  test("small pointer jitter remains a click, but a drag ending back at its origin does not", () => {
    const gesture = { start: { x: 100, y: 100 }, end: { x: 102, y: 101 }, moved: false, multiple: false, cancelled: false };
    expect(shouldToggleCompareOnRelease(gesture)).toBe(true);
    expect(shouldToggleCompareOnRelease({ ...gesture, end: { x: 104, y: 100 } })).toBe(false);
    expect(shouldToggleCompareOnRelease({ ...gesture, end: gesture.start, moved: true })).toBe(false);
  });
  test("pinch, pointer cancellation and lost capture never trigger the click toggle", () => {
    const gesture = { start: { x: 100, y: 100 }, end: { x: 100, y: 100 }, moved: false, multiple: false, cancelled: false };
    expect(shouldToggleCompareOnRelease({ ...gesture, multiple: true })).toBe(false);
    expect(shouldToggleCompareOnRelease({ ...gesture, cancelled: true })).toBe(false);
  });
});

describe("comparison drafts and observation slots", () => {
  test("preserves selection order, deduplicates, and enforces the separate four-image limit", () => {
    expect(createCompareDraft(["c", "a", "c", "b"])?.imageIds).toEqual(["c", "a", "b"]);
    expect(createCompareDraft(["a"])?.imageIds).toEqual(["a"]);
    expect(createCompareDraft([])?.imageIds).toEqual([]);
    expect(createCompareDraft(["a", "b", "c", "d", "e"])).toBeNull();
  });
  test("restores only validated IDs and view parameters, never arbitrary private fields", () => {
    const original = createCompareDraft(["a", "b"])!;
    const result = parseCompareDraft({ ...original, activeId: "missing", token: "not-persisted", views: { a: { mode: "actual", zoom: 100, u: -2, v: 4 }, b: { mode: "fit", zoom: NaN, u: 0, v: 0 } } });
    expect(result?.activeId).toBe("a");
    expect(result?.views.a).toEqual({ mode: "actual", zoom: 3, u: 0, v: 1 });
    expect(result?.views.b).toEqual(defaultCompareView());
    expect(result).not.toHaveProperty("token");
    expect(parseCompareDraft({ ...original, version: 2 })).toBeNull();
    expect(parseCompareDraft({ ...original, imageIds: [null, 123] })).toBeNull();
  });
  test("mobile swaps visible candidates without showing a duplicate image", () => {
    expect(replaceCompareSlot(["a", "b"], "b", "c")).toEqual(["a", "c"]);
    expect(replaceCompareSlot(["a", "b"], "b", "a")).toEqual(["b", "a"]);
  });
  test("chat entry keeps the clicked image first and includes only up to four group results", () => {
    expect(initialCompareImageIds("c", ["a", "b", "c", "d", "e"])).toEqual(["c", "a", "b", "d"]);
    expect(initialCompareImageIds("single")).toEqual(["single"]);
  });
  test("chat entry fills remaining slots with other conversation results and starts on A", () => {
    const ids = initialCompareImageIds("clicked", ["sibling", "clicked"], ["first", "clicked", "sibling", "last", "extra"]);
    expect(ids).toEqual(["clicked", "sibling", "first", "last"]);
    expect(createCompareDraft(ids)?.activeId).toBe(ids[0]);
    expect(initialCompareImageIds("single", [], ["first", "single", "last"])).toEqual(["single", "first", "last"]);
  });
  test("gallery entry keeps the clicked image and loads a bounded set from its conversation", async () => {
    const requests: unknown[] = [];
    const ids = await galleryCompareImageIds({ id: "older-clicked", sessionId: "session-a" }, async (sessionId, limit) => {
      requests.push({ sessionId, limit });
      return ["new-1", "new-2", "new-3", "new-4"].map((id) => ({ id, sessionId }));
    });
    expect(requests).toEqual([{ sessionId: "session-a", limit: 4 }]);
    expect(ids).toEqual(["older-clicked", "new-1", "new-2", "new-3"]);
    expect(createCompareDraft(ids)?.activeId).toBe("older-clicked");
  });
  test("gallery entry deduplicates and never includes another conversation", async () => {
    expect(await galleryCompareImageIds({ id: "clicked", sessionId: "session-a" }, async () => [
      { id: "clicked", sessionId: "session-a" }, { id: "other", sessionId: "session-a" }, { id: "unrelated", sessionId: "session-b" }
    ])).toEqual(["clicked", "other"]);
    expect(await galleryCompareImageIds({ id: "detached", sessionId: null }, async () => {
      throw new Error("Must not query the entire library for an image without a conversation");
    })).toEqual(["detached"]);
  });
  test("gallery entry reports a failed conversation lookup instead of silently changing the requested selection", async () => {
    expect(galleryCompareImageIds({ id: "clicked", sessionId: "session-a" }, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
  test("membership changes preserve retained views and do not allow a fifth selection", () => {
    const initial = createCompareDraft(["a", "b", "c", "d"])!;
    initial.activeId = "c";
    initial.views.b = { mode: "actual", zoom: 2, u: .6, v: .4 };
    expect(changeCompareMembers(initial, "e")).toEqual({ draft: initial, reason: "limit" });
    const removed = changeCompareMembers(initial, "c").draft;
    expect(removed.imageIds).toEqual(["a", "b", "d"]);
    expect(removed.activeId).toBe("a");
    expect(removed.views.b).toEqual(initial.views.b);
    expect(removed.views.c).toBeUndefined();
    const added = changeCompareMembers(removed, "e").draft;
    expect(added.activeId).toBe("e");
    expect(added.imageIds).toEqual(["a", "b", "d", "e"]);
    const empty = changeCompareMembers(createCompareDraft(["a"])!, "a").draft;
    expect(empty.imageIds).toEqual([]);
    expect(empty.activeId).toBe("");
    expect(empty.views).toEqual({});
    const selectedAgain = changeCompareMembers(empty, "b").draft;
    expect(selectedAgain.imageIds).toEqual(["b"]);
    expect(selectedAgain.activeId).toBe("b");
    expect(selectedAgain.views.b).toEqual(defaultCompareView());
  });
  test("an empty selection survives draft restoration and malformed IDs remain invalid", () => {
    const empty = changeCompareMembers(createCompareDraft(["a"])!, "a").draft;
    expect(parseCompareDraft(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
    expect(parseCompareDraft({ ...empty, imageIds: [null, 123] })).toBeNull();
    expect(changeCompareMembers(changeCompareMembers(empty, "a").draft, "a").draft).toEqual(empty);
  });
  test("every enabled locale includes all comparison text and matching placeholders", () => {
    const source = imageCompareMessages["en-US"];
    for (const locale of enabledLocales) {
      const messages = imageCompareMessages[locale.code];
      expect(Object.keys(messages).sort()).toEqual(Object.keys(source).sort());
      for (const key of Object.keys(source)) {
        expect(messages[key].trim().length).toBeGreaterThan(0);
        expect(messages[key].match(/\{\w+\}/g)?.sort() ?? []).toEqual(source[key].match(/\{\w+\}/g)?.sort() ?? []);
      }
    }
  });
});
