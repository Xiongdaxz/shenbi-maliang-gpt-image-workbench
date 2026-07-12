import { Download, FolderOpen, Heart, HeartOff, Lightbulb, ListChecks, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";

export type ImageBatchAction = "favorite" | "unfavorite" | "asset" | "case" | "download" | "delete";

const IMAGE_BATCH_DELETE_ENABLED = false;

export function ImageBatchToolbar({
  selectedCount,
  loadedCount,
  allLoadedSelected,
  pendingAction,
  onToggleAllLoaded,
  onFavorite,
  onAddAsset,
  onAddCase,
  onDownload,
  onDelete,
  onExit
}: {
  selectedCount: number;
  loadedCount: number;
  allLoadedSelected: boolean;
  pendingAction: ImageBatchAction | null;
  onToggleAllLoaded: () => void;
  onFavorite: (favorited: boolean) => void;
  onAddAsset: () => void;
  onAddCase: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onExit: () => void;
}) {
  const { t } = useI18n();
  const pending = Boolean(pendingAction);
  const noSelection = selectedCount === 0;
  const actionDisabled = (limit: number) => pending || noSelection || selectedCount > limit;
  const actionTitle = (limit: number, label: string) =>
    selectedCount > limit ? t("pages.images.batch.limit", { count: limit }) : label;

  return (
    <div className="image-batch-toolbar" role="toolbar" aria-label={t("pages.images.batch.toolbar") }>
      <div className="image-batch-summary">
        <ListChecks size={18} />
        <strong>{t("pages.images.batch.selected", { count: selectedCount })}</strong>
      </div>
      <div className="image-batch-actions">
        <button className="secondary-btn" type="button" disabled={pending || loadedCount === 0} onClick={onToggleAllLoaded}>
          <ListChecks size={16} />
          {allLoadedSelected ? t("pages.images.batch.unselectLoaded") : t("pages.images.batch.selectLoaded")}
        </button>
        <button className="secondary-btn" type="button" disabled={actionDisabled(200)} onClick={() => onFavorite(true)} title={actionTitle(200, t("pages.images.batch.favorite"))}>
          <Heart size={16} />
          {t("pages.images.batch.favorite")}
        </button>
        <button className="secondary-btn" type="button" disabled={actionDisabled(200)} onClick={() => onFavorite(false)} title={actionTitle(200, t("pages.images.batch.unfavorite"))}>
          <HeartOff size={16} />
          {t("pages.images.batch.unfavorite")}
        </button>
        <button className="secondary-btn" type="button" disabled={actionDisabled(100)} onClick={onAddAsset} title={actionTitle(100, t("pages.cases.addToAssets"))}>
          <FolderOpen size={16} />
          {t("pages.cases.addToAssets")}
        </button>
        <button className="secondary-btn" type="button" disabled={actionDisabled(20)} onClick={onAddCase} title={actionTitle(20, t("pages.cases.addToInspiration"))}>
          <Lightbulb size={16} />
          {t("pages.cases.addToInspiration")}
        </button>
        <button className="secondary-btn" type="button" disabled={actionDisabled(50)} onClick={onDownload} title={actionTitle(50, t("pages.images.batch.download"))}>
          <Download size={16} />
          {t("pages.images.batch.download")}
        </button>
        {IMAGE_BATCH_DELETE_ENABLED ? (
          <button className="danger-btn" type="button" disabled={actionDisabled(200)} onClick={onDelete} title={actionTitle(200, t("pages.images.batch.delete"))}>
            <Trash2 size={16} />
            {t("pages.images.batch.delete")}
          </button>
        ) : null}
        <button className="secondary-btn image-batch-exit" type="button" disabled={pending} onClick={onExit}>
          <X size={16} />
          {t("pages.images.batch.exit")}
        </button>
      </div>
    </div>
  );
}
