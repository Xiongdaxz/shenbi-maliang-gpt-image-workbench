import sharp, { type OverlayOptions, type Gravity } from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import type { SetRunSnapshot } from "./imageSets";
import { creativeExampleDefinition, type CreativeExampleId } from "./creativeExampleCatalog";

export const creativeExampleAssetPath = (id: CreativeExampleId, kind: "hero" | "detail") => {
  const relative=path.join("image","creative-examples",`${id}-${kind}.webp`), built=path.join(process.cwd(),"dist",relative);
  return existsSync(built)?built:path.join(process.cwd(),"public",relative);
};
const photos = new Map<string, Promise<Buffer>>(), results = new Map<string, Buffer>();
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
function wrap(s: string, count: number, maximum = 3): string[] {
  if(Array.from(s).length>count && /[，,]/.test(s)) {
    return s.split(/[，,]/).filter(Boolean).flatMap(part=>wrap(part,count,maximum)).slice(0,maximum);
  }
  const chars = Array.from(s), rows: string[] = []; while (chars.length && rows.length < maximum) rows.push(chars.splice(0,count).join(""));
  if (chars.length) rows[rows.length-1] = rows.at(-1)!.slice(0,-1)+"…"; return rows;
}
function photo(id: CreativeExampleId, kind: "hero"|"detail") {
  const key = id+kind;
  if (!photos.has(key)) photos.set(key, readFile(creativeExampleAssetPath(id,kind)).catch(error => {photos.delete(key);throw error;}));
  return photos.get(key)!;
}
export async function renderCatalogDemoImage(snapshot: SetRunSnapshot): Promise<Buffer | null> {
  const d = snapshot.demo, definition = creativeExampleDefinition(d?.templateId);
  if (!d || !definition) return null;
  const key = JSON.stringify([snapshot.size,d.templateId,d.placement,d.total,d.variant,d.color,d.item.copy,d.item.name,d.brand,d.product,d.artworkVersion,d.style]);
  const cached = results.get(key); if(cached) return cached;
  const [width,height] = snapshot.size.split("x").map(Number), scale=width/1000, h=height/scale, p=d.placement%6;
  const [accent,paper] = definition.colors, ink=definition.id==="canvas"?"#202B46":definition.colors[2];
  const modern = d.artworkVersion === 2 && Boolean(d.style);
  const dark = d.color==="forest" || modern && d.style==="dark", vivid = !modern && d.color==="sage" && d.variant%2===1 && p===0;
  const bg=dark?ink:vivid?accent:paper, fg=dark||vivid?paper:ink, secondary=dark||vivid?paper:accent;
  const layers: OverlayOptions[] = [], decorations: string[] = [];
  const text=(x:number,y:number,value:string,size:number,fill=fg,weight=400,extra="")=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${escape(value)}</text>`;
  const rect=(x:number,y:number,w:number,hh:number,fill:string)=>`<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${fill}"/>`;
  const title=(x:number,y:number,length:number,size:number,fill=fg,max=3)=>wrap(d.item.copy||d.item.name,length,max).map((s,i)=>text(x,y+i*size*1.38,s,size,fill,600)).join("");
  const brand=(x:number,y:number,color=fg)=>text(x,y,d.brand,30,color,600)+text(x,y+29,definition.english,12,color,400,'letter-spacing="3"');
  const labels = definition.id==="tea"?["乌龙茶","牛乳","桂花"]:definition.id==="interior"?["自然光","木与石","织物"]:["棉帆布","钴蓝图案","双提手"];
  const tile=async(kind:"hero"|"detail",x:number,y:number,w:number,hh:number,position:Gravity="centre")=>{
    let source=sharp(await photo(definition.id,kind));
    // Tea's second image is an ingredient still life. Crop its lower area to keep the product's cup identity consistent.
    if(definition.id==="tea" && kind==="detail"){
      const meta=await source.metadata(), top=Math.floor(meta.height!*.68);source=source.extract({left:0,top,width:Math.floor(meta.width!*.34),height:meta.height!-top});
    }
    const wpx=Math.max(1,Math.round(w*scale)),hpx=Math.max(1,Math.round(hh*scale));
    const left=Math.max(0,Math.round(x*scale)),top=Math.max(0,Math.round(y*scale));
    const input=await source.resize(Math.min(wpx,width-left),Math.min(hpx,height-top),{fit:definition.id==="canvas"&&kind==="hero"&&p!==1?"contain":"cover",position,background:bg}).jpeg({quality:94}).toBuffer();
    layers.push({input,left,top});
  };
  const tall=h>1450, wide=h<800;
  if (modern) {
    // A versioned recipe keeps older snapshots reproducible. All three layouts
    // differ for every placement, including the full-bleed and wide formats.
    const hero = p === 5 && definition.id !== "tea" ? "detail" : "hero";
    if (wide) {
      if (d.style === "dark") {
        await tile(hero,0,0,560,h);
        decorations.push(rect(560,0,440,h,bg),brand(605,78),title(605,170,6,40,fg,3),text(605,h-58,d.product.slice(0,16),15,secondary));
      } else if (d.style === "editorial") {
        decorations.push(brand(45,72),title(45,162,7,39,fg,3));
        await tile(hero,420,35,355,h-85); await tile("detail",805,35,160,h-85);
        decorations.push(text(45,h-72,labels.join(" / "),16,secondary));
      } else {
        await tile(hero,500,0,500,h);
        decorations.push(brand(55,78),title(55,180,7,44,fg,3),text(55,h-65,d.product.slice(0,18),16,secondary));
      }
    } else if (d.style === "dark") {
      const imageY=110,imageH=Math.max(180,h*.55),titleY=imageY+imageH+92;
      await tile(hero,0,imageY,1000,imageH);
      decorations.push(brand(62,66),title(62,titleY,12,54,fg,3),text(65,h-65,labels.join("   /   "),18,secondary));
    } else if (d.style === "editorial") {
      const y=330,ph=Math.max(160,h-y-85);
      decorations.push(brand(62,76),text(62,140,"MATERIAL / DETAILS",13,secondary,400,'letter-spacing="3"'),title(62,215,13,48,fg,2));
      await tile(hero,62,y,535,ph); await tile("detail",633,y,305,ph*.60);
      labels.forEach((label,i)=>decorations.push(rect(636,y+ph*.70+i*40,14,14,definition.colors[i]),text(663,y+ph*.70+13+i*40,label,16,fg)));
    } else {
      const y=320,ph=Math.max(160,h-y-90);
      decorations.push(brand(62,78),text(62,142,definition.english,12,secondary,400,'letter-spacing="3"'),title(62,220,12,52,fg,2));
      await tile(hero,62,y,876,ph);
      decorations.push(text(65,h-54,labels.join("   /   "),16,secondary));
    }
  } else if(p===3 || wide) {
    await tile("hero",480,0,520,h);
    decorations.push(brand(58,78),text(58,139,definition.category.toUpperCase(),13,secondary,400,'letter-spacing="3"'),title(58,215,8,43,fg,3),text(58,h-88,d.product.slice(0,21),16,secondary),text(58,h-48,"BRAND COLLECTION / EXAMPLE",10,secondary,400,'letter-spacing="2"'));
  } else if(p===1) {
    await tile("hero",0,0,650,h);
    decorations.push(rect(650,0,350,h,dark?ink:accent),brand(697,90,paper),title(697,260,5,44,paper,5));
    labels.forEach((label,i)=>decorations.push(text(700,h-205+i*43,label,17,paper)));
  } else if(p===2 && tall) {
    decorations.push(brand(66,87),text(66,178,"MATERIAL / INSPIRATION",14,secondary,400,'letter-spacing="3"'),title(66,259,11,54,fg,2));
    const firstY=395,firstH=h*.39,secondY=firstY+firstH+45,secondH=Math.max(180,h-secondY-125);
    await tile("hero",66,firstY,868,firstH); await tile("detail",66,secondY,510,secondH);
    labels.forEach((label,i)=>decorations.push(rect(632,secondY+i*73,24,24,definition.colors[i]),text(681,secondY+21+i*73,label,18,fg)));
    decorations.push(text(632,secondY+270,definition.id==="interior"?"让触感成为空间的语言":"从细节，看见日常",15,secondary));
  } else if(p===4 || p===2) {
    decorations.push(brand(62,76),text(62,152,definition.english+" / DETAILS",12,secondary,400,'letter-spacing="3"'),title(62,228,11,49,fg,2));
    const y=340,bottom=h-78,ph=Math.max(160,bottom-y);
    await tile("hero",62,y,545,ph);await tile("detail",642,y,296,ph*.61);
    labels.forEach((label,i)=>decorations.push(text(645,y+ph*.72+i*35,label,16,secondary)));
  } else if(p===5) {
    await tile(definition.id==="tea"?"hero":"detail",0,0,1000,h);
    decorations.push(`<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${ink}" stop-opacity=".38"/><stop offset=".35" stop-color="${ink}" stop-opacity="0"/><stop offset="1" stop-color="${ink}" stop-opacity=".88"/></linearGradient></defs>`,rect(0,0,1000,h,"url(#shade)"),brand(66,85,paper),title(66,h-350,10,62,paper,3),text(69,h-145,d.product,20,paper),text(69,h-100,"EXPLORE THE EVERYDAY  ↗",13,paper,400,'letter-spacing="3"'));
  } else {
    decorations.push(brand(65,79),text(65,154,definition.category+" / BRAND STORY",13,secondary,400,'letter-spacing="3"'),title(65,239,10,62,fg,2));
    const y=355,ph=Math.max(160,h-y-65);
    await tile("hero",0,y,1000,ph);
    decorations.push(rect(0,h-65,1000,65,bg));
  }
  const footerColor=modern?secondary:p===1||p===5?paper:secondary;
  decorations.push(text(!modern&&p===1?698:65,h-26,`虚构品牌示例  ·  ${String(d.placement+1).padStart(2,"0")} / ${String(d.total||6).padStart(2,"0")}`,10,footerColor,400,'letter-spacing="1"'));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 ${h}"><g font-family="Microsoft YaHei, Noto Sans CJK SC, PingFang SC, sans-serif">${decorations.join("")}</g></svg>`;
  layers.push({input:Buffer.from(svg),left:0,top:0});
  const composed=await sharp({create:{width,height,channels:3,background:bg}}).composite(layers).raw().toBuffer({resolveWithObject:true});
  const buffer=await sharp(composed.data,{raw:{width,height,channels:composed.info.channels as 3|4}}).flatten({background:bg}).removeAlpha().png().toBuffer();
  if(results.size>=36)results.delete(results.keys().next().value!);results.set(key,buffer);return buffer;
}
