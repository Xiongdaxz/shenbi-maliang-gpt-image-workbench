import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrushCleaning, Check, Search, X } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { assetSpaceLabel } from "../lib/assets";
import { cx } from "../lib/cx";
import type { AssetItem } from "../types";

export const MATERIAL_PICKER_DRAWER_ANIMATION_MS = 240;

type MaterialPickerProps = {
  assets?: { assets: AssetItem[] };
  selectedAssets: AssetItem[];
  onToggleAsset: (asset: AssetItem) => void;
  onSelectedAssetsChange: (assets: AssetItem[]) => void;
  onClose?: () => void;
  closing?: boolean;
};

export function MaterialPickerDrawer({
  open,
  closing = false,
  assets,
  selectedAssets,
  onToggleAsset,
  onSelectedAssetsChange,
  onClose
}: Omit<MaterialPickerProps, "closing"> & { open: boolean; closing?: boolean }) {
  const [rendered, setRendered] = useState(open || closing);
  const closeTimerRef = useRef<number | null>(null);
  const drawerClosing = closing || (rendered && !open);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open || closing) {
      setRendered(true);
      return;
    }
    if (!rendered) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setRendered(false);
    }, MATERIAL_PICKER_DRAWER_ANIMATION_MS);
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [closing, open, rendered]);

  if (!rendered) return null;

  return (
    <div className="composer-material-drawer" data-state={drawerClosing ? "closing" : "open"}>
      <MaterialPicker
        assets={assets}
        selectedAssets={selectedAssets}
        onToggleAsset={onToggleAsset}
        onSelectedAssetsChange={onSelectedAssetsChange}
        onClose={onClose}
        closing={drawerClosing}
      />
    </div>
  );
}

export function MaterialPicker({
  assets,
  selectedAssets,
  onToggleAsset,
  onSelectedAssetsChange,
  onClose,
  closing = false
}: MaterialPickerProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [selectedTagKey, setSelectedTagKey] = useState("");
  const upload = useMutation({
    mutationFn: (form: FormData) => api.uploadAsset(form),
    onSuccess: (result) => {
      onSelectedAssetsChange([...selectedAssets, result.asset]);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    }
  });
  const allAssets = assets?.assets ?? [];
  const materialTags = useMemo(() => {
    const tagMap = new Map<string, { key: string; label: string; categoryId?: string; categoryName?: string }>();
    allAssets.forEach((asset) => {
      asset.categoryIds.forEach((categoryId, index) => {
        if (!categoryId) return;
        const label = asset.categoryNames[index] || categoryId;
        tagMap.set(`id:${categoryId}`, { key: `id:${categoryId}`, label, categoryId });
      });
      asset.categoryNames.forEach((categoryName) => {
        const label = categoryName.trim();
        if (!label) return;
        const hasSameLabel = Array.from(tagMap.values()).some((tag) => tag.label === label);
        if (!hasSameLabel) tagMap.set(`name:${label}`, { key: `name:${label}`, label, categoryName: label });
      });
    });
    return Array.from(tagMap.values()).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  }, [allAssets]);
  const selectedTag = materialTags.find((tag) => tag.key === selectedTagKey);
  const filteredAssets = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return allAssets
      .filter((asset) => {
        if (!selectedTag) return true;
        if (selectedTag.categoryId) return asset.categoryIds.includes(selectedTag.categoryId);
        return selectedTag.categoryName ? asset.categoryNames.includes(selectedTag.categoryName) : true;
      })
      .filter((asset) => {
        if (!normalizedKeyword) return true;
        const haystack = [asset.name, asset.sourceUsername, assetSpaceLabel(asset), ...asset.categoryNames]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedKeyword);
      });
  }, [allAssets, keyword, selectedTag]);
  const sections = [
    { id: "shared", name: t("common.shared"), assets: filteredAssets.filter((asset) => asset.space === "shared" || asset.shared) },
    { id: "private", name: t("common.mine"), assets: filteredAssets.filter((asset) => asset.canEdit && asset.space === "private") }
  ];
  const totalVisibleAssets = sections.reduce((count, section) => count + section.assets.length, 0);

  useEffect(() => {
    if (!selectedTagKey || materialTags.some((tag) => tag.key === selectedTagKey)) return;
    setSelectedTagKey("");
  }, [materialTags, selectedTagKey]);

  const handleTagWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const atStart = element.scrollLeft <= 0;
    const atEnd = Math.ceil(element.scrollLeft + element.clientWidth) >= element.scrollWidth;
    if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
    event.preventDefault();
    element.scrollLeft += delta;
  };
  return (
    <div className="material-picker" data-state={closing ? "closing" : "open"}>
      <div className="material-head">
        <div className="material-title-row">
          <strong>{t("materialPicker.title")}</strong>
          {materialTags.length > 0 ? (
            <div className="material-tag-filter" aria-label={t("pages.assets.tags")} onWheel={handleTagWheel}>
              <button type="button" className={cx(!selectedTagKey && "active")} onClick={() => setSelectedTagKey("")}>
                {t("common.all")}
              </button>
              {materialTags.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  className={cx(selectedTagKey === tag.key && "active")}
                  onClick={() => setSelectedTagKey((value) => (value === tag.key ? "" : tag.key))}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          ) : null}
          <label className="case-search material-search">
            <Search size={16} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("materialPicker.searchPlaceholder")} />
          </label>
        </div>
        <div className="material-head-actions">
          <label className="upload-btn compact">
            {t("materialPicker.localUpload")}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                form.set("space", "private");
                upload.mutate(form);
                event.target.value = "";
              }}
            />
          </label>
          {onClose ? (
            <button type="button" className="icon-btn material-close-btn" onClick={onClose} aria-label={t("materialPicker.close")}>
              <X size={17} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="material-sections">
        {sections.map((section) => (
          <section key={section.id}>
            <div className="material-section-head">
              <h4>{section.name}</h4>
              {section.assets.some((asset) => selectedAssets.some((item) => item.id === asset.id)) ? (
                <button
                  type="button"
                  className="material-clear-selected"
                  onClick={() => {
                    const sectionAssetIds = new Set(section.assets.map((asset) => asset.id));
                    onSelectedAssetsChange(selectedAssets.filter((asset) => !sectionAssetIds.has(asset.id)));
                  }}
                  aria-label={t("materialPicker.clearSelected", { section: section.name })}
                  title={t("materialPicker.clearSelected", { section: section.name })}
                >
                  <BrushCleaning size={14} />
                </button>
              ) : null}
            </div>
            {section.assets.length === 0 ? <p className="muted">{totalVisibleAssets === 0 ? t("materialPicker.noMatch") : t("materialPicker.empty")}</p> : null}
            <div className="material-grid">
              {section.assets.map((asset) => {
                const active = selectedAssets.some((item) => item.id === asset.id);
                return (
                  <button key={asset.id} type="button" className={active ? "active" : ""} onClick={() => onToggleAsset(asset)}>
                    {active ? (
                      <span className="material-grid-check" aria-hidden="true">
                        <Check size={12} />
                      </span>
                    ) : null}
                    <img src={asset.thumbnailUrl ?? asset.previewUrl ?? asset.url} alt={asset.name} />
                    <span>{asset.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
