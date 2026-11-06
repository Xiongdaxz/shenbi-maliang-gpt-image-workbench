import { appDb, getOne, run } from "./db";
import { createProfileStore, creativeId, creativeNow, creativeText, jsonValue } from "./creativeProfiles";
import { createImageSetStore, type SetRunSnapshot } from "./imageSets";
import type { ProfileContext } from "../src/types";
import { normalizeIdList, now } from "./utils";

const profiles = createProfileStore(appDb), sets = createImageSetStore(appDb);
export type CreativeJobContext = { profile: ProfileContext | null; originalPrompt: string; setId: string; itemId: string; revision: number; contextRevision: number; itemRevision: number; existingJobId: string };
export function prepareCreativeJob(userId: string, body: Record<string, unknown>) {
  if (!body.profileSelection && !body.imageSetId) return { body, context: null };
  if (body.editIntent === "remove" && !body.imageSetId) return { body, context: null };
  const originalPrompt = creativeText(body.prompt);
  const setId = creativeText(body.imageSetId, 200), itemId = creativeText(body.imageSetItemId, 200);
  let profile = body.profileSelection ? profiles.resolve(userId, body.profileSelection) : null;
  let revision = 0, contextRevision = 0, itemRevision = 0, references = normalizeIdList(body.sourceReferenceIds), existingJobId = "";
  if (setId) {
    if (!creativeText(body.clientRequestId, 200)) throw new Error("套图编辑缺少请求标识");
    const set = sets.get(userId, setId), raw = sets.row(userId, setId), item = set.items.find(i => i.id === itemId);
    if (set.executionMode === "demo") throw new Error("模拟项目请使用套图页面的模拟修改；正式创作请先复制为正式项目");
    if (!item || !set.confirmed || set.archived) throw new Error("套图版位不存在、未确认或已归档");
    profiles.resolve(userId, set.profileSelection);
    const sources = normalizeIdList(body.sourceImageIds);
    if (sources.length !== 1 || !getOne(appDb, "select images.id from images join image_set_runs on images.job_id=image_set_runs.job_id where images.id=? and images.user_id=? and image_set_runs.set_id=? and image_set_runs.item_id=?", sources[0], userId, setId, itemId)) throw new Error("编辑来源不属于当前套图版位");
    existingJobId = getOne<{ job_id: string }>(appDb, "select job_id from image_set_runs where set_id=? and item_id=? and client_request_id=?", setId, itemId, creativeText(body.clientRequestId, 200))?.job_id || "";
    if (!existingJobId && set.activeCount) throw new Error("请先等待或停止正在运行的套图任务");
    if (itemId !== set.anchorItemId && !set.anchorCurrent) throw new Error("请先确认当前基准图");
    profile = set.snapshot; revision = set.revision; contextRevision = set.contextRevision; itemRevision = item.revision;
    if (body.editIntent !== "remove") references = [...references, ...jsonValue<string[]>(raw.reference_ids_json, []), ...(itemId !== set.anchorItemId && raw.anchor_reference_id ? [raw.anchor_reference_id] : [])];
  }
  const context: CreativeJobContext = { profile, originalPrompt, setId, itemId, revision, contextRevision, itemRevision, existingJobId };
  const sourceAssets = [...new Set([...normalizeIdList(body.sourceAssetIds), ...(setId || body.editIntent === "remove" ? [] : profile?.assets.map(a => a.assetId) ?? [])])];
  const sourceImages = normalizeIdList(body.sourceImageIds), uniqueReferences = [...new Set(references)];
  let instruction = profile?.instruction || "";
  if (profile?.assets.length) {
    const frozen = setId ? jsonValue<string[]>(sets.row(userId, setId).reference_ids_json, []) : [];
    const offset = sourceImages.length + sourceAssets.length + normalizeIdList(body.sourceCaseItemIds).length;
    const roles = profile.assets.map((a, index) => {
      const position = setId ? offset + uniqueReferences.indexOf(frozen[index]) + 1 : sourceImages.length + sourceAssets.indexOf(a.assetId) + 1;
      return `附图${position}：${a.role}${a.note ? `；${a.note}` : ""}`;
    });
    instruction = instruction.split("参考素材用途：")[0].trim() + "\n参考图片用途（按当前附件顺序）：\n" + roles.join("\n");
  }
  const prompt = instruction && body.editIntent !== "remove" ? [instruction, `本次创作／修改要求：\n${originalPrompt}`].join("\n\n") : originalPrompt;
  return { context, body: { ...body, prompt, sourceImageIds: normalizeIdList(body.sourceImageIds),
    sourceAssetIds: sourceAssets, sourceReferenceIds: uniqueReferences } };
}
export function creativeJobConflict(userId: string, context: CreativeJobContext | null) {
  if (!context?.setId) return "";
  const set = sets.get(userId, context.setId);
  return set.revision !== context.revision || set.activeCount || set.archived ? "套图已更新或开始运行，请刷新后重试" : "";
}
export function recordCreativeJob(userId: string, jobId: string, body: Record<string, unknown>, context: CreativeJobContext | null) {
  if (!context) return;
  const timestamp = creativeNow();
  run(appDb, "insert into image_job_profile_context (job_id,user_id,snapshot_json,created_at) values (?,?,?,?)", jobId, userId, JSON.stringify(context.profile), timestamp);
  const session = getOne<{ session_id: string }>(appDb, "select session_id from image_jobs where id=? and user_id=?", jobId, userId);
  if (session) run(appDb, "insert or replace into creative_session_context (session_id,user_id,selection_json) values (?,?,?)", session.session_id, userId, JSON.stringify(context.profile?.selection || {}));
  if (!context.setId) return;
  const job = getOne<{ request_json: string; session_id: string }>(appDb, "select request_json,session_id from image_jobs where id=? and user_id=?", jobId, userId)!;
  const payload = jsonValue<Record<string, unknown>>(job.request_json, {});
  const snapshot: SetRunSnapshot = { prompt: String(body.prompt), size: String(payload.size), providerId: String(body.providerId || ""), model: String(payload.model), quality: String(payload.quality), sessionId: job.session_id,
    referenceIds: normalizeIdList(body.sourceReferenceIds), existingEditJob: true, profileContext: context.profile, sourceImageId: normalizeIdList(body.sourceImageIds)[0] };
  run(appDb, `insert into image_set_runs (id,set_id,item_id,job_id,client_request_id,candidate_index,status,context_revision,item_revision,snapshot_json,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)`,
    creativeId("setrun"), context.setId, context.itemId, jobId, creativeText(body.clientRequestId, 200), 0, "running", context.contextRevision, context.itemRevision, JSON.stringify(snapshot), timestamp, timestamp);
  run(appDb, "update image_sets set stopped=0,finalized=0,updated_at=? where id=?", timestamp, context.setId);
}
