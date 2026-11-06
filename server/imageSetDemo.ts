import sharp from "sharp";
import { appDb, getOne, run } from "./db";
import { creativeId, CreativeInputError } from "./creativeProfiles";
import type { SetRunRow, SetRunSnapshot } from "./imageSets";
import { insertMessage } from "./chatStore";
import { emitImageJobEvent } from "./imageJobEvents";
import { deleteStoredFilesIfUnreferenced, secureImagePath, writeEncryptedFile } from "./secureFiles";
import { now } from "./utils";
import { renderCatalogDemoImage } from "./creativeExampleArtwork";

const cache = new Map<string, Buffer>();
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
function lines(value: string, length: number, max = 3) {
  const words = Array.from(value.replace(/\s+/g, " ").trim()), result: string[] = [];
  while (words.length && result.length < max) result.push(words.splice(0, length).join(""));
  if (words.length) result[result.length - 1] = result.at(-1)!.slice(0, -1) + "…";
  return result;
}
export function validateDemoSize(size: string) {
  const [w, h] = size.split("x").map(Number);
  if (!w || !h || w > 4096 || h > 4096 || w * h > 16777216) throw new CreativeInputError("模拟图片尺寸请控制在 4096×4096 以内");
}

/** Portable, bundled artwork; no external assets, network, or image provider. */
export async function renderDemoImage(snapshot: SetRunSnapshot): Promise<Buffer> {
  validateDemoSize(snapshot.size);
  const d = snapshot.demo?.artworkVersion === 2 ? { ...snapshot.demo, color: snapshot.demo.color === "forest" ? "forest" as const : snapshot.demo.style === "dark" ? "forest" as const : snapshot.demo.style === "airy" ? "cream" as const : "sage" as const } : snapshot.demo;
  if (!d) throw new Error("模拟任务快照缺失");
  const catalog = await renderCatalogDemoImage(snapshot); if (catalog) return catalog;
  const key = JSON.stringify([snapshot.size, d.item.copy, d.item.name, d.placement, d.brand, d.product, d.color, d.variant]);
  const cached = cache.get(key); if (cached) return cached;
  const [width, height] = snapshot.size.split("x").map(Number), wide = width > height * 1.3, tall = height > width * 1.45;
  const w = 1000, h = Math.round(height / width * w), p = d.placement % 6;
  const forest = d.color === "forest", cream = d.color === "cream" || d.variant % 2 === 1 && d.color === "sage";
  const bg = forest ? "#163F34" : cream ? "#F4F1E8" : "#D8EBDF", ink = forest ? "#F2F5E9" : "#20483B", muted = forest ? "#B9D0BE" : "#657A6D";
  const accent = forest ? "#A9D6AE" : "#60856A";
  const titleSize = wide ? 48 : tall ? 75 : 64, titleX = 74, titleY = tall ? 280 : wide ? 205 : 230;
  const titleLines = lines(d.item.copy || d.item.name, wide ? 8 : 10);
  const boardX = wide ? 545 : 110, boardY = wide ? 110 : tall ? h * .46 : h * .50, boardW = wide ? 435 : 790, boardH = wide ? 300 : tall ? h * .32 : h * .37;
  const text = (x: number, y: number, value: string, size: number, fill = ink, weight = 400, extra = "") => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" ${extra}>${xml(value)}</text>`;
  const block = (x: number, y: number, bw: number, bh: number, fill: string, r = 22, extra = "") => `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${r}" fill="${fill}" ${extra}/>`;
  const board = `<g transform="translate(${boardX},${boardY}) rotate(${p % 2 ? -3 : 3} ${boardW/2} ${boardH/2})" filter="url(#shadow)">
    ${block(0, 0, boardW, boardH, "#FEFFFA", 26)}
    ${block(0, 0, boardW, 56, "#F0F4EB", 26)}${block(0, 29, boardW, 28, "#F0F4EB", 0)}
    <circle cx="25" cy="28" r="5" fill="#8EAC92"/><circle cx="44" cy="28" r="5" fill="#C4D2BE"/><circle cx="63" cy="28" r="5" fill="#DCE4D3"/>
    ${text(87, 35, d.product.slice(0, 22), 17, "#41624C", 600)}
    ${[0, 1, 2].map((column) => {
      const x = 24 + column * (boardW - 40) / 3, cw = (boardW - 64) / 3 - 8, by = 106;
      return text(x + 4, 88, ["任务看板", "项目进度", "资料共享"][column], 18, "#526B53", 600) +
        [0, 1].map((row) => block(x, by + row * (boardH - by - 20) / 2, cw, (boardH - by - 36) / 2, ["#E3EDDB", "#EDF1E7", "#E6EEDC"][(column + row + p) % 3], 13) +
          block(x + 15, by + 18 + row * (boardH - by - 20) / 2, cw * .42, 6, "#9BB691", 3) +
          block(x + 15, by + 37 + row * (boardH - by - 20) / 2, cw * .73, 5, "#C0CFB5", 3)).join("");
    }).join("")}</g>`;
  const orbX = wide ? 852 : p === 2 ? 170 : 805, orbY = wide ? 270 : boardY + boardH * .5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}">
    <defs><radialGradient id="orb" cx="30%" cy="22%"><stop stop-color="#F5F9D4"/><stop offset=".5" stop-color="#B7D2A6"/><stop offset="1" stop-color="#669275"/></radialGradient>
      <linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FCFFF6" stop-opacity=".65"/><stop offset="1" stop-color="#C0D2B6" stop-opacity="0"/></linearGradient>
      <pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="${accent}" opacity=".17"/></pattern>
      <filter id="shadow" x="-30%" y="-30%" width="170%" height="180%"><feDropShadow dx="0" dy="25" stdDeviation="28" flood-color="#254D35" flood-opacity=".14"/></filter></defs>
    <rect width="1000" height="${h}" fill="${bg}"/><rect width="1000" height="${h}" fill="url(#light)"/>
    <rect x="${wide ? 500 : 0}" y="${wide ? 0 : boardY - 55}" width="1000" height="${h}" fill="url(#grid)"/>
    <g font-family="Microsoft YaHei, Noto Sans CJK SC, PingFang SC, sans-serif">
    <g transform="translate(73 64)"><path d="M0 20Q-2 0 19 0Q23 20 0 20M0 20Q3 39 22 35Q24 15 0 20" fill="${ink}"/>${text(37, 28, d.brand.slice(0, 24), 29, ink, 600)}</g>
    ${text(74, tall ? 179 : wide ? 141 : 163, ["一起，把工作变简单", "QINGHE / WORK TOGETHER", "让好想法，继续生长"][p % 3], 18, muted, 400, 'letter-spacing="3"')}
    ${titleLines.map((line, i) => text(titleX, titleY + i * (titleSize * 1.35), line, titleSize, ink, 600)).join("")}
    ${!wide ? text(78, titleY + titleLines.length * titleSize * 1.35 + 19, "任务看板   /   项目进度   /   资料共享", tall ? 22 : 19, muted) : ""}
    <circle cx="${orbX}" cy="${orbY}" r="${wide ? 160 : 215}" fill="url(#orb)"/>
    <path d="M${wide ? 570 : 63} ${boardY + boardH * .72} Q${wide ? 700 : 450} ${boardY - 195} ${wide ? 1060 : 960} ${boardY + boardH * .95}" fill="none" stroke="${accent}" stroke-width="2" opacity=".5"/>
    ${board}
    ${p === 5 || tall ? block(74, h - 233, 290, 64, forest ? "#B7D8AB" : "#254E3D", 32) + text(113, h - 191, "一起开启清晰协作  ↗", 21, forest ? "#244A37" : "#F3F6EB", 500) : ""}
    <line x1="74" y1="${h - 109}" x2="926" y2="${h - 109}" stroke="${accent}" opacity=".3"/>
    ${text(74, h - 70, "QINGHE  /  团队协作", 15, muted, 500, 'letter-spacing="2"')}
    ${text(926, h - 70, `模拟示例  ·  ${String(p + 1).padStart(2, "0")} / 06`, 14, muted, 400, 'text-anchor="end"')}
    </g></svg>`;
  const png = await sharp(Buffer.from(svg)).flatten({ background: bg }).png().toBuffer();
  if (cache.size >= 24) cache.delete(cache.keys().next().value!);
  cache.set(key, png); return png;
}

/** Only a server-owned demo project can enter this executor. Never consult provider config. */
export async function executeDemoImageSetRun(userId: string, r: SetRunRow, snapshot: SetRunSnapshot, isActive: () => boolean, instant = false) {
  if (!getOne(appDb, "select id from image_sets where id=? and user_id=? and execution_mode='demo'", r.set_id, userId)) throw new Error("模拟项目不存在");
  if (!getOne(appDb, "select id from sessions where id=? and user_id=? and deleted_at is null", snapshot.sessionId, userId)) throw new Error("关联对话已删除，请重新确认方案");
  const previous = getOne<{ status: string }>(appDb, "select status from image_jobs where id=? and user_id=?", r.job_id, userId);
  if (previous?.status === "succeeded" || !isActive()) return;
  const type = snapshot.sourceImageId ? "edit" : "generation", timestamp = now();
  appDb.transaction(() => {
    if (!previous) {
      run(appDb, `insert into image_jobs (id,user_id,session_id,type,status,prompt,provider_id,request_json,client_request_id,source_image_ids,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?)`, r.job_id, userId, snapshot.sessionId, type, "running", snapshot.displayPrompt || snapshot.prompt, "internal-demo",
        JSON.stringify({ _imageSetDemo: true, n: 1, size: snapshot.size }), r.id, JSON.stringify({ imageIds: snapshot.sourceImageId ? [snapshot.sourceImageId] : [], referenceIds: snapshot.referenceIds }), timestamp, timestamp);
      run(appDb, "insert into image_job_profile_context (job_id,user_id,snapshot_json,created_at) values (?,?,?,?)", r.job_id, userId, JSON.stringify(snapshot.profileContext), timestamp);
      insertMessage(userId, snapshot.sessionId, "user", snapshot.displayPrompt || snapshot.prompt, snapshot.sourceImageId || null, { jobId: r.job_id, imageSetId: r.set_id, imageSetItemId: r.item_id, simulated: true });
    } else run(appDb, "update image_jobs set status='running',error=null,manual_retry_count=manual_retry_count+1,updated_at=? where id=?", timestamp, r.job_id);
  })();
  emitImageJobEvent(userId, { jobId: r.job_id, sessionId: snapshot.sessionId, status: "running", updatedAt: timestamp });
  if (!instant) await Bun.sleep(1200);
  if (!isActive()) return;
  if (snapshot.demo?.failOnce && !previous) {
    const error = "模拟失败：这是一次重试体验，点击“重试”即可继续，不影响已采用图片。";
    run(appDb, "update image_jobs set status='failed',error=?,updated_at=? where id=?", error, now(), r.job_id);
    throw new Error(error);
  }
  const png = await renderDemoImage(snapshot);
  if (!isActive()) return;
  const imageId = creativeId("img"), relativePath = secureImagePath(userId, snapshot.sessionId, imageId);
  await writeEncryptedFile(relativePath, png);
  if (!isActive()) { await deleteStoredFilesIfUnreferenced([relativePath]); return; }
  const [width, height] = snapshot.size.split("x").map(Number);
  try {
    appDb.transaction(() => {
      if (!isActive()) throw new Error("模拟任务已停止");
      run(appDb, `insert into images (id,user_id,session_id,job_id,job_image_index,path,prompt,kind,size,quality,provider_id,mime_type,parent_image_id,image_width,image_height,image_file_size,created_at)
        values (?,?,?,?,1,?,?,?,?,?,?,'image/png',?,?,?,?,?)`, imageId, userId, snapshot.sessionId, r.job_id, relativePath, snapshot.displayPrompt || snapshot.prompt,
        type, snapshot.size, "high", "internal-demo", snapshot.sourceImageId || null, width, height, png.length, now());
      run(appDb, "update image_jobs set status='succeeded',error=null,result_image_id=?,response_json=?,updated_at=? where id=?", imageId, '{"simulated":true}', now(), r.job_id);
      insertMessage(userId, snapshot.sessionId, "assistant", "模拟图片已完成", imageId, { jobId: r.job_id, n: 1, imageIndex: 1, imageTotal: 1, simulated: true });
    })();
  } catch (error) { await deleteStoredFilesIfUnreferenced([relativePath]); throw error; }
  emitImageJobEvent(userId, { jobId: r.job_id, sessionId: snapshot.sessionId, status: "succeeded", updatedAt: now() });
}
