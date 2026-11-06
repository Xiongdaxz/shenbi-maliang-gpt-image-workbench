import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight, Image as ImageIcon, LockKeyhole, Package, Palette, Pencil, Share2 } from "lucide-react";
import { api } from "../api";
import { localeRegistry, useI18n } from "../i18n";
import { profileColorSwatches } from "../lib/imageSetWorkspace";
import { CheckerboardImage } from "./CheckerboardImage";
import { CreativeModal, ProfileAssets, ProfileImagePreview, useProfileAssetDetails } from "./CreativeProfiles";
import type { CreativeProfile, ProfileSelection } from "../types";

export function CreativeProfileViewer({ profile, userId, canEdit, onEdit, onUse, onClose }: {
  profile: CreativeProfile; userId: string; canEdit: boolean; onEdit: () => void; onUse: (selection: ProfileSelection) => void; onClose: () => void;
}) {
  const { t, resolvedLanguage } = useI18n(), isBrand = profile.kind === "brand";
  const [brandSection, setBrandSection] = useState("overview");
  const [variantId, setVariantId] = useState(""), [activeAssetId, setActiveAssetId] = useState("");
  const [referencePreview, setReferencePreview] = useState(false), [workPreview, setWorkPreview] = useState<number | null>(null);
  const variant = profile.variants.find(item => item.id === variantId);
  const details = { ...profile.details, ...variant?.details }, references = variant?.assets.length ? variant.assets : profile.assets;
  const assetQueries = useProfileAssetDetails(references, userId), assets = assetQueries.flatMap(query => query.data ? [query.data] : []);
  const activeAsset = assets.find(asset => asset.id === activeAssetId) || assets[0];
  const logoReference = references.find(reference => reference.role === "logo") || references[0];
  const logo = assets.find(asset => asset.id === logoReference?.assetId);
  const colors = profileColorSwatches(details.colors);
  const brand = useQuery({ queryKey: ["creative-profile-brand", userId, profile.brandId], queryFn: ({ signal }) => api.creativeProfile("brand", profile.brandId, { signal }), enabled: !isBrand && Boolean(profile.brandId) });
  const linkedBrandBlocked = !isBrand && Boolean(profile.brandId) && (brand.isPending || brand.isError || Boolean(brand.data?.profile.archived));
  const works = useInfiniteQuery({ queryKey: ["creative-profile-images", userId, profile.id], initialPageParam: "", queryFn: ({ pageParam, signal }) => api.creativeProfileImages(profile, pageParam, { signal }), getNextPageParam: page => page.nextCursor || undefined, enabled: !isBrand || brandSection === "works" });
  const workImages = works.data?.pages.flatMap(page => page.items) || [];
  const referenceImages = assets.map(asset => ({ url: asset.originalUrl || asset.url, thumbnailUrl: asset.thumbnailUrl, name: asset.name, whiteBackground: isBrand && asset.id === logoReference?.assetId || references.some(reference => reference.assetId === asset.id && reference.role === "logo") }));
  const readField = (key: "visualStyle" | "tone" | "facts" | "features") => details[key] ? <section className="profile-read-field"><h4>{t(`sets.details.${key}`)}</h4><p>{details[key]}</p></section> : null;
  const relatedWorks = <section className="profile-related-works"><header><h4>{t("sets.relatedWorks")}</h4></header>
    {works.isPending ? <p role="status" className="sets-hint">{t("common.loading")}</p> : works.isError ? <div role="alert" className="sets-error"><p>{works.error.message}</p><button type="button" className="sets-text-btn" onClick={() => void works.refetch()}>{t("sets.retry")}</button></div> : !workImages.length ? isBrand ? <div className="profile-works-empty"><ImageIcon size={28} strokeWidth={1.2}/><p>{t("sets.noRelatedWorks")}</p></div> : <p className="sets-hint">{t("sets.noRelatedWorks")}</p> : null}
    <div className="profile-works-grid">{workImages.map((image, index) => <button type="button" key={image.id} aria-label={t("imageLightbox.viewNth", { index: index + 1 })} onClick={() => setWorkPreview(index)}><CheckerboardImage src={image.thumbnailUrl || image.previewUrl || image.url} alt={image.prompt} loading="lazy"/></button>)}</div>
    {works.hasNextPage ? <button type="button" className="secondary-btn sets-more" disabled={works.isFetchingNextPage} onClick={() => void works.fetchNextPage()}>{t("sets.loadMore")}</button> : null}
  </section>;
  return <><CreativeModal title={t(isBrand ? "sets.brandDetails" : "sets.productDetails")} className={`profile-dialog profile-viewer-dialog${isBrand ? " profile-brand-dialog" : ""}`} onClose={onClose}
    headerActions={canEdit ? <button type="button" className="secondary-btn profile-edit" onClick={onEdit}><Pencil size={15}/>{t(isBrand ? "sets.editBrand" : "sets.editProduct")}</button> : undefined}>
    {isBrand ? <Tabs.Root className="profile-brand-view" value={brandSection} onValueChange={setBrandSection} dir={localeRegistry[resolvedLanguage].dir}>
      <div className="profile-brand-heading"><div className="profile-brand-mark">{logo ? <button type="button" aria-label={logo.name} onClick={() => { setActiveAssetId(logo.id); setReferencePreview(true); }}><CheckerboardImage whiteBackground src={logo.previewUrl || logo.url} alt={logo.name}/></button> : <Palette size={30} strokeWidth={1.3}/>}</div><div><h3>{profile.name}</h3><span>{t(profile.archived ? "sets.archived" : "sets.brandProfile")}</span></div></div>
      <Tabs.List className="profile-brand-tabs" aria-label={t("sets.profileSections")}>
        <Tabs.Trigger value="overview">{t("sets.brandOverview")}</Tabs.Trigger>
        <Tabs.Trigger value="materials">{t("sets.assets")}{references.length ? <span className="profile-tab-count">{references.length}</span> : null}</Tabs.Trigger>
        <Tabs.Trigger value="works">{t("sets.brandWorks")}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content className="profile-brand-panel" value="overview">
        <div className="profile-brand-overview">
          {details.description ? <section className="profile-read-field profile-brand-description"><h4>{t("sets.details.description")}</h4><p>{details.description}</p></section> : null}
          {details.colors ? <section className="profile-read-field"><h4>{t("sets.details.colors")}</h4>{colors.length ? <div className="profile-brand-colors">{colors.map(color => <div key={color}><span style={{ background: color }}/><code>{color.toUpperCase()}</code></div>)}</div> : null}{details.colors.replace(/#[\da-f]{6}\b|#[\da-f]{3}\b/gi, "").replace(/[\s,，;；/·]+/g, "") ? <p className="profile-color-note">{details.colors}</p> : null}</section> : null}
          {details.visualStyle || details.tone ? <div className="profile-brand-style-grid">{readField("visualStyle")}{readField("tone")}</div> : null}
          {details.rules ? <details className="profile-rules"><summary><ChevronRight size={16}/><span>{t("sets.details.rules")}</span></summary><p>{details.rules}</p></details> : null}
          {![details.description, details.colors, details.visualStyle, details.tone, details.rules].some(Boolean) ? <p className="sets-hint">{t("sets.noDescription")}</p> : null}
        </div>
      </Tabs.Content>
      <Tabs.Content className="profile-brand-panel" value="materials"><ProfileAssets cards readOnly userId={userId} value={references} logoAssetId={logoReference?.assetId} onChange={() => {}}/></Tabs.Content>
      <Tabs.Content className="profile-brand-panel" value="works">{relatedWorks}</Tabs.Content>
    </Tabs.Root> : <div className="profile-viewer-scroll">
      <div className="profile-product-overview">
        <div className="profile-product-gallery"><button className="profile-product-image" type="button" disabled={!activeAsset} aria-label={t("sets.fullPreview")} onClick={() => setReferencePreview(true)}>{activeAsset ? <CheckerboardImage src={activeAsset.previewUrl || activeAsset.url} alt={activeAsset.name}/> : <span><Package size={42} strokeWidth={1.2}/><span>{t(assetQueries.some(query => query.isPending) ? "common.loading" : "sets.noMaterials")}</span></span>}</button>
          {assets.length > 0 ? <div className="profile-product-thumbs">{assets.map(asset => <button type="button" key={asset.id} aria-label={asset.name} aria-pressed={asset.id === activeAsset?.id} onClick={() => setActiveAssetId(asset.id)}><CheckerboardImage src={asset.thumbnailUrl || asset.previewUrl || asset.url} alt=""/><span>{references.find(reference => reference.assetId === asset.id)?.note || asset.name}</span></button>)}</div> : null}
          {assetQueries.some(query => query.isError) ? <p className="sets-hint">{t("sets.materialUnavailable")} <button className="sets-text-btn" onClick={() => assetQueries.filter(query => query.isError).forEach(query => void query.refetch())}>{t("sets.retry")}</button></p> : null}
        </div>
        <div className="profile-product-copy"><h3>{profile.name}</h3>{profile.brandId ? <p className="profile-brand-link">{t("sets.brand")} · {brand.data?.profile.name || t(brand.isPending ? "common.loading" : "sets.profileUnavailable")}{brand.data?.profile.archived ? ` · ${t("sets.archived")}` : ""}</p> : null}
          {details.description ? <p className="profile-product-description">{details.description}</p> : null}
          {profile.variants.length ? <div className="profile-variant-choice"><h4>{t("sets.variant")}</h4><div role="group" aria-label={t("sets.variant")}>
            {[{ id: "", name: t("sets.baseProfile") }, ...profile.variants].map(item => <button type="button" key={item.id} aria-pressed={variantId === item.id} onClick={() => { setVariantId(item.id); setActiveAssetId(""); }}>{item.name}</button>)}
          </div></div> : null}
          {readField("facts")}{readField("features")}
          {details.rules ? <details className="profile-rules"><summary><ChevronRight size={16}/><span>{t("sets.details.rules")}</span></summary><p>{details.rules}</p></details> : null}
        </div>
      </div>
      {relatedWorks}
    </div>}
    <footer className="profile-dialog-footer"><span className="profile-read-visibility">{profile.shared ? <Share2 size={16}/> : <LockKeyhole size={16}/>} {t(profile.shared ? "sets.shared" : "sets.private")}</span><div className="profile-footer-actions"><button type="button" className="secondary-btn" onClick={onClose}>{t("sets.close")}</button><button type="button" className="primary-btn profile-use" disabled={profile.archived || linkedBrandBlocked} title={profile.archived || brand.data?.profile.archived ? t("sets.archived") : linkedBrandBlocked ? t(brand.isPending ? "common.loading" : "sets.profileUnavailable") : undefined} onClick={() => onUse(isBrand ? { brandId: profile.id } : { brandId: profile.brandId || undefined, productId: profile.id, variantId: variantId || undefined })}>{t("sets.useInNewSet")}<ArrowUpRight size={16}/></button></div></footer>
  </CreativeModal>
  {referencePreview && activeAsset ? <ProfileImagePreview images={referenceImages} index={assets.indexOf(activeAsset)} onChange={index => setActiveAssetId(assets[index].id)} onClose={() => setReferencePreview(false)}/> : null}
  {workPreview !== null && workImages.length ? <ProfileImagePreview images={workImages.map(image => ({ url: image.url, thumbnailUrl: image.thumbnailUrl, name: profile.name }))} index={workPreview} onChange={setWorkPreview} onClose={() => setWorkPreview(null)}/> : null}
  </>;
}
