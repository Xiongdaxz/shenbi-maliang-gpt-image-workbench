import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { cx } from "../lib/cx";

const MAX_ALPHA_SAMPLE_SIZE = 256;
const MAX_TRANSPARENCY_CACHE_ENTRIES = 256;
const transparencyBySrc = new Map<string, boolean>();

function transparencyCacheKey(src: string) {
  return src.length <= 2048 && !src.startsWith("data:") ? src : "";
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function rememberTransparency(src: string, transparent: boolean) {
  if (!transparencyBySrc.has(src) && transparencyBySrc.size >= MAX_TRANSPARENCY_CACHE_ENTRIES) {
    const oldest = transparencyBySrc.keys().next().value;
    if (oldest) transparencyBySrc.delete(oldest);
  }
  transparencyBySrc.set(src, transparent);
}

function deferTransparencyCheck(callback: () => void) {
  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 200 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

function imageHasTransparency(image: HTMLImageElement) {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return false;
  const scale = Math.min(1, MAX_ALPHA_SAMPLE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function CheckerboardImage({
  className,
  onError,
  onLoad,
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const analysisVersionRef = useRef(0);
  const cancelAnalysisRef = useRef<(() => void) | null>(null);
  const srcKey = typeof src === "string" ? src : "";
  const [transparentSrc, setTransparentSrc] = useState("");

  const updateTransparency = useCallback((image: HTMLImageElement) => {
    const version = analysisVersionRef.current + 1;
    analysisVersionRef.current = version;
    cancelAnalysisRef.current?.();
    cancelAnalysisRef.current = null;
    if (!srcKey) {
      setTransparentSrc("");
      return;
    }
    const cacheKey = transparencyCacheKey(srcKey);
    if (cacheKey && transparencyBySrc.has(cacheKey)) {
      setTransparentSrc(transparencyBySrc.get(cacheKey) ? srcKey : "");
      return;
    }
    setTransparentSrc("");
    cancelAnalysisRef.current = deferTransparencyCheck(() => {
      cancelAnalysisRef.current = null;
      if (analysisVersionRef.current !== version || imageRef.current !== image) return;
      const transparent = imageHasTransparency(image);
      if (cacheKey) rememberTransparency(cacheKey, transparent);
      setTransparentSrc(transparent ? srcKey : "");
    });
  }, [srcKey]);

  useEffect(() => {
    const image = imageRef.current;
    if (srcKey && image?.complete && image.naturalWidth > 0) {
      updateTransparency(image);
    } else {
      setTransparentSrc("");
    }
    return () => {
      analysisVersionRef.current += 1;
      cancelAnalysisRef.current?.();
      cancelAnalysisRef.current = null;
    };
  }, [srcKey, updateTransparency]);

  return (
    <img
      {...props}
      ref={imageRef}
      className={cx(className, transparentSrc === srcKey && Boolean(srcKey) && "image-alpha-checkerboard")}
      src={src}
      onLoad={(event) => {
        updateTransparency(event.currentTarget);
        onLoad?.(event);
      }}
      onError={(event) => {
        analysisVersionRef.current += 1;
        cancelAnalysisRef.current?.();
        cancelAnalysisRef.current = null;
        setTransparentSrc("");
        onError?.(event);
      }}
    />
  );
}
