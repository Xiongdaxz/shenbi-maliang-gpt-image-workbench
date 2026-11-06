import type { CreativeProfile, ImageSet, ProfileContext, ProfileDetails, ProductVariant } from "../types";

const builtInCopy: [string, string][] = [
  ["虚构的新茶饮品牌", "新茶饮品牌"],
  ["所有品牌资料、饮品与画面均为示例。", ""],
  ["虚构的住宅室内设计工作室", "住宅室内设计工作室"],
  ["展示的是创作示意空间，不代表真实客户项目。", ""],
  ["虚构的生活方式品牌", "生活方式品牌"],
  ["品牌、产品规格与摄影均为创作示例。", ""],
  ["用于熟悉品牌产品与套图流程的虚构品牌，可以直接修改、复制、归档或删除。", "统一维护品牌视觉资料，可直接修改、复制、归档或删除。"],
  ["虚构的团队协作软件示例，演示通用产品资料的维护方式。", "团队协作软件，用于统一管理任务、进度与资料。"],
  ["虚构饮品：", "饮品："], ["示例原料为", "原料为"], ["示例服务包含", "服务包含"], ["示例产品为", "产品为"], ["示例功能：", "功能："],
  ["未设定真实", "尚未填写"],
  ["此处全部为模拟资料，正式使用前请替换。", ""],
  ["面向团队协作的虚构服务方案，不包含真实价格或权益承诺。", "面向团队协作的服务方案，价格与权益以确认资料为准。"],
  ["为虚构茶饮品牌茶屿", "为茶饮品牌茶屿"], ["为虚构室内设计品牌栖间", "为室内设计品牌栖间"], ["为虚构品牌山行", "为品牌山行"], ["为虚构的青禾协作平台", "为青禾协作平台"],
  ["资料均为模拟示例，可以自行替换；本方案尚未生成图片。", ""],
  ["品牌、产品和画面均为模拟示例，可自行管理。", ""],
  ["解释一个已确认的示例功能", "解释一个已确认的功能"]
];
function builtInText(value: string) {
  return builtInCopy.reduce((text, [before, after]) => text.replaceAll(before, after), value);
}
function builtInName(value: string) {
  return value.replace(/^示例\s*·\s*/, "").replace(/\s*·\s*示例(?:品牌|产品|规格|服务)(?=\s*·|$)/g, "");
}
function builtInCopyName(value: string) {
  return /^(?:示例 · (?:茶屿 · 桂花乌龙上新|栖间 · 温润住宅设计|山行 · 日常帆布袋|协作平台发布套图)(?: · 从头体验)?|(?:茶屿|栖间|山行|青禾) · 示例品牌|(?:桂花乌龙轻乳茶|温润住宅空间设计服务|日常棉帆布托特袋|青禾协作平台) · 示例产品)(?: · 副本)+$/.test(value);
}
function details(value: Partial<ProfileDetails>) {
  return Object.fromEntries(Object.entries(value).map(([key, text]) => [key, builtInText(text)]));
}
function variant(value: ProductVariant): ProductVariant {
  return { ...value, name: builtInName(value.name), details: details(value.details) };
}
function profile(value: CreativeProfile): CreativeProfile {
  if (!value.isExample && !builtInCopyName(value.name)) return value;
  return { ...value, name: builtInName(value.name), details: details(value.details) as ProfileDetails, variants: value.variants.map(variant) };
}
function imageSet(value: ImageSet): ImageSet {
  if (!value.isExample && !builtInCopyName(value.name)) return value;
  return { ...value, name: builtInName(value.name), brief: builtInText(value.brief), items: value.items.map(item => ({ ...item, purpose: builtInText(item.purpose) })) };
}
export function presentCreativeContext(value: ProfileContext): ProfileContext {
  return { ...value,
    brand: value.brand ? profile(value.brand) : null,
    product: value.product ? profile(value.product) : null,
    variant: value.variant && value.product && (value.product.isExample || builtInCopyName(value.product.name)) ? variant(value.variant) : value.variant };
}

// Present built-in records like other creative records without changing stored data or execution mode.
export function presentCreativeResponse<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const data = value as { profile?: CreativeProfile; set?: ImageSet; context?: ProfileContext; items?: unknown[] };
  const result = { ...data };
  if (data.profile) result.profile = profile(data.profile);
  if (data.set) result.set = imageSet(data.set);
  if (data.context) result.context = presentCreativeContext(data.context);
  if (data.items) result.items = data.items.map(item => {
    if (!item || typeof item !== "object" || !("isExample" in item)) return item;
    return "kind" in item ? profile(item as CreativeProfile) : "brief" in item ? imageSet(item as ImageSet) : item;
  });
  return result as T;
}
