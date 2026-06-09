import { appDb, getOne, run } from "./db";
import { makeId, now } from "./utils";

type CaseUsageCaseItem = {
  id: string;
  group_id: string | null;
  user_id: string | null;
  image_id: string | null;
  asset_id: string | null;
  prompt: string;
  image_url: string;
};

export type CaseUsageSource = {
  sourceUserId: string;
  sourceType: "image" | "asset" | "url" | "case_group";
  sourceId: string;
};

export function caseUsageSourceFromCaseItem(item: {
  group_id?: string | null;
  user_id: string | null;
  image_id: string | null;
  asset_id: string | null;
  image_url: string;
}): CaseUsageSource {
  if (item.group_id) {
    const groupImageCount =
      getOne<{ total: number }>(appDb, "select count(*) as total from case_group_images where group_id = ?", item.group_id)?.total ?? 0;
    if (groupImageCount > 1) {
      return { sourceUserId: item.user_id ?? "", sourceType: "case_group", sourceId: item.group_id };
    }
  }
  if (item.image_id) {
    return { sourceUserId: item.user_id ?? "", sourceType: "image", sourceId: item.image_id };
  }
  if (item.asset_id) {
    return { sourceUserId: item.user_id ?? "", sourceType: "asset", sourceId: item.asset_id };
  }
  return { sourceUserId: item.user_id ?? "", sourceType: "url", sourceId: item.image_url };
}

export function caseUsageSourceKey(source: CaseUsageSource) {
  return [source.sourceUserId, source.sourceType, source.sourceId].join("\u001f");
}

export function recordCasePromptUsage({
  caseItemId,
  submittedPrompt,
  usedByUserId,
  jobId,
  requestType
}: {
  caseItemId: string;
  submittedPrompt: string;
  usedByUserId: string;
  jobId: string;
  requestType: "generation" | "edit";
}) {
  const normalizedCaseItemId = caseItemId.trim();
  if (!normalizedCaseItemId) return null;
  const item = getOne<CaseUsageCaseItem>(
    appDb,
    "select id, group_id, user_id, image_id, asset_id, prompt, image_url from case_items where id = ? or group_id = ? order by rowid asc limit 1",
    normalizedCaseItemId,
    normalizedCaseItemId
  );
  if (!item) return null;

  const source = caseUsageSourceFromCaseItem(item);
  if (!source.sourceId) return null;

  run(
    appDb,
    `insert or ignore into case_prompt_usage_events (
      id, case_item_id, source_user_id, source_type, source_id,
      original_prompt_snapshot, submitted_prompt, used_by_user_id,
      job_id, request_type, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("caseuse"),
    item.id,
    source.sourceUserId || null,
    source.sourceType,
    source.sourceId,
    item.prompt,
    submittedPrompt,
    usedByUserId,
    jobId,
    requestType,
    now()
  );

  return {
    caseItemId: item.id,
    source,
    originalPrompt: item.prompt
  };
}
