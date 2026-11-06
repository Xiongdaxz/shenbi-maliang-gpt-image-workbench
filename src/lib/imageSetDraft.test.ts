import { expect, test } from "bun:test";
import type { ImageSet } from "../types";
import { presentCreativeResponse } from "./creativePresentation";
import { preserveImageSetSource } from "./imageSetDraft";

const source = { id:"set",revision:3,isExample:true,name:"示例 · 栖间 · 温润住宅设计",brief:"为虚构室内设计品牌栖间制作套图。",items:[{id:"image",name:"材质",purpose:"解释一个已确认的示例功能",copy:"旧文案",size:"1152x2048",composition:""}] } as ImageSet;
test("saving one image keeps unchanged source fields out of global context changes",()=>{
  const draft=structuredClone(presentCreativeResponse({set:source}).set);draft.items[0].copy="新文案";
  const result=preserveImageSetSource(draft,source);
  expect(result.name).toBe(source.name);expect(result.brief).toBe(source.brief);expect(result.items[0].purpose).toBe(source.items[0].purpose);expect(result.items[0].copy).toBe("新文案");
  expect(draft.name).toBe("栖间 · 温润住宅设计");expect(source.items[0].copy).toBe("旧文案");
});
test("real edits stay edited and stale revisions are never rebased",()=>{
  const draft=structuredClone(presentCreativeResponse({set:source}).set);draft.name="我的新名称";draft.brief="新的要求";draft.items[0].purpose="新的用途";
  expect(preserveImageSetSource(draft,source)).toEqual(draft);
  draft.revision=2;expect(preserveImageSetSource(draft,source)).toBe(draft);
});
