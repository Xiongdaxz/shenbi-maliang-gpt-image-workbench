import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";

export function SkeletonImage({
  src,
  alt,
  loading = "lazy"
}: {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    setLoaded(Boolean(image?.complete && image.naturalWidth > 0));
  }, [src]);

  return (
    <span className={cx("image-load-shell", loaded && "loaded")}>
      <span className="image-load-skeleton" aria-hidden="true" />
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </span>
  );
}
