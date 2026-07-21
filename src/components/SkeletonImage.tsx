import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";

const loadedImageSources = new Map<string, true>();
const MAX_REMEMBERED_IMAGE_SOURCES = 2_000;

function rememberLoadedImageSource(src: string) {
  if (!src) return;
  loadedImageSources.delete(src);
  loadedImageSources.set(src, true);
  while (loadedImageSources.size > MAX_REMEMBERED_IMAGE_SOURCES) {
    const oldest = loadedImageSources.keys().next().value;
    if (typeof oldest !== "string") break;
    loadedImageSources.delete(oldest);
  }
}

export function SkeletonImage({
  src,
  alt,
  loading = "lazy",
  fetchPriority = "auto"
}: {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [loadedSrc, setLoadedSrc] = useState(() => loadedImageSources.has(src) ? src : "");
  const loaded = loadedSrc === src;

  useEffect(() => {
    const image = imageRef.current;
    if (loadedImageSources.has(src) || (image?.complete && image.naturalWidth > 0)) {
      rememberLoadedImageSource(src);
      setLoadedSrc(src);
    }
  }, [src]);

  return (
    <span className={cx("image-load-shell", loaded && "loaded")}>
      <span className="image-load-skeleton" aria-hidden="true" />
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        onLoad={() => {
          rememberLoadedImageSource(src);
          setLoadedSrc(src);
        }}
        onError={() => setLoadedSrc(src)}
      />
    </span>
  );
}
