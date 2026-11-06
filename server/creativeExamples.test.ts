import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { initImageSetSchema } from "./imageSetSchema";
import { ensureAllCreativeExamples, ensureCreativeExample } from "./creativeExamples";
import { createProfileStore, creativeId } from "./creativeProfiles";
import { createImageSetStore } from "./imageSets";
import { CREATIVE_EXAMPLE_IDS } from "./creativeExampleCatalog";

function fixture() {
  const db = new Database(":memory:");
  db.exec("pragma foreign_keys=ON; create table users(id text primary key,disabled integer default 0); insert into users(id) values ('a'),('b'); create table sessions(id text primary key,user_id text not null,deleted_at text);");
  initImageSetSchema(db);
  db.exec("create table images(id text primary key,user_id text,job_id text,job_image_index integer,created_at text,image_width integer,image_height integer); create table assets(id text primary key,user_id text,space text,shared integer,share_status text);");
  const profiles = createProfileStore(db), sets = createImageSetStore(db);
  const count = (table: string) => (db.query(`select count(*) as n from ${table}`).get() as { n: number }).n;
  return { db, profiles, sets, count };
}
describe("personal creative examples", () => {
  test("catalog keeps three distinct private brands, service/product facts and durable per-type markers", () => {
    const f=fixture();
    for(const id of CREATIVE_EXAMPLE_IDS){
      const seed=ensureCreativeExample(f.db,"a",undefined,id), again=ensureCreativeExample(f.db,"a",undefined,id), other=ensureCreativeExample(f.db,"b",undefined,id);
      expect(seed.setId).toBe(again.setId);expect(other.setId).not.toBe(seed.setId);
      const set=f.sets.get("a",seed.setId);expect(set.demoTemplate).toBe(id);expect(set.items).toHaveLength(6);expect(set.items.every(i=>i.copy&&i.purpose&&i.composition)).toBe(true);
      expect(f.profiles.get("a",seed.productId).details.facts).not.toBe("");expect(f.profiles.get("a",seed.brandId).shared).toBe(false);
      f.sets.remove("a",seed.setId,set.revision);expect(ensureCreativeExample(f.db,"a",undefined,id).created).toBe(false);
      expect(f.sets.list("a").items.some(s=>s.id===seed.setId)).toBe(false);
    }
    f.db.exec("insert into users(id) values ('c')");
    const manual=ensureCreativeExample(f.db,"c","first-manual","tea");expect(ensureCreativeExample(f.db,"c",undefined,"tea").setId).toBe(manual.setId);
    expect(()=>ensureCreativeExample(f.db,"a",undefined,"unknown")).toThrow("示例类型不存在");f.db.close();
  });
  test("creates independent private metadata for the asynchronous complete example initializer", () => {
    const f = fixture(); const a = ensureCreativeExample(f.db, "a"), b = ensureCreativeExample(f.db, "b");
    expect(a.setId).not.toBe(b.setId); expect(a.brandId).not.toBe(b.brandId); expect(a.productId).not.toBe(b.productId);
    const first = f.sets.get("a", a.setId), second = f.sets.get("b", b.setId);
    expect(first.items).toHaveLength(6); expect(first.isExample).toBe(true); expect(first.confirmed).toBe(false); expect(first.activeCount).toBe(0);
    expect(first.executionMode).toBe("demo");
    expect(first.items.every(item => !second.items.some(other => other.id === item.id))).toBe(true);
    expect(f.count("image_set_runs")).toBe(0); expect(f.count("images")).toBe(0);
    const brand = f.profiles.get("a", a.brandId), product = f.profiles.get("a", a.productId);
    expect(brand.shared).toBe(false); expect(product.shared).toBe(false); expect(product.brandId).toBe(brand.id); expect(product.variants).toHaveLength(1);
    expect(first.profileSelection.productId).toBe(product.id); expect(first.profileSelection.variantId).toBe(product.variants[0].id);
    expect(f.profiles.list("b", "brand").items.map(value => value.id)).toEqual([b.brandId]);
    expect(() => f.sets.get("b", a.setId)).toThrow("无权"); expect(() => f.profiles.get("b", a.productId)).toThrow("无权"); f.db.close();
  });
  test("keeps edits and archives unchanged across repeated initialization", () => {
    const f = fixture(), seed = ensureCreativeExample(f.db, "a");
    const project = f.sets.get("a", seed.setId), brand = f.profiles.get("a", seed.brandId);
    f.sets.save("a", { ...project, name: "用户自己的方案" }, project.id); f.sets.archive("a", project.id, true);
    f.profiles.save("a", "brand", { ...brand, name: "用户自己的品牌", archived: true }, brand.id);
    expect(ensureCreativeExample(f.db, "a").created).toBe(false);
    expect(f.sets.get("a", seed.setId).name).toBe("用户自己的方案"); expect(f.sets.get("a", seed.setId).archived).toBe(true);
    expect(f.profiles.get("a", seed.brandId).name).toBe("用户自己的品牌"); expect(f.profiles.get("a", seed.brandId).archived).toBe(true);
    expect(f.count("image_sets")).toBe(1); expect(f.count("creative_profiles")).toBe(2); f.db.close();
  });
  test("supports deliberate deletion and never silently recreates removed examples", () => {
    const f = fixture(), seed = ensureCreativeExample(f.db, "a");
    const product = f.profiles.get("a", seed.productId), brand = f.profiles.get("a", seed.brandId);
    expect(() => f.profiles.remove("a", brand.id, brand.revision, "brand")).toThrow("产品引用");
    expect(() => f.profiles.remove("a", product.id, product.revision, "product")).toThrow("套图或对话引用");
    f.sets.remove("a", seed.setId, f.sets.get("a", seed.setId).revision);
    f.profiles.remove("a", product.id, product.revision, "product"); f.profiles.remove("a", brand.id, brand.revision, "brand");
    expect(ensureCreativeExample(f.db, "a").created).toBe(false); expect(f.count("image_sets")).toBe(0); expect(f.count("creative_profiles")).toBe(0);
    const newExample = ensureCreativeExample(f.db, "a", "explicit-add"); expect(newExample.created).toBe(true); expect(newExample.setId).not.toBe(seed.setId); f.db.close();
  });
  test("deduplicates retried manual requests while separate requests create independent examples", () => {
    const f = fixture(); const first = ensureCreativeExample(f.db, "a", "same-request"), retry = ensureCreativeExample(f.db, "a", "same-request");
    expect(retry).toEqual({ ...first, created: false });
    expect(ensureCreativeExample(f.db, "a")).toEqual({ ...first, created: false }); expect(f.count("image_sets")).toBe(1);
    const other = ensureCreativeExample(f.db, "a", "new-request"); expect(other.setId).not.toBe(first.setId); expect(f.count("image_sets")).toBe(2); f.db.close();
  });
  test("rolls all example records back together on a failed initialization", () => {
    const f = fixture(); f.db.exec("create trigger fail_set before insert on image_sets begin select raise(abort,'fixture failure'); end;");
    expect(() => ensureCreativeExample(f.db, "a")).toThrow("fixture failure");
    expect(f.count("creative_profiles")).toBe(0); expect(f.count("image_sets")).toBe(0); expect(f.count("creative_example_seeds")).toBe(0);
    f.db.exec("drop trigger fail_set"); expect(ensureCreativeExample(f.db, "a").created).toBe(true); f.db.close();
  });
  test("backfills existing users once and includes newly added users without seeding disabled users", () => {
    const f = fixture(); expect(ensureAllCreativeExamples(f.db)).toBe(2); expect(ensureAllCreativeExamples(f.db)).toBe(0);
    f.db.exec("insert into users values ('c',0),('disabled',1)"); expect(ensureAllCreativeExamples(f.db)).toBe(1); expect(f.count("image_sets")).toBe(3);
    expect(() => ensureCreativeExample(f.db, "missing")).toThrow("用户不存在"); expect(() => ensureCreativeExample(f.db, "a", "")).toThrow("标识无效"); f.db.close();
  });
  test("normal copies and arbitrary requests cannot forge the example origin", () => {
    const f = fixture(), seed = ensureCreativeExample(f.db, "a"), brand = f.profiles.get("a", seed.brandId), project = f.sets.get("a", seed.setId);
    expect(f.profiles.save("a", "brand", { ...brand, isExample: true }).isExample).toBe(false);
    const items = project.items.map(item => ({ ...item, id: creativeId("slot") }));
    const copy = f.sets.save("a", { ...project, items, anchorItemId: items[0].id, isExample: true, executionMode: "demo" });
    expect(copy.isExample).toBe(false); expect(copy.executionMode).toBe("provider");expect(copy.demoTemplate).toBeUndefined();
    expect(f.sets.save("a", { ...project, executionMode: "provider" }, project.id).executionMode).toBe("demo"); f.db.close();
  });
  test("migration keeps existing ordinary content and initialization is repeatable", () => {
    const f = fixture(); const brand = f.profiles.save("a", "brand", { name: "已有资料" });
    f.db.exec("alter table creative_profiles drop column is_example; alter table image_sets drop column is_example;alter table image_sets drop column demo_template;");
    initImageSetSchema(f.db); initImageSetSchema(f.db);
    expect(f.profiles.get("a", brand.id).isExample).toBe(false); ensureCreativeExample(f.db, "a"); expect(f.profiles.get("a", brand.id).name).toBe("已有资料");
    f.db.exec("delete from users where id='a'"); expect(f.count("creative_example_seeds")).toBe(0); f.db.close();
  });
});
describe("creative record deletion", () => {
  test("rejects another owner and stale revisions, and keeps completed images when a project is removed", () => {
    const f = fixture(), seed = ensureCreativeExample(f.db, "a"), project = f.sets.get("a", seed.setId);
    expect(() => f.sets.remove("b", project.id, project.revision)).toThrow("无权"); expect(() => f.sets.remove("a", project.id, project.revision + 1)).toThrow("已更新");
    f.db.query("insert into image_set_runs values ('run',?,?,'job','request',0,'queued',1,1,'{}','','now','now')").run(project.id, project.items[0].id);
    expect(() => f.sets.remove("a", project.id, project.revision)).toThrow("停止任务");
    f.db.exec("update image_set_runs set status='succeeded';insert into images values ('image','a','job',1,'now',1024,1024)");
    f.sets.remove("a", project.id, project.revision); expect(f.count("image_set_runs")).toBe(0); expect(f.count("image_set_items")).toBe(0); expect(f.count("images")).toBe(1); f.db.close();
  });
  test("a shared profile can only be removed by its owner and chat references are protected", () => {
    const f = fixture(); const profile = f.profiles.save("a", "product", { name: "个人资料", shared: true });
    expect(() => f.profiles.remove("b", profile.id, profile.revision, "product")).toThrow("自己的档案");
    expect(() => f.profiles.remove("a", profile.id, profile.revision + 1, "product")).toThrow("已更新");
    f.db.exec("insert into sessions(id,user_id) values ('chat','a')");
    f.db.query("insert into creative_session_context values ('chat','a',?)").run(JSON.stringify({ productId: profile.id }));
    expect(() => f.profiles.remove("a", profile.id, profile.revision, "product")).toThrow("对话引用");
    f.db.exec("delete from creative_session_context"); expect(f.profiles.remove("a", profile.id, profile.revision, "product")).toEqual({ ok: true }); f.db.close();
  });
});
