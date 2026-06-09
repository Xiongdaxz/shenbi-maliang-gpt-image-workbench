import { appDb, getAll, run } from "./db";
import { generatePromptAssetCategoryIds } from "./promptTitle";
import type { ImageRow } from "./types";
import { parseJsonArray } from "./utils";

type AssetTagOption = {
  id: string;
  name: string;
  slug: string;
};

function assetTagOptions() {
  return getAll<AssetTagOption>(
    appDb,
    "select id, name, slug from case_categories where type = 'asset' order by sort_order asc"
  );
}

export async function suggestAssetCategoryIds(prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return [];
  const options = assetTagOptions();
  return generatePromptAssetCategoryIds(normalizedPrompt, options);
}

export async function applyAssetFieldSuggestionsToImages(imageIds: string[], prompt: string) {
  const ids = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0 || !prompt.trim()) return { categoryIds: [] };
  const categoryIds = await suggestAssetCategoryIds(prompt);
  run(
    appDb,
    `update images
     set suggested_asset_category_ids_json = ?
     where id in (${ids.map(() => "?").join(", ")})`,
    JSON.stringify(categoryIds),
    ...ids
  );
  return { categoryIds };
}

export async function ensureAssetFieldSuggestionsForImage(image: ImageRow, promptOverride?: string) {
  const existingCategoryIds = parseJsonArray(image.suggested_asset_category_ids_json, []);
  if (existingCategoryIds.length > 0) return { categoryIds: existingCategoryIds, generated: false };

  const categoryIds = await suggestAssetCategoryIds(String(promptOverride ?? image.prompt));
  run(
    appDb,
    `update images
     set suggested_asset_category_ids_json = ?
     where id = ?`,
    JSON.stringify(categoryIds),
    image.id
  );
  return { categoryIds, generated: true };
}
