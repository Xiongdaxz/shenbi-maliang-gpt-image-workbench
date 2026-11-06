import { describe, expect, test } from "bun:test";
import { LOCALE_CODES } from "../i18n/locales";
import imageModelMessages from "../i18n/messages/imageModelMessages";

describe("image model picker messages", () => {
  test("covers every enabled locale", () => {
    for (const locale of LOCALE_CODES) {
      const messages = imageModelMessages[locale];
      for (const key of ["chatMessages.requestedImageModel", "chatMessages.actualImageModel", "chatMessages.upstreamModelUnavailable"]) {
        expect(messages[key], `missing ${key} for ${locale}`).toBeTruthy();
      }
      expect(messages["picker.model.flare"], `missing Flare label for ${locale}`).toBeTruthy();
      expect(messages["picker.model.sunburst"], `missing Sunburst label for ${locale}`).toBeTruthy();
      expect(messages["picker.model.compatible"], `missing compatibility label for ${locale}`).toBeTruthy();
      expect(messages["picker.quality.xhigh"], `missing xhigh label for ${locale}`).toBeTruthy();
      expect(messages["picker.quality.max"], `missing max label for ${locale}`).toBeTruthy();
    }
    expect(imageModelMessages["zh-CN"]["picker.model.flareDesc"]).toBe("速度快、画质好，适合日常创作");
    expect(imageModelMessages["zh-CN"]["picker.model.sunburstDesc"]).toBe("画质更高、编辑更准，适合专业创作");
    expect(imageModelMessages["zh-CN"]["picker.model.compatibleDesc"]).toBe("画质稳定、细节清晰，适合常规创作");
  });
});
