import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const CREATIVE_ARTWORK_VERSION = 3;
export type DefaultArtwork = { file: string; imageId: string; sourceSha256: string; sha256: string; width: number; height: number };
type ArtworkManifest = { version: number; brands: Record<string, DefaultArtwork[]> };
let cached: ArtworkManifest | undefined;
export function defaultArtwork(brandId: string, index: number): DefaultArtwork {
  if (!cached) {
    const relative = path.join("image", "creative-defaults", "artwork.json"), built = path.join(process.cwd(), "dist", relative);
    const loaded = JSON.parse(readFileSync(existsSync(built) ? built : path.join(process.cwd(), "public", relative), "utf8")) as ArtworkManifest;
    if (loaded.version !== CREATIVE_ARTWORK_VERSION) throw new Error("默认成稿资源版本不匹配，请更新静态资源");
    cached = loaded;
  }
  const artwork = cached.brands[brandId]?.[index];
  if (!artwork || typeof artwork.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artwork.sha256)
    || artwork.file !== `${brandId}-v${CREATIVE_ARTWORK_VERSION}-${index + 1}-${artwork.sha256.slice(0, 12)}.png` || !artwork.imageId
    || !Number.isInteger(artwork.width) || !Number.isInteger(artwork.height) || artwork.width < 700 || artwork.height < 700 || artwork.width > 4096 || artwork.height > 4096) throw new Error("默认成稿资源不完整，请检查图片清单");
  return artwork;
}
export function verifyDefaultArtwork(bytes: Buffer, artwork: DefaultArtwork) {
  if (createHash("sha256").update(bytes).digest("hex") !== artwork.sha256) throw new Error("默认成稿文件与清单不匹配，请更新静态资源");
}
