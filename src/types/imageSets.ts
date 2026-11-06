import type { WorkImage } from "../types";

export type CreativeProfileKind = "brand" | "product";
export type ProfileDetails = { description: string; visualStyle: string; colors: string; tone: string; rules: string; facts: string; features: string };
export type ProfileAsset = { assetId: string; role: "identity" | "logo" | "style" | "composition"; note: string };
export type ProductVariant = { id: string; name: string; details: Partial<ProfileDetails>; assets: ProfileAsset[] };
export type CreativeProfile = {
  id: string; kind: CreativeProfileKind; name: string; ownerId: string; brandId: string; shared: boolean; archived: boolean;
  revision: number; details: ProfileDetails; assets: ProfileAsset[]; variants: ProductVariant[]; createdAt: string; updatedAt: string; isExample?: boolean;
};
export type ProfileSelection = { brandId?: string; productId?: string; variantId?: string };
export type ProfileContext = {
  selection: ProfileSelection; brand: CreativeProfile | null; product: CreativeProfile | null; variant: ProductVariant | null;
  assets: ProfileAsset[]; instruction: string;
};
export type ImageSetItemInput = { id: string; name: string; purpose: string; copy: string; size: string; composition: string };
export type ImageSetInput = {
  name: string; brief: string; commonStyle: string; profileSelection: ProfileSelection; assetIds: string[];
  providerId: string; model: string; quality: string; items: ImageSetItemInput[]; anchorItemId: string;
};
export type ImageSetRun = {
  id: string; itemId: string; jobId: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error: string; contextRevision: number; itemRevision: number; createdAt: string; images: WorkImage[]; demoStyle?: "airy" | "dark" | "editorial";
};
export type ImageSetItem = ImageSetItemInput & {
  revision: number; selectedImageId: string; selectionCurrent: boolean; runs: ImageSetRun[];
};
export type ImageSet = Omit<ImageSetInput, "items"> & {
  id: string; ownerId: string; revision: number; contextRevision: number; confirmed: boolean; archived: boolean; stopped: boolean;
  finalized: boolean; anchorImageId: string; anchorCurrent: boolean; items: ImageSetItem[];
  stage: "draft" | "anchor" | "generating" | "review" | "finalized" | "stopped";
  selectedCount: number; activeCount: number; snapshot: ProfileContext | null; createdAt: string; updatedAt: string; isExample?: boolean; executionMode?: "provider" | "demo"; demoTemplate?: string;
};
export type ImageSetList = { items: ImageSet[]; nextCursor: string | null };
