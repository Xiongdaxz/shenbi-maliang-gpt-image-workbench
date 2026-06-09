import { useEffect } from "react";

type TextareaRef = {
  current: HTMLTextAreaElement | null;
};

type UseComposerTextareaAutosizeOptions = {
  draftPrompt: string;
  maxHeight?: number;
  previewCount: number;
  textareaRef: TextareaRef;
};

export function useComposerTextareaAutosize({
  draftPrompt,
  maxHeight = 220,
  previewCount,
  textareaRef
}: UseComposerTextareaAutosizeOptions) {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [draftPrompt, maxHeight, previewCount, textareaRef]);
}
