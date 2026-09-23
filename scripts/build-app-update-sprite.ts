import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDirectory = path.join(root, "docs", "design", "app-update", "frames");
const outputDirectory = path.join(root, "public", "image", "app-update");
const outputPath = path.join(outputDirectory, "maliang-update-sprite.webp");
const idleOutputPath = path.join(outputDirectory, "maliang-update-idle-01.webp");
const frameSize = 512;
const frameCount = 6;

await mkdir(outputDirectory, { recursive: true });

const frames = await Promise.all(Array.from({ length: frameCount }, async (_, index) => {
  const framePath = path.join(sourceDirectory, `maliang-update-frame-${String(index + 1).padStart(2, "0")}.png`);
  return sharp(framePath)
    .ensureAlpha()
    .resize(frameSize, frameSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}));
await sharp({
  create: {
    width: frameSize * frameCount,
    height: frameSize,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  }
})
  .composite(frames.map((input, index) => ({ input, left: index * frameSize, top: 0 })))
  .webp({ quality: 90, alphaQuality: 100, smartSubsample: true })
  .toFile(outputPath);

await sharp(frames[0])
  .webp({ quality: 90, alphaQuality: 100, smartSubsample: true })
  .toFile(idleOutputPath);

console.log(`Built ${path.relative(root, outputPath)} and static waving idle frame.`);
