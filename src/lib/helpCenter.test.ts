import { describe, expect, test } from "bun:test";
import { helpCenterOverrides } from "../i18n/messages/helpCenterOverrides";
import { helpCenterPrimaryOverrides } from "../i18n/messages/helpCenterPrimaryOverrides";
import { HELP_ARTICLES } from "./helpCenter";

describe("help center article registry", () => {
  test("keeps the image editing guide on its stable article id", () => {
    const article = HELP_ARTICLES.find((item) => item.id === "mask-edit");

    expect(article?.titleKey).toBe("help.article.maskEdit.title");
    expect(article?.bodyKey).toBe("help.article.maskEdit.body");
    expect(article?.action?.to).toBe("/images");
  });

  test("does not show screenshots for recently changed editing and quality controls", () => {
    const articlesWithoutCurrentScreenshots = [
      "create-first-image",
      "add-reference-image",
      "refine-existing-result",
      "mask-edit",
      "adjust-generation-options"
    ];

    for (const articleId of articlesWithoutCurrentScreenshots) {
      const article = HELP_ARTICLES.find((item) => item.id === articleId);
      expect(article, `missing help article: ${articleId}`).toBeDefined();
      expect(article?.visual, `stale help screenshot registered for: ${articleId}`).toBeUndefined();
    }
  });

  test("documents Comment and Remove prerequisites in every help locale", () => {
    const localeMessages = {
      ...helpCenterPrimaryOverrides,
      ...helpCenterOverrides
    };

    for (const [locale, messages] of Object.entries(localeMessages)) {
      const guide = messages["help.article.maskEdit.body"];
      const troubleshooting = messages["help.article.imageDisplayOrEditFailed.body"];

      expect(guide, `missing image editing guide for: ${locale}`).toMatch(/Comment|评论/);
      expect(guide, `missing Remove flow for: ${locale}`).toMatch(/Remove|移除/);
      expect(troubleshooting, `missing editing prerequisites for: ${locale}`).toMatch(/Comment|评论/);
      expect(troubleshooting, `missing Remove prerequisite for: ${locale}`).toMatch(/Remove|移除/);
    }
  });
});
