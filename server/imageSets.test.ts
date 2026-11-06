import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createImageSetStore, compileSetPrompt, normalizeSetItems } from "./imageSets";
import { createProfileStore, normalizeProfileDetails } from "./creativeProfiles";
import { initImageSetSchema } from "./imageSetSchema";
import type { ImageSetInput, ProfileContext, WorkImage } from "../src/types";

function fixture() {
  const db = new Database(":memory:"); initImageSetSchema(db);
  db.exec(`create table assets(id text primary key,user_id text,space text,shared integer,share_status text);
    create table images(id text primary key,user_id text,job_id text,job_image_index integer,created_at text,image_width integer,image_height integer);`);
  const store = createImageSetStore(db, rows => rows.map(v => { const r = v as Record<string, unknown>; return { id: r.id, imageWidth: r.image_width, imageHeight: r.image_height } as WorkImage; }));
  const profiles = createProfileStore(db);
  const input: ImageSetInput = { name: "推广服务", brief: "制作通用营销素材，文案 3 个特点，参考图1和图2。", commonStyle: "简洁", profileSelection: {}, assetIds: [], providerId: "", model: "", quality: "high", anchorItemId: "base", items: [
    { id: "base", name: "主视觉", size: "1024x1024", purpose: "主题", copy: "3 个特点", composition: "" },
    { id: "banner", name: "横幅", size: "2048x1152", purpose: "行动", copy: "", composition: "" } ] };
  let set = store.save("a", input);
  const confirm = (context: ProfileContext = profiles.resolve("a", {})) => { set = store.confirm("a", set.id, set.revision, context, ["frozen-ref"], "session"); return set; };
  const complete = (itemId: string, requestId: string, dimensions?: [number, number]) => {
    const r = db.query("select * from image_set_runs where set_id=? and item_id=? and client_request_id=? order by candidate_index limit 1").get(set.id, itemId, requestId) as { id: string; job_id: string };
    const size = input.items.find(i => i.id === itemId)!.size.split("x").map(Number);
    db.query("insert into images values (?,?,?,?,?,?,?)").run(r.id, "a", r.job_id, 1, "2026-10-08", ...(dimensions || size));
    db.query("update image_set_runs set status='succeeded' where id=?").run(r.id);
    return r.id;
  };
  const anchor = () => { confirm(); store.enqueue("a", set.id, ["base"], "anchor", 1); const imageId = complete("base", "anchor"); set = store.select("a", set.id, "base", imageId, false, "frozen-anchor"); return imageId; };
  return { db, store, profiles, input, get set() { return store.get("a", set.id); }, confirm, complete, anchor };
}
describe("image set lifecycle", () => {
  test("demo styles reuse completed results without changing adoption and reject provider projects", () => {
    const f=fixture();f.anchor();
    expect(()=>f.store.demoStyle("a",f.set.id,"banner","airy","not-demo")).toThrow("模拟");
    f.db.query("update image_sets set execution_mode='demo',demo_template='interior' where id=?").run(f.set.id);
    f.store.demoStyle("a",f.set.id,"banner","airy","airy");const first=f.complete("banner","airy");f.store.select("a",f.set.id,"banner",first);
    const repeated=f.store.demoStyle("a",f.set.id,"banner","airy","airy-again");
    expect(repeated.imageId).toBe(first);expect(repeated.set.items[1].runs).toHaveLength(1);expect(repeated.set.items[1].selectedImageId).toBe(first);
    for(const style of ["dark","editorial"] as const){f.store.demoStyle("a",f.set.id,"banner",style,style);f.complete("banner",style);}
    expect(new Set(f.set.items[1].runs.map(run=>run.demoStyle)).size).toBe(3);expect(f.set.items[1].selectedImageId).toBe(first);
    const current=f.set;f.store.save("a",{...current,items:current.items.map(item=>item.id==="banner"?{...item,copy:"Changed text"}:item)},current.id);
    f.store.demoStyle("a",f.set.id,"banner","airy","new-content");expect(f.set.items[1].runs).toHaveLength(4);
    expect(()=>f.store.demoStyle("b",f.set.id,"banner","dark","other-user")).toThrow("无权");f.db.close();
  });
  test("legacy demo candidates are retained and not mistaken for a new layout recipe",()=>{
    const f=fixture();f.anchor();f.db.query("update image_sets set execution_mode='demo' where id=?").run(f.set.id);
    f.store.demoStyle("a",f.set.id,"banner","airy","legacy");f.complete("banner","legacy");
    f.db.query("update image_set_runs set snapshot_json=json_remove(snapshot_json,'$.demo.artworkVersion') where client_request_id='legacy'").run();
    f.store.demoStyle("a",f.set.id,"banner","airy","v2");expect(f.set.items[1].runs).toHaveLength(2);expect(f.set.items[1].runs.filter(run=>run.demoStyle)).toHaveLength(1);f.db.close();
  });
  test("edited demo candidates are not advertised as reusable preset styles",()=>{
    const f=fixture();f.anchor();f.db.query("update image_sets set execution_mode='demo' where id=?").run(f.set.id);
    f.store.demoStyle("a",f.set.id,"banner","airy","preset");const source=f.complete("banner","preset");
    f.store.enqueue("a",f.set.id,["banner"],"edited",1,source,{copy:"Personal headline",color:"forest"});f.complete("banner","edited");
    const edited=f.set.items[1].runs.find(run=>run.images.some(image=>image.id!==source));expect(edited?.demoStyle).toBeUndefined();
    expect(f.store.demoStyle("a",f.set.id,"banner","airy","reuse").imageId).toBe(source);f.db.close();
  });
  test("requires a confirmed plan and accepted baseline, while ordinary text numbering stays in one placement", () => {
    const f = fixture(); expect(() => f.store.enqueue("a", f.set.id, ["base"], "x")).toThrow("确认方案"); f.confirm();
    expect(() => f.store.enqueue("a", f.set.id, ["banner"], "x")).toThrow("基准图");
    const prompt = compileSetPrompt(f.input, f.input.items[0], null, false); expect(prompt).toContain("3 个特点"); expect(prompt).toContain("编号不表示输出数量"); f.db.close();
  });
  test("duplicate submission produces only the requested candidates and does not replace selections", () => {
    const f = fixture(); f.confirm(); f.store.enqueue("a", f.set.id, ["base"], "same", 2); f.store.enqueue("a", f.set.id, ["base"], "same", 2);
    expect(f.set.items[0].runs).toHaveLength(2); expect(f.set.items[0].selectedImageId).toBe(""); f.db.close();
  });
  test("each placement freezes its own size, prompt and reference snapshot", () => {
    const f = fixture(); f.anchor(); expect(f.set.items[0].runs[0].contextRevision).toBe(f.set.contextRevision); f.store.enqueue("a", f.set.id, ["banner"], "rest");
    const snapshot = JSON.parse((f.db.query("select snapshot_json from image_set_runs where client_request_id='rest'").get() as { snapshot_json: string }).snapshot_json);
    expect(snapshot.size).toBe("2048x1152"); expect(snapshot.prompt).toContain("横幅"); expect(snapshot.referenceIds).toEqual(["frozen-ref", "frozen-anchor"]); f.db.close();
  });
  test("completed images survive stopping and can be adopted afterwards", () => {
    const f = fixture(); f.anchor(); f.store.enqueue("a", f.set.id, ["banner"], "rest"); const imageId = f.complete("banner", "rest");
    f.store.stop("a", f.set.id); expect(f.set.items[1].runs[0].images[0].id).toBe(imageId);
    f.store.select("a", f.set.id, "banner", imageId); expect(f.store.finalize("a", f.set.id).finalized).toBe(true); f.db.close();
  });
  test("requires explicit acceptance of actual dimensions", () => {
    const f = fixture(); f.confirm(); f.store.enqueue("a", f.set.id, ["base"], "small"); const imageId = f.complete("base", "small", [512, 512]);
    expect(() => f.store.select("a", f.set.id, "base", imageId, false, "snapshot")).toThrow("实际尺寸");
    expect(f.store.select("a", f.set.id, "base", imageId, true, "snapshot").anchorCurrent).toBe(true); f.db.close();
  });
  test("editing one placement only makes its selection stale", () => {
    const f = fixture(); f.anchor(); f.store.enqueue("a", f.set.id, ["banner"], "rest"); f.store.select("a", f.set.id, "banner", f.complete("banner", "rest"));
    const previous = f.set; const changed = f.store.save("a", { ...previous, items: previous.items.map(i => i.id === "banner" ? { ...i, copy: "新内容" } : i) }, previous.id);
    expect(changed.items[0].selectionCurrent).toBe(true); expect(changed.items[1].selectionCurrent).toBe(false);
    expect(() => f.store.finalize("a", changed.id)).toThrow("全部版位"); f.db.close();
  });
  test("common changes retain images and require confirmation and a fresh baseline", () => {
    const f = fixture(); f.anchor(); const previous = f.set;
    const next = f.store.save("a", { ...previous, commonStyle: "暗色" }, previous.id);
    expect(next.confirmed).toBe(false); expect(next.anchorCurrent).toBe(false); expect(next.items[0].runs[0].images).toHaveLength(1); f.db.close();
  });
  test("cannot modify a running plan or select an image from a different owner or placement", () => {
    const f = fixture(); f.confirm(); f.store.enqueue("a", f.set.id, ["base"], "busy");
    expect(() => f.store.save("a", f.set, f.set.id)).toThrow("停止"); expect(() => f.store.get("b", f.set.id)).toThrow("无权");
    f.store.stop("a", f.set.id); const imageId = f.complete("base", "busy");
    expect(() => f.store.select("a", f.set.id, "banner", imageId)).toThrow("不属于"); f.db.close();
  });
  test("a cross-project placement ID rolls back the entire save", () => {
    const f = fixture(); expect(() => f.store.save("b", { ...f.input, name: "其他项目" })).toThrow("不属于");
    expect((f.db.query("select count(*) as n from image_sets").get() as { n: number }).n).toBe(1); f.db.close();
  });
  test("changing a profile at confirmation invalidates adopted old-context results", () => {
    const f = fixture(); f.anchor(); const p = f.profiles.save("a", "brand", { name: "品牌", details: { colors: "红色" } });
    const next = f.store.confirm("a", f.set.id, f.set.revision, f.profiles.resolve("a", { brandId: p.id }), [], "session");
    expect(next.anchorCurrent).toBe(false); expect(next.items[0].selectionCurrent).toBe(false); f.db.close();
  });
  test("validates count, sizes and distinct placements before persistence", () => {
    expect(() => normalizeSetItems([])).toThrow(); expect(() => normalizeSetItems([{ name: "a", size: "auto" }, { name: "b", size: "512x512" }])).toThrow("尺寸");
    expect(() => normalizeSetItems([{ id: "same", name: "a", size: "512x512" }, { id: "same", name: "b", size: "512x512" }])).toThrow("重复");
  });
});
describe("brand and general product profiles", () => {
  test("requires approved public dependencies before publishing and does not expose private profiles", () => {
    const f = fixture(); f.db.exec("insert into assets values ('private','a','private',0,'none')");
    const p = f.profiles.save("a", "product", { name: "软件服务", assets: [{ assetId: "private", role: "identity" }] });
    expect(() => f.profiles.get("b", p.id)).toThrow("无权");
    expect(() => f.profiles.save("a", "product", { ...p, shared: true }, p.id)).toThrow("共享素材"); f.db.close();
  });
  test("a selected product version only uses its own references and inherits unspecified facts", () => {
    const f = fixture(); f.db.exec("insert into assets values ('v1','a','private',0,'none'),('v2','a','private',0,'none')");
    const p = f.profiles.save("a", "product", { name: "服务", details: { facts: "基础功能", rules: "保持名称" }, variants: [
      { id: "one", name: "专业版", details: { facts: "专业功能" }, assets: [{ assetId: "v1", role: "identity" }] },
      { id: "two", name: "团队版", assets: [{ assetId: "v2", role: "identity" }] } ] });
    const context = f.profiles.resolve("a", { productId: p.id, variantId: "one" });
    expect(context.assets.map(a => a.assetId)).toEqual(["v1"]); expect(context.instruction).toContain("专业功能"); expect(context.instruction).toContain("保持名称"); f.db.close();
  });
  test("revoked sharing, archived profiles and revision conflicts reject new use", () => {
    const f = fixture(); const p = f.profiles.save("a", "brand", { name: "品牌", shared: true }); expect(f.profiles.resolve("b", { brandId: p.id }).brand?.id).toBe(p.id);
    f.profiles.save("a", "brand", { ...p, shared: false, archived: true }, p.id);
    expect(() => f.profiles.resolve("b", { brandId: p.id })).toThrow(); expect(() => f.profiles.resolve("a", { brandId: p.id })).toThrow("归档");
    expect(() => f.profiles.save("a", "brand", p, p.id)).toThrow("已更新"); expect(normalizeProfileDetails({}).facts).toBe(""); f.db.close();
  });
});
