import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  Bot,
  Bug,
  Check,
  Database,
  Download,
  FolderOpen,
  GripVertical,
  ImageIcon,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Mail,
  Network,
  PanelLeft,
  ScrollText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Upload,
  Users,
  WandSparkles
} from "lucide-react";
import { api, configApi } from "../../api";
import { LightweightLineChart } from "../../components/LightweightChart";
import { MarkdownView } from "../../components/MarkdownView";
import { useInfinitePageLoader } from "../../hooks/useInfinitePageLoader";
import { DEFAULT_SITE_NAME } from "../../lib/branding";
import { copyTextToClipboard } from "../../lib/clipboard";
import { cx } from "../../lib/cx";
import { formatImageFileSize } from "../../lib/format";
import type {
  BackupRun,
  BackupSettings,
  ChangelogEntry,
  BrandingAsset,
  BrandingAssetType,
  BrandingSettings,
  ConfigStatistics,
  DebugSettings,
  ImageAccount,
  ImageAccountImportPreviewItem,
  ImageAccountImportSource,
  ImageGenerationMode,
  ModelRequestLog,
  PromptOptimizerProvider,
  ProviderConfig,
  ProviderRequestLog,
  ProxyConfig,
  SafetyReviewLog,
  SafetyReviewSettings,
  SmsSettings,
  StatisticsPreset,
  SmtpSettings,
  StarterCopySettings,
  StarterDailyCopy,
  Team
} from "../../types";
import type {
  ConfigAssetReviewItem,
  ConfigCaseReviewItem,
  ConfigContentCategory,
  ConfigContentCategoryType
} from "../../api/config";
import { ConfirmDialog, CustomSelect, PromptDialog, useToast } from "../../ui";
import {
  ConfigHeader,
  GlobalSwitchRow,
  REQUEST_LOG_PAGE_SIZE,
  SwitchControl,
  durationLabel,
  emptyProvider,
  formatDate,
  inputDateOffset,
  inputDateValue,
  nextChangelogVersion,
  numberLabel,
  percentLabel,
  providerDateFromId,
  shouldAutoRefreshAccountUsage,
  todayInputDate,
  uniqueProviderFormId,
  isGeneratedProviderId,
  isGeneratedProviderName
} from "../shared";

type AssetReviewStatusFilter = "pending" | "approved" | "rejected" | "all";
type CaseReviewStatusFilter = "pending" | "approved" | "rejected" | "all";

const assetReviewStatusOptions: Array<{ value: AssetReviewStatusFilter; label: string }> = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "未通过" },
  { value: "all", label: "全部" }
];

const caseReviewStatusOptions: Array<{ value: CaseReviewStatusFilter; label: string }> = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "未通过" },
  { value: "all", label: "全部" }
];

function assetReviewStatusLabel(status: ConfigAssetReviewItem["shareStatus"]) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已通过";
  if (status === "rejected") return "未通过";
  return "未申请";
}

function caseReviewStatusLabel(status: ConfigCaseReviewItem["reviewStatus"]) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已通过";
  if (status === "rejected") return "未通过";
  return "已通过";
}

function contentCategoryTypeLabel(type: ConfigContentCategoryType) {
  return type === "case" ? "灵感风格" : "素材标签";
}

function contentCategoryItemLabel(type: ConfigContentCategoryType) {
  return type === "case" ? "条灵感" : "个素材";
}

function CategoryMergeDialog({
  source,
  categories,
  pending,
  onCancel,
  onConfirm
}: {
  source: ConfigContentCategory | null;
  categories: ConfigContentCategory[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (targetId: string) => void;
}) {
  const targets = useMemo(() => categories.filter((category) => category.id !== source?.id), [categories, source?.id]);
  const [targetId, setTargetId] = useState("");

  useEffect(() => {
    setTargetId(source ? targets[0]?.id ?? "" : "");
  }, [source, targets]);

  if (!source) return null;
  const target = targets.find((category) => category.id === targetId);
  const typeLabel = contentCategoryTypeLabel(source.type);

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <section className="case-modal content-category-merge-modal" role="dialog" aria-modal="true" aria-label={`合并${typeLabel}`}>
        <header>
          <h3>合并{typeLabel}</h3>
          <button type="button" onClick={onCancel} disabled={pending}>关闭</button>
        </header>
        <div className="content-category-merge-body">
          <p>
            将“{source.name}”的 {source.itemCount} {contentCategoryItemLabel(source.type)}和 {source.suggestionCount} 张图片的自动推荐记录迁移到目标项，
            然后删除原{typeLabel}。此操作不会删除灵感或素材。
          </p>
          <label>
            <span>合并到</span>
            <CustomSelect
              value={targetId}
              options={targets.map((category) => ({
                value: category.id,
                label: `${category.name} · ${category.itemCount} ${contentCategoryItemLabel(category.type)}`
              }))}
              onChange={setTargetId}
              menuWidth={320}
            />
          </label>
          {target ? <small>合并后统一使用“{target.name}”，原名称将不再出现在筛选和新增选择中。</small> : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onCancel} disabled={pending}>取消</button>
            <button className="danger-btn" type="button" onClick={() => onConfirm(targetId)} disabled={pending || !targetId}>
              {pending ? "合并中" : "确认合并"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CategoryDeleteDialog({
  source,
  categories,
  deletePending,
  migratePending,
  onCancel,
  onDelete,
  onMigrate
}: {
  source: ConfigContentCategory | null;
  categories: ConfigContentCategory[];
  deletePending: boolean;
  migratePending: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onMigrate: (targetId: string) => void;
}) {
  const targets = useMemo(() => categories.filter((category) => category.id !== source?.id), [categories, source?.id]);
  const [targetId, setTargetId] = useState("");
  const pending = deletePending || migratePending;

  useEffect(() => {
    setTargetId("");
  }, [source?.id]);

  if (!source) return null;
  const typeLabel = contentCategoryTypeLabel(source.type);
  const directDeleteEffect = source.type === "case"
    ? `${source.itemCount} ${contentCategoryItemLabel(source.type)}会保留，并清除这个风格`
    : `${source.itemCount} ${contentCategoryItemLabel(source.type)}会保留，仅解除这个标签`;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <section className="case-modal content-category-delete-modal" role="dialog" aria-modal="true" aria-label={`删除${typeLabel}`}>
        <header>
          <h3>删除{typeLabel}</h3>
          <button type="button" onClick={onCancel} disabled={pending}>关闭</button>
        </header>
        <div className="content-category-delete-body">
          <p>
            删除“{source.name}”不会删除灵感或素材本身。直接删除时，{directDeleteEffect}；
            {source.suggestionCount} 张图片中的自动推荐记录会同时移除。
          </p>
          {targets.length ? (
            <label>
              <span>迁移到其他{typeLabel}（可选）</span>
              <CustomSelect
                value={targetId}
                placeholder={`请选择目标${typeLabel}`}
                options={targets.map((category) => ({
                  value: category.id,
                  label: `${category.name} · ${category.itemCount} ${contentCategoryItemLabel(category.type)}`
                }))}
                onChange={setTargetId}
                menuWidth={320}
              />
              <small>主动选择目标后，才能使用“迁移后删除”，内容关联和自动推荐记录会一并转到目标项。</small>
            </label>
          ) : (
            <small>当前没有可迁移的其他{typeLabel}，只能直接删除。</small>
          )}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onCancel} disabled={pending}>取消</button>
            <button className="danger-btn" type="button" onClick={onDelete} disabled={pending}>
              {deletePending ? "删除中" : "直接删除"}
            </button>
            {targets.length ? (
              <button className="primary-btn" type="button" onClick={() => onMigrate(targetId)} disabled={pending || !targetId}>
                {migratePending ? "迁移中" : "迁移后删除"}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function ContentCategoryManagementPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [activeType, setActiveType] = useState<ConfigContentCategoryType>("case");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ConfigContentCategory | null>(null);
  const [mergeTarget, setMergeTarget] = useState<ConfigContentCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConfigContentCategory | null>(null);
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const caseCategories = useQuery({
    queryKey: ["config-content-categories", "case"],
    queryFn: () => configApi.contentCategories("case")
  });
  const assetCategories = useQuery({
    queryKey: ["config-content-categories", "asset"],
    queryFn: () => configApi.contentCategories("asset")
  });
  const activeQuery = activeType === "case" ? caseCategories : assetCategories;
  const categories = activeQuery.data?.categories ?? [];
  const visibleCategories = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return categories;
    return categories.filter((category) => category.name.toLowerCase().includes(normalizedKeyword));
  }, [categories, keyword]);

  const refreshCategoryConsumers = (type: ConfigContentCategoryType) => {
    void queryClient.invalidateQueries({ queryKey: ["config-content-categories", type] });
    void queryClient.invalidateQueries({ queryKey: [type === "case" ? "case-categories" : "asset-categories"] });
    void queryClient.invalidateQueries({ queryKey: [type === "case" ? "cases" : "assets"] });
  };
  const createCategory = useMutation({
    mutationFn: ({ type, name }: { type: ConfigContentCategoryType; name: string }) => configApi.createContentCategory(type, name),
    onSuccess: (_, variables) => {
      refreshCategoryConsumers(variables.type);
      setCreateOpen(false);
      showToast(`${contentCategoryTypeLabel(variables.type)}已新增`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "新增失败", "error")
  });
  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => configApi.renameContentCategory(id, name),
    onSuccess: ({ category }) => {
      refreshCategoryConsumers(category.type);
      setRenameTarget(null);
      showToast(`${contentCategoryTypeLabel(category.type)}已改名`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "改名失败", "error")
  });
  const reorderCategories = useMutation({
    mutationFn: ({ type, orderedIds }: { type: ConfigContentCategoryType; orderedIds: string[] }) =>
      configApi.reorderContentCategories(type, orderedIds),
    onSuccess: ({ categories: nextCategories }, variables) => {
      queryClient.setQueryData(["config-content-categories", variables.type], { categories: nextCategories });
      refreshCategoryConsumers(variables.type);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "排序失败", "error")
  });
  const mergeCategory = useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) => configApi.mergeContentCategory(id, targetId),
    onSuccess: (result) => {
      queryClient.setQueryData(["config-content-categories", result.type], { categories: result.categories });
      refreshCategoryConsumers(result.type);
      setMergeTarget(null);
      setDeleteTarget(null);
      showToast(`已迁移 ${result.migratedItemCount} 个内容关联和 ${result.migratedSuggestionCount} 张图片的自动推荐记录，原分类已删除`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "合并失败", "error")
  });
  const deleteCategory = useMutation({
    mutationFn: (id: string) => configApi.deleteContentCategory(id),
    onSuccess: (result) => {
      queryClient.setQueryData(["config-content-categories", result.type], { categories: result.categories });
      refreshCategoryConsumers(result.type);
      setDeleteTarget(null);
      const contentEffect = result.type === "case"
        ? `${result.detachedItemCount} 条灵感已保留并清除该风格`
        : `${result.detachedItemCount} 个素材已解除该标签`;
      showToast(`${contentCategoryTypeLabel(result.type)}已删除，${contentEffect}`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "删除失败", "error")
  });

  const moveCategory = (category: ConfigContentCategory, direction: -1 | 1) => {
    const index = categories.findIndex((item) => item.id === category.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= categories.length || reorderCategories.isPending) return;
    const next = [...categories];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    reorderCategories.mutate({ type: activeType, orderedIds: next.map((item) => item.id) });
  };

  const sortingDisabled = Boolean(keyword.trim()) || reorderCategories.isPending;
  const resetCategoryDrag = () => {
    setDraggingCategoryId(null);
    setDropTarget(null);
  };
  const categoryDropTargetAt = (clientX: number, clientY: number) => {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLTableRowElement>("tr[data-category-id]");
    const targetId = row?.dataset.categoryId;
    if (!row || !targetId || !row.closest(".content-category-table")) return null;
    const bounds = row.getBoundingClientRect();
    return {
      id: targetId,
      position: clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const
    };
  };
  const commitCategoryDrag = (sourceId: string, targetId: string, position: "before" | "after") => {
    if (sourceId === targetId || sortingDisabled) return;
    const source = categories.find((category) => category.id === sourceId);
    const targetIndex = categories.findIndex((category) => category.id === targetId);
    if (!source || targetIndex < 0) return;
    const next = categories.filter((category) => category.id !== sourceId);
    const remainingTargetIndex = next.findIndex((category) => category.id === targetId);
    next.splice(remainingTargetIndex + (position === "after" ? 1 : 0), 0, source);
    if (next.every((category, index) => category.id === categories[index]?.id)) return;
    reorderCategories.mutate({ type: activeType, orderedIds: next.map((category) => category.id) });
  };
  const handleCategoryPointerDown = (event: ReactPointerEvent<HTMLTableRowElement>, categoryId: string) => {
    if (sortingDisabled || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".content-category-action-btn")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingCategoryId(categoryId);
    setDropTarget(null);
  };
  const handleCategoryPointerMove = (event: ReactPointerEvent<HTMLTableRowElement>) => {
    if (!draggingCategoryId || sortingDisabled) return;
    event.preventDefault();
    const target = categoryDropTargetAt(event.clientX, event.clientY);
    if (!target || target.id === draggingCategoryId) {
      setDropTarget(null);
      return;
    }
    setDropTarget((current) => current?.id === target.id && current.position === target.position ? current : target);
  };
  const handleCategoryPointerUp = (event: ReactPointerEvent<HTMLTableRowElement>, sourceId: string) => {
    if (draggingCategoryId !== sourceId || sortingDisabled) return;
    const target = categoryDropTargetAt(event.clientX, event.clientY);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resetCategoryDrag();
    if (target) commitCategoryDrag(sourceId, target.id, target.position);
  };

  return (
    <section className="config-card content-category-management-card">
      <ConfigHeader
        title="分类管理"
        desc="统一维护灵感空间风格与素材库标签；前台仍可新增。"
      />
      <div className="content-category-toolbar">
        <div className="provider-filter-tabs" role="tablist" aria-label="分类类型">
          <button type="button" role="tab" className={activeType === "case" ? "active" : ""} onClick={() => setActiveType("case")}>
            灵感风格 <span data-config-no-translate="true">{caseCategories.data?.categories.length ?? 0}</span>
          </button>
          <button type="button" role="tab" className={activeType === "asset" ? "active" : ""} onClick={() => setActiveType("asset")}>
            素材标签 <span data-config-no-translate="true">{assetCategories.data?.categories.length ?? 0}</span>
          </button>
        </div>
        <input
          className="asset-review-search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={`搜索${contentCategoryTypeLabel(activeType)}`}
        />
        <button className="primary-btn" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> 新增{contentCategoryTypeLabel(activeType)}
        </button>
      </div>
      <div className="table-wrap content-category-table-wrap">
        <table className="content-category-table">
          <thead>
            <tr>
              <th>顺序</th>
              <th>名称</th>
              <th>关联内容</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleCategories.map((category) => {
              const index = categories.findIndex((item) => item.id === category.id);
              return (
                <tr
                  key={category.id}
                  data-category-id={category.id}
                  className={cx(
                    !sortingDisabled && "content-category-row-sortable",
                    draggingCategoryId === category.id && "content-category-row-dragging",
                    dropTarget?.id === category.id && `content-category-drop-${dropTarget.position}`
                  )}
                  onPointerDown={(event) => handleCategoryPointerDown(event, category.id)}
                  onPointerMove={handleCategoryPointerMove}
                  onPointerUp={(event) => handleCategoryPointerUp(event, category.id)}
                  onPointerCancel={resetCategoryDrag}
                >
                  <td>
                    <div className="content-category-order-cell">
                      <button
                        className="ghost-btn content-category-drag-handle"
                        type="button"
                        aria-label={`拖动${category.name}排序`}
                        title={keyword.trim() ? "清除搜索后可拖动排序" : reorderCategories.isPending ? "正在保存排序" : "整行均可拖动；聚焦此处也可使用上下方向键"}
                        disabled={sortingDisabled}
                        onKeyDown={(event) => {
                          if (sortingDisabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                          event.preventDefault();
                          moveCategory(category, event.key === "ArrowUp" ? -1 : 1);
                        }}
                      >
                        <GripVertical size={20} aria-hidden="true" />
                      </button>
                      <span className="content-category-order">{index + 1}</span>
                    </div>
                  </td>
                  <td><strong title={category.name}>{category.name}</strong></td>
                  <td>{category.itemCount} {contentCategoryItemLabel(category.type)}</td>
                  <td>
                    <div className="content-category-row-actions">
                      <button className="secondary-btn content-category-action-btn" type="button" onClick={() => setRenameTarget(category)}>
                        改名
                      </button>
                      <button
                        className="secondary-btn content-category-action-btn"
                        type="button"
                        title="合并到其他分类"
                        disabled={categories.length < 2}
                        onClick={() => setMergeTarget(category)}
                      >
                        合并
                      </button>
                      <button
                        className="danger-btn content-category-action-btn"
                        type="button"
                        title="删除或迁移后删除"
                        onClick={() => setDeleteTarget(category)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {activeQuery.isLoading ? <tr><td colSpan={4}>分类加载中...</td></tr> : null}
            {activeQuery.error ? <tr><td colSpan={4} className="form-error">{activeQuery.error.message}</td></tr> : null}
            {!activeQuery.isLoading && !activeQuery.error && visibleCategories.length === 0 ? (
              <tr><td colSpan={4}>{keyword.trim() ? "暂无匹配分类" : `暂无${contentCategoryTypeLabel(activeType)}`}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <PromptDialog
        open={createOpen}
        title={`新增${contentCategoryTypeLabel(activeType)}`}
        label="名称"
        confirmText={createCategory.isPending ? "保存中" : "新增"}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(name) => {
          if (!createCategory.isPending) createCategory.mutate({ type: activeType, name: name.trim() });
        }}
      />
      <PromptDialog
        open={Boolean(renameTarget)}
        title={`修改${renameTarget ? contentCategoryTypeLabel(renameTarget.type) : "分类"}名称`}
        label="名称"
        defaultValue={renameTarget?.name ?? ""}
        confirmText={renameCategory.isPending ? "保存中" : "保存"}
        onCancel={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (renameTarget && !renameCategory.isPending) renameCategory.mutate({ id: renameTarget.id, name: name.trim() });
        }}
      />
      <CategoryMergeDialog
        source={mergeTarget}
        categories={categories}
        pending={mergeCategory.isPending}
        onCancel={() => setMergeTarget(null)}
        onConfirm={(targetId) => {
          if (mergeTarget && !mergeCategory.isPending) mergeCategory.mutate({ id: mergeTarget.id, targetId });
        }}
      />
      <CategoryDeleteDialog
        source={deleteTarget}
        categories={categories}
        deletePending={deleteCategory.isPending}
        migratePending={mergeCategory.isPending}
        onCancel={() => setDeleteTarget(null)}
        onDelete={() => {
          if (deleteTarget && !deleteCategory.isPending) deleteCategory.mutate(deleteTarget.id);
        }}
        onMigrate={(targetId) => {
          if (deleteTarget && !mergeCategory.isPending) mergeCategory.mutate({ id: deleteTarget.id, targetId });
        }}
      />
    </section>
  );
}

function ReviewPromptPreview({ text }: { text?: string | null }) {
  const prompt = text?.trim();
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setCardPosition(null), 90);
  };

  const openCard = (target: HTMLElement) => {
    if (!prompt) return;
    clearCloseTimer();
    const rect = target.getBoundingClientRect();
    const availableWidth = Math.max(280, window.innerWidth - 48);
    const width = Math.min(760, availableWidth);
    const left = Math.min(Math.max(24, rect.left), Math.max(24, window.innerWidth - width - 24));
    const cardHeight = 420;
    const belowTop = rect.bottom + 8;
    const top = belowTop + cardHeight > window.innerHeight ? Math.max(24, rect.top - cardHeight - 8) : belowTop;
    setCardPosition({ left, top, width });
  };

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  if (!prompt) return null;

  return (
    <>
      <button
        type="button"
        className="asset-review-prompt-trigger"
        onMouseEnter={(event) => openCard(event.currentTarget)}
        onMouseLeave={scheduleClose}
        onFocus={(event) => openCard(event.currentTarget)}
        onBlur={scheduleClose}
        onClick={() => {
          clearCloseTimer();
          setCardPosition(null);
          setModalOpen(true);
        }}
        title="点击查看完整提示词"
      >
        {prompt}
      </button>
      {cardPosition ? (
        <div
          className="review-prompt-card"
          style={{ left: cardPosition.left, top: cardPosition.top, width: cardPosition.width }}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
          role="tooltip"
        >
          {prompt}
        </div>
      ) : null}
      {modalOpen ? (
        <div className="modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) setModalOpen(false);
        }}>
          <section className="case-modal review-prompt-modal" role="dialog" aria-modal="true" aria-label="完整提示词">
            <header>
              <h3>完整提示词</h3>
              <button type="button" onClick={() => setModalOpen(false)}>
                关闭
              </button>
            </header>
            <div className="review-prompt-modal-body">
              <pre>{prompt}</pre>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function AssetReviewPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<AssetReviewStatusFilter>("pending");
  const [keyword, setKeyword] = useState("");
  const [approveTarget, setApproveTarget] = useState<ConfigAssetReviewItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ConfigAssetReviewItem | null>(null);
  const reviews = useQuery({
    queryKey: ["config-asset-reviews", status, keyword],
    queryFn: () => configApi.assetReviews({ status, keyword })
  });
  const approve = useMutation({
    mutationFn: (id: string) => configApi.approveAssetReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-asset-reviews"] });
      setApproveTarget(null);
      showToast("素材已通过审核");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => configApi.rejectAssetReview(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-asset-reviews"] });
      setRejectTarget(null);
      showToast("素材已拒绝共享");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const counts = reviews.data?.counts ?? { pending: 0, approved: 0, rejected: 0 };
  const statusCount = (value: AssetReviewStatusFilter) => {
    if (value === "pending") return counts.pending;
    if (value === "approved") return counts.approved;
    if (value === "rejected") return counts.rejected;
    return counts.pending + counts.approved + counts.rejected;
  };

  return (
    <section className="config-card">
      <ConfigHeader title="素材审核" desc="用户主动申请共享后才会出现在这里；审核通过后才进入共享素材区。" />
      <GlobalSwitchRow
        type="asset_review"
        title="素材审核"
        desc="关闭后，新提交共享的素材会直接公开；历史待审素材仍保留当前状态。"
        defaultEnabled
        invalidateQueryKeys={["config-asset-reviews"]}
      />
      <div className="asset-review-toolbar">
        <div className="provider-filter-tabs" role="tablist" aria-label="素材审核状态">
          {assetReviewStatusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              className={status === option.value ? "active" : ""}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
              <span>{statusCount(option.value)}</span>
            </button>
          ))}
        </div>
        <input
          className="asset-review-search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索素材、用户、账号或标签"
        />
      </div>
      <div className="table-wrap asset-review-table-wrap">
        <table className="asset-review-table">
          <colgroup>
            <col className="review-col-main" />
            <col className="review-col-user" />
            <col className="review-col-tags" />
            <col className="review-col-status" />
            <col className="review-col-time" />
            <col className="review-col-time" />
            <col className="review-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>素材</th>
              <th>提交用户</th>
              <th>标签</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>审核时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {reviews.data?.assets.map((asset) => (
              <tr key={asset.id}>
                <td>
                  <div className="asset-review-media">
                    <a className="asset-review-thumb-link" href={asset.url} target="_blank" rel="noreferrer" title="预览素材">
                      <img src={asset.thumbnailUrl || asset.previewUrl || asset.url} alt={asset.name} />
                    </a>
                    <div>
                      <strong>{asset.name}</strong>
                      <span>
                        {asset.imageWidth > 0 && asset.imageHeight > 0 ? `${asset.imageWidth} x ${asset.imageHeight}` : "尺寸未知"}
                        {formatImageFileSize(asset.size) ? ` · ${formatImageFileSize(asset.size)}` : ""}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="asset-review-user">
                    <strong>{asset.sourceUsername}</strong>
                    <span>{asset.sourceAccount || "-"} · {asset.teamName}</span>
                  </div>
                </td>
                <td>{asset.categoryNames.length > 0 ? asset.categoryNames.join("、") : "-"}</td>
                <td>
                  <span className={cx("asset-review-status", asset.shareStatus)}>{assetReviewStatusLabel(asset.shareStatus)}</span>
                  {asset.shareStatus === "rejected" && asset.shareRejectReason ? <small>{asset.shareRejectReason}</small> : null}
                </td>
                <td>{formatDate(asset.shareRequestedAt || asset.createdAt)}</td>
                <td>{formatDate(asset.shareReviewedAt)}</td>
                <td className="row-actions compact-actions">
                  <a className="secondary-btn" href={asset.url} target="_blank" rel="noreferrer">预览</a>
                  {asset.shareStatus !== "approved" ? (
                    <button className="primary-btn" onClick={() => setApproveTarget(asset)}>
                      {asset.shareStatus === "rejected" ? "改为通过" : "通过"}
                    </button>
                  ) : null}
                  {asset.shareStatus !== "rejected" ? (
                    <button className="danger-btn" onClick={() => setRejectTarget(asset)}>
                      {asset.shareStatus === "approved" ? "改为未通过" : "拒绝"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {reviews.isLoading ? (
              <tr>
                <td colSpan={7}>素材审核加载中...</td>
              </tr>
            ) : null}
            {reviews.error ? (
              <tr>
                <td colSpan={7} className="form-error">{reviews.error.message}</td>
              </tr>
            ) : null}
            {!reviews.isLoading && !reviews.error && (reviews.data?.assets.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7}>暂无素材审核记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(approveTarget)}
        title={approveTarget?.shareStatus === "rejected" ? "改为通过素材共享" : "通过素材共享"}
        description={
          approveTarget
            ? approveTarget.shareStatus === "rejected"
              ? `确认将“${approveTarget.name}”改为已通过？通过后所有用户都能在共享素材中查看和使用。`
              : `确认通过“${approveTarget.name}”？通过后所有用户都能在共享素材中查看和使用。`
            : ""
        }
        confirmText={approve.isPending ? "处理中" : approveTarget?.shareStatus === "rejected" ? "改为通过" : "通过"}
        onCancel={() => setApproveTarget(null)}
        onConfirm={() => {
          if (approveTarget && !approve.isPending) approve.mutate(approveTarget.id);
        }}
      />
      <PromptDialog
        open={Boolean(rejectTarget)}
        title={rejectTarget?.shareStatus === "approved" ? "改为未通过素材" : "拒绝素材共享"}
        label="拒绝原因"
        confirmText={reject.isPending ? "处理中" : rejectTarget?.shareStatus === "approved" ? "改为未通过" : "拒绝"}
        onCancel={() => setRejectTarget(null)}
        onSubmit={(reason) => {
          if (rejectTarget && !reject.isPending) reject.mutate({ id: rejectTarget.id, reason: reason.trim() });
        }}
      />
    </section>
  );
}

export function CaseReviewPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<CaseReviewStatusFilter>("pending");
  const [keyword, setKeyword] = useState("");
  const [approveTarget, setApproveTarget] = useState<ConfigCaseReviewItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ConfigCaseReviewItem | null>(null);
  const reviews = useQuery({
    queryKey: ["config-case-reviews", status, keyword],
    queryFn: () => configApi.caseReviews({ status, keyword })
  });
  const approve = useMutation({
    mutationFn: (id: string) => configApi.approveCaseReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-case-reviews"] });
      setApproveTarget(null);
      showToast("灵感已通过审核");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => configApi.rejectCaseReview(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-case-reviews"] });
      setRejectTarget(null);
      showToast("灵感已拒绝公开");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const counts = reviews.data?.counts ?? { pending: 0, approved: 0, rejected: 0 };
  const statusCount = (value: CaseReviewStatusFilter) => {
    if (value === "pending") return counts.pending;
    if (value === "approved") return counts.approved;
    if (value === "rejected") return counts.rejected;
    return counts.pending + counts.approved + counts.rejected;
  };

  return (
    <section className="config-card">
      <ConfigHeader title="灵感审核" desc="用户加入灵感空间后先进入审核；通过后才进入公共灵感空间。" />
      <GlobalSwitchRow
        type="case_review"
        title="灵感审核"
        desc="关闭后，新加入灵感会直接公开；历史待审灵感仍保留当前状态。"
        defaultEnabled
        invalidateQueryKeys={["config-case-reviews"]}
      />
      <div className="asset-review-toolbar">
        <div className="provider-filter-tabs" role="tablist" aria-label="灵感审核状态">
          {caseReviewStatusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              className={status === option.value ? "active" : ""}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
              <span>{statusCount(option.value)}</span>
            </button>
          ))}
        </div>
        <input
          className="asset-review-search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索灵感、提示词、用户、账号或风格"
        />
      </div>
      <div className="table-wrap asset-review-table-wrap">
        <table className="asset-review-table case-review-table">
          <colgroup>
            <col className="review-col-main" />
            <col className="review-col-user" />
            <col className="review-col-tags" />
            <col className="review-col-status" />
            <col className="review-col-time" />
            <col className="review-col-time" />
            <col className="review-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>灵感</th>
              <th>提交用户</th>
              <th>风格</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>审核时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {reviews.data?.cases.map((item) => (
              <tr key={item.groupId || item.id}>
                <td>
                  <div className="asset-review-media">
                    <a className="asset-review-thumb-link" href={item.url} target="_blank" rel="noreferrer" title="预览灵感">
                      <img src={item.thumbnailUrl || item.previewUrl || item.url} alt={item.title} />
                    </a>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {item.imageWidth > 0 && item.imageHeight > 0 ? `${item.imageWidth} x ${item.imageHeight}` : "尺寸未知"}
                        {formatImageFileSize(item.imageFileSize) ? ` · ${formatImageFileSize(item.imageFileSize)}` : ""}
                      </span>
                      <ReviewPromptPreview text={item.prompt} />
                    </div>
                  </div>
                </td>
                <td>
                  <div className="asset-review-user">
                    <strong>{item.sourceUsername}</strong>
                    <span>{item.sourceAccount || "-"} · {item.teamName}</span>
                  </div>
                </td>
                <td>{item.categoryNames.length > 0 ? item.categoryNames.join("、") : "-"}</td>
                <td>
                  <span className={cx("asset-review-status", item.reviewStatus)}>{caseReviewStatusLabel(item.reviewStatus)}</span>
                  {item.reviewStatus === "rejected" && item.rejectReason ? <small>{item.rejectReason}</small> : null}
                </td>
                <td>{formatDate(item.reviewRequestedAt || item.createdAt)}</td>
                <td>{formatDate(item.reviewedAt)}</td>
                <td className="row-actions compact-actions">
                  <a className="secondary-btn" href={item.url} target="_blank" rel="noreferrer">预览</a>
                  {item.reviewStatus !== "approved" ? (
                    <button className="primary-btn" onClick={() => setApproveTarget(item)}>
                      {item.reviewStatus === "rejected" ? "改为通过" : "通过"}
                    </button>
                  ) : null}
                  {item.reviewStatus !== "rejected" ? (
                    <button className="danger-btn" onClick={() => setRejectTarget(item)}>
                      {item.reviewStatus === "approved" ? "改为未通过" : "拒绝"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {reviews.isLoading ? (
              <tr>
                <td colSpan={7}>灵感审核加载中...</td>
              </tr>
            ) : null}
            {reviews.error ? (
              <tr>
                <td colSpan={7} className="form-error">{reviews.error.message}</td>
              </tr>
            ) : null}
            {!reviews.isLoading && !reviews.error && (reviews.data?.cases.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7}>暂无灵感审核记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(approveTarget)}
        title={approveTarget?.reviewStatus === "rejected" ? "改为通过灵感" : "通过灵感公开"}
        description={
          approveTarget
            ? approveTarget.reviewStatus === "rejected"
              ? `确认将“${approveTarget.title}”改为已通过？通过后所有用户都能在灵感空间中查看和使用。`
              : `确认通过“${approveTarget.title}”？通过后所有用户都能在灵感空间中查看和使用。`
            : ""
        }
        confirmText={approve.isPending ? "处理中" : approveTarget?.reviewStatus === "rejected" ? "改为通过" : "通过"}
        onCancel={() => setApproveTarget(null)}
        onConfirm={() => {
          if (approveTarget && !approve.isPending) approve.mutate(approveTarget.groupId || approveTarget.id);
        }}
      />
      <PromptDialog
        open={Boolean(rejectTarget)}
        title={rejectTarget?.reviewStatus === "approved" ? "改为未通过灵感" : "拒绝灵感公开"}
        label="拒绝原因"
        confirmText={reject.isPending ? "处理中" : rejectTarget?.reviewStatus === "approved" ? "改为未通过" : "拒绝"}
        onCancel={() => setRejectTarget(null)}
        onSubmit={(reason) => {
          if (rejectTarget && !reject.isPending) reject.mutate({ id: rejectTarget.groupId || rejectTarget.id, reason: reason.trim() });
        }}
      />
    </section>
  );
}

function emptyStarterCopySettings(): StarterCopySettings {
  return {
    enabled: true,
    copyCount: 50,
    updatedAt: ""
  };
}

function normalizeStarterCopyCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 50;
  return Math.max(0, Math.min(100, Math.trunc(count)));
}

function normalizeStarterCopySettings(settings?: StarterCopySettings | null): StarterCopySettings {
  const fallback = emptyStarterCopySettings();
  return {
    ...fallback,
    ...settings,
    enabled: Boolean(settings?.enabled ?? fallback.enabled),
    copyCount: normalizeStarterCopyCount(settings?.copyCount ?? fallback.copyCount)
  };
}

function sourceLabel(source: string) {
  if (source === "ai") return "AI 生成";
  if (source === "fallback") return "本地兜底";
  return source || "-";
}

function starterCopyStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "success" || normalized === "succeeded") return "已生成";
  if (normalized === "failed" || normalized === "error") return "生成失败";
  if (normalized === "running" || normalized === "pending") return "生成中";
  return status || "-";
}

function StarterCopyPreview({ copy }: { copy: StarterDailyCopy | null | undefined }) {
  if (!copy) return <p className="muted">今日暂未生成文案。</p>;
  const copiesZh = (copy.copiesZh?.length ? copy.copiesZh : copy.copies).map((item) => String(item ?? "").trim()).filter(Boolean);
  const copiesEn = (copy.copiesEn ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  const rowCount = Math.max(copiesZh.length, copiesEn.length);
  return (
    <div className="starter-copy-preview">
      <div className="starter-copy-preview-head">
        <strong>今日文案</strong>
        <div className="starter-copy-status-line">
          <span>日期：{copy.date || "-"}</span>
          <span>来源：{sourceLabel(copy.source)}</span>
          <span>状态：{starterCopyStatusLabel(copy.status || (copy.copies.length > 0 ? "success" : "-"))}</span>
          {copy.generatedAt ? <span>生成：{formatDate(copy.generatedAt)}</span> : null}
        </div>
      </div>
      {copy.error ? <div className="form-error">{copy.error}</div> : null}
      {rowCount > 0 ? (
        <div className="starter-copy-comparison-list">
          {Array.from({ length: rowCount }, (_, index) => {
            const zhText = copiesZh[index] || "未生成";
            const enText = copiesEn[index] || "英文版本待生成";
            return (
              <div className="starter-copy-comparison-row" key={`${index}-${zhText}-${enText}`}>
                <div className="starter-copy-copy">
                  <span className="starter-copy-copy-label">中文文案</span>
                  <span className="starter-copy-copy-text" data-config-no-translate="true" title={zhText}>{index + 1}. {zhText}</span>
                </div>
                <div className="starter-copy-copy">
                  <span className="starter-copy-copy-label">英文文案</span>
                  <span className="starter-copy-copy-text" data-config-no-translate="true" title={enText}>{index + 1}. {enText}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function StarterCopySettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-starter-copy-settings"], queryFn: configApi.starterCopySettings });
  const [form, setForm] = useState<StarterCopySettings>(emptyStarterCopySettings());
  const save = useMutation({
    mutationFn: () => configApi.saveStarterCopySettings(normalizeStarterCopySettings(form)),
    onSuccess: (data) => {
      if (data.settings) setForm(normalizeStarterCopySettings(data.settings));
      showToast("每日文案配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-starter-copy-settings"] });
    }
  });
  const regenerate = useMutation({
    mutationFn: configApi.regenerateStarterCopies,
    onSuccess: (data) => {
      queryClient.setQueryData<{ settings: StarterCopySettings | null; today: StarterDailyCopy | null } | undefined>(
        ["config-starter-copy-settings"],
        (value) => value ? { ...value, today: data.today } : value
      );
      showToast("今日文案已更新");
      queryClient.invalidateQueries({ queryKey: ["config-starter-copy-settings"] });
    },
    onError: (error) => {
      showToast(error.message || "每日文案更新失败", "error");
      queryClient.invalidateQueries({ queryKey: ["config-starter-copy-settings"] });
    }
  });

  useEffect(() => {
    if (query.data?.settings) setForm(normalizeStarterCopySettings(query.data.settings));
  }, [query.data?.settings]);

  const patch = (patchValue: Partial<StarterCopySettings>) => setForm((value) => ({ ...value, ...patchValue }));
  return (
    <section className="config-card starter-copy-settings-card">
      <ConfigHeader title="空白页每日文案" desc="开启后每天凌晨由启用的语言模型生成生图相关互动文案；关闭或失败时继续使用本地固定文案。" />
      <div className="provider-form starter-copy-form">
        <div className="starter-copy-control-row">
          <div className="switch-row starter-copy-switch-row">
            <span>AI 每日文案</span>
            <SwitchControl checked={form.enabled} label={form.enabled ? "启用" : "停用"} onChange={(enabled) => patch({ enabled })} />
          </div>
          <label className="starter-copy-count-field">
            生成数量
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.copyCount}
              onChange={(event) => patch({ copyCount: normalizeStarterCopyCount(event.target.value) })}
            />
          </label>
          <div className="row-actions starter-copy-actions">
            <button className="primary-btn" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save size={16} />
              保存配置
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={!form.enabled || save.isPending || regenerate.isPending}
              aria-busy={regenerate.isPending}
            >
              <RefreshCw className={regenerate.isPending ? "spin-icon" : undefined} size={16} />
              立即更新文案
            </button>
          </div>
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {regenerate.error ? <div className="form-error">{regenerate.error.message}</div> : null}
      </div>
      <StarterCopyPreview copy={query.data?.today} />
    </section>
  );
}
