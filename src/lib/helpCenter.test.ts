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

  test("documents the background option in every help locale", () => {
    const localeMessages = {
      ...helpCenterPrimaryOverrides,
      ...helpCenterOverrides
    };
    const backgroundTerms: Record<string, RegExp> = {
      "zh-CN": /背景/,
      "en-US": /background/i,
      "ja-JP": /背景/,
      "ko-KR": /배경/,
      "es-ES": /fondo/i,
      "fr-FR": /arrière-plan/i,
      "de-DE": /Hintergrund/i,
      "pt-BR": /fundo/i,
      "ru-RU": /фон/i,
      "fa-IR": /پس‌زمینه/
    };

    for (const [locale, messages] of Object.entries(localeMessages)) {
      const pattern = backgroundTerms[locale];
      expect(pattern, `missing background term for: ${locale}`).toBeDefined();
      expect(messages["help.visual.workbench.parameters"], `missing background visual copy for: ${locale}`).toMatch(pattern);
      expect(messages["help.article.adjustGenerationOptions.body"], `missing background guide for: ${locale}`).toMatch(pattern);
    }
  });
});
