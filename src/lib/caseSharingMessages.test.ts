import { describe, expect, test } from "bun:test";
import { enabledLocales } from "../i18n/locales";
import caseSharingMessages from "../i18n/messages/caseSharingMessages";

const keys = [
  "pages.cases.shareConversationUnavailable",
  "pages.cases.viewConversation"
] as const;

describe("case conversation sharing messages", () => {
  test("localizes every sharing label for every enabled locale", () => {
    for (const locale of enabledLocales) {
      for (const key of keys) expect(caseSharingMessages[locale.code]?.[key]?.trim()).toBeTruthy();
    }
  });
});
