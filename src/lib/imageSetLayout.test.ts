import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SET_LAYOUT, imageSetLayoutGeometry, parseImageSetLayout } from "./imageSetLayout";

describe("image set panel geometry", () => {
  test("corrupt, incomplete and oversized browser preferences cannot break layout", () => {
    for (const raw of [null,"null","{", "{}", JSON.stringify({left:"20",right:.3,candidates:150}), " ".repeat(1001)]) expect(parseImageSetLayout(raw)).toEqual(DEFAULT_IMAGE_SET_LAYOUT);
    expect(parseImageSetLayout('{"left":-10,"right":9,"candidates":9999}')).toEqual({left:.08,right:.5,candidates:260});
  });
  test("extreme saved widths still leave enough room for the image and controls", () => {
    for (const width of [900,960,1100,1400,2000]) for (const left of [.08,.4]) for (const right of [.12,.5]) {
      const g=imageSetLayoutGeometry(width,580,{left,right,candidates:260});
      expect(g.mode).toBe("wide");expect(g.left).toBeGreaterThanOrEqual(160);expect(g.right).toBeGreaterThanOrEqual(280);expect(g.canvas).toBeGreaterThanOrEqual(420);
      expect(g.left+g.right+g.canvas+20).toBe(width);expect(g.candidates).toBeLessThanOrEqual(210);
    }
  });
  test("uses container width and limits the candidate strip on short displays", () => {
    expect(imageSetLayoutGeometry(760,550,DEFAULT_IMAGE_SET_LAYOUT).mode).toBe("narrow");
    expect(imageSetLayoutGeometry(390,520,DEFAULT_IMAGE_SET_LAYOUT).mode).toBe("stacked");
    expect(imageSetLayoutGeometry(1200,480,{...DEFAULT_IMAGE_SET_LAYOUT,candidates:260}).candidates).toBe(110);
  });
});
