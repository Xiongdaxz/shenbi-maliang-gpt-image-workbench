import { describe, expect, test } from "bun:test";
import { createCreativeId } from "./creativeId";

const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
describe("creative IDs on secure and LAN HTTP pages", () => {
  test("uses a native UUID when available and preserves its receiver", () => {
    const source = { marker: "native-uuid", randomUUID() { return this.marker; } };
    expect(createCreativeId(source)).toBe("native-uuid");
  });
  test("initializes placements and product variants when HTTP exposes only getRandomValues", () => {
    const source = { getRandomValues(bytes: Uint8Array) { bytes.fill(255); return bytes; } };
    expect(createCreativeId(source)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(createCreativeId(source)).toMatch(uuid);
  });
  test("older runtimes without Web Crypto still create distinct non-security IDs", () => {
    const ids = Array.from({ length: 100 }, () => createCreativeId({}));
    expect(ids.every(id => uuid.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
