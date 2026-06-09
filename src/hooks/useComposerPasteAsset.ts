import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { getClipboardImageFile } from "../lib/clipboardImage";
import type { AssetItem } from "../types";

type UseComposerPasteAssetOptions = {
  selectedAssets: AssetItem[];
  setSelectedAssets: (assets: AssetItem[]) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export function useComposerPasteAsset({ selectedAssets, setSelectedAssets, showToast }: UseComposerPasteAssetOptions) {
  const queryClient = useQueryClient();
  const pasteAsset = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return api.uploadAsset(form);
    },
    onSuccess: (result) => {
      setSelectedAssets([...selectedAssets, result.asset]);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
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
