import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageEditorOpenRequest } from "../store/workbench";
import { newestWorkImages, uniqueWorkImages, workImageFromMessage } from "../lib/workImages";
import type { AssetItem, Message, WorkImage } from "../types";
import type { ImageEditorState } from "../components/ImageEditWorkspace";

type UseImageEditorLauncherOptions = {
  editorImageRequest: ImageEditorOpenRequest | null;
  messageList: Message[];
  setEditorImageRequest: (request: ImageEditorOpenRequest | null) => void;
  setMaterialPickerOpen: (open: boolean) => void;
  setSelectedAssets: (assets: AssetItem[]) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

type CloseImageEditorOptions = {
  restoreSidebar?: boolean;
};

export function useImageEditorLauncher({
  editorImageRequest,
  messageList,
  setEditorImageRequest,
  setMaterialPickerOpen,
  setSelectedAssets,
  setSidebarCollapsed
}: UseImageEditorLauncherOptions) {
  const [imageEditor, setImageEditor] = useState<ImageEditorState | null>(null);
  const handledEditorRequestRef = useRef<ImageEditorOpenRequest | null>(null);
  const editorImages = useMemo(
    () => uniqueWorkImages(messageList.filter((message) => message.role === "assistant").map(workImageFromMessage).filter(Boolean) as WorkImage[]),
    [messageList]
  );

  useEffect(() => {
    if (!editorImageRequest) {
      handledEditorRequestRef.current = null;
      return;
    }
    if (handledEditorRequestRef.current === editorImageRequest) return;
    handledEditorRequestRef.current = editorImageRequest;
    const requestImage = editorImageRequest.image;
    const requestImages =
      editorImageRequest.images && editorImageRequest.images.length > 0
        ? newestWorkImages(uniqueWorkImages([requestImage, ...editorImageRequest.images]))
        : editorImages.some((item) => item.id === requestImage.id)
          ? editorImages
          : [requestImage, ...editorImages];
    setSidebarCollapsed(true);
    if (!editorImageRequest.preserveSelectedAssets) setSelectedAssets([]);
    setMaterialPickerOpen(false);
    setImageEditor({
      images: requestImages,
      activeImageId: requestImage.id,
      initialPrompt: editorImageRequest.initialPrompt,
      discardDraftOnClose: editorImageRequest.discardDraftOnClose
    });
    if (!editorImageRequest.persistAcrossSessionChange) setEditorImageRequest(null);
  }, [editorImageRequest, editorImages, setEditorImageRequest, setMaterialPickerOpen, setSelectedAssets, setSidebarCollapsed]);

  const openImageEditor = (image: WorkImage) => {
    setSidebarCollapsed(true);
    setSelectedAssets([]);
    setMaterialPickerOpen(false);
    setImageEditor({
      images: editorImages.some((item) => item.id === image.id) ? editorImages : [image, ...editorImages],
      activeImageId: image.id
    });
  };

  const closeImageEditor = useCallback((options: CloseImageEditorOptions = {}) => {
    const { restoreSidebar = true } = options;
    setImageEditor(null);
    handledEditorRequestRef.current = null;
    setEditorImageRequest(null);
    if (restoreSidebar) setSidebarCollapsed(false);
  }, [setEditorImageRequest, setSidebarCollapsed]);

  return { closeImageEditor, imageEditor, openImageEditor };
}
