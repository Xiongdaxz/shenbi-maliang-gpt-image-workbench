import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";

export type ImageLightboxTarget = {
  url: string;
  thumbnailUrl?: string;
  name: string;
};

export type ImageLightboxState = {
  items: ImageLightboxTarget[];
  index: number;
};

export function ImageLightbox({
  state,
  onClose,
  onChangeIndex
}: {
  state: ImageLightboxState | null;
  onClose: () => void;
  onChangeIndex: (index: number) => void;
}) {
  const { t } = useI18n();
  const items = state?.items ?? [];
  const index = Math.max(0, Math.min(state?.index ?? 0, Math.max(0, items.length - 1)));
  const activeItem = items[index] ?? null;
  const canSwitch = items.length > 1;

  useEffect(() => {
    if (!activeItem) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!canSwitch) return;
      if (event.key === "ArrowLeft") onChangeIndex(index <= 0 ? items.length - 1 : index - 1);
      if (event.key === "ArrowRight") onChangeIndex(index >= items.length - 1 ? 0 : index + 1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItem, canSwitch, index, items.length, onChangeIndex, onClose]);

  if (!activeItem) return null;

  const goByOffset = (offset: number) => {
    if (!canSwitch) return;
    const nextIndex = (index + offset + items.length) % items.length;
    onChangeIndex(nextIndex);
  };

  return createPortal(
    <div className={cx("reference-image-lightbox", canSwitch && "has-thumbs")} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={t("imageLightbox.preview")}>
      <button
        type="button"
        className="reference-image-close"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
        aria-label={t("imageLightbox.close")}
      >
        <X size={20} />
      </button>
      {canSwitch ? (
        <button
          type="button"
          className="reference-image-step reference-image-step-prev"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => goByOffset(-1)}
          aria-label={t("imageLightbox.previous")}
        >
          <ChevronLeft size={26} />
        </button>
      ) : null}
      <div className="reference-image-frame" onMouseDown={(event) => event.stopPropagation()}>
        <img src={activeItem.url} alt={activeItem.name} />
      </div>
      {canSwitch ? (
        <>
          <button
            type="button"
            className="reference-image-step reference-image-step-next"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => goByOffset(1)}
            aria-label={t("imageLightbox.next")}
          >
            <ChevronRight size={26} />
          </button>
          <div className="reference-image-thumbs" onMouseDown={(event) => event.stopPropagation()} aria-label={t("imageLightbox.thumbnails")}>
            {items.map((item, itemIndex) => (
              <button
                key={`${item.url}-${itemIndex}`}
                type="button"
                className={cx(itemIndex === index && "active")}
                onClick={() => onChangeIndex(itemIndex)}
                aria-label={t("imageLightbox.viewNth", { index: itemIndex + 1 })}
                aria-pressed={itemIndex === index}
              >
                <img src={item.thumbnailUrl ?? item.url} alt={item.name} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>,
    document.body
  );
}
