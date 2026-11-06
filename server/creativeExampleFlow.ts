import { appDb, getAll, getOne, run } from "./db";
import { ensureCreativeExample, type CreativeExample } from "./creativeExamples";
import { createImageSetStore, type SetRunRow, type SetRunSnapshot } from "./imageSets";
import { createProfileStore, creativeId } from "./creativeProfiles";
import { executeDemoImageSetRun } from "./imageSetDemo";
import { snapshotMessageSourceReferences } from "./messageSourceReferences";
import { insertMessage } from "./chatStore";
import { now } from "./utils";
import type { ImageRow } from "./types";
import { CREATIVE_EXAMPLE_IDS, type CreativeExampleId } from "./creativeExampleCatalog";
import { creativeExampleDefinition } from "./creativeExampleCatalog";
import { creativeExampleAssetPath } from "./creativeExampleArtwork";
import { secureAssetPath, writeEncryptedFile } from "./secureFiles";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ProfileAsset } from "../src/types";

const sets = createImageSetStore(appDb), profiles = createProfileStore(appDb), completing = new Map<string, Promise<void>>();
type Seed = { user_id: string; brand_id: string; product_id: string; set_id: string; completion_state: string };

async function prepareCatalogReferences(seed: Seed) {
  const definition=creativeExampleDefinition(sets.row(seed.user_id,seed.set_id).demo_template);if(!definition)return;
  const assets:ProfileAsset[]=[];
  for(const kind of ["hero","detail"] as const){
    const id=`example_${seed.product_id}_${kind}`;
    if(!getOne(appDb,"select id from assets where id=? and user_id=?",id,seed.user_id)){
      let bytes=await readFile(creativeExampleAssetPath(definition.id,kind));
      if(definition.id==="tea"&&kind==="detail"){
        const m=await sharp(bytes).metadata(),top=Math.floor(m.height!*.68);
        bytes=await sharp(bytes).extract({left:0,top,width:Math.floor(m.width!*.34),height:m.height!-top}).webp({quality:92}).toBuffer();
      }
      const meta=await sharp(bytes).metadata(),file=secureAssetPath(seed.user_id,id);await writeEncryptedFile(file,bytes);
      run(appDb,`insert into assets(id,user_id,name,path,mime_type,size,content_hash,image_width,image_height,has_transparency,created_at) values (?,?,?,?,?,?,?,?,?,0,?)`,id,seed.user_id,
        `${definition.brand} · ${kind==="hero"?"产品与空间参考":"材质与风格参考"}.webp`,file,"image/webp",bytes.length,createHash("sha256").update(bytes).digest("hex"),meta.width!,meta.height!,now());
    }
    assets.push({assetId:id,role:kind==="hero"?"identity":"style",note:kind==="hero"?"保持产品外观、品牌图案或空间的设计语言。":"只参考材质、光线与场景，不替代产品身份。"});
  }
  run(appDb,"update creative_profiles set assets_json=? where id=? and user_id=?",JSON.stringify(assets),seed.product_id,seed.user_id);
}

async function complete(seed: Seed) {
  if (["ready", "skipped"].includes(seed.completion_state)) return;
  const existing = completing.get(seed.set_id); if (existing) return existing;
  const work = async () => {
    const eligible = appDb.transaction(() => {
      const current = getOne<{ completion_state: string }>(appDb, "select completion_state from creative_example_seeds where user_id=? and set_id=? limit 1", seed.user_id, seed.set_id);
      if (!current || ["ready", "skipped"].includes(current.completion_state)) return false;
      if (current.completion_state === "building") return true;
      // Only untouched v1 drafts are upgraded. A deletion, edit or archive is a durable user choice.
      const untouched = getOne(appDb, `select id from image_sets where id=? and user_id=? and is_example=1 and revision=1 and context_revision=1 and archived=0 and confirmed=0
        and not exists(select 1 from image_set_runs where set_id=image_sets.id)
        and (select count(*) from creative_profiles where id in (?,?) and user_id=? and is_example=1 and revision=1 and archived=0)=2`, seed.set_id, seed.user_id, seed.brand_id, seed.product_id, seed.user_id);
      run(appDb, "update creative_example_seeds set completion_state=? where user_id=? and set_id=?", untouched ? "building" : "skipped", seed.user_id, seed.set_id);
      if (!untouched) return false;
      run(appDb, "update image_sets set execution_mode='demo',brief=case when demo_template='' then ? else brief end where id=?", "为虚构的青禾协作平台制作六个用途不同、视觉统一的宣传版位。展示从需求、方案、基准候选、选稿修改到定稿交付的完整过程。品牌、产品和画面均为模拟示例，可自行管理。", seed.set_id);
      return true;
    }).immediate();
    if (!eligible) return;
    await prepareCatalogReferences(seed);
    let set = sets.get(seed.user_id, seed.set_id);
    if (!set.confirmed) {
      const sessionId = creativeId("chat");
      run(appDb, "insert into sessions (id,user_id,title,title_status,created_at,updated_at) values (?,?,?,'manual',?,?)", sessionId, seed.user_id, `${set.name} · 模拟流程`, now(), now());
      const context=profiles.resolve(seed.user_id,set.profileSelection);
      const sources=context.assets.map(a=>{
        const row=getOne<{name:string;path:string;mime_type:string;size:number;image_width:number;image_height:number}>(appDb,"select * from assets where id=? and user_id=?",a.assetId,seed.user_id)!;
        return {sourceType:"asset" as const,sourceId:a.assetId,name:row.name,path:row.path,mimeType:row.mime_type,size:row.size,imageWidth:row.image_width,imageHeight:row.image_height};
      });
      const messageId=insertMessage(seed.user_id,sessionId,"user","示例参考素材快照",null,{simulated:true});
      const references=await snapshotMessageSourceReferences({userId:seed.user_id,sessionId,messageId,jobId:"",sources});
      set = sets.confirm(seed.user_id, set.id, set.revision, context, references.map(r=>r.sourceReferenceId), sessionId);
    }
    const drain = async () => {
      const rows = getAll<SetRunRow>(appDb, "select * from image_set_runs where set_id=? and status in ('queued','running') order by created_at,rowid", set.id);
      for (const r of rows) {
        run(appDb, "update image_set_runs set status='running' where id=?", r.id);
        await executeDemoImageSetRun(seed.user_id, r, JSON.parse(r.snapshot_json) as SetRunSnapshot,
          () => Boolean(getOne(appDb, "select id from image_set_runs where id=? and status='running'", r.id)), true);
        run(appDb, "update image_set_runs set status=(select status from image_jobs where id=?),error='' where id=?", r.job_id, r.id);
      }
      set = sets.get(seed.user_id, set.id);
    };
    if (!set.anchorCurrent) {
      sets.enqueue(seed.user_id, set.id, [set.anchorItemId], "example-baseline-v2", 2); await drain();
      const imageId = set.items.find(i => i.id === set.anchorItemId)!.runs.flatMap(r => r.images)[0].id;
      const image = getOne<ImageRow>(appDb, "select * from images where id=? and user_id=?", imageId, seed.user_id)!;
      const sessionId = sets.row(seed.user_id, set.id).session_id, messageId = insertMessage(seed.user_id, sessionId, "user", "采用模拟基准图，冻结视觉参考", null, { simulated: true });
      const refs = await snapshotMessageSourceReferences({ userId: seed.user_id, sessionId, messageId, jobId: "", sources: [{ sourceType: "image", sourceId: image.id, name: "模拟基准图", path: image.path,
        mimeType: image.mime_type, size: image.image_file_size, imageWidth: image.image_width, imageHeight: image.image_height }] });
      set = sets.select(seed.user_id, set.id, set.anchorItemId, imageId, false, refs[0].sourceReferenceId);
    }
    sets.enqueue(seed.user_id, set.id, set.items.filter(i => i.id !== set.anchorItemId).map(i => i.id), "example-remaining-v2"); await drain();
    // Keep both the first result and an edited child, so version selection is visible immediately.
    const editedItem = set.items[1], sourceId = getOne<{ id: string }>(appDb, "select images.id from images join image_set_runs r on r.job_id=images.job_id where r.set_id=? and r.item_id=? and images.parent_image_id is null order by images.rowid limit 1", set.id, editedItem.id)!.id;
    sets.enqueue(seed.user_id, set.id, [editedItem.id], "example-edit-v2", 1, sourceId, { copy: editedItem.copy, color: "forest" }); await drain();
    for (const item of set.items.filter(i => i.id !== set.anchorItemId)) {
      const images = getAll<{ id: string }>(appDb, "select images.id from images join image_set_runs r on r.job_id=images.job_id where r.set_id=? and r.item_id=? and images.user_id=? order by images.rowid desc", set.id, item.id, seed.user_id);
      set = sets.select(seed.user_id, set.id, item.id, images[0].id);
    }
    sets.finalize(seed.user_id, set.id);
    run(appDb, "update creative_example_seeds set completion_state='ready' where user_id=? and set_id=?", seed.user_id, seed.set_id);
  };
  const promise = work(); completing.set(seed.set_id, promise);
  try { await promise; } finally { completing.delete(seed.set_id); }
}

export async function ensureCompleteCreativeExample(userId: string, requestId?: string): Promise<CreativeExample> {
  const example = ensureCreativeExample(appDb, userId, requestId);
  const seed = getOne<Seed>(appDb, "select * from creative_example_seeds where user_id=? and set_id=? limit 1", userId, example.setId)!;
  await complete(seed); return example;
}
export async function ensureAllCompleteCreativeExamples() {
  const users = getAll<{ id: string }>(appDb, "select id from users where disabled=0");
  for (const u of users) {
    ensureCreativeExample(appDb, u.id);
    const seeds = getAll<Seed>(appDb, "select * from creative_example_seeds where user_id=? and completion_state in ('','building') and seed_key not like 'defaults-%' group by set_id", u.id);
    for (const seed of seeds) await complete(seed);
  }
}

export async function ensureCompleteCatalogExample(userId: string, templateId: CreativeExampleId, requestId?: string) {
  const example = ensureCreativeExample(appDb, userId, requestId, templateId);
  await complete(getOne<Seed>(appDb, "select * from creative_example_seeds where user_id=? and set_id=? limit 1", userId, example.setId)!);
  return example;
}
export async function ensureCreativeExampleCatalog(userId: string) {
  const pending=getAll<Seed>(appDb,"select * from creative_example_seeds where user_id=? and completion_state in ('','building') and seed_key not like 'defaults-%' group by set_id",userId);
  for(const seed of pending) await complete(seed);
  for (const id of CREATIVE_EXAMPLE_IDS) await ensureCompleteCatalogExample(userId, id);
  // Retire only the untouched, completed old software sample. Keep its files/history and allow restore.
  appDb.transaction(() => {
    if (getOne(appDb, "select 1 from creative_example_seeds where user_id=? and seed_key='catalog-retirement-v1'", userId)) return;
    const old = getOne<Seed>(appDb, "select * from creative_example_seeds where user_id=? and seed_key='starter-v1'", userId);
    if (!old) return;
    const unedited = getOne(appDb, `select id from image_sets where id=? and user_id=? and demo_template='' and is_example=1 and revision=3 and context_revision=1 and finalized=1 and archived=0
      and (select count(*) from image_set_items where set_id=image_sets.id and revision=1 and removed=0)=6
      and (select count(*) from image_set_runs where set_id=image_sets.id)=8
      and not exists(select 1 from image_set_items i where i.set_id=image_sets.id and i.id<>image_sets.anchor_item_id and i.selected_image_id<>coalesce((select images.id from images join image_set_runs r on r.job_id=images.job_id where r.set_id=i.set_id and r.item_id=i.id order by images.rowid desc limit 1),''))
      and (select count(*) from creative_profiles where id in (?,?) and revision=1 and archived=0)=2`, old.set_id, userId, old.brand_id, old.product_id);
    if (unedited) {
      sets.archive(userId, old.set_id, true);
      for (const id of [old.product_id, old.brand_id]) {
        const referenced = getOne(appDb, "select id from image_sets where id<>? and (json_extract(selection_json,'$.brandId')=? or json_extract(selection_json,'$.productId')=?) union all select session_id from creative_session_context where json_extract(selection_json,'$.brandId')=? or json_extract(selection_json,'$.productId')=? union all select id from creative_profiles where brand_id=? and id<>? limit 1", old.set_id, id, id, id, id, id, old.product_id);
        if (!referenced) run(appDb, "update creative_profiles set archived=1,revision=revision+1 where id=? and user_id=?", id, userId);
      }
    }
    run(appDb, "insert into creative_example_seeds(user_id,seed_key,brand_id,product_id,set_id,created_at,completion_state) values (?,'catalog-retirement-v1',?,?,?,?,'skipped')", userId, old.brand_id, old.product_id, old.set_id, now());
  }).immediate();
}
export async function ensureAllCreativeExampleCatalogs() {
  for (const user of getAll<{id: string}>(appDb, "select id from users where disabled=0")) await ensureCreativeExampleCatalog(user.id);
}
