import { describe, expect, test } from "bun:test";
import deDEMessages from "../i18n/messages/de-DE";
import enUSMessages from "../i18n/messages/en-US";
import esESMessages from "../i18n/messages/es-ES";
import faIRMessages from "../i18n/messages/fa-IR";
import frFRMessages from "../i18n/messages/fr-FR";
import jaJPMessages from "../i18n/messages/ja-JP";
import koKRMessages from "../i18n/messages/ko-KR";
import ptBRMessages from "../i18n/messages/pt-BR";
import ruRUMessages from "../i18n/messages/ru-RU";
import zhCNMessages from "../i18n/messages/zh-CN";
import zhTWMessages from "../i18n/messages/zh-TW";

describe("image background picker messages", () => {
  test("localizes every background picker label for every enabled locale", () => {
    const localeMessages = {
      "zh-CN": zhCNMessages,
      "zh-TW": zhTWMessages,
      "en-US": enUSMessages,
      "ja-JP": jaJPMessages,
      "ko-KR": koKRMessages,
      "es-ES": esESMessages,
      "fr-FR": frFRMessages,
      "de-DE": deDEMessages,
      "pt-BR": ptBRMessages,
      "ru-RU": ruRUMessages,
      "fa-IR": faIRMessages
    };
    const expectedTriggers: Record<keyof typeof localeMessages, string> = {
      "zh-CN": "背景",
      "zh-TW": "背景",
      "en-US": "Background",
      "ja-JP": "背景",
      "ko-KR": "배경",
      "es-ES": "Fondo",
      "fr-FR": "Arrière-plan",
      "de-DE": "Hintergrund",
      "pt-BR": "Fundo",
      "ru-RU": "Фон",
      "fa-IR": "پس‌زمینه"
    };

    for (const [locale, messages] of Object.entries(localeMessages) as Array<[
      keyof typeof localeMessages,
      (typeof localeMessages)[keyof typeof localeMessages]
    ]>) {
      expect(messages["picker.background.trigger"], `missing trigger for: ${locale}`).toBe(expectedTriggers[locale]);
      expect(messages["picker.backgroundTooltip"], `missing tooltip for: ${locale}`).toBeTruthy();
      expect(messages["picker.background.default"], `missing default label for: ${locale}`).toBeTruthy();
      expect(messages["picker.background.opaque"], `missing opaque label for: ${locale}`).toBeTruthy();
      expect(messages["picker.background.opaqueDesc"], `missing opaque description for: ${locale}`).toBeTruthy();
      expect(messages["picker.background.transparent"], `missing transparent label for: ${locale}`).toBeTruthy();
      expect(messages["picker.background.transparentDesc"], `missing transparent description for: ${locale}`).toBeTruthy();
    }
  });
});
