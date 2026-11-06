import { useWorkbench } from "../store/workbench";
import { CaseMaterialPickerModal } from "../components/CaseMaterialPickerModal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowDown, ArrowUp, ArrowUpRight, Archive, Check, ChevronRight, Circle, CircleCheck, Copy, Download, Ellipsis, Image as ImageIcon, Layers, LoaderCircle, LockKeyhole, Maximize2, Package, Palette, Pencil, Plus, RefreshCw, Search, Settings2, Share2, Sparkles, Square, Trash2, TriangleAlert, X, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { ConfirmDialog, CustomSelect, ModalPortal, useToast } from "../ui";
import { CreativeModal, CreativeContextPreview, ProfileAssets, ProfileEditor, ProfileSelectionFields, useCreativeProfiles } from "../components/CreativeProfiles";
import { CreativeProfileViewer } from "../components/CreativeProfileViewer";
import { CheckerboardImage } from "../components/CheckerboardImage";
import { ImageEditWorkspace } from "../components/ImageEditWorkspace";
import { ImageCompareWorkspace } from "../components/images/ImageCompareWorkspace";
import { ImageLightbox } from "../components/ImageLightbox";
import { buildSizeOptions, buildQualityOptions, sizeOptionFromValue } from "../lib/imageOptions";
import { imageSetGuidance, imageSetNextAction, imageSetPlacementStatus, imageSetPreview, imageSetStep, profileColorSwatches } from "../lib/imageSetWorkspace";
import { useImageSetLayout } from "../hooks/useImageSetLayout";
import { useImageSetDuplicatePreview } from "../hooks/useImageSetDuplicatePreview";
import { DEFAULT_EDIT_IMAGE_MODEL, DEFAULT_GENERATION_IMAGE_MODEL, IMAGE_MODEL_OPTIONS, fallbackImageQuality, imageModelQualities, isImageModelId, isImageQualitySupported } from "../lib/imageModels";
import { createCompareDraft, type CompareDraft } from "../lib/imageCompare";
import { createSubmitRequestId } from "../lib/chatRequest";
import { createCreativeId } from "../lib/creativeId";
import { presentCreativeContext } from "../lib/creativePresentation";
import { cx } from "../lib/cx";
import type { CreativeProfile, CreativeProfileKind, ImageSet, ImageSetInput, ProfileSelection, User, WorkImage } from "../types";
import "../styles/image-sets.css";
import "../styles/image-sets-workspace.css";

const initialSizes = ["1536x2048", "1024x1024", "1152x2048", "2048x1152", "1024x1024", "1536x2048"];
const stages = ["draft", "anchor", "generating", "review", "finalized", "stopped"];
function validDraft(d: ImageSetInput) { return Boolean(d.name.trim() && d.brief.trim() && d.items.every(i => i.name.trim())); }

export function ImageSetsPage({ user }: { user: User }) {
  const { t } = useI18n(), navigate = useNavigate(), location = useLocation();
  const segment = location.pathname.split("/")[2] || "", profiles = segment === "profiles";
  const parameters = new URLSearchParams(location.search), initialSelection: ProfileSelection = {};
  for (const key of ["brandId", "productId", "variantId"] as const) { const value = parameters.get(key); if (value) initialSelection[key] = value; }
  return <section className={cx("page-section sets-page", segment && !profiles && "sets-page-workspace")} aria-label={t("sets.title")}>
    <header className="sets-page-header">
    <nav className="sets-tabs" aria-label={t("sets.title")}>
      <button className={cx(!profiles && "active")} aria-current={!profiles ? "page" : undefined} onClick={() => navigate("/image-sets")}>{t("sets.tabSets")}</button>
      <button className={cx(profiles && "active")} aria-current={profiles ? "page" : undefined} onClick={() => navigate("/image-sets/profiles")}>{t("sets.tabProfiles")}</button>
    </nav>{!segment || profiles ? <RestoreDefaultsButton userId={user.id} /> : null}</header>
    {profiles ? <ProfilesLibrary user={user} /> : segment ? <SetWorkspace key={segment === "new" ? segment + location.search : segment} user={user} id={segment === "new" ? "" : segment} initialSelection={segment === "new" ? initialSelection : undefined} /> : <SetsLibrary user={user} />}
  </section>;
}
function RestoreDefaultsButton({ userId }: { userId: string }) {
  const { t } = useI18n(), client = useQueryClient(), { showToast } = useToast();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), inFlight = useRef(false), requestId = useRef("");
  const restore = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setOpen(false); setBusy(true); requestId.current ||= createSubmitRequestId();
    try {
      await api.restoreCreativeDefaults(requestId.current); requestId.current = "";
      await Promise.all([client.invalidateQueries({ queryKey: ["image-sets", userId] }), client.invalidateQueries({ queryKey: ["creative-profiles", userId] }), client.invalidateQueries({ queryKey: ["creative-profile-context", userId] })]);
      showToast(t("sets.defaultsRestored"));
    } catch (error) { showToast(error instanceof Error ? error.message : String(error), "error"); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <><button type="button" className="sets-text-btn sets-restore-defaults" disabled={busy} onClick={() => setOpen(true)}>
    {busy ? <LoaderCircle size={15} className="sets-spin" /> : <RefreshCw size={15} />}{t(busy ? "sets.restoringDefaults" : "sets.restoreDefaults")}
  </button><ConfirmDialog open={open} title={t("sets.restoreDefaults")} description={t("sets.restoreDefaultsHint")} confirmText={t("sets.restoreDefaults")} onCancel={() => setOpen(false)} onConfirm={() => void restore()} /></>;
}
function LibrarySearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  return <div className="sets-library-search"><Search size={17} aria-hidden="true" />
    <input aria-label={t("sets.search")} placeholder={t("sets.search")} value={value} onChange={event => onChange(event.target.value)} />
    {value ? <button className="icon-btn" aria-label={t("sets.clearSearch")} onClick={() => onChange("")}><X size={14} /></button> : null}
  </div>;
}
function LibraryLoading() {
  const { t } = useI18n();
  return <div className="sets-grid sets-skeleton-grid" role="status" aria-label={t("common.loading")}>
    {[0, 1, 2].map(index => <div className="sets-skeleton-card" key={index}><span /><i /><i /></div>)}
  </div>;
}
function SetsLibrary({ user }: { user: User }) {
  const { t } = useI18n(), navigate = useNavigate(), client = useQueryClient(), { showToast } = useToast();
  const [keyword, setKeyword] = useState(""), [archived, setArchived] = useState(false), [stage, setStage] = useState(""), [brandId, setBrandId] = useState(""), [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ImageSet | null>(null);
  const query = useInfiniteQuery({ queryKey: ["image-sets", user.id, keyword, archived, stage, brandId], initialPageParam: "",
    queryFn: ({ pageParam, signal }) => api.imageSets({ keyword, archived, stage, brandId, cursor: pageParam }, { signal }), getNextPageParam: page => page.nextCursor || undefined, refetchInterval: 6000 });
  const brands = useCreativeProfiles("brand", user.id), items = query.data?.pages.flatMap(page => page.items) ?? [];
  const filtered = Boolean(keyword || brandId || stage || archived);
  const resetFilters = () => { setKeyword(""); setBrandId(""); setStage(""); setArchived(false); };
  const action = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); await client.invalidateQueries({ queryKey: ["image-sets"] }); } catch (error) { showToast(error instanceof Error ? error.message : String(error), "error"); } finally { setBusy(false); } };
  return <div className="sets-library">
    <header className="sets-library-toolbar sets-library-filters sets-project-filters" aria-label={t("sets.tabSets")}>
      <LibrarySearch value={keyword} onChange={setKeyword} />
      <CustomSelect value={brandId} ariaLabel={t("sets.brand")} options={[{ value: "", label: t("sets.allBrands") }, ...(brands.data?.pages.flatMap(page => page.items) ?? []).map(profile => ({ value: profile.id, label: profile.name }))]} onChange={setBrandId} />
      <CustomSelect value={stage} ariaLabel={t("sets.allStages")} options={[{ value: "", label: t("sets.allStages") }, ...stages.map(value => ({ value, label: t("sets.stage." + value) }))]} onChange={setStage} />
      <label className="sets-check sets-archive-filter"><input className="sets-checkbox" type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />{t("sets.archived")}</label>
      <button className="primary-btn sets-library-create" onClick={() => navigate("/image-sets/new")}><Plus size={17} />{t("sets.newSet")}</button>
    </header>
    {query.isPending ? <LibraryLoading /> : null}
    {query.isError ? <div className="sets-library-error" role="alert"><TriangleAlert size={21} /><div><strong>{t("sets.loadFailed")}</strong><p>{query.error.message}</p></div><button className="secondary-btn" onClick={() => void query.refetch()}>{t("sets.retry")}</button></div> : null}
    {query.isSuccess && !items.length ? <div className="sets-library-empty">
      <div className="sets-empty-illustration" aria-hidden="true"><span /><span /><span><Layers size={31} strokeWidth={1.4} /></span></div>
      <h3>{t(filtered ? "sets.noMatches" : "sets.emptySetTitle")}</h3><p>{t(filtered ? "sets.noMatchesHint" : "sets.emptySetHint")}</p>
      <button className={filtered ? "secondary-btn" : "primary-btn"} onClick={filtered ? resetFilters : () => navigate("/image-sets/new")}>{filtered ? <RefreshCw size={15} /> : <Plus size={16} />}{t(filtered ? "sets.clearFilters" : "sets.createFirstSet")}</button>
      {!filtered ? <small>{t("sets.noProfileNeeded")}</small> : null}
    </div> : null}
    <div className="sets-grid sets-project-grid">{items.map(set => {
      const previews = set.items.slice(0, 6).map(item => ({ item, image: imageSetPreview(item.runs.flatMap(record => record.images), undefined, item.selectedImageId) }));
      const hasImages = previews.some(preview => preview.image);
      return <article className="sets-card sets-project-card" key={set.id}>
        <button className={cx("sets-project-cover", !hasImages && "is-empty")} onClick={() => navigate("/image-sets/" + set.id)} aria-label={set.name}>
          {hasImages ? <span className="sets-cover-grid">{previews.map(({ item, image }) => <span className="sets-cover-tile" key={item.id}>{image ? <CheckerboardImage src={image.thumbnailUrl || image.previewUrl || image.url} alt={item.name} loading="lazy" /> : <ImageIcon size={24} strokeWidth={1.2}/>}</span>)}</span> : <span className="sets-cover-placeholder"><Layers size={37} strokeWidth={1.1} /><small>{t("sets.stage.draft")}</small></span>}
          <span className="sets-cover-count"><Layers size={12} />{set.items.length}</span>
        </button>
        <div className="sets-card-body">
          <span className={cx("sets-project-stage", "is-" + set.stage)}>{set.activeCount ? <LoaderCircle size={12} className="sets-spin" /> : <Circle size={8} />}{t(set.archived ? "sets.archived" : "sets.stage." + set.stage)}</span>
          <button className="sets-card-title" onClick={() => navigate("/image-sets/" + set.id)}>{set.name}</button>
          <div className="sets-project-progress"><span>{t("sets.progress", { count: set.selectedCount, total: set.items.length })}</span><time dateTime={set.updatedAt}>{new Date(set.updatedAt).toLocaleDateString()}</time></div>
          <div className="sets-progress-track" role="progressbar" aria-label={t("sets.progress", { count: set.selectedCount, total: set.items.length })} aria-valuemin={0} aria-valuemax={set.items.length} aria-valuenow={set.selectedCount}><span style={{ width: (set.selectedCount / set.items.length * 100) + "%" }} /></div>
          <footer className="sets-card-actions"><button className="sets-text-btn" onClick={() => navigate("/image-sets/" + set.id)}>{t("sets.openSet")}<ArrowUpRight size={15} /></button><span />
            <button className="icon-btn" title={t(set.executionMode === "demo" ? "sets.useForReal" : "sets.copyProject")} aria-label={t(set.executionMode === "demo" ? "sets.useForReal" : "sets.copyProject")} disabled={busy} onClick={() => void action(async () => { const result = await api.copyImageSet(set.id); navigate("/image-sets/" + result.set.id); })}><Copy size={15} /></button>
            <button className="icon-btn" title={t(set.archived ? "sets.restore" : "sets.archive")} aria-label={t(set.archived ? "sets.restore" : "sets.archive")} disabled={busy || set.activeCount > 0} onClick={() => void action(() => api.archiveImageSet(set.id, !set.archived))}><Archive size={15} /></button>
            <button className="icon-btn" title={t("common.delete")} aria-label={t("common.delete")} disabled={busy || set.activeCount > 0} onClick={() => setRemoving(set)}><Trash2 size={15} /></button>
          </footer>
        </div>
      </article>;
    })}</div>
    {query.hasNextPage ? <button className="secondary-btn sets-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? <LoaderCircle size={14} className="sets-spin" /> : null}{t("sets.loadMore")}</button> : null}
    <ConfirmDialog open={Boolean(removing)} destructive title={t("common.delete")} description={t("sets.deleteSetHint", { name: removing?.name || "" })} onCancel={() => setRemoving(null)} onConfirm={() => { const target = removing; setRemoving(null); if (target) void action(() => api.deleteImageSet(target.id, target.revision)); }} />
  </div>;
}
function ProfileLibrarySymbol({ profile, userId, onClick }: { profile: CreativeProfile; userId: string; onClick: () => void }) {
  const reference = profile.kind === "brand" ? profile.assets.find(asset => asset.role === "logo") || profile.assets[0] : undefined;
  const query = useQuery({ queryKey: ["creative-reference-asset", userId, reference?.assetId],
    queryFn: ({ signal }) => api.assetDetail(reference!.assetId, { signal }).then(result => result.asset), enabled: Boolean(reference), staleTime: 60_000 });
  const [failedSrc, setFailedSrc] = useState("");
  const source = query.data?.thumbnailUrl || query.data?.previewUrl || query.data?.url;
  const Icon = profile.kind === "brand" ? Palette : Package;
  return <button type="button" className="sets-profile-symbol" aria-label={profile.name} onClick={onClick}>
    {source && source !== failedSrc ? <CheckerboardImage whiteBackground src={source} alt="" loading="lazy" onError={() => setFailedSrc(source)} /> : <Icon size={25} strokeWidth={1.5} />}
  </button>;
}
function ProfilesLibrary({ user }: { user: User }) {
  const { t } = useI18n(), client = useQueryClient(), { showToast } = useToast(), navigate = useNavigate();
  const [kind, setKind] = useState<CreativeProfileKind>("brand"), [keyword, setKeyword] = useState(""), [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<{ kind: CreativeProfileKind; profile?: CreativeProfile } | null>(null), [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<CreativeProfile | null>(null);
  const [removing, setRemoving] = useState<CreativeProfile | null>(null);
  const query = useCreativeProfiles(kind, user.id, keyword, archived), items = query.data?.pages.flatMap(page => page.items) ?? [];
  const filtered = Boolean(keyword || archived);
  const ProfileIcon = kind === "brand" ? Palette : Package;
  const action = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); await client.invalidateQueries({ queryKey: ["creative-profiles"] }); } catch (error) { showToast(error instanceof Error ? error.message : String(error), "error"); } finally { setBusy(false); } };
  return <div className="sets-library sets-profiles-library">
    <header className="sets-library-toolbar sets-library-filters sets-profile-filters" aria-label={t("sets.tabProfiles")}>
      <div className="sets-kind-switch" role="group" aria-label={t("sets.tabProfiles")}>
        <button aria-pressed={kind === "brand"} onClick={() => setKind("brand")}><Palette size={15} />{t("sets.brand")}</button>
        <button aria-pressed={kind === "product"} onClick={() => setKind("product")}><Package size={15} />{t("sets.product")}</button>
      </div>
      <LibrarySearch value={keyword} onChange={setKeyword} />
      <label className="sets-check sets-archive-filter"><input className="sets-checkbox" type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />{t("sets.archived")}</label>
      <button className="primary-btn sets-library-create" onClick={() => setEditing({ kind })}><Plus size={17} />{t(kind === "brand" ? "sets.newBrand" : "sets.newProduct")}</button>
    </header>
    {query.isPending ? <LibraryLoading /> : null}
    {query.isError ? <div className="sets-library-error" role="alert"><TriangleAlert size={21} /><div><strong>{t("sets.loadFailed")}</strong><p>{query.error.message}</p></div><button className="secondary-btn" onClick={() => void query.refetch()}>{t("sets.retry")}</button></div> : null}
    {query.isSuccess && !items.length ? <div className="sets-library-empty sets-profile-empty">
      <div className="sets-profile-empty-icon" aria-hidden="true"><ProfileIcon size={34} strokeWidth={1.2} /></div>
      <h3>{t(filtered ? "sets.noMatches" : kind === "brand" ? "sets.emptyBrandTitle" : "sets.emptyProductTitle")}</h3><p>{t(filtered ? "sets.noMatchesHint" : "sets.emptyProfileHint")}</p>
      <button className={filtered ? "secondary-btn" : "primary-btn"} onClick={filtered ? () => { setKeyword(""); setArchived(false); } : () => setEditing({ kind })}><Plus size={16} />{t(filtered ? "sets.clearFilters" : kind === "brand" ? "sets.newBrand" : "sets.newProduct")}</button>
      <small>{t("sets.noProfileNeeded")}</small>
    </div> : null}
    <div className="sets-grid sets-profiles-grid">{items.map(profile => {
      const colors = profileColorSwatches(profile.details.colors);
      return <article className="sets-card sets-profile-card" key={profile.id}>
        <header><ProfileLibrarySymbol profile={profile} userId={user.id} onClick={() => setViewing(profile)} />
          <span className="sets-profile-visibility">{profile.shared ? <Share2 size={12} /> : <LockKeyhole size={12} />}{t(profile.shared ? "sets.shared" : "sets.private")}</span></header>
        <button className="sets-card-title" onClick={() => setViewing(profile)}>{profile.name}</button><p className="sets-profile-description">{profile.details.description || t("sets.noDescription")}</p>
        <div className="sets-profile-meta"><span><ImageIcon size={13} />{profile.assets.length} {t("sets.assets")}</span>{profile.variants.length ? <span><Layers size={13} />{profile.variants.length} {t("sets.variants")}</span> : null}</div>
        {colors.length ? <div className="sets-profile-colors">{colors.map(color => <span key={color} style={{ backgroundColor: color }} aria-label={color} title={color} />)}</div> : null}
        <footer className="sets-card-actions"><button className="sets-text-btn" onClick={() => setEditing({ kind, profile })} disabled={busy || profile.ownerId !== user.id && !(profile.shared && user.hasConfigAccess)}><Pencil size={14} />{t("sets.edit")}</button><span />
          <button className="icon-btn" title={t("sets.copyProject")} aria-label={t("sets.copyProject")} disabled={busy} onClick={() => void action(() => api.copyCreativeProfile(profile))}><Copy size={15} /></button>
          {profile.ownerId === user.id ? <button className="icon-btn" title={t(profile.archived ? "sets.restore" : "sets.archive")} aria-label={t(profile.archived ? "sets.restore" : "sets.archive")} disabled={busy} onClick={() => void action(() => api.saveCreativeProfile(kind, { ...profile, archived: !profile.archived }, profile.id))}><Archive size={15} /></button> : null}
          {profile.ownerId === user.id ? <button className="icon-btn" title={t("common.delete")} aria-label={t("common.delete")} disabled={busy} onClick={() => setRemoving(profile)}><Trash2 size={15} /></button> : null}
        </footer>
      </article>;
    })}</div>
    {query.hasNextPage ? <button className="secondary-btn sets-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t("sets.loadMore")}</button> : null}
    {editing ? <ProfileEditor key={editing.profile?.id || editing.kind} kind={editing.kind} profile={editing.profile} userId={user.id} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
    {viewing ? <CreativeProfileViewer profile={viewing} userId={user.id} canEdit={viewing.ownerId === user.id || viewing.shared && user.hasConfigAccess} onClose={() => setViewing(null)} onEdit={() => { setEditing({ kind: viewing.kind, profile: viewing }); setViewing(null); }} onUse={selection => { setViewing(null); navigate("/image-sets/new?" + new URLSearchParams(Object.entries(selection).filter((entry): entry is [string, string] => Boolean(entry[1])))); }} /> : null}
    <ConfirmDialog open={Boolean(removing)} destructive title={t("common.delete")} description={t("sets.deleteProfileHint", { name: removing?.name || "" })} onCancel={() => setRemoving(null)} onConfirm={() => { const target = removing; setRemoving(null); if (target) void action(() => api.deleteCreativeProfile(target)); }} />
  </div>;
}
function SetWorkspace({ id, user, initialSelection }: { id: string; user: User; initialSelection?: ProfileSelection }) {
  const { t, resolvedLanguage } = useI18n(), client = useQueryClient(), navigate = useNavigate(), { showToast } = useToast();
  const query = useQuery({ queryKey: ["image-set", user.id, id], queryFn: ({ signal }) => api.imageSet(id, { signal }), enabled: Boolean(id), refetchInterval: q => q.state.data?.set.activeCount ? 2000 : 6000 });
  const [draft, setDraft] = useState<ImageSetInput & { revision?: number }>(() => {
    const items = initialSizes.map((size, index) => ({ id: createCreativeId(), size, name: t(`sets.slot${index}`), purpose: "", copy: "", composition: "" }));
    return { name: "", brief: "", commonStyle: "", profileSelection: initialSelection || {}, assetIds: [], providerId: "", model: DEFAULT_GENERATION_IMAGE_MODEL, quality: "high", anchorItemId: items[0].id, items };
  });
  const createdProjectId = useRef("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [activeItemId, setActiveItemId] = useState(draft.anchorItemId);
  const [creatingProfile, setCreatingProfile] = useState<CreativeProfileKind | null>(null), [confirmAction, setConfirmAction] = useState<null | (() => void)>(null), [confirmDescription, setConfirmDescription] = useState("");
  const [casePicker, setCasePicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [actionsOpen, setActionsOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [stylesOpen, setStylesOpen] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<Record<string, string>>({});
  const layout = useImageSetLayout(!id || query.isSuccess);
  const [inspectorTab, setInspectorTab] = useState<"preview" | "adjust">("preview");
  const [previewIds, setPreviewIds] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<"fit" | number>("fit");
  const imageCanvas = useRef<HTMLDivElement>(null);
  const placementList = useRef<HTMLDivElement>(null);
  const selectedCaseMaterials = useWorkbench(state => state.selectedCaseMaterials);
  const previousEditor = useRef<Pick<ReturnType<typeof useWorkbench.getState>, "selectedAssets" | "selectedCaseMaterials" | "sidebarCollapsed"> | null>(null);
  const restoreEditor = () => { const previous = previousEditor.current; previousEditor.current = null; if (!previous) return; const state = useWorkbench.getState(); if (client.getQueryData<{ user: User | null }>(["me"])?.user?.id === user.id) { state.setSelectedAssets(previous.selectedAssets); state.setSelectedCaseMaterials(previous.selectedCaseMaterials); } state.setSidebarCollapsed(previous.sidebarCollapsed); };
  useEffect(() => () => restoreEditor(), []);
  const closeEditor = () => { setEditingImage(null); setEditorMaterials(false); setCasePicker(false); restoreEditor(); };
  const [demoEditingImage, setDemoEditingImage] = useState<WorkImage | null>(null), [demoCopy, setDemoCopy] = useState(""), [demoColor, setDemoColor] = useState("sage");
  const openEditor = (image: WorkImage) => { if (query.data?.set.executionMode === "demo") { setDemoEditingImage(image); setDemoCopy(current.copy); setDemoColor("forest"); return; } const state = useWorkbench.getState(); previousEditor.current = { selectedAssets: state.selectedAssets, selectedCaseMaterials: state.selectedCaseMaterials, sidebarCollapsed: state.sidebarCollapsed }; state.setSelectedAssets([]); state.setSelectedCaseMaterials([]); state.setSidebarCollapsed(true); setEditingImage(image); };
  const [editingImage, setEditingImage] = useState<WorkImage | null>(null), [compareDraft, setCompareDraft] = useState<CompareDraft | null>(null), [editorMaterials, setEditorMaterials] = useState(false);
  const set = query.data?.set, isDemo = set?.executionMode === "demo", locked = Boolean(busy || set?.activeCount || set?.archived);
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  useEffect(() => { if (set && !dirty) setDraft(structuredClone(set)); }, [set, dirty]);
  useEffect(() => { if (!draft.items.some(i => i.id === activeItemId)) setActiveItemId(draft.anchorItemId); }, [draft.items, draft.anchorItemId, activeItemId]);
  const context = useQuery({ queryKey: ["creative-profile-context", user.id, draft.profileSelection], queryFn: ({ signal }) => api.resolveCreativeProfile(draft.profileSelection, { signal }), enabled: Boolean(draft.profileSelection.brandId || draft.profileSelection.productId) });
  const update = (value: Partial<ImageSetInput>) => { setDraft(d => ({ ...d, ...value })); setDirty(true); };
  const apply = useCallback((next: ImageSet) => { client.setQueryData(["image-set", user.id, next.id], { set: next }); setDraft(structuredClone(next)); setDirty(false); void client.invalidateQueries({ queryKey: ["image-sets"] }); }, [client, user.id]);
  const run = async (operation: () => Promise<unknown>) => { setBusy(true); setError(""); try { await operation(); } catch (e) { const message = e instanceof Error ? e.message : String(e); setError(message); showToast(message, "error"); } finally { setBusy(false); if (mounted.current && !id && createdProjectId.current) navigate(`/image-sets/${createdProjectId.current}`); } };
  const save = async () => {
    if (!validDraft(draft)) throw new Error(t("sets.invalid"));
    const result = await api.saveImageSet(draft, id || createdProjectId.current || undefined); apply(result.set); if (!id) createdProjectId.current = result.set.id; return result.set;
  };
  const current = draft.items.find(i => i.id === activeItemId) || draft.items[0], storedItem = set?.items.find(i => i.id === current.id), images = storedItem?.runs.flatMap(r => r.images) ?? [];
  const previewImage = imageSetPreview(images, previewIds[current.id], storedItem?.selectedImageId);
  const selectedImage = images.find(image => image.id === storedItem?.selectedImageId);
  const duplicatePreview = useImageSetDuplicatePreview(previewImage, selectedImage);
  const numberFor = (image: WorkImage) => images.length - images.findIndex(candidate => candidate.id === image.id);
  const preview = (itemId: string, imageId: string) => { setPendingPreviews(value => { const next = { ...value }; delete next[itemId]; return next; }); setPreviewIds(value => ({ ...value, [itemId]: imageId })); };
  useEffect(() => {
    if (!set) return;
    const ready = Object.entries(pendingPreviews).flatMap(([itemId, runId]) => { const run = set.items.find(item => item.id === itemId)?.runs.find(run => run.id === runId); return run?.images[0] ? [{ itemId, imageId: run.images[0].id }] : []; });
    if (!ready.length) return;
    setPreviewIds(value => ({ ...value, ...Object.fromEntries(ready.map(value => [value.itemId, value.imageId])) }));
    setPendingPreviews(value => { const next = { ...value }; ready.forEach(value => delete next[value.itemId]); return next; });
  }, [set, pendingPreviews]);
  useEffect(() => { setPreviewZoom("fit"); }, [previewImage?.id]);
  const zoomPreview = (factor: number) => {
    if (!previewImage || !imageCanvas.current) return;
    const fit = Math.min((imageCanvas.current.clientWidth - 24) / previewImage.imageWidth, (imageCanvas.current.clientHeight - 24) / previewImage.imageHeight) * 100;
    const currentZoom = previewZoom === "fit" ? fit : previewZoom;
    setPreviewZoom(Math.min(200, Math.max(10, Math.round(currentZoom * factor))));
  };
  const previewRun = storedItem?.runs.find(record => record.images.some(image => image.id === previewImage?.id));
  const previousRound = Boolean(previewRun && (previewRun.contextRevision !== set?.contextRevision || previewRun.itemRevision !== storedItem?.revision));
  const adopted = Boolean(previewImage && previewImage.id === storedItem?.selectedImageId && storedItem.selectionCurrent);
  const currentStatus = imageSetPlacementStatus(storedItem);
  const latestRun = storedItem?.runs[0];
  const currentSize = sizeOptionFromValue(current.size);
  const storedProfileContext = set?.confirmed && !dirty ? set.snapshot : context.data?.context;
  const profileContext = storedProfileContext ? presentCreativeContext(storedProfileContext) : storedProfileContext;
  const nextAction = imageSetNextAction(set, dirty);
  const step = imageSetStep(set);
  const guidance = imageSetGuidance(set, dirty);
  const showAdjust = !set?.confirmed || inspectorTab === "adjust";
  useEffect(() => {
    const list = placementList.current;
    if (!list) return;
    const reveal = () => {
      const selected = list.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) return;
      const vertical = getComputedStyle(list).flexDirection === "column";
      const listRect = list.getBoundingClientRect(), selectedRect = selected.getBoundingClientRect();
      list.scrollTo({ ...(vertical ? { top: list.scrollTop + selectedRect.top - listRect.top - (list.clientHeight - selectedRect.height) / 2 } : { left: list.scrollLeft + selectedRect.left - listRect.left - (list.clientWidth - selectedRect.width) / 2 }),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    };
    reveal();
    const observer = new ResizeObserver(reveal); observer.observe(list); return () => observer.disconnect();
  }, [activeItemId, draft.items.length]);
  const editItem = (value: Partial<typeof current>) => update({ items: draft.items.map(i => i.id === current.id ? { ...i, ...value } : i) });
  const ask = (description: string, action: () => void) => { setConfirmDescription(description); setConfirmAction(() => action); };
  const choose = (image: WorkImage) => {
    const adopt = (acknowledge: boolean) => void run(async () => apply((await api.selectImageSetItem(id, current.id, image.id, acknowledge)).set));
    const actual = `${image.imageWidth}x${image.imageHeight}`;
    const warnings = [current.id === set?.anchorItemId && set.anchorImageId && set.anchorImageId !== image.id ? t("sets.changeStyleWarning") : "", actual !== current.size ? t("sets.sizeMismatch", { actual, target: current.size }) : ""].filter(Boolean);
    if (warnings.length) ask(warnings.join("\n\n"), () => adopt(actual !== current.size)); else adopt(false);
  };
  const retryRun = (runId: string) => void run(async () => apply((await api.retryImageSetRun(id, runId)).set));
  const exportDownload = async (partial: boolean) => { const result = await api.exportImageSet(id, partial); const link = document.createElement("a"); link.href = result.downloadUrl; link.download = ""; document.body.appendChild(link); link.click(); link.remove(); };
  const download = (partial: boolean) => void run(() => exportDownload(partial));
  const generateDisabled = locked || dirty || !set?.confirmed || current.id !== set.anchorItemId && !set.anchorCurrent;
  const generateCurrent = () => { if (isDemo) { setStylesOpen(true); return; } void run(async () => { const result = await api.generateImageSetItem(id, current.id, createSubmitRequestId()); apply(result.set); const latest = result.set.items.find(item => item.id === current.id)?.runs[0]; if (latest) setPendingPreviews(value => ({ ...value, [current.id]: latest.id })); }); };
  const chooseStyle = (style: "airy" | "dark" | "editorial") => { setStylesOpen(false); void run(async () => { const result = await api.imageSetDemoStyle(id, current.id, style, createSubmitRequestId()); apply(result.set); if (result.imageId) preview(current.id, result.imageId); else setPendingPreviews(value => ({ ...value, [current.id]: result.runId })); }); };
  const copyProject = () => void run(async () => { const result = await api.copyImageSet(id); navigate(`/image-sets/${result.set.id}`); });
  const editSubmit: Parameters<typeof ImageEditWorkspace>[0]["onSubmitEdit"] = payload => void run(async () => {
    const result = await api.edit({ clientRequestId: createSubmitRequestId(), sourceImageIds: [payload.image.id], prompt: payload.prompt, model: payload.imageModel, quality: payload.quality, n: payload.imageCount,
      size: current.size, imageSetId: id, imageSetItemId: current.id, sourceAssetIds: payload.sourceAssetIds, sourceCaseItemIds: payload.sourceCaseItemIds,
      sourceInlineImages: payload.sourceInlineImages, maskDataUrl: payload.maskDataUrl, editIntent: payload.editIntent, imageAnnotations: payload.imageAnnotations, background: payload.background, imageMarkupReference: payload.imageMarkupReference });
    if (result.error) throw new Error(result.error); closeEditor(); await client.invalidateQueries({ queryKey: ["image-set", user.id, id] });
  });
  const sizes = useMemo(() => { const enabled = providers.data?.providers.filter(p => p.enabled) ?? []; const chosen = enabled.find(p => p.id === draft.providerId);
    return buildSizeOptions(chosen?.sizes || [...new Set(enabled.flatMap(p => p.sizes))]); }, [providers.data, draft.providerId]);
  const nextLabels = { confirm: "sets.action.confirm", save: "sets.save", anchor: "sets.action.anchor", generate: "sets.generateRest", review: "sets.action.review", finalize: "sets.action.finalize", export: "sets.export", stop: "sets.stop" };
  const nextDisabled = nextAction === "stop" ? busy : nextAction === "export" ? busy || dirty : locked || !validDraft(draft);
  const doNext = () => {
    if (nextAction === "anchor") { setActiveItemId(draft.anchorItemId); setInspectorTab("preview"); return; }
    if (nextAction === "review") { const item = set?.items.find(item => !item.selectionCurrent); if (item) setActiveItemId(item.id); setInspectorTab("preview"); return; }
    if (nextAction === "export") { download(false); return; }
    if (nextAction === "stop") { ask(t("sets.stopHint"), () => void run(async () => apply((await api.stopImageSet(id)).set))); return; }
    void run(async () => {
      if (nextAction === "save") { await save(); showToast(t("sets.saved")); }
      else if (nextAction === "confirm") {
        const saved = dirty || !id ? await save() : set!;
        apply((await api.confirmImageSet(saved.id, saved.revision, createSubmitRequestId())).set);
        setActiveItemId(saved.anchorItemId); setInspectorTab("preview");
      } else if (nextAction === "generate") apply((await api.generateImageSet(id, createSubmitRequestId())).set);
      else if (nextAction === "finalize") { apply((await api.finalizeImageSet(id)).set); await exportDownload(false); }
    });
  };
  if (id && query.isPending) return <p role="status">{t("common.loading")}</p>;
  if (query.isError) return <p className="sets-error" role="alert">{query.error.message}</p>;
  return <>
    <div className="sets-workspace-header sets-clarity-header">
      <div className="sets-project-title"><button className="icon-btn" aria-label={t("sets.tabSets")} onClick={() => dirty ? ask(t("sets.leaveHint"), () => navigate("/image-sets")) : navigate("/image-sets")}><ArrowLeft size={20}/></button><strong title={draft.name}>{draft.name || t("sets.newSet")}</strong>{isDemo ? <span className="sets-mode-badge">{t("sets.demoMode")}</span> : null}{set?.archived ? <span className="sets-badge">{t("sets.archived")}</span> : null}</div>
      <div className="sets-header-actions"><button className="secondary-btn" onClick={() => setSettingsOpen(true)}><Settings2 size={16}/>{t("sets.projectSettings")}</button><button className="icon-btn sets-project-more" aria-label={t("sets.exampleActions")} disabled={!id} onClick={() => setActionsOpen(true)}><Ellipsis size={20}/></button><button className={cx(nextAction === "stop" ? "secondary-btn" : "primary-btn", "sets-next-action")} disabled={nextDisabled} onClick={doNext}>{nextAction === "stop" ? <Square size={15}/> : nextAction === "finalize" || nextAction === "export" ? <Download size={16}/> : null}{t(nextLabels[nextAction])}</button></div>
    </div>
    <div className="sets-workflow-guide"><ol className="sets-workflow-steps" aria-label={t("sets.workflow")}>{["brief","style","delivery"].map((stage,index) => <li key={stage} className={cx(index===step&&"active",index<step&&"complete")} aria-current={index===step?"step":undefined}><span>{index<step?<Check size={13}/>:index+1}</span>{t("sets.flow."+stage)}</li>)}</ol><p role="status">{t("sets.guidance."+guidance,{count: set ? guidance === "review" ? set.items.length-set.selectedCount : set.items.length : draft.items.length})}</p><span className="sets-save-status">{t(busy?"common.loading":dirty||!id?"sets.notSaved":"sets.saved")}</span></div>
    {isDemo ? <div className="sets-mode-note"><span>{t("sets.demoModeHint")}</span><button className="sets-text-btn" disabled={locked||dirty} onClick={copyProject}>{t("sets.realCreation")}</button></div> : null}
    {error ? <p className="sets-error sets-workspace-notice" role="alert">{error}</p> : null}
    <div className="sets-workspace sets-resizable" data-layout={layout.mode} ref={layout.workspaceRef} style={layout.style} id={layout.workspaceId}>
      <section className="sets-filmstrip" aria-label={t("sets.allPlacements")}>
        <header><h2>{t("sets.imageList")}</h2><span>{draft.items.filter(item => set?.items.some(saved => saved.id === item.id && saved.selectionCurrent)).length}/{draft.items.length} {t("sets.imageReady")}</span>
          <button className="sets-text-btn" disabled={locked || draft.items.length >= 10} onClick={() => { const item = { id: createCreativeId(), name: t("sets.addImage"), purpose: "", copy: "", composition: "", size: "1024x1024" }; update({ items: [...draft.items, item] }); setActiveItemId(item.id); }}><Plus size={15} />{t("sets.addImage")}</button>
        </header>
        <div className="sets-placement-list" ref={placementList} onKeyDown={event => {
          const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-placement-id]");
          if (!target) return;
          const index = draft.items.findIndex(item => item.id === target.dataset.placementId);
          const next = (event.key === "ArrowRight" || event.key === "ArrowDown") ? (index + 1) % draft.items.length : (event.key === "ArrowLeft" || event.key === "ArrowUp") ? (index + draft.items.length - 1) % draft.items.length : event.key === "Home" ? 0 : event.key === "End" ? draft.items.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setActiveItemId(draft.items[next].id);
          placementList.current?.querySelectorAll<HTMLButtonElement>("button[data-placement-id]")[next]?.focus({ preventScroll: true });
        }}>{draft.items.map((item, index) => {
          const saved = set?.items.find(saved => saved.id === item.id), itemImages = saved?.runs.flatMap(run => run.images) ?? [];
          const thumbnail = imageSetPreview(itemImages, undefined, saved?.selectedImageId), status = imageSetPlacementStatus(saved);
          const active = status === "queued" || status === "running";
          return <button key={item.id} data-placement-id={item.id} className={cx("sets-placement", item.id === current.id && "active")} aria-pressed={item.id === current.id} onClick={() => setActiveItemId(item.id)}>
            <span className="sets-placement-thumb">{thumbnail ? <CheckerboardImage src={thumbnail.thumbnailUrl || thumbnail.previewUrl || thumbnail.url} alt="" loading="lazy" /> : active ? <LoaderCircle size={25} strokeWidth={1.5} className="sets-spin" /> : <ImageIcon size={27} strokeWidth={1.2} />}
              {item.id === draft.anchorItemId ? <span className="sets-placement-anchor">{t("sets.styleImage")}</span> : null}{active && thumbnail ? <span className="sets-placement-running"><LoaderCircle size={18} className="sets-spin" /></span> : null}
            </span>
            <span className="sets-placement-caption"><strong title={item.name}>{item.name || String(index + 1)}</strong><small className={cx("sets-placement-status", "is-" + status)}>
              {status === "adopted" ? <CircleCheck size={12} /> : active ? <LoaderCircle size={12} className="sets-spin" /> : status === "failed" || status === "stale" ? <TriangleAlert size={12} /> : <Circle size={10} />}
              {t(status === "queued" || status === "running" || status === "failed" || status === "cancelled" ? "sets.run." + status : status === "adopted" ? "sets.imageReady" : "sets." + status)}
            </small></span>
          </button>;
        })}</div>
      </section>

      {layout.separator("left")}
      <main className="sets-preview-panel" aria-label={t("sets.preview")} ref={layout.previewRef} id={layout.previewId}>
        <div className="sets-canvas-toolbar">
          <div><span className="sets-ratio">{currentSize.ratio}</span>{current.id === draft.anchorItemId ? <span className="sets-baseline-tag">{t("sets.styleImage")}</span> : null}{previewZoom !== "fit" ? <span className="sets-zoom-level" role="status">{previewZoom}%</span> : null}</div>
          <div className="sets-zoom-controls">
            <button className="sets-text-btn sets-fit" disabled={!previewImage} aria-pressed={previewZoom === "fit"} onClick={() => setPreviewZoom("fit")}>{t("compare.fit")}</button>
            <button className="sets-text-btn sets-actual" disabled={!previewImage} aria-pressed={previewZoom === 100} title={t("imagePreview.originalSize")} onClick={() => setPreviewZoom(100)}>100%</button>
            <button className="icon-btn" disabled={!previewImage} aria-label={t("imagePreview.zoomOut")} title={t("imagePreview.zoomOut")} onClick={() => zoomPreview(.8)}><ZoomOut size={18}/></button>
            <button className="icon-btn" disabled={!previewImage} aria-label={t("imagePreview.zoomIn")} title={t("imagePreview.zoomIn")} onClick={() => zoomPreview(1.25)}><ZoomIn size={18}/></button>
            <button className="icon-btn" aria-label={t("sets.fullPreview")} title={t("sets.fullPreview")} disabled={!previewImage} onClick={() => setPreviewOpen(true)}><Maximize2 size={17} /></button>
          </div>
        </div>
        <div ref={imageCanvas} className={cx("sets-canvas", previewZoom !== "fit" && "is-zoomed", !previewImage && !set?.confirmed && "sets-canvas-brief")}>
          {previewImage ? <>
            <button className="sets-image-preview" style={previewZoom === "fit" ? undefined : { width: previewImage.imageWidth * previewZoom / 100, height: previewImage.imageHeight * previewZoom / 100 }} onClick={() => setPreviewOpen(true)} aria-label={t("sets.fullPreview")}>
              <CheckerboardImage key={previewImage.id} src={previewZoom === "fit" ? previewImage.previewUrl || previewImage.url : previewImage.url} alt={current.name} />
            </button>
            {previousRound || currentStatus === "running" || currentStatus === "queued" || currentStatus === "failed" ? <span className={cx("sets-canvas-status", currentStatus === "failed" && "sets-error")} role={currentStatus === "failed" ? "alert" : "status"}>
              {currentStatus === "running" || currentStatus === "queued" ? <><LoaderCircle size={13} className="sets-spin" />{t("sets.newVersionRunning")}</> : <><TriangleAlert size={13} />{t(currentStatus === "failed" ? "sets.run.failed" : "sets.oldRound")}</>}
              {currentStatus === "failed" && latestRun ? <button className="sets-text-btn" disabled={locked || dirty} onClick={() => retryRun(latestRun.id)}>{t("sets.retry")}</button> : null}
            </span> : null}
          </> : !set?.confirmed ? <div className="sets-brief-panel">
            <span className="sets-brief-icon"><Layers size={25} strokeWidth={1.5} /></span>
            <p>{t("sets.startHint")}</p>
            <div className="sets-form">
              <label>{t("sets.name")}<input aria-label={t("sets.projectName")} placeholder={t("sets.namePlaceholder")} value={draft.name} disabled={locked} maxLength={120} onChange={event => update({ name: event.target.value })} /></label>
              <label>{t("sets.brief")}<textarea placeholder={t("sets.briefPlaceholder")} value={draft.brief} disabled={locked} rows={4} onChange={event => update({ brief: event.target.value })} /></label>
            </div>
            <p className="sets-brief-footnote">{t("sets.planHint")}</p><button className="secondary-btn sets-plan-button" disabled={locked || !validDraft(draft)} onClick={() => void run(async () => { const saved = dirty || !id ? await save() : set!; apply((await api.planImageSet(saved.id, resolvedLanguage)).set); })}><Sparkles size={15}/>{t("sets.plan")}</button>
          </div> : <div className="sets-canvas-empty" role="status">
            {currentStatus === "running" || currentStatus === "queued" ? <LoaderCircle size={34} strokeWidth={1.5} className="sets-spin" /> : currentStatus === "failed" ? <TriangleAlert size={34} strokeWidth={1.5} /> : <ImageIcon size={38} strokeWidth={1.2} />}
            <h3>{t(currentStatus === "queued" || currentStatus === "running" || currentStatus === "failed" || currentStatus === "cancelled" ? "sets.run." + currentStatus : "sets.waiting")}</h3>
            <p>{t(!set.anchorCurrent && current.id !== set.anchorItemId ? "sets.baselineFirst" : currentStatus === "running" || currentStatus === "queued" ? "sets.generatingHint" : "sets.placementEmpty")}</p>
            {storedItem?.runs[0]?.error ? <p className="sets-error">{storedItem.runs[0].error}</p> : null}
            {!set.anchorCurrent && current.id !== set.anchorItemId ? <button className="secondary-btn" onClick={() => setActiveItemId(draft.anchorItemId)}>{t("sets.chooseBaseline")}</button> : null}
            {latestRun && (latestRun.status === "failed" || latestRun.status === "cancelled") ? <button className="secondary-btn" disabled={locked || dirty} onClick={() => retryRun(latestRun.id)}><RefreshCw size={14} />{t("sets.retry")}</button> : null}
          </div>}
        </div>

        {layout.separator("candidates")}
        <div className="sets-version-bar"><div className="sets-version-heading"><strong>{t(isDemo?"sets.demoStyles":"sets.candidatePlans")}</strong><span>{images.length}</span></div>
          {images.length ? <div className="sets-version-list" aria-label={t("sets.candidatePlans")}>{images.map((image,index)=>{
            const style=storedItem?.runs.find(record=>record.images.some(candidate=>candidate.id===image.id))?.demoStyle;
            const selected=storedItem?.selectedImageId===image.id&&storedItem.selectionCurrent;
            return <button key={image.id} className={cx("sets-version",previewImage?.id===image.id&&"active")} aria-pressed={previewImage?.id===image.id} onClick={()=>preview(current.id,image.id)}>
              <span className="sets-version-thumb"><CheckerboardImage src={image.thumbnailUrl||image.previewUrl||image.url} alt="" loading="lazy"/>{selected?<span className="sets-version-tag"><Check size={11}/>{t("sets.finalImage")}</span>:previewImage?.id===image.id?<span className="sets-version-tag">{t("sets.viewing")}</span>:null}</span>
              <span>{t("sets.planNumber",{number:images.length-index})}</span>{style?<small>{t("sets.demoStyle."+style)}</small>:null}
            </button>;
          })}</div> : <p className="sets-hint">{t("sets.candidateEmpty")}</p>}
        </div>
      </main>
      {layout.separator("right")}
      <aside className="sets-inspector sets-image-review" aria-label={t("sets.currentImage")}>
        <div className="sets-inspector-heading"><h2>{current.name}</h2><span>{t("sets.imagePosition",{index:draft.items.indexOf(current)+1,total:draft.items.length})}</span><p>{currentSize.ratio} · {current.size}</p></div>
        <div className="sets-inspector-tabs" role="tablist" aria-label={t("sets.currentImage")}><button id="sets-preview-tab" role="tab" aria-selected={!showAdjust} disabled={!set?.confirmed} aria-controls="sets-inspector-content" onClick={()=>setInspectorTab("preview")}>{t("sets.pickImage")}</button><button id="sets-adjust-tab" role="tab" aria-selected={showAdjust} aria-controls="sets-inspector-content" onClick={()=>setInspectorTab("adjust")}>{t("sets.imageRequirements")}</button></div>
        <div id="sets-inspector-content" role="tabpanel" aria-labelledby={showAdjust?"sets-adjust-tab":"sets-preview-tab"}>
          {showAdjust ? <>
<div className="sets-form sets-item-form">
            <label>{t("sets.name")}<input value={current.name} disabled={locked} maxLength={120} onChange={event => editItem({ name: event.target.value })} /></label>
            <label>{t("sets.size")}<CustomSelect value={current.size} ariaLabel={t("sets.size")} options={(!sizes.some(size => size.value === current.size) ? [currentSize, ...sizes] : sizes).map(size => ({ value: size.value, label: size.ratio + " · " + size.value }))} disabled={locked} onChange={size => editItem({ size })} /></label>
            <label>{t("sets.purpose")}<input value={current.purpose} disabled={locked} onChange={event => editItem({ purpose: event.target.value })} /></label>
            <label>{t("sets.copy")}<textarea value={current.copy} disabled={locked} rows={2} onChange={event => editItem({ copy: event.target.value })} /></label>
            <label>{t("sets.composition")}<textarea value={current.composition} disabled={locked} rows={3} onChange={event => editItem({ composition: event.target.value })} /></label>
            <label className="sets-check"><input className="sets-checkbox" type="checkbox" checked={draft.anchorItemId === current.id} disabled={locked} onChange={() => update({ anchorItemId: current.id })} />{t("sets.styleImage")}</label>
            <div className="sets-item-tools">
              <button className="icon-btn" disabled={locked || draft.items.indexOf(current) === 0} aria-label={t("sets.moveUp")} title={t("sets.moveUp")} onClick={() => { const items = [...draft.items], index = items.indexOf(current); [items[index - 1], items[index]] = [items[index], items[index - 1]]; update({ items }); }}><ArrowUp size={16} /></button>
              <button className="icon-btn" disabled={locked || draft.items.indexOf(current) === draft.items.length - 1} aria-label={t("sets.moveDown")} title={t("sets.moveDown")} onClick={() => { const items = [...draft.items], index = items.indexOf(current); [items[index + 1], items[index]] = [items[index], items[index + 1]]; update({ items }); }}><ArrowDown size={16} /></button>
              <button className="sets-text-btn" disabled={locked || draft.items.length <= 2 || current.id === draft.anchorItemId} onClick={() => update({ items: draft.items.filter(item => item.id !== current.id) })}><X size={14} />{t("sets.remove")}</button>
            </div>
          </div>
            <button className="primary-btn sets-save-requirements" disabled={locked||!dirty||!validDraft(draft)} onClick={()=>void run(async()=>{await save();showToast(t("sets.saved"));})}>{t("sets.saveRequirements")}</button><p className="sets-hint">{t("sets.requirementsHint")}</p>
          </> : <>
            {previewImage ? <div className="sets-selection-summary">
              <div className="sets-choice-card"><CheckerboardImage src={previewImage.thumbnailUrl||previewImage.previewUrl||previewImage.url} alt=""/><div><small>{t("sets.viewing")}</small><strong>{t("sets.planNumber",{number:numberFor(previewImage)})}</strong><span>{t(adopted?"sets.finalImage":"sets.notSelected")}</span></div></div>
              {selectedImage&&selectedImage.id!==previewImage.id ? <div className="sets-choice-card is-final"><CheckerboardImage src={selectedImage.thumbnailUrl||selectedImage.previewUrl||selectedImage.url} alt=""/><div><small>{t("sets.finalImage")}</small><strong>{t("sets.planNumber",{number:numberFor(selectedImage)})}</strong>{!storedItem?.selectionCurrent?<span>{t("sets.stale")}</span>:null}</div></div>:null}
              {previousRound?<p className="sets-hint sets-old-round"><TriangleAlert size={14}/>{t("sets.oldRound")}</p>:null}
              {adopted ? <p className="sets-selected-state"><CircleCheck size={18}/>{t("sets.selectedForFinal")}</p> : <button className="primary-btn sets-adopt" disabled={busy||dirty||set?.archived||current.id===set?.anchorItemId&&Boolean(set?.activeCount)} onClick={()=>choose(previewImage)}><Check size={17}/>{t(current.id===set?.anchorItemId&&!set.anchorCurrent?"sets.useAsStyle":"sets.selectThis")}</button>}
              <p className="sets-hint">{t(current.id===draft.anchorItemId?"sets.styleSelectionHint":"sets.selectionHint")}</p>
              {duplicatePreview?<p className="sets-duplicate-note" role="status"><TriangleAlert size={15}/>{t("sets.identicalCandidate")}</p>:null}
            </div> : <p className="sets-hint">{t("sets.candidateEmpty")}</p>}
            <div className="sets-image-actions"><button className="secondary-btn sets-generate-current" disabled={generateDisabled} onClick={generateCurrent}><RefreshCw size={15}/>{t(isDemo?"sets.switchDemoStyle":"sets.generatePlan")}</button>{previewImage?<button className="secondary-btn" disabled={locked||dirty} onClick={()=>openEditor(previewImage)}><Pencil size={15}/>{t("sets.editThisImage")}</button>:null}</div>
            {images.length>1?<button className="sets-text-btn sets-compare-plans" onClick={()=>{const candidates=[previewImage,selectedImage,...images].filter((image):image is WorkImage=>Boolean(image));setCompareDraft(createCompareDraft([...new Map(candidates.map(image=>[image.id,image])).values()].slice(0,4).map(image=>image.id)));}}>{t("sets.comparePlans")}<ChevronRight size={14}/></button>:null}
            {currentStatus==="failed"&&latestRun?<div className="sets-inline-error" role="alert"><p>{latestRun.error}</p><button className="secondary-btn" disabled={locked||dirty} onClick={()=>retryRun(latestRun.id)}>{t("sets.retry")}</button></div>:null}
            {isDemo?<p className="sets-hint sets-demo-explanation">{t("sets.demoStylesHint")}</p>:null}
          </>}
          {storedItem?.runs.length?<button className="sets-text-btn sets-history-link" onClick={()=>setHistoryOpen(true)}>{t("sets.generationHistory")}<ChevronRight size={14}/></button>:null}
        </div>
      </aside>
    </div>
    {settingsOpen?<CreativeModal title={t("sets.projectSettings")} className="sets-settings-modal" busy={busy} onClose={()=>setSettingsOpen(false)}>
      <p className="sets-hint">{t("sets.projectSettingsHint")}</p><div className="sets-settings-sections">
          <details className="sets-detail" open><summary><span>{t("sets.setRequirements")}</span><ChevronRight size={15} /></summary><div className="sets-form">
            <><label>{t("sets.projectName")}<input value={draft.name} disabled={locked} maxLength={120} onChange={event => update({ name: event.target.value })} /></label>
              <label>{t("sets.brief")}<textarea value={draft.brief} disabled={locked} rows={4} onChange={event => update({ brief: event.target.value })} /></label></>
            <label>{t("sets.commonStyle")}<textarea value={draft.commonStyle} disabled={locked} rows={3} onChange={event => update({ commonStyle: event.target.value })} /></label>
          </div></details>
          <details className="sets-detail"><summary><span>{t("sets.tabProfiles")}</span><small>{[profileContext?.brand?.name, profileContext?.product?.name].filter(Boolean).join(" / ") || t("sets.optional")}</small><ChevronRight size={15} /></summary><div className="sets-form">
            <p className="sets-hint">{t("sets.profileHint")}</p><ProfileSelectionFields userId={user.id} value={draft.profileSelection} onChange={profileSelection => update({ profileSelection })} disabled={locked} onNew={setCreatingProfile} />
            {profileContext ? <CreativeContextPreview context={profileContext} /> : null}{context.isError ? <p className="sets-error" role="alert">{context.error.message}</p> : null}
          </div></details>
          {!isDemo ? <details className="sets-detail"><summary><span>{t("sets.assets")}</span>{draft.assetIds.length ? <small>{draft.assetIds.length}</small> : null}<ChevronRight size={15} /></summary><div className="sets-form">
            <ProfileAssets simple userId={user.id} disabled={locked} value={draft.assetIds.map(assetId => ({ assetId, role: "identity", note: "" }))} onChange={assets => update({ assetIds: assets.map(asset => asset.assetId) })} />
          </div></details> : <p className="sets-hint">{t("sets.demoEditHint")}</p>}
          {!isDemo ? <details className="sets-detail"><summary><span>{t("sets.generationSettings")}</span><ChevronRight size={15} /></summary><div className="sets-form">
            <label>{t("sets.model")}<CustomSelect value={draft.model} ariaLabel={t("sets.model")} disabled={locked} options={IMAGE_MODEL_OPTIONS.map(model => ({ value: model.value, label: t(model.labelKey) }))} onChange={model => update({
              model,
              quality: isImageModelId(model) && !isImageQualitySupported(model, draft.quality) ? fallbackImageQuality(draft.quality) : draft.quality
            })} /></label>
            <label>{t("sets.provider")}<CustomSelect value={draft.providerId} ariaLabel={t("sets.provider")} disabled={locked} options={[{ value: "", label: t("sets.autoProvider") }, ...(providers.data?.providers.filter(provider => provider.enabled && !provider.virtual) ?? []).map(provider => ({ value: provider.id, label: provider.name }))]} onChange={providerId => update({ providerId })} /></label>
            <label>{t("sets.quality")}<CustomSelect value={draft.quality} ariaLabel={t("sets.quality")} disabled={locked} options={buildQualityOptions(isImageModelId(draft.model) ? imageModelQualities(draft.model) : []).map(quality => ({ value: quality.value, label: quality.labelKey ? t(quality.labelKey) : quality.label }))} onChange={quality => update({ quality })} /></label>
          </div></details> : null}

      </div><footer><button className="secondary-btn" onClick={()=>setSettingsOpen(false)}>{t("sets.close")}</button><button className="primary-btn" disabled={locked||!dirty||!validDraft(draft)} onClick={()=>void run(async()=>{await save();setSettingsOpen(false);showToast(t("sets.saved"));})}>{t("sets.save")}</button></footer>
    </CreativeModal>:null}
    {actionsOpen?<CreativeModal title={t("sets.exampleActions")} className="sets-actions-modal" busy={busy} onClose={()=>setActionsOpen(false)}><div className="sets-form">
      {isDemo?<p className="sets-hint">{t("sets.demoModeHint")}</p>:null}
      <button className="secondary-btn" disabled={locked||dirty} onClick={copyProject}><Copy size={16}/>{t(isDemo?"sets.realCreation":"sets.copyProject")}</button>
      {set?.selectedCount?<button className="secondary-btn" disabled={busy||dirty} onClick={()=>download(true)}><Download size={16}/>{t("sets.exportPartial")}</button>:null}
      {isDemo&&set?.confirmed?<details className="sets-detail"><summary><span>{t("sets.demoTroubleshooting")}</span><ChevronRight size={15}/></summary><button className="sets-text-btn" disabled={locked||dirty||current.id!==set.anchorItemId&&!set.anchorCurrent} onClick={()=>{setActionsOpen(false);void run(async()=>apply((await api.failImageSetDemo(id,current.id,createSubmitRequestId())).set));}}>{t("sets.demoFailure")}</button></details>:null}
    </div></CreativeModal>:null}
    {historyOpen?<CreativeModal title={`${current.name} · ${t("sets.generationHistory")}`} className="sets-history-modal" onClose={()=>setHistoryOpen(false)}>{storedItem?.runs.map(record=><section className="sets-run" key={record.id}><div className="sets-run-heading"><time>{new Date(record.createdAt).toLocaleString()}</time><span>{t("sets.run."+record.status)}</span></div>{record.contextRevision!==set?.contextRevision||record.itemRevision!==storedItem.revision?<small>{t("sets.oldRound")}</small>:null}{record.error?<p className="sets-error">{record.error}</p>:null}{record.status==="failed"||record.status==="cancelled"?<button className="sets-text-btn" disabled={locked||dirty} onClick={()=>retryRun(record.id)}><RefreshCw size={14}/>{t("sets.retry")}</button>:null}</section>)}</CreativeModal>:null}
    {stylesOpen?<CreativeModal title={t("sets.switchDemoStyle")} description={t("sets.demoStylesHint")} className="sets-styles-modal" onClose={()=>setStylesOpen(false)}><div className="sets-style-options">{(["airy","dark","editorial"] as const).map(style=>{
      const existing=storedItem?.runs.find(record=>record.demoStyle===style&&record.contextRevision===set?.contextRevision&&record.itemRevision===storedItem.revision&&record.images.length)?.images[0];
      return <button key={style} type="button" data-demo-style={style} disabled={generateDisabled} onClick={()=>chooseStyle(style)}><span className={`sets-style-preview is-${style}`}>{existing?<CheckerboardImage src={existing.thumbnailUrl||existing.previewUrl||existing.url} alt=""/>:<><span/><ImageIcon size={32}/><i/></>}</span><strong>{t("sets.demoStyle."+style)}</strong><small>{t(existing?"sets.previewExistingStyle":"sets.prepareStyle")}</small></button>;
    })}</div></CreativeModal>:null}
    <ImageLightbox state={previewOpen && previewImage ? { items: images.map(image => ({ url: image.url, thumbnailUrl: image.thumbnailUrl, downloadUrl: image.url, name: current.name })), index: images.findIndex(image => image.id === previewImage.id) } : null} onClose={() => setPreviewOpen(false)} onChangeIndex={index => setPreviewIds(value => ({ ...value, [current.id]: images[index].id }))} />
    {creatingProfile ? <ProfileEditor kind={creatingProfile} userId={user.id} onClose={() => setCreatingProfile(null)} onSaved={p => { update({ profileSelection: p.kind === "brand" ? { brandId: p.id } : { productId: p.id, brandId: p.brandId } }); setCreatingProfile(null); }} /> : null}
    <ConfirmDialog open={Boolean(confirmAction)} title={t("common.confirm")} description={confirmDescription} onCancel={() => setConfirmAction(null)} onConfirm={() => { const action = confirmAction; setConfirmAction(null); action?.(); }} />
    {compareDraft ? <ModalPortal><div className="sets-comparison"><ImageCompareWorkspace initial={compareDraft} ownerId={user.id} thumbnails={Object.fromEntries(images.map(i => [i.id, i.thumbnailUrl]))} wheelMode={user.preferences?.imagePreviewWheelMode || "pan"}
      onClose={() => setCompareDraft(null)} onEdit={image => { if (images.some(i => i.id === image.id)) { setCompareDraft(null); openEditor(image); } else showToast(t("sets.invalid"), "error"); }} /></div></ModalPortal> : null}
    <CaseMaterialPickerModal open={casePicker} selectedCaseMaterials={selectedCaseMaterials} onClose={() => setCasePicker(false)} onConfirm={items => { useWorkbench.getState().setSelectedCaseMaterials(items); setCasePicker(false); }} />
    {demoEditingImage ? <CreativeModal title={t("sets.demoEdit")} description={t("sets.demoEditHint")} busy={busy} onClose={() => setDemoEditingImage(null)} icon={<Pencil size={23} />}>
      <form className="sets-form" onSubmit={event => { event.preventDefault(); void run(async () => { apply((await api.editImageSetDemo(id, current.id, { clientRequestId: createSubmitRequestId(), sourceImageId: demoEditingImage.id, copy: demoCopy, color: demoColor })).set); setDemoEditingImage(null); }); }}>
        <label>{t("sets.copy")}<input value={demoCopy} onChange={event => setDemoCopy(event.target.value)} maxLength={120} required disabled={busy} /></label>
        <label>{t("sets.demoColor")}<CustomSelect value={demoColor} onChange={setDemoColor} disabled={busy} options={["sage", "cream", "forest"].map(value => ({ value, label: t("sets.theme." + value) }))} /></label>
        <button className="primary-btn" type="submit" disabled={busy || !demoCopy.trim()}>{t("sets.demoEdit")}</button>
      </form>
    </CreativeModal> : null}
    {editingImage ? <ImageEditWorkspace images={images} activeImageId={editingImage.id} initialImageCount={1} initialImageModel={isImageModelId(draft.model) ? draft.model : DEFAULT_EDIT_IMAGE_MODEL}
      initialQuality="high" selectedSize={current.size} sizeOptions={sizes} isSubmitting={busy} materialPickerOpen={editorMaterials} wheelMode={user.preferences?.imagePreviewWheelMode || "pan"}
      onClose={closeEditor} onLockedRequest={() => showToast(t("common.loading"))} onOpenCasePicker={() => setCasePicker(true)} onToggleMaterialPicker={() => setEditorMaterials(v => !v)} onSubmitEdit={editSubmit}
      onPickSize={(image, option, imageCount, imageModel, quality) => void run(async () => { const result = await api.saveImageSet({ ...draft, items: draft.items.map(i => i.id === current.id ? { ...i, size: option.value } : i) }, id); apply(result.set);
        const edited = await api.edit({ clientRequestId: createSubmitRequestId(), sourceImageIds: [image.id], prompt: `${t("sets.composition")}: ${option.ratio}; ${current.composition}`, n: imageCount, model: imageModel, quality, size: option.value, imageSetId: id, imageSetItemId: current.id });
        if (edited.error) throw new Error(edited.error); closeEditor(); await client.invalidateQueries({ queryKey: ["image-set", user.id, id] }); })} /> : null}
  </>;
}
