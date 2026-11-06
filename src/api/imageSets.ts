import { request as apiRequest } from "./client";
import { presentCreativeResponse } from "../lib/creativePresentation";
import { preserveImageSetSource } from "../lib/imageSetDraft";
import type { CreativeProfile, CreativeProfileKind, ImageSet, ImageSetInput, ImageSetList, ProfileContext, ProfileSelection } from "../types";

const collection = (kind: CreativeProfileKind) => kind === "brand" ? "brands" : "products";
const request = <T>(url: string, init?: RequestInit) => apiRequest<T>(url, init).then(presentCreativeResponse);
const path = (id: string) => `/api/image-sets/${encodeURIComponent(id)}`;
const post = <T>(url: string, payload: unknown = {}) => request<T>(url, { method: "POST", body: JSON.stringify(payload) });
export const imageSetsApi = {
  imageSetExampleCatalog: (init?: RequestInit) => request<{items: Array<{id: string;name: string;category: string;subtitle: string;previewUrl: string}>}>("/api/image-sets/example-catalog",init),
  createImageSetExample: (clientRequestId: string, templateId = "tea") => post<{ example: { brandId: string; productId: string; setId: string; created: boolean } }>("/api/image-sets/examples", { clientRequestId, templateId }),
  deleteImageSet: (id: string, revision: number) => request<{ ok: boolean }>(path(id), { method: "DELETE", body: JSON.stringify({ revision }) }),
  deleteCreativeProfile: (profile: CreativeProfile) => request<{ ok: boolean }>(`/api/${collection(profile.kind)}/${encodeURIComponent(profile.id)}`, { method: "DELETE", body: JSON.stringify({ revision: profile.revision }) }),
  sessionCreativeProfile: (id: string, init?: RequestInit) => request<{ selection: ProfileSelection }>(`/api/sessions/${encodeURIComponent(id)}/creative-profile`, init),
  saveSessionCreativeProfile: (id: string, selection: ProfileSelection) => request<{ selection: ProfileSelection }>(`/api/sessions/${encodeURIComponent(id)}/creative-profile`, { method: "PUT", body: JSON.stringify(selection) }),
  creativeProfiles: (kind: CreativeProfileKind, params: { keyword?: string; archived?: boolean; cursor?: string } = {}, init?: RequestInit) =>
    request<{ items: CreativeProfile[]; nextCursor: string | null }>(`/api/${collection(kind)}?${new URLSearchParams({ keyword: params.keyword || "", archived: params.archived ? "1" : "0", cursor: params.cursor || "" })}`, init),
  creativeProfile: (kind: CreativeProfileKind, id: string, init?: RequestInit) => request<{ profile: CreativeProfile }>(`/api/${collection(kind)}/${encodeURIComponent(id)}`, init),
  saveCreativeProfile: (kind: CreativeProfileKind, payload: Partial<CreativeProfile>, id?: string) =>
    request<{ profile: CreativeProfile }>(`/api/${collection(kind)}${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }),
  copyCreativeProfile: (profile: CreativeProfile) => post<{ profile: CreativeProfile }>(`/api/${collection(profile.kind)}/${encodeURIComponent(profile.id)}/copy`),
  creativeProfileImages: (profile: CreativeProfile, cursor = "", init?: RequestInit) => request<{ items: import("../types").WorkImage[]; nextCursor: string | null }>(`/api/${collection(profile.kind)}/${encodeURIComponent(profile.id)}/images?cursor=${encodeURIComponent(cursor)}`, init),
  resolveCreativeProfile: (selection: ProfileSelection, init?: RequestInit) => request<{ context: ProfileContext }>("/api/profiles/resolve", { ...init, method: "POST", body: JSON.stringify(selection) }),
  imageSets: (params: { keyword?: string; archived?: boolean; cursor?: string; brandId?: string; stage?: string } = {}, init?: RequestInit) =>
    request<ImageSetList>(`/api/image-sets?${new URLSearchParams({ keyword: params.keyword || "", archived: params.archived ? "1" : "0", cursor: params.cursor || "", brandId: params.brandId || "", stage: params.stage || "" })}`, init),
  imageSet: (id: string, init?: RequestInit) => request<{ set: ImageSet }>(path(id), init),
  saveImageSet: async (payload: ImageSetInput & { revision?: number }, id?: string) => {
    const preserved = id ? preserveImageSetSource(payload, (await apiRequest<{ set: ImageSet }>(path(id))).set) : payload;
    return request<{ set: ImageSet }>(id ? path(id) : "/api/image-sets", { method: id ? "PUT" : "POST", body: JSON.stringify(preserved) });
  },
  copyImageSet: (id: string) => post<{ set: ImageSet }>(`${path(id)}/copy`),
  startImageSetDemo: (id: string, clientRequestId: string) => post<{ set: ImageSet }>(`${path(id)}/demo-start`, { clientRequestId }),
  restoreCreativeDefaults: (clientRequestId: string) => post<{ restored: { brands: number; products: number; sets: number; preserved: number } }>("/api/image-sets/restore-defaults", { clientRequestId }),
  imageSetDemoStyle: (id: string, itemId: string, style: "airy" | "dark" | "editorial", clientRequestId: string) => post<{ set: ImageSet; runId: string; imageId: string }>(`${path(id)}/items/${encodeURIComponent(itemId)}/demo-style`, { style, clientRequestId }),
  editImageSetDemo: (id: string, itemId: string, payload: { clientRequestId: string; sourceImageId: string; copy: string; color: string }) => post<{ set: ImageSet }>(`${path(id)}/items/${encodeURIComponent(itemId)}/demo-edit`, payload),
  failImageSetDemo: (id: string, itemId: string, clientRequestId: string) => post<{ set: ImageSet }>(`${path(id)}/items/${encodeURIComponent(itemId)}/demo-failure`, { clientRequestId }),
  archiveImageSet: (id: string, archived: boolean) => post<{ set: ImageSet }>(`${path(id)}/archive`, { archived }),
  planImageSet: (id: string, language: string) => post<{ set: ImageSet }>(`${path(id)}/plan`, { language }),
  confirmImageSet: (id: string, revision: number, clientRequestId: string) => post<{ set: ImageSet }>(`${path(id)}/confirm-plan`, { revision, clientRequestId }),
  generateImageSet: (id: string, clientRequestId: string) => post<{ set: ImageSet }>(`${path(id)}/generate`, { clientRequestId }),
  generateImageSetItem: (id: string, itemId: string, clientRequestId: string, sourceImageId?: string) => post<{ set: ImageSet }>(`${path(id)}/items/${encodeURIComponent(itemId)}/generate`, { clientRequestId, sourceImageId }),
  selectImageSetItem: (id: string, itemId: string, imageId: string, acknowledgeSize = false) => request<{ set: ImageSet }>(`${path(id)}/items/${encodeURIComponent(itemId)}/selection`, { method: "PUT", body: JSON.stringify({ imageId, acknowledgeSize }) }),
  stopImageSet: (id: string) => post<{ set: ImageSet }>(`${path(id)}/stop`),
  retryImageSetRun: (id: string, runId: string) => post<{ set: ImageSet }>(`${path(id)}/runs/${encodeURIComponent(runId)}/retry`),
  finalizeImageSet: (id: string) => post<{ set: ImageSet }>(`${path(id)}/finalize`),
  exportImageSet: (id: string, partial: boolean) => post<{ downloadUrl: string }>(`${path(id)}/export`, { partial })
};
