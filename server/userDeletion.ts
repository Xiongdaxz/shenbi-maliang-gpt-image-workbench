import { audit } from "./auditLog";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { deleteImageDerivativesForSources, imageDerivativePathsForSources, type ImageDerivativeSourceGroup } from "./imageDerivatives";
import { abortImageJobExecution } from "./imageJobCancellation";
import { deleteStoredFilesIfUnreferenced } from "./secureFiles";
import type { UserRow } from "./types";
import { now } from "./utils";

function uniquePaths(rows: Array<{ path: string | null }>) {
  return Array.from(new Set(rows.map((row) => String(row.path ?? "").trim()).filter(Boolean)));
}

function idsFrom(sql: string, ...params: string[]) {
  return getAll<{ id: string }>(appDb, sql, ...params).map((row) => row.id);
}

export function deleteAccountConfirmationText(user: Pick<UserRow, "username">) {
  return `${user.username.trim()}确认删除账户`;
}

export async function deleteUserAccount(userId: string) {
  const existing = getOne<UserRow>(appDb, "select * from users where id = ?", userId);
  if (!existing) return null;

  const runningJobIds = idsFrom("select id from image_jobs where user_id = ? and status = 'running'", userId);
  if (runningJobIds.length > 0) {
    run(
      appDb,
      "update image_jobs set status = 'cancelled', error = null, result_image_id = null, updated_at = ? where user_id = ? and status = 'running'",
      now(),
      userId
    );
    for (const jobId of runningJobIds) abortImageJobExecution(jobId);
  }

  const imageIds = idsFrom("select id from images where user_id = ?", userId);
  const assetIds = idsFrom("select id from assets where user_id = ?", userId);
  const imageReferenceIds = idsFrom(
    "select id from image_asset_references where user_id = ? or image_id in (select id from images where user_id = ?)",
    userId,
    userId
  );
  const messageSourceReferenceIds = idsFrom(
    "select id from message_source_references where user_id = ? or message_id in (select id from messages where user_id = ?)",
    userId,
    userId
  );
  const ownedTemplateIds = idsFrom("select id from prompt_templates where user_id = ?", userId);
  const derivativeSources: ImageDerivativeSourceGroup[] = [
    { sourceType: "image", sourceIds: imageIds },
    { sourceType: "asset", sourceIds: assetIds },
    { sourceType: "image-reference", sourceIds: imageReferenceIds },
    { sourceType: "message-source-reference", sourceIds: messageSourceReferenceIds }
  ];
  const pathsToDelete = uniquePaths([
    { path: existing.avatar_path },
    ...getAll<{ path: string }>(appDb, "select path from images where user_id = ?", userId),
    ...getAll<{ path: string }>(appDb, "select path from assets where user_id = ?", userId),
    ...getAll<{ path: string }>(
      appDb,
      "select path from image_asset_references where user_id = ? or image_id in (select id from images where user_id = ?)",
      userId,
      userId
    ),
    ...getAll<{ path: string }>(
      appDb,
      "select path from message_source_references where user_id = ? or message_id in (select id from messages where user_id = ?)",
      userId,
      userId
    ),
    ...imageDerivativePathsForSources(derivativeSources)
  ]);

  const deleteAppRecords = appDb.transaction(() => {
    run(appDb, "update images set parent_image_id = null where parent_image_id in (select id from images where user_id = ?)", userId);
    run(appDb, "update image_jobs set result_image_id = null where result_image_id in (select id from images where user_id = ?)", userId);
    run(appDb, "update image_asset_references set source_asset_id = null where source_asset_id in (select id from assets where user_id = ?)", userId);
    run(appDb, "update prompt_template_results set template_id = null where template_id in (select id from prompt_templates where user_id = ?) and user_id <> ?", userId, userId);

    if (ownedTemplateIds.length > 0) {
      const placeholders = ownedTemplateIds.map(() => "?").join(", ");
      run(appDb, `delete from prompt_template_form_drafts where template_id in (${placeholders})`, ...ownedTemplateIds);
      run(appDb, `delete from prompt_template_base_translations where template_id in (${placeholders})`, ...ownedTemplateIds);
      run(appDb, `delete from prompt_template_export_downloads where template_id in (${placeholders})`, ...ownedTemplateIds);
      run(appDb, `delete from prompt_template_export_revocations where template_id in (${placeholders})`, ...ownedTemplateIds);
    }
    run(appDb, "delete from prompt_template_default_seeds where user_id = ?", userId);
    run(appDb, "delete from prompt_template_results where user_id = ?", userId);
    run(appDb, "delete from prompt_template_form_drafts where user_id = ?", userId);
    run(appDb, "delete from prompt_template_base_translations where user_id = ?", userId);
    run(appDb, "delete from prompt_template_export_downloads where user_id = ?", userId);
    run(appDb, "delete from prompt_template_export_revocations where user_id = ?", userId);
    run(appDb, "delete from prompt_templates where user_id = ?", userId);

    run(appDb, "delete from case_prompt_usage_events where used_by_user_id = ? or source_user_id = ?", userId, userId);
    run(
      appDb,
      `delete from case_prompt_usage_events
       where case_item_id in (
         select id from case_items
         where user_id = ?
            or image_id in (select id from images where user_id = ?)
            or asset_id in (select id from assets where user_id = ?)
       )`,
      userId,
      userId,
      userId
    );
    run(appDb, "delete from case_favorites where user_id = ? or source_user_id = ?", userId, userId);
    run(
      appDb,
      "delete from case_group_images where user_id = ? or image_id in (select id from images where user_id = ?) or asset_id in (select id from assets where user_id = ?)",
      userId,
      userId,
      userId
    );
    run(
      appDb,
      "delete from case_items where user_id = ? or image_id in (select id from images where user_id = ?) or asset_id in (select id from assets where user_id = ?)",
      userId,
      userId,
      userId
    );
    run(appDb, "delete from image_favorites where user_id = ? or image_id in (select id from images where user_id = ?)", userId, userId);
    run(appDb, "delete from image_asset_references where user_id = ? or image_id in (select id from images where user_id = ?)", userId, userId);
    run(appDb, "delete from message_source_references where user_id = ? or message_id in (select id from messages where user_id = ?)", userId, userId);
    run(appDb, "delete from image_edit_suggestions where user_id = ? or image_id in (select id from images where user_id = ?)", userId, userId);
    run(appDb, "delete from asset_categories where asset_id in (select id from assets where user_id = ?)", userId);
    deleteImageDerivativesForSources(derivativeSources);
    run(appDb, "delete from images where user_id = ?", userId);
    run(appDb, "delete from assets where user_id = ?", userId);
    run(appDb, "delete from messages where user_id = ?", userId);
    run(appDb, "delete from image_jobs where user_id = ?", userId);
    run(appDb, "delete from sessions where user_id = ?", userId);
    run(appDb, "delete from search_history where user_id = ?", userId);
    run(appDb, "delete from prompt_color_schemes where user_id = ?", userId);
    run(appDb, "delete from user_preferences where user_id = ?", userId);
    run(appDb, "delete from user_auth_sessions where user_id = ?", userId);
    run(appDb, "delete from image_job_cancel_requests where user_id = ?", userId);
    if (existing.email) run(appDb, "delete from auth_verification_codes where target_type = 'email' and lower(target) = lower(?)", existing.email);
    if (existing.phone) run(appDb, "delete from auth_verification_codes where target_type = 'phone' and target = ?", existing.phone);
    run(appDb, "delete from users where id = ?", userId);
  });
  const deleteConfigRecords = configDb.transaction(() => {
    run(configDb, "delete from safety_review_logs where user_id = ?", userId);
    run(configDb, "delete from provider_request_logs where user_id = ?", userId);
    run(configDb, "delete from model_request_logs where user_id = ?", userId);
  });

  deleteAppRecords();
  deleteConfigRecords();
  await deleteStoredFilesIfUnreferenced(pathsToDelete);
  audit("user.delete", { userId, username: existing.username, account: existing.account });
  return existing;
}
