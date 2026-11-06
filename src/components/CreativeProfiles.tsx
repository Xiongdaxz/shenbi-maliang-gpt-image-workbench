import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Image as ImageIcon, LoaderCircle, LockKeyhole, Plus, Share2, X } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { CustomSelect, ModalPortal, SelectMenuLayer, useToast } from "../ui";
import { MaterialPicker } from "./MaterialPicker";
import { createCreativeId } from "../lib/creativeId";
import { cx } from "../lib/cx";
import { profileColorSwatches } from "../lib/imageSetWorkspace";
import { CheckerboardImage } from "./CheckerboardImage";
import "../styles/creative-profiles.css";
import type { AssetItem, CreativeProfile, CreativeProfileKind, ProfileAsset, ProfileDetails, ProfileSelection, ProfileContext } from "../types";

const creativeModalStack: symbol[] = [];
let restoreCreativeScroll: (() => void) | undefined;
export function CreativeModal({ title, description, icon, headerActions, className, busy = false, onClose, children }: {
  title: string; description?: string; icon?: ReactNode; headerActions?: ReactNode; className?: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const { t } = useI18n(), panel = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = () => { if (!busy) onClose(); };
  useEffect(() => {
    if (!creativeModalStack.length) {
      const root = document.documentElement, overflow = root.style.overflow, gutter = root.style.scrollbarGutter;
      root.style.overflow = "hidden"; root.style.scrollbarGutter = "stable";
      restoreCreativeScroll = () => { root.style.overflow = overflow; root.style.scrollbarGutter = gutter; };
    }
    const token = Symbol(); creativeModalStack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    (panel.current?.querySelector<HTMLElement>("[data-autofocus]") || panel.current?.querySelector<HTMLElement>(".sets-modal-content input:not(:disabled),.sets-modal-content textarea:not(:disabled),.sets-modal-content button:not(:disabled)") || panel.current?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (creativeModalStack.at(-1) !== token || event.defaultPrevented) return;
      const expanded = panel.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"][aria-expanded="true"]');
      const menu = expanded && document.querySelector<HTMLElement>(`[role="listbox"][aria-labelledby="${expanded.id}"]`);
      if (expanded && menu) {
        const options = [...menu.querySelectorAll<HTMLButtonElement>('button[role="option"]')];
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") { event.preventDefault(); expanded.click(); expanded.focus(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && options.length) {
          event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (index + 1) % options.length : (index < 0 ? options.length - 1 : (index + options.length - 1) % options.length); options[next].focus(); return;
        }
        if (event.key === "Tab") { expanded.click(); expanded.focus(); }
      }
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]') ?? [])].filter(n => n.tabIndex >= 0 && n.getClientRects().length > 0);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); const index = creativeModalStack.indexOf(token); if (index >= 0) creativeModalStack.splice(index, 1); if (!creativeModalStack.length) { restoreCreativeScroll?.(); restoreCreativeScroll = undefined; } if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <ModalPortal><SelectMenuLayer zIndex={1401}><div className="sets-modal-backdrop"><div className={cx("sets-modal", className)} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
    <header>{icon ? <span className="sets-modal-symbol" aria-hidden="true">{icon}</span> : null}<div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{headerActions ? <span className="profile-header-actions">{headerActions}</span> : null}<button type="button" className="icon-btn" disabled={busy} onClick={() => close.current()} aria-label={t("sets.close")}><X size={19} /></button></header><div className="sets-modal-content">{children}</div>
  </div></div></SelectMenuLayer></ModalPortal>;
}
export function CreativeContextPreview({ context }: { context: ProfileContext }) {
  const { t } = useI18n();
  return <div className="sets-context-preview">{[context.brand, context.product].filter(Boolean).map(profile => {
    const details = profile!.kind === "product" ? { ...profile!.details, ...context.variant?.details } : profile!.details;
    return <section key={profile!.id}><strong>{profile!.name}{profile!.kind === "product" && context.variant ? ` · ${context.variant.name}` : ""}</strong>
      {Object.entries(details).filter(([, value]) => value).map(([key, value]) => <p key={key}><span>{t(`sets.details.${key}`)}：</span>{value}</p>)}</section>;
  })}{context.assets.length ? <p>{t("sets.assets")} · {context.assets.length}</p> : null}</div>;
}
export function useProfileAssetDetails(value: ProfileAsset[], userId: string) {
  return useQueries({ queries: value.map(reference => ({ queryKey: ["creative-reference-asset", userId, reference.assetId],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.assetDetail(reference.assetId, { signal }).then(result => result.asset), staleTime: 60_000 })) });
}
export type ProfilePreviewImage = { url: string; thumbnailUrl?: string; name: string; whiteBackground?: boolean };
export function ProfileImagePreview({ images, index, onChange, onClose }: { images: ProfilePreviewImage[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const { t } = useI18n(), active = images[Math.min(index, images.length - 1)];
  if (!active) return null;
  const step = (offset: number) => onChange((index + offset + images.length) % images.length);
  return <CreativeModal title={active.name} className="profile-image-dialog" onClose={onClose} headerActions={<a className="secondary-btn" href={active.url} download={active.name} aria-label={t("imagePreview.downloadReference")}><Download size={17}/></a>}>
    <div className="profile-image-stage" onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1); } }}>
      {images.length > 1 ? <button type="button" className="icon-btn" aria-label={t("imageLightbox.previous")} onClick={() => step(-1)}><ChevronLeft size={22}/></button> : null}
      <CheckerboardImage whiteBackground={active.whiteBackground} src={active.url} alt={active.name}/>
      {images.length > 1 ? <button type="button" className="icon-btn" aria-label={t("imageLightbox.next")} onClick={() => step(1)}><ChevronRight size={22}/></button> : null}
    </div>
    {images.length > 1 ? <div className="profile-image-thumbs">{images.map((image, i) => <button key={image.url} type="button" aria-pressed={i === index} aria-label={image.name} onClick={() => onChange(i)}><CheckerboardImage whiteBackground={image.whiteBackground} src={image.thumbnailUrl || image.url} alt=""/></button>)}</div> : null}
  </CreativeModal>;
}
export function ProfileAssets({ value, onChange, userId, disabled = false, simple = false, readOnly = false, cards = false, logoAssetId }: { value: ProfileAsset[]; onChange: (value: ProfileAsset[]) => void; userId: string; disabled?: boolean; simple?: boolean; readOnly?: boolean; cards?: boolean; logoAssetId?: string }) {
  const { t } = useI18n(), [open, setOpen] = useState(false), [previewId, setPreviewId] = useState("");
  const queries = useProfileAssetDetails(value, userId), assets = queries.flatMap(query => query.data ? [query.data] : []);
  const previewIndex = assets.findIndex(asset => asset.id === previewId);
  const change = (selected: AssetItem[]) => onChange([...selected.map(asset => value.find(reference => reference.assetId === asset.id) ?? { assetId: asset.id, role: "identity" as const, note: "" }), ...value.filter(reference => !assets.some(asset => asset.id === reference.assetId) && !selected.some(asset => asset.id === reference.assetId))]);
  return <div className={cx("sets-references", cards && "profile-reference-cards")}>
    <div className="sets-inline"><strong>{t("sets.assets")}</strong>{!readOnly ? <button className="secondary-btn" type="button" disabled={disabled} onClick={() => setOpen(true)}><Plus size={15} />{t(cards ? "sets.selectMaterials" : "sets.select")}</button> : null}</div>
    {!value.length ? <div className="sets-reference-empty"><ImageIcon size={26} strokeWidth={1.3}/><p>{t(readOnly ? "sets.noMaterials" : "sets.assetsHint")}</p></div> : null}
    <div className={cards ? "profile-material-grid" : "profile-material-list"}>{value.map((reference, index) => {
      const query = queries[index], asset = query.data;
      return <div className={cards ? "profile-material-card" : "sets-reference-row"} key={reference.assetId}>
        <button className="profile-material-image" type="button" disabled={!asset} aria-label={asset?.name || t("sets.fullPreview")} onClick={() => setPreviewId(reference.assetId)}>{asset ? <CheckerboardImage whiteBackground={reference.role === "logo" || reference.assetId === logoAssetId} src={asset.thumbnailUrl || asset.previewUrl || asset.url} alt=""/> : query.isPending ? <LoaderCircle className="sets-spin" size={24}/> : <ImageIcon size={28}/>}</button>
        <div className="profile-material-copy"><span title={asset?.name}>{asset?.name || t(query.isPending ? "common.loading" : "sets.materialUnavailable")}</span>
          {query.isError ? <button type="button" className="sets-text-btn" onClick={() => void query.refetch()}>{t("sets.retry")}</button> : null}
          {!simple && !readOnly ? <CustomSelect value={reference.role} options={["identity", "logo", "style", "composition"].map(role => ({ value: role, label: t(`sets.role.${role}`) }))} disabled={disabled} ariaLabel={t("sets.assets")} onChange={role => onChange(value.map((a, i) => i === index ? { ...a, role: role as ProfileAsset["role"] } : a))}/> : null}
          {!simple && !readOnly ? <input aria-label={t("sets.assetNote")} placeholder={t("sets.assetNote")} disabled={disabled} value={reference.note} onChange={event => onChange(value.map((a, i) => i === index ? { ...a, note: event.target.value } : a))}/> : null}
          {readOnly ? <small>{t(`sets.role.${reference.role}`)}{reference.note ? ` · ${reference.note}` : ""}</small> : null}
        </div>
        {!readOnly ? <button className="icon-btn profile-material-remove" type="button" disabled={disabled} aria-label={t("sets.remove")} onClick={() => onChange(value.filter((_, i) => i !== index))}><X size={15}/></button> : null}
      </div>;
    })}</div>
    {open ? <CreativeModal title={t("sets.assets")} className="profile-material-picker" onClose={() => setOpen(false)}><MaterialPicker selectedAssets={assets} onToggleAsset={asset => onChange(value.some(reference => reference.assetId === asset.id) ? value.filter(reference => reference.assetId !== asset.id) : [...value, { assetId: asset.id, role: "identity", note: "" }])} onSelectedAssetsChange={change} onClose={() => setOpen(false)}/></CreativeModal> : null}
    {previewIndex >= 0 ? <ProfileImagePreview images={assets.map(asset => ({ url: asset.originalUrl || asset.url, thumbnailUrl: asset.thumbnailUrl, name: asset.name, whiteBackground: asset.id === logoAssetId || value.some(reference => reference.assetId === asset.id && reference.role === "logo") }))} index={previewIndex} onChange={index => setPreviewId(assets[index].id)} onClose={() => setPreviewId("")}/> : null}
  </div>;
}
export function useCreativeProfiles(kind: CreativeProfileKind, userId: string, keyword = "", archived = false) {
  return useInfiniteQuery({ queryKey: ["creative-profiles", userId, kind, keyword, archived], initialPageParam: "", queryFn: ({ pageParam, signal }) => api.creativeProfiles(kind, { keyword, archived, cursor: pageParam }, { signal }),
    getNextPageParam: page => page.nextCursor || undefined, staleTime: 10000 });
}
export function ProfileSelectionFields({ value, onChange, userId, disabled = false, onNew, brandsOnly = false }: { value: ProfileSelection; onChange: (s: ProfileSelection) => void; userId: string; disabled?: boolean; onNew?: (kind: CreativeProfileKind) => void; brandsOnly?: boolean }) {
  const { t } = useI18n(), brands = useCreativeProfiles("brand", userId), products = useCreativeProfiles("product", userId);
  const resolved = useQuery({ queryKey: ["creative-profile-context", userId, value], queryFn: ({ signal }) => api.resolveCreativeProfile(value, { signal }), enabled: Boolean(value.brandId || value.productId) });
  const brandList = brands.data?.pages.flatMap(p => p.items) ?? [], productList = products.data?.pages.flatMap(p => p.items) ?? [];
  if (resolved.data?.context.brand && !brandList.some(profile => profile.id === resolved.data.context.brand?.id)) brandList.push(resolved.data.context.brand);
  if (resolved.data?.context.product && !productList.some(profile => profile.id === resolved.data.context.product?.id)) productList.push(resolved.data.context.product);
  const selected = productList.find(p => p.id === value.productId);
  return <div className="sets-profile-selection">
    <label>{t("sets.brand")}<CustomSelect value={value.brandId || ""} disabled={disabled} ariaLabel={t("sets.brand")}
      options={[{ value: "", label: t("sets.noProfile") }, ...brandList.map(p => ({ value: p.id, label: p.name }))]}
      onChange={brandId => onChange({ brandId, productId: "", variantId: "" })} /></label>
    {!brandsOnly ? <label>{t("sets.product")}<CustomSelect value={value.productId || ""} disabled={disabled} ariaLabel={t("sets.product")}
      options={[{ value: "", label: t("sets.noProfile") }, ...productList.map(p => ({ value: p.id, label: p.name }))]}
      onChange={productId => { const p = productList.find(item => item.id === productId); onChange({ productId, brandId: p?.brandId || value.brandId || "", variantId: "" }); }} /></label> : null}
    {selected?.variants.length ? <label>{t("sets.variant")}<CustomSelect value={value.variantId || ""} disabled={disabled} ariaLabel={t("sets.variant")}
      options={[{ value: "", label: t("sets.none") }, ...selected.variants.map(v => ({ value: v.id, label: v.name }))]} onChange={variantId => onChange({ ...value, variantId })} /></label> : null}
    {brands.hasNextPage || products.hasNextPage ? <button className="secondary-btn" type="button" disabled={disabled || brands.isFetchingNextPage || products.isFetchingNextPage} onClick={() => { if (brands.hasNextPage) void brands.fetchNextPage(); if (products.hasNextPage) void products.fetchNextPage(); }}>{t("sets.loadMore")}</button> : null}
    {onNew ? <div className="sets-inline"><button className="secondary-btn" type="button" disabled={disabled} onClick={() => onNew("brand")}>{t("sets.newBrand")}</button><button className="secondary-btn" type="button" disabled={disabled} onClick={() => onNew("product")}>{t("sets.newProduct")}</button></div> : null}
    {brands.isError || products.isError || resolved.isError ? <p className="sets-error" role="alert">{(brands.error || products.error || resolved.error)?.message}</p> : null}
  </div>;
}
const emptyDetails: ProfileDetails = { description: "", visualStyle: "", colors: "", tone: "", rules: "", facts: "", features: "" };
export function ProfileEditor({ kind, profile, userId, onSaved, onClose }: { kind: CreativeProfileKind; profile?: CreativeProfile; userId: string; onSaved: (profile: CreativeProfile) => void; onClose: () => void }) {
  const { t } = useI18n(), { showToast } = useToast(), client = useQueryClient(), fieldId = useId();
  const [initial] = useState<Partial<CreativeProfile>>(() => profile ? structuredClone(profile) : { kind, name: "", brandId: "", shared: false, details: { ...emptyDetails }, assets: [], variants: [] });
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false), [discard, setDiscard] = useState(false), [activeSection, setActiveSection] = useState("basic");
  const body = useRef<HTMLDivElement>(null), nav = useRef<HTMLElement>(null);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const sections = [ ["basic", "sets.basicInfo"], ["information", kind === "brand" ? "sets.visualIdentity" : "sets.productInformation"], ["materials", "sets.assets"], ...(kind === "product" ? [["variants", "sets.variants"]] : []) ];
  const title = t(profile ? kind === "brand" ? "sets.editBrand" : "sets.editProduct" : kind === "brand" ? "sets.newBrand" : "sets.newProduct");
  const close = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  const moveTo = (name: string) => {
    const area = body.current, target = area?.querySelector<HTMLElement>(`[data-profile-section="${name}"]`);
    if (!area || !target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    setActiveSection(name);
    area.scrollTo({ top: area.scrollTop + target.getBoundingClientRect().top - area.getBoundingClientRect().top - 24, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  useEffect(() => {
    const list = nav.current, selected = list?.querySelector<HTMLElement>(`[data-section-id="${activeSection}"]`);
    if (list && selected && list.scrollWidth > list.clientWidth) list.scrollTo({ left: list.scrollLeft + selected.getBoundingClientRect().left - list.getBoundingClientRect().left - (list.clientWidth - selected.offsetWidth) / 2 });
  }, [activeSection]);
  const focusField = (name: string, variant = false) => {
    const field = [...(body.current?.querySelectorAll<HTMLElement>("[data-profile-field]") || [])].find(element => element.dataset.profileField === name && Boolean(element.closest(".profile-variant")) === variant);
    if (!field) return;
    for (let parent = field.parentElement; parent && parent !== body.current; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    const section = field.closest<HTMLElement>("[data-profile-section]");
    if (section) setActiveSection(section.dataset.profileSection!);
    requestAnimationFrame(() => { field.scrollIntoView({ block: "center", behavior: "instant" }); field.focus({ preventScroll: true }); });
  };
  const save = async () => {
    if (busy) return;
    setSubmitted(true); setError("");
    if (!draft.name?.trim()) { focusField("name"); return; }
    const invalidVariant = draft.variants?.find(variant => !variant.name.trim());
    if (invalidVariant) { focusField(invalidVariant.id, true); return; }
    setBusy(true);
    try {
      const result = await api.saveCreativeProfile(kind, draft, profile?.id);
      await Promise.all([client.invalidateQueries({ queryKey: ["creative-profiles"] }), client.invalidateQueries({ queryKey: ["creative-profile-context"] })]);
      showToast(t("sets.saved")); onSaved(result.profile);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); }
  };
  const field = (key: keyof ProfileDetails, rows = 2, wide = false, hiddenLabel = false) => <label className={cx("profile-field", wide && "profile-field-wide")} key={key}>
    {!hiddenLabel ? <span>{t("sets.details." + key)}</span> : null}
    {key === "colors" || key === "tone" ? <input aria-label={t("sets.details." + key)} disabled={busy} value={draft.details?.[key] || ""} placeholder={t("sets.placeholder." + key)} onChange={event => setDraft(current => ({ ...current, details: { ...emptyDetails, ...current.details, [key]: event.target.value } }))}/> :
      <textarea aria-label={t("sets.details." + key)} disabled={busy} rows={rows} value={draft.details?.[key] || ""} placeholder={t("sets.placeholder." + key)} onChange={event => setDraft(current => ({ ...current, details: { ...emptyDetails, ...current.details, [key]: event.target.value } }))}/>}
    {key === "colors" && profileColorSwatches(draft.details?.colors || "").length ? <span className="profile-palette-preview">{profileColorSwatches(draft.details?.colors || "").map(color => <span key={color}><i style={{ background: color }}/><span>{color.toUpperCase()}</span></span>)}</span> : null}
  </label>;
  return <><CreativeModal title={title} className="profile-dialog profile-editor-dialog" busy={busy} onClose={close}>
    <form className="profile-form" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="profile-editor-layout">
        <nav className="profile-section-nav" ref={nav} aria-label={t("sets.profileSections")}>
          {sections.map(([name, label]) => <button type="button" key={name} data-section-id={name} aria-current={activeSection === name ? "location" : undefined} onClick={() => moveTo(name)}>{t(label)}</button>)}
        </nav>
        <div className="profile-editor-scroll" ref={body} onScroll={() => {
          const area = body.current; if (!area) return;
          const top = area.getBoundingClientRect().top + 64;
          const visible = [...area.querySelectorAll<HTMLElement>("[data-profile-section]")].filter(section => section.getBoundingClientRect().top <= top).at(-1);
          if (visible) setActiveSection(visible.dataset.profileSection!);
        }}>
          <section className="profile-editor-section" data-profile-section="basic">
            <p className="profile-form-hint">{t("sets.profileEditorHint")}</p>
            <div className="profile-field-grid">
              <label className={cx("profile-field", kind === "brand" && "profile-field-wide")}><span>{t("sets.name")}<i className="sets-required" aria-hidden="true">*</i></span>
                <input data-autofocus data-profile-field="name" aria-invalid={submitted && !draft.name?.trim()} aria-describedby={submitted && !draft.name?.trim() ? `${fieldId}-name-error` : undefined} required maxLength={120} value={draft.name || ""} disabled={busy} placeholder={t(kind === "brand" ? "sets.brandNamePlaceholder" : "sets.productNamePlaceholder")} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/>
                {submitted && !draft.name?.trim() ? <small className="profile-field-error" id={`${fieldId}-name-error`}>{t("sets.profileNameRequired")}</small> : null}
              </label>
              {kind === "product" ? <ProfileSelectionFields brandsOnly userId={userId} value={{ brandId: draft.brandId }} onChange={selection => setDraft(current => ({ ...current, brandId: selection.brandId }))} disabled={busy}/> : null}
              {field("description", 2, true)}
            </div>
          </section>
          <section className="profile-editor-section" data-profile-section="information"><h3>{t(kind === "brand" ? "sets.visualIdentity" : "sets.productInformation")}</h3>
            <div className="profile-field-grid">{kind === "brand" ? <>{field("colors", 1, true)}{field("visualStyle")}{field("tone")}</> : <>{field("facts", 3)}{field("features", 3)}</>}</div>
            <details className="profile-rules"><summary><ChevronRight size={16}/><span>{t("sets.details.rules")}</span><small>{t("sets.optional")}</small></summary>{field("rules", 3, true, true)}</details>
          </section>
          <section className="profile-editor-section" data-profile-section="materials"><ProfileAssets cards userId={userId} value={draft.assets || []} logoAssetId={kind === "brand" ? (draft.assets?.find(asset => asset.role === "logo") || draft.assets?.[0])?.assetId : undefined} onChange={assets => setDraft(current => ({ ...current, assets }))} disabled={busy}/></section>
          {kind === "product" ? <details className="profile-variants" data-profile-section="variants" open={profile?.variants.length ? true : undefined}>
            <summary><ChevronRight size={16}/><span>{t("sets.variants")}</span><small>{draft.variants?.length || t("sets.optional")}</small></summary>
            <p className="profile-form-hint">{t("sets.variantHint")}</p>
            {draft.variants?.map((variant, index) => <div className="profile-variant" key={variant.id}>
              <header><strong>{variant.name || t("sets.version", { number: index + 1 })}</strong><button className="icon-btn" disabled={busy} type="button" aria-label={t("sets.remove")} onClick={() => setDraft(current => ({ ...current, variants: current.variants!.filter(value => value.id !== variant.id) }))}><X size={16}/></button></header>
              <div className="profile-field-grid">
                <label className="profile-field"><span>{t("sets.versionName")}<i className="sets-required" aria-hidden="true">*</i></span><input required data-profile-field={variant.id} disabled={busy} aria-invalid={submitted && !variant.name.trim()} placeholder={t("sets.versionName")} value={variant.name} onChange={event => setDraft(current => ({ ...current, variants: current.variants!.map(value => value.id === variant.id ? { ...value, name: event.target.value } : value) }))}/>{submitted && !variant.name.trim() ? <small className="profile-field-error">{t("sets.variantNameRequired")}</small> : null}</label>
                <label className="profile-field"><span>{t("sets.details.facts")}</span><textarea disabled={busy} rows={2} placeholder={t("sets.placeholder.facts")} value={variant.details.facts || ""} onChange={event => setDraft(current => ({ ...current, variants: current.variants!.map(value => value.id === variant.id ? { ...value, details: { ...value.details, facts: event.target.value } } : value) }))}/></label>
              </div>
              <ProfileAssets cards userId={userId} value={variant.assets} onChange={assets => setDraft(current => ({ ...current, variants: current.variants!.map(value => value.id === variant.id ? { ...value, assets } : value) }))} disabled={busy}/>
            </div>)}
            <button type="button" className="secondary-btn profile-add-variant" disabled={busy || (draft.variants?.length ?? 0) >= 30} onClick={() => { const id = createCreativeId(); setDraft(current => ({ ...current, variants: [...(current.variants || []), { id, name: "", details: {}, assets: [] }] })); requestAnimationFrame(() => focusField(id, true)); }}><Plus size={16}/>{t("sets.addVariant")}</button>
          </details> : null}
        </div>
      </div>
      {error ? <p className="profile-save-error" role="alert">{error}</p> : null}
      <footer className="profile-dialog-footer">
        <div className="profile-visibility">{draft.shared ? <Share2 size={16}/> : <LockKeyhole size={16}/>}<CustomSelect value={draft.shared ? "shared" : "private"} ariaLabel={t("sets.visibility")} menuPlacement="top" disabled={busy} options={[{ value: "private", label: t("sets.private") }, { value: "shared", label: t("sets.shared"), description: t("sets.sharingHint") }]} onChange={value => setDraft(current => ({ ...current, shared: value === "shared" }))}/></div>
        <div className="profile-footer-actions"><button className="secondary-btn" type="button" disabled={busy} onClick={close}>{t("common.cancel")}</button><button className="primary-btn profile-save" type="submit" disabled={busy}>{busy ? <LoaderCircle className="sets-spin" size={16}/> : null}{t(busy ? "sets.saving" : kind === "brand" ? "sets.saveBrand" : "sets.saveProduct")}</button></div>
      </footer>
    </form>
  </CreativeModal>
  {discard ? <CreativeModal title={t("sets.discardTitle")} className="profile-discard-dialog" onClose={() => setDiscard(false)}><p>{t("sets.discardHint")}</p><div className="profile-footer-actions"><button type="button" className="secondary-btn" data-autofocus onClick={() => setDiscard(false)}>{t("sets.continueFilling")}</button><button type="button" className="primary-btn" onClick={onClose}>{t("sets.discardChanges")}</button></div></CreativeModal> : null}
  </>;
}
