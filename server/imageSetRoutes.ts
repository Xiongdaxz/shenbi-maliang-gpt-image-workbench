import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { isConfigAuthed, requireUser } from "./auth";
import { audit } from "./auditLog";
import { appDb, getAll, getOne, run } from "./db";
import { createProfileStore, CreativeInputError, creativeId, creativeIds, creativeNow, creativeText, jsonValue, recordValue, normalizeProfileAssets, normalizeProductVariants } from "./creativeProfiles";
import { createImageSetStore, normalizeSetItems, type SetRunRow, type SetRunSnapshot } from "./imageSets";
import { ensureCompleteCatalogExample } from "./creativeExampleFlow";
import { ensureCreativeDefaults, restoreCreativeDefaults } from "./creativeDefaults";
import { CREATIVE_EXAMPLE_CATALOG, creativeExampleDefinition } from "./creativeExampleCatalog";
import { creativeExampleAssetPath } from "./creativeExampleArtwork";
import { validateDemoSize } from "./imageSetDemo";
import { executeImageSetRun, imageSetProvidersFor } from "./imageRoutes";
import { abortImageJobExecution } from "./imageJobCancellation";
import { emitImageJobEvent } from "./imageJobEvents";
import { snapshotMessageSourceReferences, type MessageSourceReferenceInput } from "./messageSourceReferences";
import { insertMessage } from "./chatStore";
import { imageGenerationSettings } from "./settingsStore";
import { requestCreativeImagePlan } from "./imagePromptPlan";
import { publicImagesWithReferences } from "./serializers";
import { imageExtensionFromMime } from "./imageFiles";
import { readStoredFile } from "./secureFiles";
import { now } from "./utils";
import type { AssetRow, ImageRow, UserRow } from "./types";
import type { CreativeProfileKind, ImageSet, ProfileContext } from "../src/types";

export const profileStore = createProfileStore(appDb);
const setStore = createImageSetStore(appDb, rows => publicImagesWithReferences(rows as ImageRow[], new Map()));
const executions = new Set<string>();
let schedulerStarted = false;

function jobStatus(runRow: SetRunRow) {
  return getOne<{ status: string; error: string | null }>(appDb, "select status,error from image_jobs where id=?", runRow.job_id);
}
function reconcileRuns() {
  for (const r of getAll<SetRunRow>(appDb, "select * from image_set_runs where status='running' and not exists(select 1 from creative_example_seeds s where s.set_id=image_set_runs.set_id and s.completion_state='building')")) {
    const job = jobStatus(r);
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) {
      run(appDb, "update image_set_runs set status=?,error=?,updated_at=? where id=? and status='running'", job.status, job.error || "", creativeNow(), r.id);
      run(appDb, "update image_sets set updated_at=? where id=?", creativeNow(), r.set_id);
    } else if (!executions.has(r.id) && (!job || job.status === "running" && getOne(appDb, "select id from image_sets where id=? and execution_mode='demo'", r.set_id))) {
      const snapshot = jsonValue<SetRunSnapshot>(r.snapshot_json, {} as SetRunSnapshot);
      if (snapshot.existingEditJob) run(appDb, "update image_set_runs set status='failed',error='原编辑任务已删除，请重新提交编辑' where id=? and status='running'", r.id);
      else run(appDb, "update image_set_runs set status='queued' where id=? and status='running'", r.id);
    }
  }
}
export function startImageSetScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const pump = () => {
    try {
      reconcileRuns();
      const active = getOne<{ n: number }>(appDb, "select count(*) as n from image_set_runs where status='running'")?.n ?? 0;
      const available = Math.max(0, imageGenerationSettings().multiImageConcurrency - Math.max(active, executions.size));
      const pending = getAll<SetRunRow & { user_id: string }>(appDb, `select image_set_runs.*,image_sets.user_id from image_set_runs
        join image_sets on image_sets.id=image_set_runs.set_id where image_set_runs.status='queued' and image_sets.stopped=0 and image_sets.archived=0
        and not exists(select 1 from creative_example_seeds s where s.set_id=image_sets.id and s.completion_state='building') order by image_set_runs.created_at,image_set_runs.rowid limit ?`, available);
      for (const r of pending) {
        if (executions.has(r.id)) continue;
        const claim = run(appDb, "update image_set_runs set status='running',updated_at=? where id=? and status='queued'", creativeNow(), r.id);
        if (!claim.changes) continue;
        executions.add(r.id);
        const activeRun = () => Boolean(getOne(appDb, "select id from image_set_runs where id=? and status='running'", r.id));
        const user = getOne<UserRow>(appDb, "select * from users where id=? and disabled=0", r.user_id);
        const execute = user ? executeImageSetRun(user.id, r, jsonValue<SetRunSnapshot>(r.snapshot_json, {} as SetRunSnapshot), activeRun) : Promise.reject(new Error("用户不可用"));
        void execute.catch(error => {
          const message = error instanceof Error ? error.message : "套图任务执行失败";
          run(appDb, "update image_set_runs set status='failed',error=?,updated_at=? where id=? and status='running'", message, creativeNow(), r.id);
          run(appDb, "update image_jobs set status='failed',error=?,updated_at=? where id=? and status='running'", message, now(), r.job_id);
        }).finally(() => { executions.delete(r.id); reconcileRuns(); });
      }
    } catch (error) { console.warn("套图调度失败", error); }
  };
  pump();
  setInterval(pump, 750).unref();
}
function stopSet(user: UserRow, id: string) {
  for (const r of setStore.stop(user.id, id)) {
    const job = getOne<{ session_id: string }>(appDb, "select session_id from image_jobs where id=? and user_id=? and status='running'", r.job_id, user.id);
    if (!job) continue;
    run(appDb, "update image_jobs set status='cancelled',updated_at=? where id=? and status='running'", now(), r.job_id);
    abortImageJobExecution(r.job_id);
    emitImageJobEvent(user.id, { jobId: r.job_id, sessionId: job.session_id, status: "cancelled", updatedAt: now() });
  }
  return setStore.get(user.id, id);
}
function createSetSession(userId: string, set: ImageSet) {
  const existing = setStore.row(userId, set.id).session_id;
  if (existing && getOne(appDb, "select id from sessions where id=? and user_id=? and deleted_at is null", existing, userId)) return existing;
  const id = creativeId("chat"), timestamp = now();
  run(appDb, "insert into sessions (id,user_id,title,title_status,created_at,updated_at) values (?,?,?,?,?,?)", id, userId, set.name, "manual", timestamp, timestamp);
  return id;
}
async function freezeAssets(userId: string, sessionId: string, label: string, ids: string[]) {
  profileStore.validateAssets(userId, ids.map(assetId => ({ assetId, role: "identity", note: "" })));
  const assets = ids.map(id => getOne<AssetRow>(appDb, "select * from assets where id=?", id)!);
  const sources: MessageSourceReferenceInput[] = assets.map(a => ({ sourceType: "asset", sourceId: a.id, name: a.name, path: a.path,
    mimeType: a.mime_type, size: a.size, imageWidth: a.image_width, imageHeight: a.image_height }));
  const messageId = insertMessage(userId, sessionId, "user", label, null, { imageSetReferenceSnapshot: true });
  const refs = await snapshotMessageSourceReferences({ userId, sessionId, messageId, jobId: "", sources });
  return refs.map(r => r.sourceReferenceId);
}
async function freezeAnchor(userId: string, set: ImageSet, imageId: string) {
  const image = getOne<ImageRow>(appDb, `select images.* from images join image_set_runs on image_set_runs.job_id=images.job_id where images.id=? and images.user_id=? and image_set_runs.set_id=? and image_set_runs.item_id=?`, imageId, userId, set.id, set.anchorItemId);
  if (!image) throw new CreativeInputError("基准图片不属于当前版位", 404);
  const sessionId = createSetSession(userId, set), messageId = insertMessage(userId, sessionId, "user", "基准图快照", null, { imageSetReferenceSnapshot: true });
  const refs = await snapshotMessageSourceReferences({ userId, sessionId, messageId, jobId: "", sources: [{ sourceType: "image", sourceId: image.id, name: "基准图 · 仅参考视觉风格", path: image.path,
    mimeType: image.mime_type, size: image.image_file_size, imageWidth: image.image_width, imageHeight: image.image_height }] });
  return refs[0]?.sourceReferenceId || "";
}
function guarded(handler: (c: Context, user: UserRow, body: Record<string, unknown>) => Promise<Response> | Response) {
  return async (c: Context) => {
    const user = await requireUser(c); if (!user) return c.json({ error: "未登录" }, 401);
    try { return await handler(c, user, recordValue(await c.req.json().catch(() => ({})))); }
    catch (error) {
      if (!(error instanceof CreativeInputError)) console.warn("套图操作失败", error);
      return c.json({ error: error instanceof Error ? error.message : "操作失败" }, (error instanceof CreativeInputError ? error.status : 500) as ContentfulStatusCode);
    }
  };
}
function validateSet(userId: string, body: Record<string, unknown>) {
  body.profileSelection = profileStore.resolve(userId, body.profileSelection).selection;
  profileStore.validateAssets(userId, creativeIds(body.assetIds).map(assetId => ({ assetId, role: "identity", note: "" })));
}

async function exportSet(userId: string, set: ImageSet, partial: boolean) {
  if (!partial && (!set.finalized || set.selectedCount !== set.items.length)) throw new CreativeInputError("请先整套定稿，或选择导出已采用部分", 409);
  const selected = set.items.filter(i => i.selectedImageId && i.selectionCurrent);
  if (!selected.length) throw new CreativeInputError("尚未采用图片");
  const files: Array<{ buffer: Buffer; name: string }> = [], manifest: unknown[] = [];
  let bytes = 0;
  for (const item of selected) {
    const image = getOne<ImageRow>(appDb, "select * from images where id=? and user_id=?", item.selectedImageId, userId);
    if (!image) throw new CreativeInputError("采用图片已删除，请重新选稿", 409);
    const buffer = await readStoredFile(image.path); bytes += buffer.length;
    if (bytes > 200 * 1024 * 1024) throw new CreativeInputError("本次导出超过 200 MB，请分批下载");
    const label = item.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80);
    const name = `${String(set.items.findIndex(i => i.id === item.id) + 1).padStart(2, "0")}_${label}_${image.image_width}x${image.image_height}.${imageExtensionFromMime(image.mime_type).replace(/^\./, "")}`;
    files.push({ buffer, name }); manifest.push({ name, itemId: item.id, imageId: image.id, targetSize: item.size, actualSize: `${image.image_width}x${image.image_height}` });
  }
  const archive = new ZipArchive({ zlib: { level: 3 } }), output = new PassThrough(), chunks: Buffer[] = [];
  archive.on("error", error => output.destroy(error)); archive.pipe(output);
  files.forEach(f => archive.append(f.buffer, { name: f.name }));
  archive.append(JSON.stringify({ name: set.name, complete: selected.length === set.items.length, images: manifest }, null, 2), { name: "manifest.json" });
  const completion = archive.finalize();
  for await (const chunk of output) chunks.push(Buffer.from(chunk));
  await completion;
  return new Response(Buffer.concat(chunks), { headers: { "content-type": "application/zip", "cache-control": "no-store", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(set.name + ".zip")}` } });
}

export function registerImageSetRoutes(api: Hono, seriesCreationAvailable: boolean) {
  for (const [path, kind] of [["brands", "brand"], ["products", "product"]] as const) {
    api.get(`/${path}`, guarded(async (c, u) => {
      if (seriesCreationAvailable) await ensureCreativeDefaults(u.id);
      return c.json(profileStore.list(u.id, kind, c.req.query("keyword"), c.req.query("archived") === "1", c.req.query("cursor")));
    }));
    api.get(`/${path}/:id`, guarded((c, u) => c.json({ profile: profileStore.readable(u.id, profileStore.get(u.id, (c.req.param("id") || ""), kind)) })));
    api.post(`/${path}`, guarded((c, u, b) => c.json({ profile: profileStore.save(u.id, kind, b) }, 201)));
    api.delete(`/${path}/:id`, guarded((c, u, b) => c.json(profileStore.remove(u.id, c.req.param("id") || "", Number(b.revision), kind))));
    api.put(`/${path}/:id`, guarded((c, u, b) => {
      const old = profileStore.get(u.id, c.req.param("id") || "", kind);
      if (old.ownerId !== u.id) {
        if (!old.shared || !u.has_config_access || !isConfigAuthed(c)) throw new CreativeInputError("需要配置管理权限与登录状态才能维护他人的共享档案", 403);
        profileStore.validateAssets(u.id, [...normalizeProfileAssets(b.assets), ...normalizeProductVariants(b.variants).flatMap(v => v.assets)]);
        if (b.brandId) profileStore.get(u.id, String(b.brandId), "brand");
      }
      const profile = profileStore.save(old.ownerId, kind, b, old.id);
      audit("creative.profile.updated", { actorId: u.id, ownerId: old.ownerId, profileId: old.id, revision: profile.revision });
      return c.json({ profile });
    }));
    api.post(`/${path}/:id/copy`, guarded((c, u) => {
      const p = profileStore.readable(u.id, profileStore.get(u.id, (c.req.param("id") || ""), kind));
      return c.json({ profile: profileStore.save(u.id, kind as CreativeProfileKind, { ...p, name: `${p.name} · 副本`, shared: false, archived: false }) }, 201);
    }));
    api.get(`/${path}/:id/images`, guarded((c, u) => {
      const profile = profileStore.readable(u.id, profileStore.get(u.id, c.req.param("id") || "", kind));
      const rows = getAll<ImageRow>(appDb, `select images.* from images join image_job_profile_context on image_job_profile_context.job_id=images.job_id
        where images.user_id=? and json_extract(image_job_profile_context.snapshot_json,?)=? and (?='' or images.id<?) order by images.id desc limit 31`,
        u.id, kind === "brand" ? "$.brand.id" : "$.product.id", profile.id, c.req.query("cursor") || "", c.req.query("cursor") || "");
      return c.json({ items: publicImagesWithReferences(rows.slice(0, 30), new Map()), nextCursor: rows.length > 30 ? rows[29].id : null });
    }));
  }
  api.post("/profiles/resolve", guarded((c, u, b) => c.json({ context: profileStore.resolve(u.id, b) })));
  api.get("/sessions/:id/creative-profile", guarded((c, u) => {
    if (!getOne(appDb, "select id from sessions where id=? and user_id=? and deleted_at is null", c.req.param("id") || "", u.id)) throw new CreativeInputError("对话不存在", 404);
    const row = getOne<{ selection_json: string }>(appDb, "select selection_json from creative_session_context where session_id=? and user_id=?", c.req.param("id") || "", u.id);
    return c.json({ selection: jsonValue(row?.selection_json, {}) });
  }));
  api.put("/sessions/:id/creative-profile", guarded((c, u, b) => {
    if (!getOne(appDb, "select id from sessions where id=? and user_id=? and deleted_at is null", c.req.param("id") || "", u.id)) throw new CreativeInputError("对话不存在", 404);
    const context = profileStore.resolve(u.id, b);
    run(appDb, "insert or replace into creative_session_context (session_id,user_id,selection_json) values (?,?,?)", c.req.param("id") || "", u.id, JSON.stringify(context.selection));
    return c.json({ selection: context.selection });
  }));
  if (!seriesCreationAvailable) {
    api.all("/image-sets", c => c.notFound());
    api.all("/image-sets/*", c => c.notFound());
    return;
  }
  api.post("/image-sets/examples", guarded(async (c, u, b) => {
    const requestId = creativeText(b.clientRequestId, 200);
    if (!requestId) throw new CreativeInputError("示例请求标识不能为空");
    const definition = creativeExampleDefinition(b.templateId === undefined ? "tea" : b.templateId);
    if (!definition) throw new CreativeInputError("请选择有效的品牌示例");
    const example = await ensureCompleteCatalogExample(u.id, definition.id, requestId);
    return c.json({ example }, example.created ? 201 : 200);
  }));
  api.get("/image-sets/example-catalog", guarded(c => c.json({ items: Object.values(CREATIVE_EXAMPLE_CATALOG).map(({id,name,category,subtitle})=>({id,name,category,subtitle,previewUrl:`/api/image-sets/example-catalog/${id}/preview`})) })));
  api.get("/image-sets/example-catalog/:templateId/preview", guarded(c => {
    const definition = creativeExampleDefinition(c.req.param("templateId")); if (!definition) throw new CreativeInputError("示例不存在",404);
    return new Response(Bun.file(creativeExampleAssetPath(definition.id,"hero")),{headers:{"content-type":"image/webp","cache-control":"private, max-age=86400"}});
  }));
  api.post("/image-sets/restore-defaults", guarded(async (c, u, b) => c.json({ restored: await restoreCreativeDefaults(u.id, b.clientRequestId) })));
  api.get("/image-sets", guarded(async (c, u) => { await ensureCreativeDefaults(u.id); reconcileRuns(); return c.json(setStore.list(u.id, c.req.query("keyword"), c.req.query("archived") === "1", c.req.query("cursor"), c.req.query("brandId"), c.req.query("stage"))); }));
  api.post("/image-sets", guarded((c, u, b) => { validateSet(u.id, b); return c.json({ set: setStore.save(u.id, b) }, 201); }));
  api.get("/image-sets/:id", guarded((c, u) => { reconcileRuns(); return c.json({ set: setStore.get(u.id, (c.req.param("id") || "")) }); }));
  api.put("/image-sets/:id", guarded((c, u, b) => { validateSet(u.id, b); return c.json({ set: setStore.save(u.id, b, (c.req.param("id") || "")) }); }));
  api.delete("/image-sets/:id", guarded((c, u, b) => c.json(setStore.remove(u.id, c.req.param("id") || "", Number(b.revision)))));
  api.post("/image-sets/:id/archive", guarded((c, u, b) => c.json({ set: setStore.archive(u.id, (c.req.param("id") || ""), b.archived === true) })));
  api.post("/image-sets/:id/copy", guarded((c, u) => {
    const old = setStore.get(u.id, (c.req.param("id") || "")); validateSet(u.id, old as unknown as Record<string, unknown>);
    const items = old.items.map(i => ({ ...i, id: creativeId("slot") }));
    return c.json({ set: setStore.save(u.id, { ...old, name: `${old.name} · 副本`, items, anchorItemId: items[old.items.findIndex(i => i.id === old.anchorItemId)]?.id || items[0].id }) }, 201);
  }));
  api.post("/image-sets/:id/demo-start", guarded((c, u, b) => {
    const old = setStore.get(u.id, c.req.param("id") || ""), requestId = creativeText(b.clientRequestId, 200);
    if (old.executionMode !== "demo" || !requestId) throw new CreativeInputError("请从模拟示例开始体验");
    const key = `try:${old.id}:${requestId}`;
    const previous = getOne<{ set_id: string }>(appDb, "select set_id from creative_example_seeds where user_id=? and seed_key=?", u.id, key);
    if (previous) return c.json({ set: setStore.get(u.id, previous.set_id) });
    validateSet(u.id, old as unknown as Record<string, unknown>);
    const items = old.items.map(i => ({ ...i, id: creativeId("slot") }));
    const next = appDb.transaction(() => {
      const created = setStore.save(u.id, { ...old, name: `${old.name} · 从头体验`, items, anchorItemId: items[old.items.findIndex(i => i.id === old.anchorItemId)]?.id || items[0].id });
      run(appDb, "update image_sets set is_example=1,execution_mode='demo',demo_template=? where id=? and user_id=?", old.demoTemplate||"", created.id, u.id);
      run(appDb, "insert into creative_example_seeds (user_id,seed_key,brand_id,product_id,set_id,created_at,completion_state) values (?,?,?,?,?,?,'skipped')", u.id, key, old.profileSelection.brandId || "", old.profileSelection.productId || "", created.id, creativeNow());
      return setStore.get(u.id, created.id);
    }).immediate();
    return c.json({ set: next }, 201);
  }));
  api.post("/image-sets/:id/items/:itemId/demo-edit", guarded((c, u, b) => {
    const set = setStore.get(u.id, c.req.param("id") || "");
    if (set.executionMode !== "demo") throw new CreativeInputError("此操作仅用于模拟项目");
    const copy = creativeText(b.copy, 120), color = creativeText(b.color, 20);
    if (!copy || !creativeText(b.sourceImageId, 200) || !["sage", "cream", "forest"].includes(color)) throw new CreativeInputError("请选择来源图片、输入模拟画面标题并选择配色");
    profileStore.resolve(u.id, set.profileSelection);
    return c.json({ set: setStore.enqueue(u.id, set.id, [c.req.param("itemId") || ""], creativeText(b.clientRequestId, 200), 1, creativeText(b.sourceImageId, 200), { copy, color: color as "sage" | "cream" | "forest" }) }, 202);
  }));
  api.post("/image-sets/:id/items/:itemId/demo-style", guarded((c, u, b) => {
    const set = setStore.get(u.id, c.req.param("id") || ""), style = creativeText(b.style, 20);
    if (set.executionMode !== "demo") throw new CreativeInputError("此操作仅用于模拟项目", 403);
    if (style !== "airy" && style !== "dark" && style !== "editorial") throw new CreativeInputError("请选择有效的演示样式");
    profileStore.resolve(u.id, set.profileSelection);
    return c.json(setStore.demoStyle(u.id, set.id, c.req.param("itemId") || "", style, creativeText(b.clientRequestId, 200)), 202);
  }));
  api.post("/image-sets/:id/items/:itemId/demo-failure", guarded((c, u, b) => {
    const set = setStore.get(u.id, c.req.param("id") || "");
    if (set.executionMode !== "demo") throw new CreativeInputError("此操作仅用于模拟项目");
    profileStore.resolve(u.id, set.profileSelection);
    return c.json({ set: setStore.enqueue(u.id, set.id, [c.req.param("itemId") || ""], creativeText(b.clientRequestId, 200), 1, "", { failOnce: true }) }, 202);
  }));
  api.post("/image-sets/:id/plan", guarded(async (c, u, b) => {
    const set = setStore.get(u.id, (c.req.param("id") || "")); if (set.activeCount || set.archived) throw new CreativeInputError("请先停止任务并恢复项目", 409);
    const context = profileStore.resolve(u.id, set.profileSelection);
    if (set.executionMode === "demo") {
      const items = set.items.map(i => ({ ...i, purpose: i.purpose || `展示${i.name}的核心信息`, copy: i.copy || set.name, composition: i.composition || "标题、协作看板与留白构成清晰的视觉层次。" }));
      return c.json({ set: setStore.save(u.id, { ...set, commonStyle: set.commonStyle || "鼠尾草绿、奶油白与深绿，简洁栅格与统一字体层级。", items }, set.id) });
    }
    const raw = await requestCreativeImagePlan([{ role: "system", content: "你是按实际使用场景策划套图的视觉设计师。先依据用户的发布渠道、受众和需求，明确每张图要帮助用户看清什么、了解什么。产品广告突出产品与使用场景，软件展示突出可读界面与功能关系，饮品上新突出饮品与原料，空间展示突出完整摄影和必要设计说明。各版位分别设计信息内容和构图，共同风格统一品牌识别而不强制相同排版。不要默认使用小照片、泛泛口号和大片空白；明确要求极简或留白时尊重用户。copy仅写本图需要的可见文案，纯图片展示可为空；composition具体描述主体、场景、信息分布和必要细节。按确认事实编写，禁止虚构价格、日期、卖点、成绩和认证。只返回JSON {commonStyle:string,items:[{id,name,purpose,copy,size,composition}]}。保持提供的版位id、数量和尺寸。语言跟随用户需求。参考图片用途和产品身份需保留。" },
      { role: "user", content: JSON.stringify({ brief: set.brief, commonStyle: set.commonStyle, context: context.instruction, items: set.items.map(({ id, name, purpose, copy, size, composition }) => ({ id, name, purpose, copy, size, composition })), language: creativeText(b.language, 30) }) }], u.id, c.req.raw.signal);
    const parsed = recordValue(jsonValue(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""), null));
    const items = normalizeSetItems(parsed.items);
    if (items.length !== set.items.length || items.some((i, index) => i.id !== set.items[index].id || i.size !== set.items[index].size)) throw new CreativeInputError("规划结果与版位不匹配，原方案已保留");
    return c.json({ set: setStore.save(u.id, { ...set, commonStyle: creativeText(parsed.commonStyle) || set.commonStyle, items }, set.id) });
  }));
  api.post("/image-sets/:id/confirm-plan", guarded(async (c, u, b) => {
    const set = setStore.get(u.id, (c.req.param("id") || ""));
    if (set.activeCount || set.archived || Number(b.revision) !== set.revision) throw new CreativeInputError("项目已变化，请刷新后重新确认", 409);
    const context = profileStore.resolve(u.id, set.profileSelection), ids = [...new Set([...context.assets.map(a => a.assetId), ...set.assetIds])];
    for (const item of set.items) {
      if (set.executionMode === "demo") validateDemoSize(item.size);
      else imageSetProvidersFor({ providerId: set.providerId, model: set.model, quality: set.quality, size: item.size, referenceIds: ids.length || item.id !== set.anchorItemId ? ["required"] : [] });
    }
    if (ids.length > 20) throw new CreativeInputError("请将本次参考素材减少到 20 张以内");
    const sessionId = createSetSession(u.id, set), referenceIds = await freezeAssets(u.id, sessionId, "套图方案参考快照", ids);
    const confirmed = setStore.confirm(u.id, set.id, set.revision, context, referenceIds, sessionId);
    return c.json({ set: setStore.enqueue(u.id, set.id, [confirmed.anchorItemId], creativeText(b.clientRequestId, 200), 2) }, 202);
  }));
  const selection = guarded(async (c, u, b) => {
    const set = setStore.get(u.id, (c.req.param("id") || "")), itemId = (c.req.param("itemId") || "") || set.anchorItemId, imageId = creativeText(b.imageId, 200);
    const anchorReferenceId = itemId === set.anchorItemId ? await freezeAnchor(u.id, set, imageId) : "";
    if (setStore.get(u.id, set.id).revision !== set.revision) throw new CreativeInputError("项目已变化，请重新选择", 409);
    return c.json({ set: setStore.select(u.id, set.id, itemId, imageId, b.acknowledgeSize === true, anchorReferenceId) });
  });
  api.post("/image-sets/:id/anchor", selection);
  api.put("/image-sets/:id/items/:itemId/selection", selection);
  api.post("/image-sets/:id/generate", guarded((c, u, b) => {
    const set = setStore.get(u.id, (c.req.param("id") || "")); profileStore.resolve(u.id, set.profileSelection);
    const ids = set.items.filter(i => i.id !== set.anchorItemId && !i.selectionCurrent && !i.runs.some(r => r.contextRevision === set.contextRevision && r.itemRevision === i.revision && r.images.length > 0)).map(i => i.id);
    return c.json({ set: ids.length ? setStore.enqueue(u.id, set.id, ids, creativeText(b.clientRequestId, 200)) : set }, 202);
  }));
  api.post("/image-sets/:id/items/:itemId/generate", guarded((c, u, b) => {
    const set = setStore.get(u.id, (c.req.param("id") || "")); profileStore.resolve(u.id, set.profileSelection);
    return c.json({ set: setStore.enqueue(u.id, set.id, [(c.req.param("itemId") || "")], creativeText(b.clientRequestId, 200), (c.req.param("itemId") || "") === set.anchorItemId ? 2 : 1, creativeText(b.sourceImageId, 200)) }, 202);
  }));
  api.post("/image-sets/:id/stop", guarded((c, u) => c.json({ set: stopSet(u, (c.req.param("id") || "")) })));
  api.post("/image-sets/:id/runs/:runId/retry", guarded((c, u) => {
    const set = setStore.get(u.id, c.req.param("id") || ""); profileStore.resolve(u.id, set.profileSelection);
    const previous = getOne<SetRunRow>(appDb, "select * from image_set_runs where id=? and set_id=?", c.req.param("runId") || "", set.id);
    if (!previous) throw new CreativeInputError("任务不存在", 404);
    const snapshot = jsonValue<SetRunSnapshot>(previous.snapshot_json, {} as SetRunSnapshot);
    if (snapshot.existingEditJob && !jobStatus(previous)) throw new CreativeInputError("原编辑任务已删除，请重新提交编辑", 409);
    if (snapshot.profileContext) profileStore.resolve(u.id, snapshot.profileContext.selection);
    return c.json({ set: setStore.retry(u.id, set.id, c.req.param("runId") || "") }, 202);
  }));
  api.post("/image-sets/:id/finalize", guarded((c, u) => c.json({ set: setStore.finalize(u.id, (c.req.param("id") || "")) })));
  api.post("/image-sets/:id/export", guarded((c, u, b) => { const set = setStore.get(u.id, (c.req.param("id") || "")); if (!b.partial && !set.finalized) throw new CreativeInputError("请先定稿或选择导出已采用部分", 409); return c.json({ downloadUrl: `/api/image-sets/${encodeURIComponent(set.id)}/export?partial=${b.partial === true ? "1" : "0"}` }); }));
  api.get("/image-sets/:id/export", guarded((c, u) => exportSet(u.id, setStore.get(u.id, (c.req.param("id") || "")), c.req.query("partial") === "1")));
}
