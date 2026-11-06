import type { Database } from "bun:sqlite";
import type { ImageSet, ImageSetInput, ImageSetItemInput, ImageSetRun, ProfileContext, WorkImage } from "../src/types";
import { CreativeInputError, creativeId, creativeIds, creativeNow, creativeText, jsonValue, recordValue } from "./creativeProfiles";

type SetRow = { id: string; user_id: string; name: string; brief: string; common_style: string; selection_json: string; asset_ids_json: string;
  provider_id: string; model: string; quality: string; session_id: string; revision: number; context_revision: number; confirmed: number; archived: number;
  stopped: number; finalized: number; anchor_item_id: string; anchor_image_id: string; anchor_reference_id: string; anchor_revision: number;
  snapshot_json: string; reference_ids_json: string; created_at: string; updated_at: string; is_example: number; execution_mode: string; demo_template: string };
type ItemRow = { id: string; set_id: string; name: string; purpose: string; copy: string; size: string; composition: string; sort_order: number;
  revision: number; removed: number; selected_image_id: string; selected_context_revision: number; selected_item_revision: number };
export type SetRunRow = { id: string; set_id: string; item_id: string; job_id: string; client_request_id: string; candidate_index: number;
  status: ImageSetRun["status"]; context_revision: number; item_revision: number; snapshot_json: string; error: string; created_at: string; updated_at: string };
export const DEMO_STYLES = ["airy", "dark", "editorial"] as const;
export type DemoStyle = typeof DEMO_STYLES[number];
export type DemoEdit = { copy?: string; color?: "sage" | "cream" | "forest"; failOnce?: boolean; style?: DemoStyle };
export type SetRunSnapshot = { prompt: string; displayPrompt?: string; existingEditJob?: boolean; size: string; providerId: string; model: string; quality: string; sessionId: string; referenceIds: string[]; sourceImageId?: string; profileContext: ProfileContext | null;
  demo?: { item: ImageSetItemInput; placement: number; total?: number; templateId?: string; brand: string; product: string; color: "sage" | "cream" | "forest"; variant: number; failOnce?: boolean; artworkVersion?: 2; style?: DemoStyle } };

export function normalizeSetItems(value: unknown): ImageSetItemInput[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10) throw new CreativeInputError("每套需要 2～10 个版位");
  const seen = new Set<string>();
  return value.map(v => {
    const item = recordValue(v), id = creativeText(item.id, 200) || creativeId("slot"), name = creativeText(item.name, 120), size = creativeText(item.size, 40);
    if (!name || seen.has(id)) throw new CreativeInputError("版位名称缺失或编号重复");
    if (!/^\d{2,5}x\d{2,5}$/.test(size) || size.split("x").some(n => Number(n) < 64 || Number(n) > 8192)) throw new CreativeInputError("请为每个版位选择明确的有效尺寸");
    seen.add(id);
    return { id, name, size, purpose: creativeText(item.purpose, 2000), copy: creativeText(item.copy, 4000), composition: creativeText(item.composition, 8000) };
  });
}
export function compileSetPrompt(set: Pick<ImageSetInput, "brief" | "commonStyle">, item: ImageSetItemInput, context: ProfileContext | null, anchor: boolean) {
  return ["根据本张实际用途，生成一张可以直接使用的完整成图。遵守用户明确的构图；没有特别要求时，让产品主体、空间或功能信息成为主要画面，不默认套用小图加口号和大片空白的模板。", `本次需求：${set.brief}`, context?.instruction ?? "", set.commonStyle ? `本次共同视觉要求：${set.commonStyle}` : "",
    `本张用途：${item.name}；${item.purpose}`, `目标尺寸：${item.size}`, item.copy ? `画面文案（按确认内容使用，不增加无关口号）：${item.copy}` : "本张未设置宣传文案，不添加口号；仅保留已确认的品牌识别，按用途展示主体。请勿虚构价格、日期或促销信息。",
    item.composition ? `构图要求：${item.composition}` : "", anchor ? "参考图片最后一张为已确认基准图：仅参考配色、光线、质感与视觉语言，按当前版位重新构图。产品身份以产品参考素材和确认事实为准。" : "",
    "请仅输出本张图片，文案中的数字和参考图片编号不表示输出数量。"].filter(Boolean).join("\n\n");
}

export function createImageSetStore(db: Database, hydrate: (rows: unknown[]) => WorkImage[] = rows => rows as WorkImage[]) {
  function row(userId: string, id: string) {
    const r = db.query("select * from image_sets where id=? and user_id=?").get(id, userId) as SetRow | null;
    if (!r) throw new CreativeInputError("套图不存在或无权访问", 404);
    return r;
  }
  function activeCount(id: string) { return (db.query("select count(*) as n from image_set_runs where set_id=? and status in ('queued','running')").get(id) as { n: number }).n; }
  function editable(r: SetRow) { if (r.archived || activeCount(r.id)) throw new CreativeInputError("请先停止正在运行的任务，或恢复已归档项目", 409); }
  function get(userId: string, id: string, summary = false): ImageSet {
    const r = row(userId, id), rows = db.query("select * from image_set_items where set_id=? and removed=0 order by sort_order").all(id) as ItemRow[];
    const items = rows.map(item => {
      const runRows = summary
        ? db.query("select * from image_set_runs where item_id=? and set_id=? order by (job_id=(select job_id from images where id=?)) desc,created_at desc,id desc limit 1").all(item.id, id, item.selected_image_id)
        : db.query("select * from image_set_runs where item_id=? and set_id=? order by created_at desc,id desc").all(item.id, id);
      const runs = (runRows as SetRunRow[]).map(run => {
        const snapshot = jsonValue<SetRunSnapshot>(run.snapshot_json, {} as SetRunSnapshot);
        const demoStyle = r.execution_mode === "demo" && snapshot.demo?.artworkVersion === 2 && !snapshot.sourceImageId && !snapshot.demo.failOnce && snapshot.demo.color === "sage" && snapshot.demo.item.copy === item.copy ? snapshot.demo.style : undefined;
        return {
        id: run.id, itemId: run.item_id, jobId: run.job_id, status: run.status, error: run.error, contextRevision: run.context_revision, itemRevision: run.item_revision, createdAt: run.created_at,
        ...(demoStyle ? { demoStyle } : {}),
        images: hydrate(db.query("select * from images where job_id=? and user_id=? order by job_image_index,created_at,id").all(run.job_id, userId))
      }; });
      const exists = Boolean(item.selected_image_id && db.query("select id from images where id=? and user_id=?").get(item.selected_image_id, userId));
      return { id: item.id, name: item.name, purpose: item.purpose, copy: item.copy, size: item.size, composition: item.composition, revision: item.revision,
        selectedImageId: exists ? item.selected_image_id : "", selectionCurrent: exists && item.selected_context_revision === r.context_revision && item.selected_item_revision === item.revision, runs };
    });
    const active = activeCount(id), selectedCount = items.filter(i => i.selectionCurrent).length;
    const anchorCurrent = r.anchor_revision === r.context_revision && Boolean(r.anchor_image_id && db.query("select id from images where id=? and user_id=?").get(r.anchor_image_id, userId));
    return { id, ownerId: userId, name: r.name, brief: r.brief, commonStyle: r.common_style, profileSelection: jsonValue(r.selection_json, {}), assetIds: jsonValue(r.asset_ids_json, []), isExample: Boolean(r.is_example),
      providerId: r.provider_id, model: r.model, quality: r.quality, executionMode: r.execution_mode === "demo" ? "demo" : "provider", demoTemplate: r.demo_template || undefined, revision: r.revision, contextRevision: r.context_revision, confirmed: Boolean(r.confirmed), archived: Boolean(r.archived), stopped: Boolean(r.stopped),
      finalized: Boolean(r.finalized) && selectedCount === items.length, anchorItemId: r.anchor_item_id, anchorImageId: r.anchor_image_id, anchorCurrent, items, selectedCount, activeCount: active,
      stage: active ? "generating" : r.stopped ? "stopped" : !r.confirmed ? "draft" : !anchorCurrent ? "anchor" : r.finalized && selectedCount === items.length ? "finalized" : "review",
      snapshot: summary ? null : jsonValue(r.snapshot_json, null), createdAt: r.created_at, updatedAt: r.updated_at };
  }
  function save(userId: string, value: unknown, id?: string) {
    const input = recordValue(value), previous = id ? row(userId, id) : null;
    if (previous) { editable(previous); if (Number(input.revision) !== previous.revision) throw new CreativeInputError("项目已更新，请刷新后再保存", 409); }
    const name = creativeText(input.name, 120), brief = creativeText(input.brief), commonStyle = creativeText(input.commonStyle), items = normalizeSetItems(input.items);
    if (!name || !brief) throw new CreativeInputError("请输入项目名称和创作需求");
    const anchorItemId = creativeText(input.anchorItemId, 200) || items[0].id;
    if (!items.some(i => i.id === anchorItemId)) throw new CreativeInputError("基准版位不存在");
    const selection = JSON.stringify(recordValue(input.profileSelection)), assets = JSON.stringify(creativeIds(input.assetIds));
    const providerId = creativeText(input.providerId, 200), model = creativeText(input.model, 200), quality = creativeText(input.quality, 40) || "high";
    const nextId = id || creativeId("set"), timestamp = creativeNow();
    db.transaction(() => {
      if (previous) {
        const changed = brief !== previous.brief || commonStyle !== previous.common_style || selection !== previous.selection_json || assets !== previous.asset_ids_json || anchorItemId !== previous.anchor_item_id;
        db.query("update image_sets set name=?,brief=?,common_style=?,selection_json=?,asset_ids_json=?,provider_id=?,model=?,quality=?,anchor_item_id=?,revision=revision+1,context_revision=context_revision+?,confirmed=case when ? then 0 else confirmed end,finalized=0,stopped=0,updated_at=? where id=?")
          .run(name, brief, commonStyle, selection, assets, providerId, model, quality, anchorItemId, changed ? 1 : 0, changed ? 1 : 0, timestamp, nextId);
        db.query("update image_set_items set removed=1 where set_id=?").run(nextId);
      } else db.query("insert into image_sets (id,user_id,name,brief,common_style,selection_json,asset_ids_json,provider_id,model,quality,anchor_item_id,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(nextId, userId, name, brief, commonStyle, selection, assets, providerId, model, quality, anchorItemId, timestamp, timestamp);
      items.forEach((item, index) => {
        const old = db.query("select * from image_set_items where id=?").get(item.id) as ItemRow | null;
        if (old && old.set_id !== nextId) throw new CreativeInputError("版位不属于当前项目", 409);
        if (old) {
          const changed = ["name", "purpose", "copy", "size", "composition"].some(key => item[key as keyof ImageSetItemInput] !== old[key as keyof ItemRow]);
          db.query("update image_set_items set name=?,purpose=?,copy=?,size=?,composition=?,sort_order=?,removed=0,revision=revision+? where id=?")
            .run(item.name, item.purpose, item.copy, item.size, item.composition, index, changed ? 1 : 0, item.id);
          if (changed && item.id === anchorItemId) db.query("update image_sets set anchor_revision=0 where id=?").run(nextId);
        } else db.query("insert into image_set_items (id,set_id,name,purpose,copy,size,composition,sort_order) values (?,?,?,?,?,?,?,?)")
          .run(item.id, nextId, item.name, item.purpose, item.copy, item.size, item.composition, index);
      });
    })();
    return get(userId, nextId);
  }
  function list(userId: string, keyword = "", archived = false, cursor = "", brandId = "", stage = "") {
    const rows = db.query("select id from image_sets where user_id=? and archived=? and name like ? and (?='' or id>?) order by id limit 31")
      .all(userId, archived ? 1 : 0, `%${keyword}%`, cursor, cursor) as { id: string }[];
    const items = rows.slice(0, 30).map(r => get(userId, r.id, true)).filter(s => (!brandId || s.profileSelection.brandId === brandId) && (!stage || s.stage === stage));
    return { items, nextCursor: rows.length > 30 ? rows[29].id : null };
  }
  function confirm(userId: string, id: string, revision: number, context: ProfileContext, referenceIds: string[], sessionId: string) {
    const r = row(userId, id); editable(r);
    if (r.revision !== revision) throw new CreativeInputError("方案已更新，请重新确认", 409);
    const contextChanged = r.confirmed && r.snapshot_json !== JSON.stringify(context);
    db.query("update image_sets set snapshot_json=?,reference_ids_json=?,session_id=?,confirmed=1,stopped=0,revision=revision+1,context_revision=context_revision+?,finalized=0,updated_at=? where id=?")
      .run(JSON.stringify(context), JSON.stringify(referenceIds), sessionId, contextChanged ? 1 : 0, creativeNow(), id);
    return get(userId, id);
  }
  function existingDemoStyleRun(userId: string, id: string, itemId: string, contextRevision: number, itemRevision: number, style: DemoStyle, copy: string) {
    return db.query(`select r.id from image_set_runs r where r.set_id=? and r.item_id=? and r.context_revision=? and r.item_revision=?
      and json_extract(r.snapshot_json,'$.demo.artworkVersion')=2 and json_extract(r.snapshot_json,'$.demo.style')=?
      and coalesce(json_extract(r.snapshot_json,'$.sourceImageId'),'')='' and coalesce(json_extract(r.snapshot_json,'$.demo.failOnce'),0)=0
      and json_extract(r.snapshot_json,'$.demo.color')='sage'
      and json_extract(r.snapshot_json,'$.demo.item.copy')=? and (r.status in ('queued','running') or (r.status='succeeded' and exists(select 1 from images where job_id=r.job_id and user_id=?))) order by r.created_at desc,r.id desc limit 1`)
      .get(id, itemId, contextRevision, itemRevision, style, copy, userId) as { id: string } | null;
  }
  function enqueue(userId: string, id: string, itemIds: string[], requestId: string, candidates = 1, sourceImageId = "", demoEdit?: DemoEdit) {
    const r = row(userId, id), set = get(userId, id);
    if (!r.confirmed || r.archived) throw new CreativeInputError("请先确认方案并恢复项目", 409);
    if (!requestId || requestId.length > 200 || ![1, 2].includes(candidates)) throw new CreativeInputError("生成请求标识或候选数量无效");
    if (demoEdit && r.execution_mode !== "demo") throw new CreativeInputError("此操作仅用于模拟项目", 403);
    if (demoEdit?.style !== undefined && !DEMO_STYLES.includes(demoEdit.style)) throw new CreativeInputError("请选择有效的演示样式");
    const duplicate = db.query("select id from image_set_runs where set_id=? and client_request_id=? limit 1").get(id, requestId);
    if (duplicate) return get(userId, id);
    if (sourceImageId && (itemIds.length !== 1 || !db.query("select images.id from images join image_set_runs on images.job_id=image_set_runs.job_id where images.id=? and image_set_runs.set_id=? and image_set_runs.item_id=? and images.user_id=?").get(sourceImageId, id, itemIds[0], userId))) throw new CreativeInputError("编辑来源不属于当前版位", 403);
    const targets = itemIds.map(itemId => set.items.find(i => i.id === itemId));
    if (!targets.length || targets.some(i => !i)) throw new CreativeInputError("版位不存在");
    if (targets.some(i => i!.id !== r.anchor_item_id) && !set.anchorCurrent) throw new CreativeInputError("请先选定当前方案的基准图", 409);
    if (targets.some(i => db.query("select id from image_set_runs where item_id=? and status in ('queued','running')").get(i!.id))) throw new CreativeInputError("该版位已有正在运行的任务", 409);
    db.transaction(() => {
      let inserted = false;
      for (const item of targets) for (let candidate = 0; candidate < candidates; candidate++) {
        const referenceIds = jsonValue<string[]>(r.reference_ids_json, []), isOther = item!.id !== r.anchor_item_id;
        if (isOther && r.anchor_reference_id) referenceIds.push(r.anchor_reference_id);
        const snapshot: SetRunSnapshot = { prompt: compileSetPrompt(set, item!, set.snapshot, isOther), displayPrompt: [set.brief, item!.name, item!.purpose, item!.copy, item!.composition].filter(Boolean).join("\n"), size: item!.size, providerId: r.provider_id,
          model: r.model, quality: r.quality, sessionId: r.session_id, referenceIds, profileContext: set.snapshot, ...(sourceImageId ? { sourceImageId } : {}) };
        if (r.execution_mode === "demo") {
          const ordinal = (db.query("select count(*) as n from image_set_runs where item_id=?").get(item!.id) as { n: number }).n;
          const style = demoEdit?.style || DEMO_STYLES[ordinal % DEMO_STYLES.length];
          if (!sourceImageId && !demoEdit?.failOnce && !demoEdit?.copy && !demoEdit?.color) {
            const existing = existingDemoStyleRun(userId, id, item!.id, r.context_revision, item!.revision, style, item!.copy);
            if (existing) continue;
          }
          snapshot.demo = { item: { ...item!, copy: demoEdit?.copy ?? item!.copy }, placement: set.items.findIndex(i => i.id === item!.id), total: set.items.length, templateId: r.demo_template || undefined,
            brand: set.snapshot?.brand?.name.replace(/\s*·\s*示例品牌$/, "") || "青禾", product: set.snapshot?.product?.name.replace(/\s*·\s*示例产品$/, "") || "青禾协作平台",
            color: demoEdit?.color || "sage", variant: ordinal, artworkVersion: 2, style, ...(demoEdit?.failOnce ? { failOnce: true } : {}) };
          if (demoEdit) snapshot.displayPrompt = `模拟修改：${snapshot.demo.item.copy} · ${snapshot.demo.color}`;
        }
        const timestamp = creativeNow();
        db.query("insert into image_set_runs (id,set_id,item_id,job_id,client_request_id,candidate_index,status,context_revision,item_revision,snapshot_json,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(creativeId("setrun"), id, item!.id, creativeId("job"), requestId, candidate, "queued", r.context_revision, item!.revision, JSON.stringify(snapshot), timestamp, timestamp);
        inserted = true;
      }
      if (inserted) db.query("update image_sets set stopped=0,finalized=0,updated_at=? where id=?").run(creativeNow(), id);
    }).immediate();
    return get(userId, id);
  }
  function demoStyle(userId: string, id: string, itemId: string, style: DemoStyle, requestId: string) {
    const set = enqueue(userId, id, [itemId], requestId, 1, "", { style });
    const item = set.items.find(item => item.id === itemId)!;
    const record = existingDemoStyleRun(userId, id, itemId, set.contextRevision, item.revision, style, item.copy);
    if (!record) throw new CreativeInputError("项目已变化，请重新选择演示样式", 409);
    return { set, runId: record.id, imageId: item.runs.find(run => run.id === record.id)?.images[0]?.id || "" };
  }
  function select(userId: string, id: string, itemId: string, imageId: string, acknowledgeSize = false, anchorReferenceId = "") {
    const r = row(userId, id), item = db.query("select * from image_set_items where set_id=? and id=? and removed=0").get(id, itemId) as ItemRow | null;
    if (!item) throw new CreativeInputError("版位不存在", 404);
    if (r.archived) throw new CreativeInputError("请先恢复项目", 409);
    const image = db.query("select images.* from images join image_set_runs on images.job_id=image_set_runs.job_id where images.id=? and images.user_id=? and image_set_runs.set_id=? and image_set_runs.item_id=?").get(imageId, userId, id, itemId) as { image_width: number; image_height: number } | null;
    if (!image) throw new CreativeInputError("候选图片不存在或不属于当前版位", 404);
    const [width, height] = item.size.split("x").map(Number);
    if (!acknowledgeSize && (image.image_width !== width || image.image_height !== height)) throw new CreativeInputError("实际尺寸与目标不同，请确认采用实际尺寸", 409);
    if (itemId === r.anchor_item_id) {
      editable(r);
      if (!anchorReferenceId) throw new CreativeInputError("基准图快照缺失");
      const changed = r.anchor_image_id !== imageId || r.anchor_revision !== r.context_revision;
      if (changed && r.anchor_image_id) r.context_revision++;
      db.query("update image_sets set anchor_image_id=?,anchor_reference_id=?,anchor_revision=?,context_revision=?,revision=revision+1,finalized=0,updated_at=? where id=?")
        .run(imageId, anchorReferenceId, r.context_revision, r.context_revision, creativeNow(), id);
    }
    db.query("update image_set_items set selected_image_id=?,selected_context_revision=?,selected_item_revision=? where id=?")
      .run(imageId, r.context_revision, item.revision, itemId);
    db.query("update image_sets set finalized=0,updated_at=? where id=?").run(creativeNow(), id);
    return get(userId, id);
  }
  function stop(userId: string, id: string) {
    row(userId, id);
    const active = db.query("select * from image_set_runs where set_id=? and status in ('queued','running')").all(id) as SetRunRow[];
    db.transaction(() => {
      db.query("update image_sets set stopped=1,updated_at=? where id=?").run(creativeNow(), id);
      db.query("update image_set_runs set status='cancelled',updated_at=? where set_id=? and status in ('queued','running')").run(creativeNow(), id);
    })();
    return active;
  }
  function finalize(userId: string, id: string) {
    const r = row(userId, id); editable(r); const set = get(userId, id);
    if (!set.anchorCurrent || set.selectedCount !== set.items.length) throw new CreativeInputError("请为全部版位采用并确认当前轮次的图片", 409);
    db.query("update image_sets set finalized=1,stopped=0,updated_at=? where id=?").run(creativeNow(), id);
    return get(userId, id);
  }
  function archive(userId: string, id: string, archived: boolean) {
    const r = row(userId, id); if (activeCount(id)) throw new CreativeInputError("请先停止任务", 409);
    db.query("update image_sets set archived=?,revision=revision+1,updated_at=? where id=? and user_id=?").run(archived ? 1 : 0, creativeNow(), r.id, userId);
    return get(userId, id);
  }
  function retry(userId: string, id: string, runId: string) {
    const r = row(userId, id);
    if (r.archived) throw new CreativeInputError("请先恢复项目", 409);
    const previous = db.query("select * from image_set_runs where id=? and set_id=?").get(runId, id) as SetRunRow | null;
    if (!previous || !["failed", "cancelled"].includes(previous.status)) throw new CreativeInputError("任务不存在或无需重试", 409);
    if (db.query("select id from image_set_runs where item_id=? and status in ('queued','running')").get(previous.item_id)) throw new CreativeInputError("该版位正在运行", 409);
    db.query("update image_set_runs set status='queued',error='',updated_at=? where id=?").run(creativeNow(), runId);
    db.query("update image_sets set stopped=0,finalized=0,updated_at=? where id=?").run(creativeNow(), id);
    return get(userId, id);
  }
  function remove(userId: string, id: string, revision: number) {
    return db.transaction(() => {
      const current = row(userId, id);
      if (current.revision !== revision) throw new CreativeInputError("项目已更新，请刷新后再删除", 409);
      if (activeCount(id)) throw new CreativeInputError("请先停止任务再删除套图", 409);
      db.query("delete from image_set_runs where set_id=?").run(id);
      db.query("delete from image_set_items where set_id=?").run(id);
      db.query("delete from image_sets where id=? and user_id=?").run(id, userId);
      return { ok: true };
    }).immediate();
  }
  return { row, get, save, list, confirm, enqueue, demoStyle, select, stop, finalize, archive, activeCount, retry, remove };
}
