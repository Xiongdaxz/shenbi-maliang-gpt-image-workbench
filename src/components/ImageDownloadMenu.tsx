import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../api";
import { cx } from "../lib/cx";
import type { ImageDownloadOption } from "../types";

const POPOVER_CLOSE_ANIMATION_MS = 240;

export type ImageDownloadSource =
  | { type: "image"; id: string; fallbackUrl?: string; fallbackName?: string }
  | { type: "asset"; id: string; fallbackUrl?: string; fallbackName?: string }
  | { type: "image-reference"; id: string; fallbackUrl?: string; fallbackName?: string };

type ImageDownloadMenuProps = {
  source: ImageDownloadSource | null | undefined;
  className?: string;
  rootClassName?: string;
  iconSize?: number;
  ariaLabel?: string;
  title?: string;
  placement?: "top-end" | "bottom-end";
  stopMouseDownPropagation?: boolean;
};

function formatDownloadFileSize(value: number | null | undefined) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2).replace(/\.?0+$/, "")} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.?0+$/, "")} KB`;
  }
  return `${Math.round(bytes)} B`;
}

function formatMimeType(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("webp")) return "WebP";
  if (normalized.includes("png")) return "PNG";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "JPG";
  if (normalized.includes("avif")) return "AVIF";
  const suffix = normalized.split("/").pop()?.trim();
  return suffix ? suffix.toUpperCase() : "";
}

function optionMeta(option: ImageDownloadOption) {
  const parts = [
    option.width > 0 && option.height > 0 ? `${option.width}×${option.height}` : "",
    formatMimeType(option.mimeType),
    formatDownloadFileSize(option.fileSize)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "大小未知";
}

function optionLabel(option: ImageDownloadOption) {
  if (option.variant === "thumb") return "缩略图";
  if (option.variant === "preview") return "预览图";
  return "原图";
}

function fetchDownloadOptions(source: ImageDownloadSource) {
  if (source.type === "image") return api.imageDownloadOptions(source.id);
  if (source.type === "asset") return api.assetDownloadOptions(source.id);
  return api.imageReferenceDownloadOptions(source.id);
}

function startDownload(option: ImageDownloadOption) {
  const anchor = document.createElement("a");
  anchor.href = option.url;
  anchor.download = option.downloadName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ImageDownloadMenu({
  source,
  className,
  rootClassName,
  iconSize = 16,
  ariaLabel = "下载图片",
  title = "下载图片",
  placement = "top-end",
  stopMouseDownPropagation = false
}: ImageDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const sourceId = source?.id ?? "";
  const popoverVisible = open || closing;

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const closePopover = () => {
    if (!open || closing) return;
    setOpen(false);
    setClosing(true);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setClosing(false);
      closeTimerRef.current = null;
    }, POPOVER_CLOSE_ANIMATION_MS);
  };

  const openPopover = () => {
    clearCloseTimer();
    setClosing(false);
    setOpen(true);
  };

  const togglePopover = () => {
    if (open && !closing) {
      closePopover();
      return;
    }
    openPopover();
  };

  const query = useQuery({
    queryKey: ["image-download-options", source?.type, sourceId],
    queryFn: () => fetchDownloadOptions(source as ImageDownloadSource),
    enabled: open && Boolean(source && sourceId),
    staleTime: 5 * 60 * 1000
  });
  const options = query.data?.options ?? [];

  useLayoutEffect(() => {
    if (!popoverVisible) return;
    const updatePosition = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 10;
      const width = Math.min(360, Math.max(260, window.innerWidth - viewportPadding * 2));
      const left = Math.min(Math.max(viewportPadding, rect.right - width), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
      if (placement === "bottom-end") {
        setPopoverStyle({ left, top: rect.bottom + gap, width });
        return;
      }
      setPopoverStyle({ left, bottom: window.innerHeight - rect.top + gap, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [placement, popoverVisible]);

  useEffect(() => {
    if (!open) return;
    const handleDocumentClickCapture = (event: MouseEvent) => {
      const root = rootRef.current;
      const popover = popoverRef.current;
      const target = event.target as Node | null;
      if (!target) return;
      if (root?.contains(target) || popover?.contains(target)) return;
      closePopover();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePopover();
    };
    window.addEventListener("click", handleDocumentClickCapture, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleDocumentClickCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closing, open]);

  useEffect(() => {
    if (source && sourceId) return;
    clearCloseTimer();
    setOpen(false);
    setClosing(false);
  }, [source, sourceId]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    []
  );

  const popover =
    popoverVisible && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            className={cx("image-download-popover", "ui-pop-motion")}
            style={popoverStyle}
            data-state={closing ? "closing" : "open"}
            data-placement={placement}
            role="menu"
            aria-label="下载尺寸选项"
            onMouseDown={(event) => {
              if (stopMouseDownPropagation) event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {query.isLoading || query.isFetching ? <div className="image-download-status">加载中</div> : null}
            {query.isError ? <div className="image-download-status error">下载选项加载失败</div> : null}
            {!query.isLoading && !query.isError && options.length === 0 ? <div className="image-download-status">暂无可下载尺寸</div> : null}
            {!query.isLoading && !query.isError
              ? options.map((option) => (
                  <button
                    key={option.variant}
                    type="button"
                    className="image-download-option"
                    role="menuitem"
                    onClick={() => {
                      startDownload(option);
                      closePopover();
                    }}
                  >
                    <span className="image-download-option-copy">
                      <strong>{optionLabel(option)}</strong>
                      <small>{option.description}</small>
                    </span>
                    <span className="image-download-option-meta">{optionMeta(option)}</span>
                  </button>
                ))
              : null}
          </div>,
          document.body
        )
      : null;

  return (
    <span
      ref={rootRef}
      className={cx("image-download-menu", `placement-${placement}`, open && "open", rootClassName)}
      onMouseDown={(event) => {
        if (stopMouseDownPropagation) event.stopPropagation();
      }}
    >
      <button
        className={cx("image-download-trigger", className)}
        type="button"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          togglePopover();
        }}
        disabled={!source || !sourceId}
        aria-label={ariaLabel}
        aria-expanded={open && !closing}
        title={title}
      >
        <Download size={iconSize} />
      </button>
      {popover}
    </span>
  );
}
