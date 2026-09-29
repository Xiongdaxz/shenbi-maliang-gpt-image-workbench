import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createCompareDraft, replaceCompareSlot } from "../../lib/imageCompare";
import { ImageCompareSelection } from "./ImageCompareSelection";

describe("mobile comparison image selection", () => {
  test("all four selected images remain available as buttons while only two panes are visible", () => {
    const draft = createCompareDraft(["a", "b", "c", "d"])!;
    const html = renderToStaticMarkup(<ImageCompareSelection imageIds={draft.imageIds} activeId="c" mobile onActivate={() => undefined} />);
    expect(html.match(/<button\b/g)?.length).toBe(4);
    for (const label of ["A", "B", "C", "D"]) expect(html).toContain(`>${label}</button>`);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(replaceCompareSlot(["a", "b"], "a", "c")).toEqual(["c", "b"]);
    expect(draft.imageIds).toEqual(["a", "b", "c", "d"]);
  });
  test("desktop and empty selection keep the compact current-image indicator", () => {
    const desktop = renderToStaticMarkup(<ImageCompareSelection imageIds={["a", "b"]} activeId="a" mobile={false} onActivate={() => undefined} />);
    expect(desktop).not.toContain("<button");
    expect(desktop).toContain(">A</span>");
    const empty = renderToStaticMarkup(<ImageCompareSelection imageIds={[]} activeId="" mobile onActivate={() => undefined} />);
    expect(empty).not.toContain("<button");
    expect(empty).toContain(">—</span>");
  });
});
