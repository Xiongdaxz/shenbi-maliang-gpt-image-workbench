import { expect, test } from "bun:test";
import type { CreativeProfile, ImageSet, ProfileContext } from "../types";
import { presentCreativeContext, presentCreativeResponse } from "./creativePresentation";

function builtInProfile(): CreativeProfile {
  return { id: "brand", kind: "brand", ownerId: "owner", name: "栖间 · 示例品牌", brandId: "", shared: false, archived: false, revision: 3, isExample: true,
    details: { description: "虚构的住宅室内设计工作室，关注自然光、居住动线与天然材质。展示的是创作示意空间，不代表真实客户项目。", colors: "#123456", visualStyle: "自然", tone: "温和", rules: "保留确认事实", facts: "示例服务包含需求沟通、空间方案、材质与软装建议。", features: "材质与自然光" },
    assets: [{ assetId: "logo", role: "logo", note: "保留标识" }], variants: [{ id: "variant", name: "住宅空间 · 示例服务", details: {}, assets: [] }], createdAt: "", updatedAt: "" };
}

test("built-in profile presentation removes labels while preserving IDs, assets and the source", () => {
  const source = builtInProfile(), before = structuredClone(source);
  const result = presentCreativeResponse({ items: [source], nextCursor: "cursor" });
  expect(result.items[0].name).toBe("栖间");
  expect(result.items[0].details.description).toBe("住宅室内设计工作室，关注自然光、居住动线与天然材质。");
  expect(result.items[0].details.facts).toStartWith("服务包含");
  expect(result.items[0].variants[0].name).toBe("住宅空间");
  expect(result.items[0].assets).toBe(source.assets);
  expect(result.items[0].id).toBe(source.id);
  expect(result.items[0].revision).toBe(3);
  expect(result.nextCursor).toBe("cursor");
  expect(source).toEqual(before);
});

test("ordinary records and custom text in built-in records remain unchanged", () => {
  const ordinary = { ...builtInProfile(), isExample: false };
  expect(presentCreativeResponse({ profile: ordinary }).profile).toBe(ordinary);
  const edited = { ...builtInProfile(), name: "客户品牌", details: { ...builtInProfile().details, description: "用户自己的说明，包含示例一词。" } };
  const result = presentCreativeResponse({ profile: edited }).profile;
  expect(result.name).toBe(edited.name);
  expect(result.details.description).toBe(edited.details.description);
});

test("set presentation retains simulation, snapshots, candidates and adoption", () => {
  const source = { id: "set", name: "示例 · 山行 · 日常帆布袋", brief: "为虚构品牌山行制作套图。", isExample: true, executionMode: "demo", snapshot: { frozen: true },
    items: [{ id: "slot", purpose: "解释一个已确认的示例功能", selectedImageId: "adopted", runs: [{ id: "run", images: [{ id: "adopted" }] }] }] } as unknown as ImageSet;
  const result = presentCreativeResponse({ set: source }).set;
  expect(result.name).toBe("山行 · 日常帆布袋");
  expect(result.brief).toBe("为品牌山行制作套图。");
  expect(result.executionMode).toBe("demo");
  expect(result.snapshot).toBe(source.snapshot);
  expect(result.items[0].selectedImageId).toBe("adopted");
  expect(result.items[0].runs).toBe(source.items[0].runs);
  expect(source.name).toBe("示例 · 山行 · 日常帆布袋");
});

test("resolved selections use the same names without rewriting execution instructions", () => {
  const product = { ...builtInProfile(), kind: "product" as const, name: "温润住宅空间设计服务 · 示例产品" };
  const context: ProfileContext = { selection: { productId: product.id, variantId: "variant" }, brand: null, product, variant: product.variants[0], assets: product.assets, instruction: "原始执行上下文" };
  const result = presentCreativeResponse({ context }).context;
  expect(result.product?.name).toBe("温润住宅空间设计服务");
  expect(result.variant?.name).toBe("住宅空间");
  expect(result.selection).toBe(context.selection);
  expect(result.instruction).toBe(context.instruction);
  expect(presentCreativeContext(context).product?.name).toBe(result.product?.name);
  expect(context.product?.name).toBe("温润住宅空间设计服务 · 示例产品");
  expect(context.variant?.name).toBe("住宅空间 · 示例服务");
});

test("existing catalog copies lose inherited name decorations while remaining normal projects", () => {
  const source = { id: "copy", name: "示例 · 茶屿 · 桂花乌龙上新 · 从头体验 · 副本", brief: "用户自己的需求", isExample: false, executionMode: "provider", items: [] } as unknown as ImageSet;
  const result = presentCreativeResponse({ set: source }).set;
  expect(result.name).toBe("茶屿 · 桂花乌龙上新 · 从头体验 · 副本");
  expect(result.executionMode).toBe("provider");
  expect(result.isExample).toBe(false);
  expect(result.brief).toBe(source.brief);
  const ordinary = { ...source, name: "示例 · 用户自己命名的项目" };
  expect(presentCreativeResponse({ set: ordinary }).set).toBe(ordinary);
});
