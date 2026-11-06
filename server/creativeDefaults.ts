import path from "node:path";
import { readFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { appDb, getAll, getOne, run } from "./db";
import { CREATIVE_DEFAULTS, defaultRules, type CreativeDefault } from "./creativeDefaultCatalog";
import { creativeId, createProfileStore, CreativeInputError } from "./creativeProfiles";
import { createImageSetStore, type SetRunRow, type SetRunSnapshot } from "./imageSets";
import { DEFAULT_IMAGE_MODEL } from "./constants";
import { secureAssetPath, secureImagePath, writeEncryptedFile } from "./secureFiles";
import { absoluteDataPath } from "./paths";
import { snapshotMessageSourceReferences } from "./messageSourceReferences";
import { insertMessage } from "./chatStore";
import { now } from "./utils";
import type { AssetRow, ImageRow } from "./types";
import { CREATIVE_ARTWORK_VERSION, defaultArtwork, verifyDefaultArtwork } from "./creativeDefaultArtwork";

const version = "defaults-v2", profiles = createProfileStore(appDb), sets = createImageSetStore(appDb);
type Manifest = { products: Record<string, string>; assets: Record<string, string>; artworkVersion?: number; baseline?: { profiles: Record<string, string>; set: string } };
type Seed = { user_id: string; seed_key: string; brand_id: string; product_id: string; set_id: string; completion_state: string; manifest_json: string };
type RestoreResult = { brands: number; products: number; sets: number; preserved: number };
const work = new Map<string, Promise<unknown>>();
function exclusive<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = work.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation); work.set(userId, next);
  void next.finally(() => { if (work.get(userId) === next) work.delete(userId); }).catch(() => {});
  return next;
}
function seedFor(userId: string, id: string) { return getOne<Seed>(appDb, "select * from creative_example_seeds where user_id=? and seed_key=?", userId, `${version}:${id}`); }
export function creativeDefaultAssetPath(id: string, suffix: string) {
  const relative = path.join("image", "creative-defaults", `${id}-${suffix}`), built = path.join(process.cwd(), "dist", relative);
  return existsSync(built) ? built : path.join(process.cwd(), "public", relative);
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function profileHash(userId: string, id: string) {
  const value = getOne(appDb, "select kind,name,brand_id,shared,details_json,assets_json,variants_json from creative_profiles where id=? and user_id=?", id, userId);
  return value ? hash(value) : "";
}
function setHash(userId: string, id: string) {
  const value = getOne(appDb, "select name,brief,common_style,selection_json,asset_ids_json,provider_id,model,quality,confirmed,finalized,anchor_item_id,anchor_image_id,context_revision from image_sets where id=? and user_id=?", id, userId);
  if (!value) return "";
  return hash([value, getAll(appDb, "select id,name,purpose,copy,size,composition,sort_order,removed,selected_image_id,selected_context_revision,selected_item_revision from image_set_items where set_id=? order by sort_order,id", id),
    getAll(appDb, "select id,job_id,status from image_set_runs where set_id=? order by id", id)]);
}
function recordBaseline(seed: Seed, manifest: Manifest) {
  manifest.baseline = { profiles: Object.fromEntries([seed.brand_id, ...Object.values(manifest.products)].map(id => [id, profileHash(seed.user_id, id)])), set: setHash(seed.user_id, seed.set_id) };
  run(appDb, "update creative_example_seeds set manifest_json=?,completion_state='ready' where user_id=? and seed_key=?", JSON.stringify(manifest), seed.user_id, seed.seed_key);
}
function createBundle(userId: string, d: CreativeDefault): Seed {
  d.placements.forEach((placement, index) => {
    const artwork = defaultArtwork(d.id, index), [width, height] = placement.size.split("x").map(Number);
    if (Math.abs(artwork.width / artwork.height - width / height) > .01) throw new Error("默认成稿比例与版位不匹配");
  });
  return appDb.transaction(() => {
    const existing = seedFor(userId, d.id); if (existing) return existing;
    const brand = profiles.save(userId, "brand", { name: d.brand, details: { description: d.description, visualStyle: d.style, colors: d.colors.join(" "), tone: d.tone, rules: defaultRules } });
    const products: Record<string, string> = {};
    for (const p of d.products) products[p.key] = profiles.save(userId, "product", { name: p.name, brandId: brand.id,
      details: { description: p.description, facts: p.facts, features: p.features, rules: defaultRules },
      variants: p.variants.map(name => ({ id: creativeId("variant"), name, details: { facts: p.facts }, assets: [] })) }).id;
    const items = d.placements.map(p => ({ ...p, id: creativeId("slot") }));
    const mainProduct = d.products.length === 1 || d.id === "xiaozhu-studio" ? products[d.products[0].key] : "";
    const set = sets.save(userId, { name: d.campaign, brief: [d.brief, ...d.products.map(p => `${p.name}：${p.facts}`), defaultRules].join("\n"), commonStyle: d.style,
      profileSelection: { brandId: brand.id, ...(mainProduct ? { productId: mainProduct } : {}) }, assetIds: [], providerId: "", model: DEFAULT_IMAGE_MODEL, quality: "high", anchorItemId: items[0].id, items });
    const assets = Object.fromEntries(["hero", "logo", ...d.products.map(p => p.key)].map(key => [key, creativeId("asset")]));
    run(appDb, "insert into creative_example_seeds(user_id,seed_key,brand_id,product_id,set_id,created_at,completion_state,manifest_json) values (?,?,?,?,?,?,'building',?)",
      userId, `${version}:${d.id}`, brand.id, mainProduct, set.id, now(), JSON.stringify({ products, assets, artworkVersion: CREATIVE_ARTWORK_VERSION }));
    return seedFor(userId, d.id)!;
  }).immediate();
}
async function prepareAssets(seed: Seed, d: CreativeDefault, manifest: Manifest) {
  for (const [key, id] of Object.entries(manifest.assets)) {
    if (getOne(appDb, "select id from assets where id=? and user_id=?", id, seed.user_id)) continue;
    const bytes = await readFile(creativeDefaultAssetPath(d.id, `${key}.${key === "logo" ? "png" : "webp"}`)), meta = await sharp(bytes).metadata();
    const file = secureAssetPath(seed.user_id, id); await writeEncryptedFile(file, bytes);
    run(appDb, "insert into assets(id,user_id,name,path,mime_type,size,content_hash,image_width,image_height,has_transparency,created_at) values (?,?,?,?,?,?,?,?,?,0,?)",
      id, seed.user_id, `${d.brand} · ${d.products.find(p => p.key === key)?.name || (key === "logo" ? "品牌标识" : "视觉参考")}`, file, key === "logo" ? "image/png" : "image/webp", bytes.length, createHash("sha256").update(bytes).digest("hex"), meta.width, meta.height, now());
  }
  if (sets.row(seed.user_id, seed.set_id).confirmed) return;
  run(appDb, "update creative_profiles set assets_json=? where id=? and user_id=?", JSON.stringify([
    { assetId: manifest.assets.logo, role: "logo", note: "品牌中文与英文字标，沿用配色与字距。" },
    { assetId: manifest.assets.hero, role: "style", note: "沿用品牌的光线、材质与色调。" }
  ]), seed.brand_id, seed.user_id);
  for (const p of d.products) run(appDb, "update creative_profiles set assets_json=? where id=? and user_id=?", JSON.stringify([
    { assetId: manifest.assets[p.key], role: d.id === "xiaozhu-studio" ? "style" : "identity", note: d.id === "xiaozhu-studio" ? "参考材质、光线与空间设计语言。" : "保持产品外观、颜色、结构与标识一致。" }
  ]), manifest.products[p.key], seed.user_id);
  run(appDb, "update image_sets set asset_ids_json=? where id=? and user_id=?", JSON.stringify(d.products.map(p => manifest.assets[p.key])), seed.set_id, seed.user_id);
}
async function importArtwork(seed: Seed, d: CreativeDefault, r: SetRunRow) {
  if (r.status === "succeeded") return;
  const snapshot = JSON.parse(r.snapshot_json) as SetRunSnapshot;
  const item = sets.get(seed.user_id, seed.set_id).items.findIndex(i => i.id === r.item_id);
  const manifest = JSON.parse(seed.manifest_json) as Manifest;
  const artwork = manifest.artworkVersion === CREATIVE_ARTWORK_VERSION ? defaultArtwork(d.id, item) : null;
  const bytes = await readFile(creativeDefaultAssetPath(d.id, artwork ? artwork.file.slice(d.id.length + 1) : `${item + 1}.png`));
  if (artwork) verifyDefaultArtwork(bytes, artwork);
  const meta = await sharp(bytes).metadata();
  if (artwork ? meta.width !== artwork.width || meta.height !== artwork.height : `${meta.width}x${meta.height}` !== snapshot.size) throw new Error("默认成稿实际尺寸与资源清单不匹配");
  // IDs stay stable across an interrupted filesystem write and database commit.
  const imageId = `img_default_${r.id}`, file = secureImagePath(seed.user_id, snapshot.sessionId, imageId);
  await writeEncryptedFile(file, bytes);
  const width = meta.width!, height = meta.height!, stamp = now();
  appDb.transaction(() => {
    run(appDb, "insert into image_jobs(id,user_id,session_id,type,status,prompt,provider_id,request_json,client_request_id,source_image_ids,created_at,updated_at,result_image_id,response_json) values (?,?,?,'generation','succeeded',?,'internal-default',?,?,?, ?,?,?,?)",
      r.job_id, seed.user_id, snapshot.sessionId, snapshot.displayPrompt, JSON.stringify({ _builtInArtwork: true, n: 1, size: snapshot.size }), r.id, JSON.stringify({ imageIds: [], referenceIds: snapshot.referenceIds }), stamp, stamp, imageId, JSON.stringify({ source: "bundled-artwork", brand: d.id, artworkVersion: manifest.artworkVersion || 2, ...(artwork ? { sourceImageId: artwork.imageId } : {}) }));
    run(appDb, "insert into image_job_profile_context(job_id,user_id,snapshot_json,created_at) values (?,?,?,?)", r.job_id, seed.user_id, JSON.stringify(snapshot.profileContext), stamp);
    run(appDb, "insert into images(id,user_id,session_id,job_id,job_image_index,path,prompt,kind,size,quality,provider_id,mime_type,image_width,image_height,image_file_size,created_at) values (?,?,?,?,1,?,?,'generation',?,'high','internal-default','image/png',?,?,?,?)",
      imageId, seed.user_id, snapshot.sessionId, r.job_id, file, snapshot.displayPrompt, snapshot.size, width, height, bytes.length, stamp);
    insertMessage(seed.user_id, snapshot.sessionId, "assistant", d.placements[item].name, imageId, { jobId: r.job_id, n: 1, imageIndex: 1, imageTotal: 1 });
    run(appDb, "update image_set_runs set status='succeeded',updated_at=? where id=?", stamp, r.id);
  }).immediate();
}
async function completeBundle(seed: Seed, d: CreativeDefault) {
  if (seed.completion_state === "ready") return;
  const manifest = JSON.parse(seed.manifest_json) as Manifest;
  await prepareAssets(seed, d, manifest);
  let set = sets.get(seed.user_id, seed.set_id);
  if (!set.confirmed) {
    const sessionId = `chat_default_${set.id}`;
    run(appDb, "insert or ignore into sessions(id,user_id,title,title_status,created_at,updated_at) values (?,?,?,'manual',?,?)", sessionId, seed.user_id, set.name, now(), now());
    const context = profiles.resolve(seed.user_id, set.profileSelection);
    const ids = [...new Set([...context.assets.map(a => a.assetId), ...set.assetIds])];
    const sources = ids.map(id => {
      const row = getOne<AssetRow>(appDb, "select * from assets where id=? and user_id=?", id, seed.user_id)!;
      return { sourceType: "asset" as const, sourceId: id, name: row.name, path: row.path, mimeType: row.mime_type, size: row.size, imageWidth: row.image_width, imageHeight: row.image_height };
    });
    const messageId = insertMessage(seed.user_id, sessionId, "user", set.brief, null, { imageSetId: set.id });
    const refs = await snapshotMessageSourceReferences({ userId: seed.user_id, sessionId, messageId, jobId: "", sources });
    set = sets.confirm(seed.user_id, set.id, set.revision, context, refs.map(r => r.sourceReferenceId), sessionId);
  }
  const finishRuns = async () => {
    for (const r of getAll<SetRunRow>(appDb, "select * from image_set_runs where set_id=? and status<>'succeeded' order by rowid", set.id)) await importArtwork(seed, d, r);
    set = sets.get(seed.user_id, set.id);
  };
  if (!set.anchorCurrent) {
    sets.enqueue(seed.user_id, set.id, [set.anchorItemId], "default-anchor-v2"); await finishRuns();
    const anchor = set.items.find(i => i.id === set.anchorItemId)!;
    const image = getOne<ImageRow>(appDb, "select * from images where id=? and user_id=?", anchor.runs[0].images[0].id, seed.user_id)!;
    const sessionId = sets.row(seed.user_id, set.id).session_id;
    const messageId = insertMessage(seed.user_id, sessionId, "user", "选用风格样图", null, { imageSetId: set.id });
    const refs = await snapshotMessageSourceReferences({ userId: seed.user_id, sessionId, messageId, jobId: "", sources: [{ sourceType: "image", sourceId: image.id, name: anchor.name, path: image.path, mimeType: image.mime_type, size: image.image_file_size, imageWidth: image.image_width, imageHeight: image.image_height }] });
    set = sets.select(seed.user_id, set.id, set.anchorItemId, image.id, manifest.artworkVersion === CREATIVE_ARTWORK_VERSION, refs[0].sourceReferenceId);
  }
  sets.enqueue(seed.user_id, set.id, set.items.filter(i => i.id !== set.anchorItemId).map(i => i.id), "default-remaining-v2"); await finishRuns();
  for (const item of set.items.filter(i => i.id !== set.anchorItemId)) sets.select(seed.user_id, set.id, item.id, item.runs[0].images[0].id, manifest.artworkVersion === CREATIVE_ARTWORK_VERSION);
  sets.finalize(seed.user_id, set.id); recordBaseline(seed, manifest);
}
function referencedOutside(userId: string, profileId: string, setId: string, ownProducts: string[]) {
  return Boolean(getOne(appDb, "select id from image_sets where id<>? and (json_extract(selection_json,'$.brandId')=? or json_extract(selection_json,'$.productId')=?) limit 1", setId, profileId, profileId) ||
    getOne(appDb, "select c.session_id from creative_session_context c join sessions s on s.id=c.session_id where s.deleted_at is null and (json_extract(c.selection_json,'$.brandId')=? or json_extract(c.selection_json,'$.productId')=?) limit 1", profileId, profileId) ||
    getAll<{ id: string; archived: number }>(appDb, "select id,archived from creative_profiles where brand_id=?", profileId).some(p => !ownProducts.includes(p.id) || !p.archived) ||
    getOne(appDb, "select id from creative_profiles where id=? and (user_id<>? or shared=1)", profileId, userId));
}
function retireBundle(seed: Seed, baseline: Manifest["baseline"], productIds: string[]) {
  if (!baseline) return;
  // Never rewrite or archive edited content. References from other projects stay usable.
  const sameSet = setHash(seed.user_id, seed.set_id) === baseline.set;
  if (sameSet && !sets.activeCount(seed.set_id)) run(appDb, "update image_sets set archived=1,revision=revision+1,updated_at=? where id=? and user_id=? and archived=0", now(), seed.set_id, seed.user_id);
  if (!sameSet && getOne(appDb, "select id from image_sets where id=? and user_id=?", seed.set_id, seed.user_id)) return;
  for (const id of [...productIds, seed.brand_id]) {
    if (profileHash(seed.user_id, id) === baseline.profiles[id] && !referencedOutside(seed.user_id, id, seed.set_id, productIds)) {
      run(appDb, "update creative_profiles set archived=1,revision=revision+1,updated_at=? where id=? and user_id=? and archived=0", now(), id, seed.user_id);
    }
  }
}
function retireLegacy(userId: string) {
  const key = `${version}:legacy-retired`;
  if (getOne(appDb, "select 1 from creative_example_seeds where user_id=? and seed_key=?", userId, key)) return;
  for (const old of getAll<Seed>(appDb, "select * from creative_example_seeds where user_id=? and (seed_key='starter-v1' or seed_key like 'catalog-v1:%')", userId)) {
    const untouched = getOne(appDb, `select id from image_sets where id=? and user_id=? and is_example=1 and revision=3 and context_revision=1 and finalized=1
      and (select count(*) from image_set_items where set_id=image_sets.id and revision=1 and removed=0)=6
      and (select count(*) from image_set_runs where set_id=image_sets.id)=8
      and not exists(select 1 from image_set_items i where i.set_id=image_sets.id and i.id<>image_sets.anchor_item_id and i.selected_image_id<>coalesce((select images.id from images join image_set_runs r on r.job_id=images.job_id where r.set_id=i.set_id and r.item_id=i.id order by images.rowid desc limit 1),''))
      and (select count(*) from creative_profiles where id in (?,?) and user_id=? and revision=1 and shared=0)=2`, old.set_id, userId, old.brand_id, old.product_id, userId);
    if (untouched) retireBundle(old, { profiles: { [old.brand_id]: profileHash(userId, old.brand_id), [old.product_id]: profileHash(userId, old.product_id) }, set: setHash(userId, old.set_id) }, [old.product_id]);
  }
  run(appDb, "insert into creative_example_seeds(user_id,seed_key,brand_id,product_id,set_id,created_at,completion_state) values (?,?,'','','',?,'skipped')", userId, key, now());
}
async function ensure(userId: string) {
  if (!getOne(appDb, "select id from users where id=? and disabled=0", userId)) throw new CreativeInputError("用户不存在", 404);
  for (const d of CREATIVE_DEFAULTS) {
    let seed = seedFor(userId, d.id) || createBundle(userId, d);
    await completeBundle(seed, d);
    seed = seedFor(userId, d.id)!;
    const manifest = JSON.parse(seed.manifest_json) as Manifest;
    if ((manifest.artworkVersion || 2) >= CREATIVE_ARTWORK_VERSION || sets.activeCount(seed.set_id)) continue;
    // Deletion and archive remain durable choices; explicit restore can recover the new version.
    const ids = [seed.brand_id, ...Object.values(manifest.products)];
    if (!getOne(appDb, "select id from image_sets where id=? and user_id=? and archived=0", seed.set_id, userId)
      || ids.some(id => !getOne(appDb, "select id from creative_profiles where id=? and user_id=? and archived=0", id, userId))) continue;
    replaceBundle(seed, d, manifest);
    await completeBundle(seedFor(userId, d.id)!, d);
  }
  retireLegacy(userId);
}
function replaceBundle(seed: Seed, d: CreativeDefault, manifest: Manifest) {
  d.placements.forEach((_, index) => defaultArtwork(d.id, index));
  appDb.transaction(() => {
    retireBundle(seed, manifest.baseline, Object.values(manifest.products));
    run(appDb, "update creative_example_seeds set seed_key=? where user_id=? and seed_key=?", `defaults-history:${creativeId(d.id)}`, seed.user_id, seed.seed_key);
    createBundle(seed.user_id, d);
  }).immediate();
}
export function ensureCreativeDefaults(userId: string) { return exclusive(userId, () => ensure(userId)); }
export async function ensureAllCreativeDefaults() {
  for (const u of getAll<{ id: string }>(appDb, "select id from users where disabled=0")) await ensureCreativeDefaults(u.id);
}
async function completeFiles(seed: Seed, manifest: Manifest) {
  const files = Object.values(manifest.assets).map(id => getOne<{ path: string }>(appDb, "select path from assets where id=? and user_id=?", id, seed.user_id)?.path);
  const selected = getAll<{ path: string | null }>(appDb, "select images.path from image_set_items i left join images on images.id=i.selected_image_id and images.user_id=? where i.set_id=? and i.removed=0", seed.user_id, seed.set_id);
  if (selected.length !== 6 || selected.some(row => !row.path) || files.some(file => !file)) return false;
  try { await Promise.all([...files, ...selected.map(i => i.path)].map(file => access(absoluteDataPath(file!)))); return true; } catch { return false; }
}
export function restoreCreativeDefaults(userId: string, requestId: unknown) {
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) throw new CreativeInputError("恢复请求标识无效");
  return exclusive(userId, async () => {
    await ensure(userId);
    const receipt = `defaults-restore:v${CREATIVE_ARTWORK_VERSION}:${requestId}`, previous = getOne<{ manifest_json: string }>(appDb, "select manifest_json from creative_example_seeds where user_id=? and seed_key=?", userId, receipt);
    if (previous) return JSON.parse(previous.manifest_json) as RestoreResult;
    if (CREATIVE_DEFAULTS.some(d => sets.activeCount(seedFor(userId, d.id)!.set_id))) throw new CreativeInputError("默认套图正在生成，请完成或停止后再恢复", 409);
    let preserved = 0;
    for (const d of CREATIVE_DEFAULTS) {
      const seed = seedFor(userId, d.id)!, manifest = JSON.parse(seed.manifest_json) as Manifest, baseline = manifest.baseline!;
      const same = baseline.set === setHash(userId, seed.set_id) && Object.entries(baseline.profiles).every(([id, value]) => value === profileHash(userId, id));
      if (sets.activeCount(seed.set_id)) throw new CreativeInputError("默认套图正在生成，请完成或停止后再恢复", 409);
      if (manifest.artworkVersion === CREATIVE_ARTWORK_VERSION && same && await completeFiles(seed, manifest)) {
        appDb.transaction(() => {
          for (const id of Object.keys(baseline.profiles)) run(appDb, "update creative_profiles set archived=0,revision=revision+1,updated_at=? where id=? and user_id=? and archived=1", now(), id, userId);
          run(appDb, "update image_sets set archived=0,revision=revision+1,updated_at=? where id=? and user_id=? and archived=1", now(), seed.set_id, userId);
        }).immediate();
      } else {
        preserved += Object.entries(baseline.profiles).filter(([id, value]) => Boolean(profileHash(userId, id)) && value !== profileHash(userId, id)).length;
        if (setHash(userId, seed.set_id) && baseline.set !== setHash(userId, seed.set_id)) preserved++;
        replaceBundle(seed, d, manifest);
        await completeBundle(seedFor(userId, d.id)!, d);
      }
    }
    const result: RestoreResult = { brands: 4, products: CREATIVE_DEFAULTS.reduce((n, d) => n + d.products.length, 0), sets: 4, preserved };
    run(appDb, "insert into creative_example_seeds(user_id,seed_key,brand_id,product_id,set_id,created_at,completion_state,manifest_json) values (?,?,'','','',?,'skipped',?)", userId, receipt, now(), JSON.stringify(result));
    return result;
  });
}
