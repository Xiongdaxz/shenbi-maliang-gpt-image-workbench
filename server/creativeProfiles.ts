import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { CreativeProfile, CreativeProfileKind, ProfileAsset, ProfileContext, ProfileDetails, ProfileSelection, ProductVariant } from "../src/types/imageSets";

export class CreativeInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const creativeId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
export const creativeNow = () => new Date().toISOString();
export const jsonValue = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
export const recordValue = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function creativeText(value: unknown, max = 12000) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new CreativeInputError(`内容超过 ${max} 字符`);
  return text;
}
export function creativeIds(value: unknown, max = 20) {
  if (!Array.isArray(value)) return [];
  if (value.length > max) throw new CreativeInputError(`最多选择 ${max} 项`);
  return [...new Set(value.map(v => creativeText(v, 200)).filter(Boolean))];
}
const detailKeys = ["description", "visualStyle", "colors", "tone", "rules", "facts", "features"] as const;
export function normalizeProfileDetails(value: unknown): ProfileDetails {
  const input = recordValue(value);
  return Object.fromEntries(detailKeys.map(key => [key, creativeText(input[key])])) as ProfileDetails;
}
export function normalizeProfileAssets(value: unknown): ProfileAsset[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 20) throw new CreativeInputError("最多关联 20 张参考素材");
  const seen = new Set<string>();
  return value.map(v => {
    const a = recordValue(v), assetId = creativeText(a.assetId, 200);
    if (!assetId || seen.has(assetId)) throw new CreativeInputError("参考素材缺失或重复");
    seen.add(assetId);
    const role = a.role;
    if (!["identity", "logo", "style", "composition"].includes(String(role))) throw new CreativeInputError("参考素材用途无效");
    return { assetId, role, note: creativeText(a.note, 1000) } as ProfileAsset;
  });
}
export function normalizeProductVariants(value: unknown): ProductVariant[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 30) throw new CreativeInputError("最多维护 30 个版本／规格");
  const seen = new Set<string>();
  return value.map(v => {
    const raw = recordValue(v), id = creativeText(raw.id, 200) || creativeId("variant"), name = creativeText(raw.name, 120);
    if (!name || seen.has(id)) throw new CreativeInputError("版本／规格名称缺失或编号重复");
    seen.add(id);
    const details = recordValue(raw.details);
    return { id, name, details: Object.fromEntries(detailKeys.filter(k => k in details).map(k => [k, creativeText(details[k])])), assets: normalizeProfileAssets(raw.assets) };
  });
}
type ProfileRow = { id: string; kind: CreativeProfileKind; user_id: string; name: string; brand_id: string; shared: number; archived: number; revision: number; details_json: string; assets_json: string; variants_json: string; created_at: string; updated_at: string; is_example: number };
function publicProfile(r: ProfileRow): CreativeProfile {
  return { id: r.id, kind: r.kind, ownerId: r.user_id, name: r.name, brandId: r.brand_id, shared: Boolean(r.shared), archived: Boolean(r.archived), revision: r.revision, isExample: Boolean(r.is_example),
    details: jsonValue(r.details_json, normalizeProfileDetails({})), assets: jsonValue(r.assets_json, []), variants: jsonValue(r.variants_json, []), createdAt: r.created_at, updatedAt: r.updated_at };
}
export function createProfileStore(db: Database) {
  function get(userId: string, id: string, kind?: CreativeProfileKind): CreativeProfile {
    const row = db.query("select * from creative_profiles where id=? and (user_id=? or shared=1)").get(id, userId) as ProfileRow | null;
    if (!row || (kind && row.kind !== kind)) throw new CreativeInputError("档案不存在或无权访问", 404);
    return publicProfile(row);
  }
  function validateAssets(userId: string, assets: ProfileAsset[], publishing = false) {
    for (const { assetId } of assets) {
      const asset = db.query("select user_id, space, shared, share_status from assets where id=?").get(assetId) as { user_id: string; space: string; shared: number; share_status: string } | null;
      const approved = asset && (asset.space === "shared" || asset.shared === 1) && (asset.share_status ?? "approved") === "approved";
      if (!asset || (asset.user_id !== userId && !approved)) throw new CreativeInputError("参考素材不存在或无权访问", 403);
      if (publishing && !approved) throw new CreativeInputError("共享档案需先将引用素材设为审核通过的共享素材");
    }
  }
  function readable(userId: string, profile: CreativeProfile) {
    validateAssets(userId, [...profile.assets, ...profile.variants.flatMap(v => v.assets)]);
    if (profile.brandId) {
      const brand = get(userId, profile.brandId, "brand");
      validateAssets(userId, brand.assets);
    }
    return profile;
  }
  function save(userId: string, kind: CreativeProfileKind, value: unknown, id?: string) {
    const input = recordValue(value), previous = id ? get(userId, id, kind) : null;
    if (previous && previous.ownerId !== userId) throw new CreativeInputError("请复制共享档案后再修改", 403);
    if (previous && Number(input.revision) !== previous.revision) throw new CreativeInputError("档案已更新，请刷新后再保存", 409);
    const name = creativeText(input.name, 120);
    if (!name) throw new CreativeInputError("请输入档案名称");
    const shared = input.shared === true, assets = normalizeProfileAssets(input.assets), variants = kind === "product" ? normalizeProductVariants(input.variants) : [];
    const brandId = kind === "product" ? creativeText(input.brandId, 200) : "";
    validateAssets(userId, [...assets, ...variants.flatMap(v => v.assets)], shared);
    if (brandId) {
      const brand = readable(userId, get(userId, brandId, "brand"));
      if (brand.archived) throw new CreativeInputError("关联品牌已归档");
      if (shared && !brand.shared) throw new CreativeInputError("共享产品需先共享其关联品牌");
    }
    const timestamp = creativeNow(), nextId = id || creativeId(kind), details = normalizeProfileDetails(input.details);
    if (previous) {
      db.query("update creative_profiles set name=?,brand_id=?,shared=?,archived=?,revision=revision+1,details_json=?,assets_json=?,variants_json=?,updated_at=? where id=? and user_id=? and revision=?")
        .run(name, brandId, shared ? 1 : 0, input.archived === true ? 1 : 0, JSON.stringify(details), JSON.stringify(assets), JSON.stringify(variants), timestamp, nextId, userId, previous.revision);
    } else db.query("insert into creative_profiles (id,kind,user_id,name,brand_id,shared,details_json,assets_json,variants_json,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)")
      .run(nextId, kind, userId, name, brandId, shared ? 1 : 0, JSON.stringify(details), JSON.stringify(assets), JSON.stringify(variants), timestamp, timestamp);
    return get(userId, nextId, kind);
  }
  function list(userId: string, kind: CreativeProfileKind, keyword = "", archived = false, cursor = "") {
    const rows = db.query("select * from creative_profiles where kind=? and (user_id=? or shared=1) and archived=? and name like ? and (?='' or id>?) order by id limit 31")
      .all(kind, userId, archived ? 1 : 0, `%${keyword}%`, cursor, cursor) as ProfileRow[];
    const items = rows.slice(0, 30).map(publicProfile).filter(p => { try { readable(userId, p); return true; } catch { return false; } });
    return { items, nextCursor: rows.length > 30 ? rows[29].id : null };
  }
  function resolve(userId: string, value: unknown): ProfileContext {
    const s = recordValue(value), productId = creativeText(s.productId, 200), variantId = creativeText(s.variantId, 200);
    const product = productId ? readable(userId, get(userId, productId, "product")) : null;
    const brandId = creativeText(s.brandId, 200) || product?.brandId || "";
    if (product?.brandId && brandId !== product.brandId) throw new CreativeInputError("品牌与产品不匹配");
    const brand = brandId ? readable(userId, get(userId, brandId, "brand")) : null;
    if (brand?.archived || product?.archived) throw new CreativeInputError("所选档案已归档，请重新选择");
    const variant = variantId ? product?.variants.find(v => v.id === variantId) ?? null : null;
    if (variantId && !variant) throw new CreativeInputError("产品版本／规格不存在");
    const details = product ? { ...product.details, ...variant?.details } : null;
    const assets = [...(brand?.assets ?? []), ...(variant?.assets.length ? variant.assets : product?.assets ?? [])];
    const uniqueAssets = assets.filter((a, i) => assets.findIndex(b => b.assetId === a.assetId) === i);
    const lines: string[] = [];
    for (const [label, profile, fields] of [["品牌", brand, brand?.details], ["产品", product, details]] as const) {
      if (!profile || !fields) continue;
      lines.push(`${label}：${profile.name}${label === "产品" && variant ? ` · ${variant.name}` : ""}`);
      for (const k of detailKeys) if (fields[k]) lines.push(`${k}：${fields[k]}`);
    }
    if (uniqueAssets.length) lines.push("参考素材用途：", ...uniqueAssets.map((a, i) => `${i + 1}. ${a.role}${a.note ? `；${a.note}` : ""}`));
    return { selection: { ...(brandId ? { brandId } : {}), ...(productId ? { productId } : {}), ...(variantId ? { variantId } : {}) }, brand, product, variant, assets: uniqueAssets, instruction: lines.join("\n") };
  }
  function remove(userId: string, id: string, revision: number, kind: CreativeProfileKind) {
    return db.transaction(() => {
      const profile = get(userId, id, kind);
      if (profile.ownerId !== userId) throw new CreativeInputError("只能删除自己的档案", 403);
      if (profile.revision !== revision) throw new CreativeInputError("档案已更新，请刷新后再删除", 409);
      const field = kind === "brand" ? "$.brandId" : "$.productId";
      if (kind === "brand" && db.query("select id from creative_profiles where brand_id=? limit 1").get(id)) throw new CreativeInputError("品牌仍被产品引用，请先解除关联或删除产品，也可以使用归档", 409);
      if (db.query("select id from image_sets where json_extract(selection_json,?)=? limit 1").get(field, id) ||
        db.query(`select context.session_id from creative_session_context context
          join sessions on sessions.id=context.session_id and sessions.user_id=context.user_id
          where sessions.deleted_at is null and json_extract(context.selection_json,?)=? limit 1`).get(field, id)) {
        throw new CreativeInputError("档案仍被套图或对话引用，请先解除关联或删除相关记录，也可以使用归档", 409);
      }
      db.query("delete from creative_profiles where id=? and user_id=?").run(id, userId);
      return { ok: true };
    }).immediate();
  }
  return { get, readable, save, list, resolve, validateAssets, remove };
}
