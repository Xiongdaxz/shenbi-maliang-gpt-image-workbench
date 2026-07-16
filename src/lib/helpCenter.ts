export type HelpCategoryId =
  | "start"
  | "create"
  | "organize"
  | "manage"
  | "account"
  | "troubleshoot";

export type HelpCategory = {
  id: HelpCategoryId;
  icon: "sparkles" | "wand" | "layers" | "images" | "settings" | "life-buoy";
  labelKey: string;
  summaryKey: string;
};

export type HelpAction = {
  to: string;
  labelKey: string;
};

export type HelpArticleVisualMarker = {
  x: number;
  y: number;
  labelKey: string;
};

export type HelpArticleVisual = {
  src: string;
  altKey: string;
  captionKey: string;
  markers: HelpArticleVisualMarker[];
};

export type HelpArticle = {
  id: string;
  categoryId: HelpCategoryId;
  titleKey: string;
  summaryKey: string;
  keywordsKey: string;
  bodyKey: string;
  action?: HelpAction;
  visual?: HelpArticleVisual;
};

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "start", icon: "sparkles", labelKey: "help.category.start.title", summaryKey: "help.category.start.summary" },
  { id: "create", icon: "wand", labelKey: "help.category.create.title", summaryKey: "help.category.create.summary" },
  { id: "organize", icon: "layers", labelKey: "help.category.organize.title", summaryKey: "help.category.organize.summary" },
  { id: "manage", icon: "images", labelKey: "help.category.manage.title", summaryKey: "help.category.manage.summary" },
  { id: "account", icon: "settings", labelKey: "help.category.account.title", summaryKey: "help.category.account.summary" },
  { id: "troubleshoot", icon: "life-buoy", labelKey: "help.category.troubleshoot.title", summaryKey: "help.category.troubleshoot.summary" }
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "create-first-image",
    categoryId: "start",
    titleKey: "help.article.createFirstImage.title",
    summaryKey: "help.article.createFirstImage.summary",
    keywordsKey: "help.article.createFirstImage.keywords",
    bodyKey: "help.article.createFirstImage.body",
    action: { to: "/", labelKey: "help.action.goCreate" },
    visual: {
      src: "/image/help/workbench-create.png",
      altKey: "help.visual.workbench.alt",
      captionKey: "help.visual.workbench.caption",
      markers: [
        { x: 34, y: 83, labelKey: "help.visual.workbench.prompt" },
        { x: 48, y: 92, labelKey: "help.visual.workbench.parameters" },
        { x: 90, y: 92, labelKey: "help.visual.workbench.send" }
      ]
    }
  },
  {
    id: "add-reference-image",
    categoryId: "start",
    titleKey: "help.article.addReferenceImage.title",
    summaryKey: "help.article.addReferenceImage.summary",
    keywordsKey: "help.article.addReferenceImage.keywords",
    bodyKey: "help.article.addReferenceImage.body",
    action: { to: "/", labelKey: "help.action.goCreate" },
    visual: {
      src: "/image/help/workbench-create.png",
      altKey: "help.visual.workbench.alt",
      captionKey: "help.visual.workbench.caption",
      markers: [
        { x: 14.5, y: 92, labelKey: "help.visual.workbench.materials" },
        { x: 34, y: 83, labelKey: "help.visual.workbench.prompt" },
        { x: 90, y: 92, labelKey: "help.visual.workbench.send" }
      ]
    }
  },
  {
    id: "refine-existing-result",
    categoryId: "start",
    titleKey: "help.article.refineExistingResult.title",
    summaryKey: "help.article.refineExistingResult.summary",
    keywordsKey: "help.article.refineExistingResult.keywords",
    bodyKey: "help.article.refineExistingResult.body",
    action: { to: "/images", labelKey: "help.action.goImages" },
    visual: {
      src: "/image/help/image-editor.png",
      altKey: "help.visual.editor.alt",
      captionKey: "help.visual.editor.caption",
      markers: [
        { x: 8.5, y: 54, labelKey: "help.visual.editor.history" },
        { x: 77, y: 48, labelKey: "help.visual.editor.preview" },
        { x: 57, y: 94, labelKey: "help.visual.editor.describe" }
      ]
    }
  },
  {
    id: "shortcuts-and-efficiency",
    categoryId: "start",
    titleKey: "help.article.shortcutsAndEfficiency.title",
    summaryKey: "help.article.shortcutsAndEfficiency.summary",
    keywordsKey: "help.article.shortcutsAndEfficiency.keywords",
    bodyKey: "help.article.shortcutsAndEfficiency.body"
  },
  {
    id: "describe-image",
    categoryId: "create",
    titleKey: "help.article.describeImage.title",
    summaryKey: "help.article.describeImage.summary",
    keywordsKey: "help.article.describeImage.keywords",
    bodyKey: "help.article.describeImage.body",
    action: { to: "/", labelKey: "help.action.goCreate" }
  },
  {
    id: "mask-edit",
    categoryId: "create",
    titleKey: "help.article.maskEdit.title",
    summaryKey: "help.article.maskEdit.summary",
    keywordsKey: "help.article.maskEdit.keywords",
    bodyKey: "help.article.maskEdit.body",
    action: { to: "/images", labelKey: "help.action.goImages" },
    visual: {
      src: "/image/help/mask-editor.png",
      altKey: "help.visual.mask.alt",
      captionKey: "help.visual.mask.caption",
      markers: [
        { x: 79, y: 4.5, labelKey: "help.visual.mask.toolbar" },
        { x: 52, y: 47, labelKey: "help.visual.mask.area" },
        { x: 57, y: 93, labelKey: "help.visual.mask.describe" }
      ]
    }
  },
  {
    id: "adjust-generation-options",
    categoryId: "create",
    titleKey: "help.article.adjustGenerationOptions.title",
    summaryKey: "help.article.adjustGenerationOptions.summary",
    keywordsKey: "help.article.adjustGenerationOptions.keywords",
    bodyKey: "help.article.adjustGenerationOptions.body",
    action: { to: "/", labelKey: "help.action.goCreate" },
    visual: {
      src: "/image/help/workbench-create.png",
      altKey: "help.visual.workbench.alt",
      captionKey: "help.visual.workbench.caption",
      markers: [
        { x: 21, y: 92, labelKey: "help.visual.workbench.size" },
        { x: 33, y: 92, labelKey: "help.visual.workbench.quality" },
        { x: 43, y: 92, labelKey: "help.visual.workbench.count" },
        { x: 55, y: 92, labelKey: "help.visual.workbench.color" }
      ]
    }
  },
  {
    id: "edit-result-not-expected",
    categoryId: "create",
    titleKey: "help.article.editResultNotExpected.title",
    summaryKey: "help.article.editResultNotExpected.summary",
    keywordsKey: "help.article.editResultNotExpected.keywords",
    bodyKey: "help.article.editResultNotExpected.body",
    action: { to: "/images", labelKey: "help.action.goImages" }
  },
  {
    id: "save-and-use-assets",
    categoryId: "organize",
    titleKey: "help.article.saveAndUseAssets.title",
    summaryKey: "help.article.saveAndUseAssets.summary",
    keywordsKey: "help.article.saveAndUseAssets.keywords",
    bodyKey: "help.article.saveAndUseAssets.body",
    action: { to: "/assets", labelKey: "help.action.goAssets" },
    visual: {
      src: "/image/help/assets-library.png",
      altKey: "help.visual.assets.alt",
      captionKey: "help.visual.assets.caption",
      markers: [
        { x: 18, y: 24, labelKey: "help.visual.assets.scope" },
        { x: 48, y: 24, labelKey: "help.visual.assets.tags" },
        { x: 94, y: 24, labelKey: "help.visual.assets.upload" },
        { x: 17, y: 51, labelKey: "help.visual.assets.card" }
      ]
    }
  },
  {
    id: "use-inspiration",
    categoryId: "organize",
    titleKey: "help.article.useInspiration.title",
    summaryKey: "help.article.useInspiration.summary",
    keywordsKey: "help.article.useInspiration.keywords",
    bodyKey: "help.article.useInspiration.body",
    action: { to: "/cases", labelKey: "help.action.goCases" },
    visual: {
      src: "/image/help/inspiration-library.png",
      altKey: "help.visual.inspiration.alt",
      captionKey: "help.visual.inspiration.caption",
      markers: [
        { x: 28, y: 24, labelKey: "help.visual.inspiration.scope" },
        { x: 78, y: 24, labelKey: "help.visual.inspiration.search" },
        { x: 18, y: 53, labelKey: "help.visual.inspiration.card" }
      ]
    }
  },
  {
    id: "use-prompt-templates",
    categoryId: "organize",
    titleKey: "help.article.usePromptTemplates.title",
    summaryKey: "help.article.usePromptTemplates.summary",
    keywordsKey: "help.article.usePromptTemplates.keywords",
    bodyKey: "help.article.usePromptTemplates.body",
    action: { to: "/prompt-templates", labelKey: "help.action.goPromptTemplates" },
    visual: {
      src: "/image/help/prompt-templates.png",
      altKey: "help.visual.promptTemplates.alt",
      captionKey: "help.visual.promptTemplates.caption",
      markers: [
        { x: 17, y: 48, labelKey: "help.visual.promptTemplates.templates" },
        { x: 65, y: 42, labelKey: "help.visual.promptTemplates.fields" },
        { x: 93, y: 8, labelKey: "help.visual.promptTemplates.actions" }
      ]
    }
  },
  {
    id: "find-favorite-and-edit-images",
    categoryId: "manage",
    titleKey: "help.article.findFavoriteAndEditImages.title",
    summaryKey: "help.article.findFavoriteAndEditImages.summary",
    keywordsKey: "help.article.findFavoriteAndEditImages.keywords",
    bodyKey: "help.article.findFavoriteAndEditImages.body",
    action: { to: "/images", labelKey: "help.action.goImages" },
    visual: {
      src: "/image/help/my-images.png",
      altKey: "help.visual.images.alt",
      captionKey: "help.visual.images.caption",
      markers: [
        { x: 36, y: 9, labelKey: "help.visual.images.view" },
        { x: 50, y: 23, labelKey: "help.visual.images.search" },
        { x: 23, y: 62, labelKey: "help.visual.images.open" },
        { x: 15, y: 31, labelKey: "help.visual.images.batch" }
      ]
    }
  },
  {
    id: "batch-organize-images",
    categoryId: "manage",
    titleKey: "help.article.batchOrganizeImages.title",
    summaryKey: "help.article.batchOrganizeImages.summary",
    keywordsKey: "help.article.batchOrganizeImages.keywords",
    bodyKey: "help.article.batchOrganizeImages.body",
    action: { to: "/images", labelKey: "help.action.goImages" },
    visual: {
      src: "/image/help/my-images-batch.png",
      altKey: "help.visual.batch.alt",
      captionKey: "help.visual.batch.caption",
      markers: [
        { x: 14, y: 24, labelKey: "help.visual.batch.select" },
        { x: 70, y: 8.5, labelKey: "help.visual.batch.actions" }
      ]
    }
  },
  {
    id: "download-images",
    categoryId: "manage",
    titleKey: "help.article.downloadImages.title",
    summaryKey: "help.article.downloadImages.summary",
    keywordsKey: "help.article.downloadImages.keywords",
    bodyKey: "help.article.downloadImages.body",
    action: { to: "/images", labelKey: "help.action.goImages" },
    visual: {
      src: "/image/help/download-options.png",
      altKey: "help.visual.download.alt",
      captionKey: "help.visual.download.caption",
      markers: [
        { x: 38, y: 32, labelKey: "help.visual.download.estimate" },
        { x: 38, y: 51, labelKey: "help.visual.download.variants" },
        { x: 38, y: 65, labelKey: "help.visual.download.manifest" },
        { x: 52, y: 77, labelKey: "help.visual.download.action" }
      ]
    }
  },
  {
    id: "download-variants",
    categoryId: "manage",
    titleKey: "help.article.downloadVariants.title",
    summaryKey: "help.article.downloadVariants.summary",
    keywordsKey: "help.article.downloadVariants.keywords",
    bodyKey: "help.article.downloadVariants.body",
    action: { to: "/images", labelKey: "help.action.goImages" },
    visual: {
      src: "/image/help/download-variants.png",
      altKey: "help.visual.download.alt",
      captionKey: "help.visual.download.caption",
      markers: [
        { x: 38, y: 32, labelKey: "help.visual.download.estimate" },
        { x: 38, y: 51, labelKey: "help.visual.download.variants" }
      ]
    }
  },
  {
    id: "personal-preferences",
    categoryId: "account",
    titleKey: "help.article.personalPreferences.title",
    summaryKey: "help.article.personalPreferences.summary",
    keywordsKey: "help.article.personalPreferences.keywords",
    bodyKey: "help.article.personalPreferences.body",
    action: { to: "/?settings=help", labelKey: "help.action.goSettings" },
    visual: {
      src: "/image/help/settings.png",
      altKey: "help.visual.settings.alt",
      captionKey: "help.visual.settings.caption",
      markers: [
        { x: 16, y: 31, labelKey: "help.visual.settings.categories" },
        { x: 66, y: 19, labelKey: "help.visual.settings.appearance" },
        { x: 84, y: 29, labelKey: "help.visual.settings.language" },
        { x: 85, y: 39, labelKey: "help.visual.settings.autoUpload" }
      ]
    }
  },
  {
    id: "archive-and-delete-chats",
    categoryId: "account",
    titleKey: "help.article.archiveAndDeleteChats.title",
    summaryKey: "help.article.archiveAndDeleteChats.summary",
    keywordsKey: "help.article.archiveAndDeleteChats.keywords",
    bodyKey: "help.article.archiveAndDeleteChats.body",
    action: { to: "/?settings=help", labelKey: "help.action.goSettings" }
  },
  {
    id: "content-data-relations",
    categoryId: "account",
    titleKey: "help.article.contentDataRelations.title",
    summaryKey: "help.article.contentDataRelations.summary",
    keywordsKey: "help.article.contentDataRelations.keywords",
    bodyKey: "help.article.contentDataRelations.body",
    action: { to: "/images", labelKey: "help.action.goImages" }
  },
  {
    id: "generation-failed",
    categoryId: "troubleshoot",
    titleKey: "help.article.generationFailed.title",
    summaryKey: "help.article.generationFailed.summary",
    keywordsKey: "help.article.generationFailed.keywords",
    bodyKey: "help.article.generationFailed.body",
    action: { to: "/", labelKey: "help.action.goCreate" }
  },
  {
    id: "image-display-or-edit-failed",
    categoryId: "troubleshoot",
    titleKey: "help.article.imageDisplayOrEditFailed.title",
    summaryKey: "help.article.imageDisplayOrEditFailed.summary",
    keywordsKey: "help.article.imageDisplayOrEditFailed.keywords",
    bodyKey: "help.article.imageDisplayOrEditFailed.body",
    action: { to: "/images", labelKey: "help.action.goImages" }
  },
  {
    id: "download-failed",
    categoryId: "troubleshoot",
    titleKey: "help.article.downloadFailed.title",
    summaryKey: "help.article.downloadFailed.summary",
    keywordsKey: "help.article.downloadFailed.keywords",
    bodyKey: "help.article.downloadFailed.body",
    action: { to: "/images", labelKey: "help.action.goImages" }
  },
  {
    id: "search-history-missing",
    categoryId: "troubleshoot",
    titleKey: "help.article.searchHistoryMissing.title",
    summaryKey: "help.article.searchHistoryMissing.summary",
    keywordsKey: "help.article.searchHistoryMissing.keywords",
    bodyKey: "help.article.searchHistoryMissing.body",
    action: { to: "/images", labelKey: "help.action.goImages" }
  }
];

export const HELP_POPULAR_ARTICLE_IDS = [
  "create-first-image",
  "mask-edit",
  "shortcuts-and-efficiency",
  "generation-failed"
] as const;

export function helpCategoryById(value: string | null | undefined) {
  return HELP_CATEGORIES.find((category) => category.id === value) ?? null;
}

export function helpArticleById(value: string | null | undefined) {
  return HELP_ARTICLES.find((article) => article.id === value) ?? null;
}
