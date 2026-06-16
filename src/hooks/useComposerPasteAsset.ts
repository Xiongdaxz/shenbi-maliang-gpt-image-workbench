import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { getClipboardImageFile } from "../lib/clipboardImage";
import type { AssetItem } from "../types";

type PasteAssetResult = {
  asset: AssetItem;
  uploaded: boolean;
};

type UseComposerPasteAssetOptions = {
  autoUploadPastedAssets: boolean;
  selectedAssets: AssetItem[];
  setSelectedAssets: (assets: AssetItem[]) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function temporaryAssetFromFile(file: File): Promise<AssetItem> {
  const dataUrl = await readFileDataUrl(file);
  const timestamp = new Date().toISOString();
  return {
    id: `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    space: "private",
    name: file.name || "粘贴图片",
    url: dataUrl,
    originalUrl: dataUrl,
    previewUrl: dataUrl,
    thumbnailUrl: dataUrl,
    mimeType: file.type || "image/png",
    size: file.size,
    imageWidth: 0,
    imageHeight: 0,
    createdAt: timestamp,
    sourceUsername: "本次输入",
    canEdit: false,
    shared: false,
    shareStatus: "none",
    categoryIds: [],
    categoryNames: [],
    temporary: true,
    dataUrl
  };
}

export function useComposerPasteAsset({ autoUploadPastedAssets, selectedAssets, setSelectedAssets, showToast }: UseComposerPasteAssetOptions) {
  const queryClient = useQueryClient();
  const pasteAsset = useMutation({
    mutationFn: async (file: File): Promise<PasteAssetResult> => {
      if (!autoUploadPastedAssets) {
        return { asset: await temporaryAssetFromFile(file), uploaded: false };
      }
      const form = new FormData();
      form.set("file", file);
      const result = await api.uploadAsset(form);
      return { asset: result.asset, uploaded: true };
    },
    onSuccess: (result) => {
      const nextAssets = selectedAssets.some((asset) => asset.id === result.asset.id)
        ? selectedAssets
        : [...selectedAssets, result.asset];
      setSelectedAssets(nextAssets);
      if (result.uploaded) {
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      }
      showToast("图片已添加到输入框");
    },
    onError: (err) => {
      showToast(err instanceof ApiError ? err.message : "粘贴图片失败", "error");
    }
  });

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const imageFile = getClipboardImageFile(event.clipboardData);
    if (!imageFile) return;
    event.preventDefault();
    if (pasteAsset.isPending) {
      showToast("图片正在添加");
      return;
    }
    pasteAsset.mutate(imageFile);
  };

  return { handleComposerPaste, isPastingAsset: pasteAsset.isPending };
}
