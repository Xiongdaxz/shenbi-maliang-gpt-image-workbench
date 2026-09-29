import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Copy, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatImageFileSize } from "../../lib/format";
import type { CompareDisplayedResource } from "../../lib/imageCompareResource";
import { routeCompareInfoTab } from "../../lib/imageCompareFocus";
import type { WorkImage } from "../../types";
import { useToast } from "../../ui";

export function ImageCompareInfoCard({ image, label, anchor, resource, onKeepOpen, onDismissSoon, onClose, onDismiss }: {
  image: WorkImage; label: string; anchor: HTMLButtonElement;
  resource?: CompareDisplayedResource;
  onKeepOpen: () => void; onDismissSoon: () => void; onClose: () => void; onDismiss: () => void;
}) {
  const { t, resolvedLanguage } = useI18n();
  const { showToast } = useToast();
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const update = () => {
      const element = panel.current;
      if (!element) return;
      if (!anchor.isConnected) { onClose(); return; }
      const bounds = anchor.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom - 20;
      const above = bounds.top - 20;
      const openAbove = below < 180 && above > below;
      const maxHeight = Math.max(80, openAbove ? above : below);
      const width = element.getBoundingClientRect().width;
      setPosition({
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        top: openAbove ? Math.max(12, bounds.top - Math.min(element.scrollHeight, maxHeight) - 8) : bounds.bottom + 8,
        maxHeight, visibility: "visible"
      });
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !panel.current?.contains(event.target)) onClose();
    };
    const keydown = (event: KeyboardEvent) => { if (panel.current) routeCompareInfoTab(event, anchor, panel.current, onDismiss); };
    const element = panel.current;
    const observer = new ResizeObserver(update);
    if (panel.current) observer.observe(panel.current);
    observer.observe(anchor);
    update();
    window.addEventListener("resize", update);
    document.addEventListener("pointerdown", outside, true);
    anchor.addEventListener("keydown", keydown);
    element?.addEventListener("keydown", keydown);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("pointerdown", outside, true);
      anchor.removeEventListener("keydown", keydown);
      element?.removeEventListener("keydown", keydown);
    };
  }, [anchor, onClose, onDismiss]);
  const prompt = image.originPrompt?.trim() || image.prompt;
  const fileSize = formatImageFileSize(resource?.fileSize);
  return <aside ref={panel} id="image-compare-info" className="image-compare-info image-compare-island" role="dialog" aria-labelledby="image-compare-info-title"
    style={position} onPointerEnter={onKeepOpen} onPointerLeave={(event) => { if (event.pointerType !== "touch") onDismissSoon(); }} onFocus={onKeepOpen}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onDismissSoon(); }}>
    <div className="image-compare-info-title"><strong id="image-compare-info-title">{t("compare.info")}</strong>
      <button type="button" onClick={onDismiss} aria-label={t("common.close")}><X size={17} /></button>
    </div>
    <div className="image-compare-info-meta"><strong>{t("compare.image", { label })}</strong>
      <span>{t(image.kind === "edit" ? "pages.images.edit" : "pages.images.generation")}</span>
      {resource ? <span>{t(resource.source === "original" ? "compare.original" : "compare.preview")}</span> : null}
      {resource?.width && resource.height ? <span>{resource.width} × {resource.height}</span> : null}
      {fileSize ? <span>{fileSize}</span> : null}
      <time>{Number.isFinite(Date.parse(image.createdAt)) ? new Date(image.createdAt).toLocaleString(resolvedLanguage) : ""}</time>
    </div>
    <p>{prompt}</p>
    <button type="button" className="secondary-btn" onClick={async () => {
      const copied = await copyTextToClipboard(prompt);
      showToast(t(copied ? "imagePreview.copySuccess" : "imagePreview.copyFailed"), copied ? "success" : "error");
    }}><Copy size={15} />{t("compare.copyPrompt")}</button>
  </aside>;
}
