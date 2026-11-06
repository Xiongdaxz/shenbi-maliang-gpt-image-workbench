import { describe, expect, test } from "bun:test";
import messages from "../i18n/messages/imageSetsMessages";

describe("image set translations", () => {
  test("every locale includes complete text with matching placeholders", () => {
    const english = messages["en-US"], keys = Object.keys(english).sort();
    for (const [locale, values] of Object.entries(messages)) {
      expect(Object.keys(values).sort()).toEqual(keys);
      for (const key of keys) {
        expect(typeof values[key]).toBe("string"); expect(values[key].length).toBeGreaterThan(0);
        expect((values[key].match(/\{[^}]+\}/g) || []).sort()).toEqual((english[key].match(/\{[^}]+\}/g) || []).sort());
      }
      expect(locale.length).toBeGreaterThan(0);
    }
  });
  test("keeps the user's final labels", () => {
    expect(messages["zh-CN"]["sets.tabSets"]).toBe("套图"); expect(messages["zh-CN"]["sets.tabProfiles"]).toBe("品牌产品");
    expect(messages["zh-CN"]["sets.title"]).toBe("系列创作");
  });
});
