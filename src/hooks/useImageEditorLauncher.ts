import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageEditorOpenRequest, ImageLibraryContinuation } from "../store/workbench";
import { orderedWorkImages, uniqueWorkImages, workImageFromMessage } from "../lib/workImages";
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
    const requestImageSort = editorImageRequest.imageSort ?? "asc";
    const requestImages =
      editorImageRequest.images && editorImageRequest.images.length > 0
        ? orderedWorkImages(uniqueWorkImages([requestImage, ...editorImageRequest.images]), requestImageSort)
        : editorImages.some((item) => item.id === requestImage.id)
          ? orderedWorkImages(editorImages, requestImageSort)
          : orderedWorkImages([requestImage, ...editorImages], requestImageSort);
    setSidebarCollapsed(true);
    if (!editorImageRequest.preserveSelectedAssets) setSelectedAssets([]);
    setMaterialPickerOpen(false);
    setImageEditor({
      images: requestImages,
      activeImageId: requestImage.id,
      imageSort: requestImageSort,
      totalImageCount: editorImageRequest.totalImageCount,
      libraryContinuations: editorImageRequest.libraryContinuations,
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
      activeImageId: image.id,
      imageSort: "asc",
      totalImageCount: editorImages.some((item) => item.id === image.id) ? editorImages.length : editorImages.length + 1
    });
  };

  const closeImageEditor = useCallback((options: CloseImageEditorOptions = {}) => {
    const { restoreSidebar = true } = options;
    setImageEditor(null);
    handledEditorRequestRef.current = null;
    setEditorImageRequest(null);
    if (restoreSidebar) setSidebarCollapsed(false);
  }, [setEditorImageRequest, setSidebarCollapsed]);

  const mergeImageEditorImages = useCallback((
    images: WorkImage[],
    pagination?: {
      direction: "newer" | "older";
      expectedCursor: string;
      continuation: ImageLibraryContinuation;
    }
  ) => {
    setImageEditor((current) => {
      if (!current) return current;
      if (pagination && current.libraryContinuations?.[pagination.direction]?.nextCursor !== pagination.expectedCursor) return current;
      const incomingById = new Map(images.map((image) => [image.id, image]));
      const currentIds = new Set(current.images.map((image) => image.id));
      if (!pagination && !images.some((image) => currentIds.has(image.id))) return current;
      const mergedImages = orderedWorkImages([
        ...current.images.map((image) => incomingById.get(image.id) ?? image),
        ...images.filter((image) => !currentIds.has(image.id))
      ], current.imageSort);
      return {
        ...current,
        images: mergedImages,
        libraryContinuations: pagination
          ? { ...current.libraryContinuations, [pagination.direction]: pagination.continuation }
          : current.libraryContinuations
      };
    });
  }, []);

  return { closeImageEditor, imageEditor, mergeImageEditorImages, openImageEditor };
}
