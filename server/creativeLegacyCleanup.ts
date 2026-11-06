import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { createImageSetStore } from "./imageSets";
import { createProfileStore } from "./creativeProfiles";
import type { CreativeProfileKind } from "../src/types/imageSets";

type Seed = { user_id: string; seed_key: string; brand_id: string; product_id: string; set_id: string; manifest_json: string };
type Entry = { id: string; userId: string; name: string; revision: number };
type ProfileEntry = Entry & { kind: CreativeProfileKind; brandId: string };
export type LegacyCreativeCleanupPlan = { sets: Entry[]; profiles: ProfileEntry[]; retained: { id: string; reason: string }[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Match the baseline saved by creativeDefaults. Revisions and archive state do not change content.
function profileHash(db: Database, userId: string, id: string) {
  const value = db.query("select kind,name,brand_id,shared,details_json,assets_json,variants_json from creative_profiles where id=? and user_id=?").get(id, userId);
  return value ? hash(value) : "";
}
function setHash(db: Database, userId: string, id: string) {
  const value = db.query("select name,brief,common_style,selection_json,asset_ids_json,provider_id,model,quality,confirmed,finalized,anchor_item_id,anchor_image_id,context_revision from image_sets where id=? and user_id=?").get(id, userId);
  return value ? hash([value,
    db.query("select id,name,purpose,copy,size,composition,sort_order,removed,selected_image_id,selected_context_revision,selected_item_revision from image_set_items where set_id=? order by sort_order,id").all(id),
    db.query("select id,job_id,status from image_set_runs where set_id=? order by id").all(id)]) : "";
}
function copyHash(db: Database, userId: string, id: string) {
  const value = db.query("select brief,common_style,selection_json,asset_ids_json from image_sets where id=? and user_id=?").get(id, userId);
  return hash([value, db.query("select name,purpose,copy,size,composition,sort_order from image_set_items where set_id=? and removed=0 order by sort_order").all(id)]);
}

/** Explicit maintenance only: never run destructive cleanup during ordinary list requests. */
export function planLegacyCreativeCleanup(db: Database, artworkVersion: number): LegacyCreativeCleanupPlan {
  const plan: LegacyCreativeCleanupPlan = { sets: [], profiles: [], retained: [] };
  const sets = createImageSetStore(db), candidates = new Map<string, Entry>(), profileIds = new Map<string, string>();
  const seeds = db.query("select user_id,seed_key,brand_id,product_id,set_id,manifest_json from creative_example_seeds").all() as Seed[];
  const currentSetIds = new Set(seeds.filter(seed => /^defaults-v2:(?!legacy-retired$)/.test(seed.seed_key)).map(seed => seed.set_id));
  const addSet = (userId: string, id: string) => {
    const row = db.query("select id,user_id userId,name,revision from image_sets where id=? and user_id=?").get(id, userId) as Entry | null;
    if (!row || currentSetIds.has(id)) return;
    if (sets.activeCount(id)) { plan.retained.push({ id, reason: "任务仍在运行" }); return; }
    candidates.set(id, row);
  };
  for (const seed of seeds) {
    if (/^(?:starter-v1$|catalog-v1:|catalog-manual:|manual:|try:)/.test(seed.seed_key)) {
      const original = db.query("select id,name from image_sets where id=? and user_id=? and is_example=1 and execution_mode='demo'").get(seed.set_id, seed.user_id) as { id: string; name: string } | null;
      if (original) {
        addSet(seed.user_id, original.id);
        // The old Copy action produced normal projects. Only inherited, unmodified copies qualify.
        const copies = db.query("select id,name from image_sets where user_id=? and is_example=0").all(seed.user_id) as { id: string; name: string }[];
        const signature = copyHash(db, seed.user_id, original.id);
        for (const copy of copies) if (copy.name !== original.name && copy.name.replace(/(?: · 副本)+$/, "") === original.name && copyHash(db, seed.user_id, copy.id) === signature) addSet(seed.user_id, copy.id);
      }
      for (const id of [seed.product_id, seed.brand_id]) if (id && db.query("select id from creative_profiles where id=? and user_id=? and is_example=1").get(id, seed.user_id)) profileIds.set(id, seed.user_id);
    } else if (seed.seed_key.startsWith("defaults-history:")) {
      const manifest = JSON.parse(seed.manifest_json) as { artworkVersion?: number; products?: Record<string, string>; baseline?: { set: string; profiles: Record<string, string> } };
      if ((manifest.artworkVersion ?? 2) >= artworkVersion || !manifest.baseline) continue;
      if (db.query("select id from image_sets where id=? and user_id=? and archived=1").get(seed.set_id, seed.user_id) && setHash(db, seed.user_id, seed.set_id) === manifest.baseline.set) addSet(seed.user_id, seed.set_id);
      for (const [id, baseline] of Object.entries(manifest.baseline.profiles)) if (profileHash(db, seed.user_id, id) === baseline && db.query("select id from creative_profiles where id=? and user_id=? and archived=1").get(id, seed.user_id)) profileIds.set(id, seed.user_id);
    }
  }
  plan.sets = [...candidates.values()];
  const remainingProfiles: ProfileEntry[] = [];
  for (const [id, userId] of profileIds) {
    const row = db.query("select id,user_id userId,name,revision,kind,brand_id brandId,shared from creative_profiles where id=? and user_id=?").get(id, userId) as (ProfileEntry & { shared: number }) | null;
    if (!row) continue;
    const field = row.kind === "brand" ? "$.brandId" : "$.productId";
    const references = db.query("select id from image_sets where json_extract(selection_json,?)=?").all(field, id) as { id: string }[];
    const context = db.query("select c.session_id from creative_session_context c join sessions s on s.id=c.session_id and s.user_id=c.user_id where s.deleted_at is null and json_extract(c.selection_json,?)=? limit 1").get(field, id);
    if (row.shared || context || references.some(ref => !candidates.has(ref.id))) { plan.retained.push({ id, reason: "资料仍被其他创作引用或共享" }); continue; }
    remainingProfiles.push({ id, userId, name: row.name, revision: row.revision, kind: row.kind, brandId: row.brandId });
  }
  plan.profiles = remainingProfiles.filter(profile => profile.kind === "product");
  const productsToRemove = new Set(plan.profiles.map(profile => profile.id));
  for (const brand of remainingProfiles.filter(profile => profile.kind === "brand")) {
    const products = db.query("select id from creative_profiles where brand_id=?").all(brand.id) as { id: string }[];
    if (products.some(product => !productsToRemove.has(product.id))) plan.retained.push({ id: brand.id, reason: "品牌仍有其他产品" });
    else plan.profiles.push(brand);
  }
  return plan;
}

export function cleanupLegacyCreativeData(db: Database, artworkVersion: number) {
  return db.transaction(() => {
    const plan = planLegacyCreativeCleanup(db, artworkVersion);
    if (plan.retained.some(item => item.reason === "任务仍在运行")) throw new Error("旧模板有运行中的任务，请完成或停止后再清理");
    const sets = createImageSetStore(db), profiles = createProfileStore(db);
    for (const entry of plan.sets) sets.remove(entry.userId, entry.id, entry.revision);
    for (const entry of plan.profiles) profiles.remove(entry.userId, entry.id, entry.revision, entry.kind);
    // Seed receipts remain as tombstones so old initializers cannot recreate removed templates.
    // Image history, conversations, assets and encrypted files remain accessible independently.
    return plan;
  }).immediate();
}
