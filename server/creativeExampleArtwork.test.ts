import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { renderCatalogDemoImage } from "./creativeExampleArtwork";
import type { SetRunSnapshot } from "./imageSets";
const hash = (bytes: Buffer | null) => createHash("sha256").update(bytes!).digest("hex");
function snapshot(templateId:string,placement:number,style:"airy"|"dark"|"editorial"):SetRunSnapshot {
  return {size:placement===3?"384x216":placement===2?"216x384":"288x384",prompt:"",providerId:"",model:"",quality:"",sessionId:"",referenceIds:[],profileContext:null,
    demo:{templateId,placement,total:6,variant:0,style,artworkVersion:2,color:"sage",brand:"品牌",product:"产品",item:{id:"item",name:"材质灵感",size:"216x384",purpose:"",copy:"让材质，慢慢说话",composition:""}}};
}
describe("versioned demo artwork",()=>{
  test("all three layouts differ across every placement of each catalog, and reruns are stable",async()=>{
    for(const template of ["tea","interior","canvas"])for(let placement=0;placement<6;placement++){
      const hashes=[];for(const style of ["airy","dark","editorial"] as const){const value=snapshot(template,placement,style),bytes=await renderCatalogDemoImage(value);hashes.push(hash(bytes));expect(hash(await renderCatalogDemoImage(value))).toBe(hash(bytes));}
      expect(new Set(hashes).size).toBe(3);
    }
  },60000);
  test("old snapshots preserve their historical rendering rather than silently upgrading",async()=>{
    const old=snapshot("interior",2,"airy");delete old.demo!.artworkVersion;delete old.demo!.style;
    const first=hash(await renderCatalogDemoImage(old));old.demo!.variant=1;expect(hash(await renderCatalogDemoImage(old))).toBe(first);
    expect(hash(await renderCatalogDemoImage(snapshot("interior",2,"airy")))).not.toBe(first);
  });
});
