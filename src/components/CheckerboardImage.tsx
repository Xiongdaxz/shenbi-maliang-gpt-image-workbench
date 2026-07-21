import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { cx } from "../lib/cx";

export function CheckerboardImage({
  className,
  onError,
  onLoad,
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const srcKey = typeof src === "string" ? src : "";
  const [loadedSrc, setLoadedSrc] = useState("");

  useEffect(() => {
    const image = imageRef.current;
    if (srcKey && image?.complete && image.naturalWidth > 0) {
      setLoadedSrc(srcKey);
    }
  }, [srcKey]);

  return (
    <img
      {...props}
      ref={imageRef}
      className={cx(className, loadedSrc === srcKey && Boolean(srcKey) && "image-alpha-checkerboard")}
      src={src}
      onLoad={(event) => {
        setLoadedSrc(srcKey);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoadedSrc("");
        onError?.(event);
      }}
    />
  );
}
