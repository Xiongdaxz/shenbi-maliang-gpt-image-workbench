import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { initImageSetSchema } from "./imageSetSchema";
import { ensureCreativeExample } from "./creativeExamples";
import { createImageSetStore } from "./imageSets";
import { createProfileStore, creativeId } from "./creativeProfiles";
import { cleanupLegacyCreativeData, planLegacyCreativeCleanup } from "./creativeLegacyCleanup";

function fixture() {
  const db = new Database(":memory:");
  db.exec("pragma foreign_keys=ON; create table users(id text primary key,disabled integer default 0); insert into users(id) values ('a'),('b'); create table sessions(id text primary key,user_id text not null,deleted_at text); create table images(id text primary key,user_id text,job_id text,created_at text); create table assets(id text primary key,user_id text,space text,shared integer,share_status text);");
  initImageSetSchema(db);
  const sets = createImageSetStore(db), profiles = createProfileStore(db);
  const source = ensureCreativeExample(db, "a", undefined, "interior");
  const copy = () => {
    const original = sets.get("a", source.setId), items = original.items.map(item => ({ ...item, id: creativeId("slot") }));
    return sets.save("a", { ...original, name: `${original.name} · 副本`, items, anchorItemId: items[0].id });
  };
  return { db, sets, profiles, source, copy };
}

test("removes old examples and inherited copies while retaining current defaults, edited copies, images and tombstones", () => {
  const { db, sets, source, copy } = fixture();
  try {
    const inherited = copy(), edited = copy(), latest = copy();
    sets.save("a", { ...edited, name: "我的空间作品", brief: "用户自己填写的创作需求" }, edited.id);
    db.query("insert into creative_example_seeds(user_id,seed_key,brand_id,product_id,set_id,created_at) values ('a','defaults-v2:current','','',?,'now')").run(latest.id);
    db.exec("insert into images values ('historical-image','a','historical-job','now')");
    const plan = cleanupLegacyCreativeData(db, 3);
    expect(plan.sets.map(set => set.id).sort()).toEqual([source.setId, inherited.id].sort());
    expect(sets.get("a", edited.id).brief).toBe("用户自己填写的创作需求");
    expect(sets.get("a", latest.id).id).toBe(latest.id);
    expect(db.query("select id from images").get()).toEqual({ id: "historical-image" });
    expect(ensureCreativeExample(db, "a", undefined, "interior").created).toBe(false);
    expect(plan.profiles).toHaveLength(0);
    expect(planLegacyCreativeCleanup(db, 3).sets).toHaveLength(0);
  } finally { db.close(); }
});

test("removes unreferenced old products before brands and handles all owners independently", () => {
  const { db, source } = fixture();
  try {
    const other = ensureCreativeExample(db, "b");
    const result = cleanupLegacyCreativeData(db, 3);
    expect(result.sets.map(set => set.id).sort()).toEqual([source.setId, other.setId].sort());
    expect(result.profiles).toHaveLength(4);
    expect(db.query("select count(*) n from creative_profiles").get()).toEqual({ n: 0 });
    expect(cleanupLegacyCreativeData(db, 3).sets).toHaveLength(0);
  } finally { db.close(); }
});

test("keeps shared profiles and profiles referenced by a live chat or another product", () => {
  const { db, profiles, source } = fixture();
  try {
    const brand = profiles.get("a", source.brandId);
    profiles.save("a", "brand", { ...brand, shared: true }, brand.id);
    db.exec("insert into sessions values ('chat','a',null)");
    db.query("insert into creative_session_context values ('chat','a',?)").run(JSON.stringify({ productId: source.productId }));
    const product = profiles.save("a", "product", { name: "自行建立的服务", brandId: source.brandId });
    const result = cleanupLegacyCreativeData(db, 3);
    expect(result.profiles).toHaveLength(0);
    expect(profiles.get("a", product.id).brandId).toBe(source.brandId);
    expect(profiles.get("a", source.productId).id).toBe(source.productId);
  } finally { db.close(); }
});

test("refuses the entire cleanup when an old project has a queued task", () => {
  const { db, source } = fixture();
  try {
    ensureCreativeExample(db, "b");
    db.query("insert into image_set_runs(id,set_id,item_id,job_id,client_request_id,candidate_index,status,context_revision,item_revision,snapshot_json,created_at,updated_at) values ('run',?,'item','job','request',0,'queued',1,1,'{}','now','now')").run(source.setId);
    expect(() => cleanupLegacyCreativeData(db, 3)).toThrow("旧模板有运行中的任务");
    expect(db.query("select count(*) n from image_sets").get()).toEqual({ n: 2 });
    expect(db.query("select count(*) n from creative_profiles").get()).toEqual({ n: 4 });
  } finally { db.close(); }
});
