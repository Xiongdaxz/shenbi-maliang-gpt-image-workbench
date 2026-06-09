import { DEFAULT_IMAGE_SIZES, DEFAULT_RESPONSES_MODEL } from "./constants";
import { defaultTeamId } from "./categories";
import { normalizeAppearanceMode } from "./appearanceMode";
import { appDb, getAll, getOne } from "./db";
import { userPreferences } from "./userPreferences";
import type { ImageAccountRow, ImageAssetReferenceRow, ImageRow, RuntimeProviderRow, UserRow } from "./types";
import {
  inferChannelFromType,
  maskSecret,
  normalizeImageAccountStatus,
  normalizeProviderChannel,
  normalizeQuotaMode,
  normalizeRouteMode,
  normalizeWebAccountMode,
  parseJsonArray,
  safeJson
} from "./utils";

function parseCodexUsageWindows(value: string | null | undefined) {
  const parsed = safeJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const resetAt = typeof record.resetAt === "string" ? record.resetAt.trim() : "";
      const rawUsedPercent = record.usedPercent;
      const usedPercent =
        typeof rawUsedPercent === "number" && Number.isFinite(rawUsedPercent)
          ? rawUsedPercent
          : typeof rawUsedPercent === "string" && Number.isFinite(Number(rawUsedPercent))
            ? Number(rawUsedPercent)
            : null;
      if (!label || (usedPercent === null && !resetAt)) return null;
      return { label, usedPercent, resetAt };
    })
    .filter((item): item is { label: string; usedPercent: number | null; resetAt: string } => Boolean(item));
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function parseUsageRecentRequests(value: string | null | undefined) {
  const parsed = safeJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const bucket = typeof record.bucket === "string" ? record.bucket.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : bucket;
      return {
        bucket,
        label,
        success: numberFromUnknown(record.success),
        failure: numberFromUnknown(record.failure),
        total: numberFromUnknown(record.total)
      };
    })
    .filter((item): item is { bucket: string; label: string; success: number; failure: number; total: number } => Boolean(item));
}

export function toProvider(row: RuntimeProviderRow, includeSecret = false) {
  const channel = normalizeProviderChannel(row.channel || inferChannelFromType(row.type));
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    channel,
    enabled: Boolean(row.enabled),
    baseUrl: row.base_url,
    apiKeyEnv: row.api_key_env ?? "",
    apiKeyValue: includeSecret ? row.api_key_value ?? "" : maskSecret(row.api_key_value),
    routeMode: normalizeRouteMode(row.route_mode),
    generationPath: row.generation_path,
    editPath: row.edit_path,
    responsesPath: row.responses_path || "/v1/responses",
    model: row.model,
    responsesModel: String(row.responses_model || "").trim() || DEFAULT_RESPONSES_MODEL,
    sizes: parseJsonArray(row.sizes, DEFAULT_IMAGE_SIZES),
    qualities: parseJsonArray(row.qualities, ["high"]),
    defaultSize: row.default_size,
    defaultQuality: row.default_quality,
    responseImagePath: row.response_image_path,
    proxyEnabled: Boolean(row.proxy_enabled),
    quotaMode: normalizeQuotaMode(row.quota_mode),
    webAccountId: row.web_account_id ?? "",
    webAccountIds: parseJsonArray(row.web_account_ids, []),
    webAccountMode: normalizeWebAccountMode(row.web_account_mode),
    webCookies: includeSecret ? row.web_cookies ?? "" : maskSecret(row.web_cookies)
  };
}

export function toImageAccount(row: ImageAccountRow, includeSecret = false) {
  return {
    id: row.id,
    name: row.name,
    remoteName: row.remote_name ?? "",
    channelId: row.channel_id ?? "",
    email: row.email,
    accountType: row.account_type,
    status: normalizeImageAccountStatus(row.status),
    quota: row.quota,
    usedQuota: row.used_quota,
    remainingQuota: Math.max(0, row.quota - row.used_quota),
    usageSuccessCount: row.usage_success_count ?? 0,
    usageFailureCount: row.usage_failure_count ?? 0,
    usageRecentRequests: parseUsageRecentRequests(row.usage_recent_requests),
    localSuccessCount: row.local_success_count ?? 0,
    localFailureCount: row.local_failure_count ?? 0,
    localLastRequestAt: row.local_last_request_at ?? "",
    codex5hUsedPercent: row.codex_5h_used_percent,
    codex5hResetAt: row.codex_5h_reset_at ?? "",
    codexWeekUsedPercent: row.codex_week_used_percent,
    codexWeekResetAt: row.codex_week_reset_at ?? "",
    codexCreditsBalance: row.codex_credits_balance ?? "",
    codexCreditsUnlimited: Boolean(row.codex_credits_unlimited),
    codexUsageWindows: parseCodexUsageWindows(row.codex_usage_windows),
    codexUsageUpdatedAt: row.codex_usage_updated_at ?? "",
    codexUsageError: row.codex_usage_error ?? "",
    priority: row.priority,
    accessToken: includeSecret ? row.access_token ?? "" : maskSecret(row.access_token),
    hasAuthJson: Boolean(row.auth_json),
    authJson: includeSecret ? row.auth_json ?? "" : row.auth_json ? "******" : "",
    hasAuthInfoJson: Boolean(row.auth_info_json),
    authInfoJson: includeSecret ? row.auth_info_json ?? "" : row.auth_info_json ? "******" : "",
    note: row.note,
    syncStatus: row.sync_status,
    lastRefreshedAt: row.last_refreshed_at ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function imageUrlFromPath(filePath: string) {
  return `/${filePath.replaceAll("\\", "/")}`;
}

type ImageUrlVariant = "original" | "preview" | "thumb";

function withImageVariant(url: string, variant: ImageUrlVariant) {
  return variant === "original" ? url : `${url}?variant=${variant}`;
}

export function imageUrlFromImageId(imageId: string, variant: ImageUrlVariant = "original") {
  return withImageVariant(`/api/files/images/${encodeURIComponent(imageId)}`, variant);
}

export function assetUrlFromAssetId(assetId: string, variant: ImageUrlVariant = "original") {
  return withImageVariant(`/api/files/assets/${encodeURIComponent(assetId)}`, variant);
}

export function imageReferenceUrlFromId(referenceId: string, variant: ImageUrlVariant = "original") {
  return withImageVariant(`/api/files/image-references/${encodeURIComponent(referenceId)}`, variant);
}

export function publicImage(row: ImageRow) {
  const originalUrl = imageUrlFromImageId(row.id);
  return {
    id: row.id,
    sessionId: row.session_id,
    jobId: row.job_id,
    url: originalUrl,
    originalUrl,
    previewUrl: imageUrlFromImageId(row.id, "preview"),
    thumbnailUrl: imageUrlFromImageId(row.id, "thumb"),
    prompt: row.prompt,
    originPrompt: row.prompt,
    suggestedCaseTitle: row.suggested_case_title ?? "",
    suggestedCaseCategoryIds: parseJsonArray(row.suggested_case_category_ids_json, []),
    suggestedAssetName: row.suggested_case_title ?? "",
    suggestedAssetCategoryIds: parseJsonArray(row.suggested_asset_category_ids_json, []),
    kind: row.kind,
    size: row.size,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageFileSize: row.image_file_size,
    quality: row.quality,
    providerId: row.provider_id,
    parentImageId: row.parent_image_id,
    favoriteCount: 0,
    favorited: false,
    createdAt: row.created_at
  };
}

export function publicImageReference(row: ImageAssetReferenceRow) {
  const originalUrl = imageReferenceUrlFromId(row.id);
  return {
    id: row.id,
    sourceType: row.source_type || null,
    sourceId: row.source_id,
    sourceAssetId: row.source_asset_id,
    sourceCaseItemId: row.source_case_item_id,
    name: row.source_name,
    url: originalUrl,
    originalUrl,
    previewUrl: imageReferenceUrlFromId(row.id, "preview"),
    thumbnailUrl: imageReferenceUrlFromId(row.id, "thumb"),
    mimeType: row.mime_type,
    size: row.size,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    createdAt: row.created_at
  };
}

export function imageReferencesByImageIds(imageIds: string[]) {
  const uniqueImageIds = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  const references = new Map<string, ReturnType<typeof publicImageReference>[]>();
  if (uniqueImageIds.length === 0) return references;
  const rows = getAll<ImageAssetReferenceRow>(
    appDb,
    `select * from image_asset_references
     where image_id in (${uniqueImageIds.map(() => "?").join(", ")})
     order by sort_order asc, created_at asc, id asc`,
    ...uniqueImageIds
  );
  for (const row of rows) {
    const group = references.get(row.image_id) ?? [];
    group.push(publicImageReference(row));
    references.set(row.image_id, group);
  }
  return references;
}

export function imageOriginPromptsByImageIds(imageIds: string[]) {
  const uniqueImageIds = Array.from(new Set(imageIds.map((id) => id.trim()).filter(Boolean)));
  const prompts = new Map<string, string>();
  if (uniqueImageIds.length === 0) return prompts;
  const rows = getAll<{ start_id: string; origin_prompt: string }>(
    appDb,
    `with recursive image_prompt_chain(start_id, id, parent_image_id, prompt, kind, depth, path) as (
       select id, id, parent_image_id, prompt, kind, 0, '|' || id || '|'
       from images
       where id in (${uniqueImageIds.map(() => "?").join(", ")})
       union all
       select image_prompt_chain.start_id, parent.id, parent.parent_image_id,
              parent.prompt, parent.kind, image_prompt_chain.depth + 1,
              image_prompt_chain.path || parent.id || '|'
       from image_prompt_chain
       join images parent on parent.id = image_prompt_chain.parent_image_id
       where image_prompt_chain.depth < 20
         and instr(image_prompt_chain.path, '|' || parent.id || '|') = 0
     ),
     ranked as (
       select start_id, prompt,
              row_number() over (
                partition by start_id
                order by
                  case when kind = 'generation' then 0 when parent_image_id is null then 1 else 2 end,
                  depth desc
              ) as rn
       from image_prompt_chain
     )
     select start_id, prompt as origin_prompt
     from ranked
     where rn = 1`,
    ...uniqueImageIds
  );
  for (const row of rows) prompts.set(row.start_id, row.origin_prompt);
  return prompts;
}

export function publicImageWithReferences(
  row: ImageRow,
  references: Map<string, ReturnType<typeof publicImageReference>[]>,
  originPrompts?: Map<string, string>
) {
  return {
    ...publicImage(row),
    originPrompt: originPrompts?.get(row.id) ?? row.prompt,
    referenceImages: references.get(row.id) ?? []
  };
}

export function publicImagesWithReferences(rows: ImageRow[], references: Map<string, ReturnType<typeof publicImageReference>[]>) {
  const originPrompts = imageOriginPromptsByImageIds(rows.map((row) => row.id));
  return rows.map((row) => publicImageWithReferences(row, references, originPrompts));
}

export function publicUser(row: UserRow) {
  const account = row.account?.trim() || row.username;
  const teamId = row.team_id ?? defaultTeamId();
  const team = getOne<{ name: string }>(appDb, "select name from teams where id = ?", teamId);
  const avatarVersion = row.updated_at || row.created_at || "";
  return {
    id: row.id,
    account,
    username: row.username,
    email: row.email ?? "",
    phone: row.phone ?? "",
    teamId,
    teamName: team?.name ?? "默认团队",
    avatarUrl: row.avatar_path ? `/api/files/user-avatar/${encodeURIComponent(row.id)}?v=${encodeURIComponent(avatarVersion)}` : "",
    appearanceMode: normalizeAppearanceMode(row.appearance_mode),
    preferences: userPreferences(row.id),
    hasConfigAccess: Boolean(row.has_config_access)
  };
}
