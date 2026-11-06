import type { Database } from "bun:sqlite";
import { DEFAULT_IMAGE_MODEL } from "./constants";
import { createProfileStore, creativeId, creativeNow, CreativeInputError } from "./creativeProfiles";
import { createImageSetStore } from "./imageSets";
import { creativeExampleDefinition } from "./creativeExampleCatalog";

const DEFAULT_SEED_KEY = "starter-v1";
export type CreativeExample = { brandId: string; productId: string; setId: string; created: boolean };

export function ensureCreativeExample(db: Database, userId: string, requestId?: string, templateId?: string): CreativeExample {
  if (!userId || !db.query("select id from users where id=?").get(userId)) throw new CreativeInputError("用户不存在", 404);
  if (requestId !== undefined && (!requestId.trim() || requestId.length > 200)) throw new CreativeInputError("示例请求标识无效");
  const template = creativeExampleDefinition(templateId);
  if (templateId !== undefined && !template) throw new CreativeInputError("示例类型不存在");
  const defaultKey = template ? `catalog-v1:${template.id}` : DEFAULT_SEED_KEY;
  const key = template ? requestId === undefined ? `catalog-v1:${template.id}` : `catalog-manual:${template.id}:${requestId}` : requestId === undefined ? DEFAULT_SEED_KEY : `manual:${requestId}`;
  return db.transaction(() => {
    const previous = db.query("select brand_id,product_id,set_id from creative_example_seeds where user_id=? and seed_key=?").get(userId, key) as { brand_id: string; product_id: string; set_id: string } | null;
    if (previous) return { brandId: previous.brand_id, productId: previous.product_id, setId: previous.set_id, created: false };
    const initializeDefault = requestId !== undefined && !db.query("select 1 from creative_example_seeds where user_id=? and seed_key=?").get(userId, defaultKey);
    const profiles = createProfileStore(db), sets = createImageSetStore(db);
    const brand = profiles.save(userId, "brand", {
      name: template ? `${template.brand} · 示例品牌` : "青禾 · 示例品牌", shared: false,
      details: { description: template?.description || "用于熟悉品牌产品与套图流程的虚构品牌，可以直接修改、复制、归档或删除。",
        visualStyle: template?.style || "自然、简洁，使用柔和光线、整齐栅格和充足留白。", colors: template?.colors.join(" ") || "#A1D9C6 #F4F1E8 #214C3D",
        tone: "温和、清晰、专业", rules: "品牌名称和标识保持一致；价格、日期与宣传数据必须由用户确认。" }
    });
    const product = profiles.save(userId, "product", {
      name: template ? `${template.product} · 示例产品` : "青禾协作平台 · 示例产品", brandId: brand.id, shared: false,
      details: { description: template?.description || "虚构的团队协作软件示例，演示通用产品资料的维护方式。",
        facts: template?.facts || "示例功能：任务看板、项目进度、资料共享。此处全部为模拟资料，正式使用前请替换。",
        features: template?.features || "让团队集中查看工作、清晰沟通进度、方便查找资料。", rules: "仅使用这里列出的确认事实，不添加价格、性能排名、认证或未确认的承诺。" },
      variants: [{ id: creativeId("variant"), name: template?.variant || "团队版 · 示例规格", details: { facts: template?.facts || "面向团队协作的虚构服务方案，不包含真实价格或权益承诺。" }, assets: [] }]
    });
    const placements = template?.placements || [
      ["活动主视觉", "1536x2048", "发布宣传主题与整体视觉", "把想法，汇成一股力量", "标题与抽象协作卡片构成主视觉，保留清晰的品牌位置。"],
      ["社媒方图", "1024x1024", "适合社交平台分享的简洁介绍", "让协作，一目了然", "方形画面，突出一个核心信息，文字与图形保持呼吸感。"],
      ["竖版宣传图", "1152x2048", "用于移动端阅读的产品介绍", "团队工作，清晰有序", "竖向排列任务、进度、资料三个信息区，避免细小密集文字。"],
      ["横版横幅", "2048x1152", "用于横向页面头图或演示封面", "让每一次协作更顺畅", "横向留白布局，左侧标题、右侧示意图，沿用基准图配色。"],
      ["重点内容图", "1024x1024", "解释一个已确认的示例功能", "任务与进度，在同一处", "突出任务卡片与进度模块，保持内容层次清晰。"],
      ["行动引导图", "1536x2048", "为下一步行动提供明确提示", "开启你的团队协作", "用一条清楚的行动文案收束整套画面，不添加虚构网址和二维码。"]
    ];
    const items = placements.map(([name, size, purpose, copy, composition]) => ({ id: creativeId("slot"), name, size, purpose, copy, composition }));
    const set = sets.save(userId, { name: template ? `示例 · ${template.name}` : "示例 · 协作平台发布套图", brief: template?.brief || "为虚构的青禾协作平台策划六个用途不同、视觉统一的宣传版位。资料均为模拟示例，可以自行替换；本方案尚未生成图片。",
      commonStyle: template?.style || "鼠尾草绿与奶油白，深绿色标题，简洁栅格，柔和光线。整套统一字体层级与品牌位置，按不同版位重新构图。",
      profileSelection: { brandId: brand.id, productId: product.id, variantId: product.variants[0].id }, assetIds: [],
      providerId: "", model: DEFAULT_IMAGE_MODEL, quality: "high", anchorItemId: items[0].id, items });
    db.query("update creative_profiles set is_example=1 where user_id=? and id in (?,?)").run(userId, brand.id, product.id);
    db.query("update image_sets set is_example=1,execution_mode='demo',demo_template=? where user_id=? and id=?").run(template?.id || "", userId, set.id);
    db.query("insert into creative_example_seeds (user_id,seed_key,brand_id,product_id,set_id,created_at) values (?,?,?,?,?,?)").run(userId, key, brand.id, product.id, set.id, creativeNow());
    if (initializeDefault) db.query("insert into creative_example_seeds (user_id,seed_key,brand_id,product_id,set_id,created_at) values (?,?,?,?,?,?)").run(userId, defaultKey, brand.id, product.id, set.id, creativeNow());
    return { brandId: brand.id, productId: product.id, setId: set.id, created: true };
  }).immediate();
}

export function ensureAllCreativeExamples(db: Database) {
  const users = db.query("select id from users where disabled=0 and not exists (select 1 from creative_example_seeds where user_id=users.id and seed_key=?)").all(DEFAULT_SEED_KEY) as { id: string }[];
  let created = 0;
  for (const user of users) if (ensureCreativeExample(db, user.id).created) created++;
  return created;
}
