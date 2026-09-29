import type { ImageDownloadOption, WorkImage } from "../types";
import type { CompareOriginal } from "../hooks/useCompareOriginals";

export type CompareDisplayedResource = {
  source: "original" | "preview";
  src: string;
  width: number;
  height: number;
  fileSize: number;
};

/** Resource metadata follows the displayed bitmap, independently of canvas geometry. */
export function compareDisplayedResource(image: WorkImage | null | undefined, wantsOriginal: boolean, original: CompareOriginal | undefined,
  preview: { src: string; width: number; height: number }, options: ImageDownloadOption[] = []): CompareDisplayedResource | null {
  if (!image) return null;
  if (wantsOriginal && original?.status === "ready" && original.src) return {
    source: "original", src: original.src,
    width: original.width || image.imageWidth, height: original.height || image.imageHeight,
    fileSize: original.fileSize || image.imageFileSize
  };
  const src = image.previewUrl || image.url;
  const isOriginal = src === (image.originalUrl || image.url);
  const option = options.find((item) => item.url === src && item.variant === (isOriginal ? "original" : "preview"));
  const decoded = preview.src === src;
  return {
    source: isOriginal ? "original" : "preview", src,
    width: (decoded ? preview.width : 0) || option?.width || (isOriginal ? image.imageWidth : 0),
    height: (decoded ? preview.height : 0) || option?.height || (isOriginal ? image.imageHeight : 0),
    fileSize: option?.fileSize || (isOriginal ? image.imageFileSize : 0)
  };
}
