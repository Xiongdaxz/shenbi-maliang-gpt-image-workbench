import { createContext, useContext } from "react";
import { Columns2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n";
import { initialCompareImageIds } from "../../lib/imageCompare";
import { useImageCompare } from "../../store/imageCompare";
import type { WorkImage } from "../../types";

export const ImageCompareResultsContext = createContext<string[]>([]);

export function ImageCompareButton({ image, groupImages = [] }: { image: WorkImage; groupImages?: WorkImage[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const resultIds = useContext(ImageCompareResultsContext);
  return <button type="button" aria-label={t("compare.title")} data-tooltip={t("compare.title")} onClick={() => {
    const comparison = useImageCompare.getState();
    const ids = initialCompareImageIds(image.id, groupImages.map((item) => item.id), resultIds);
    comparison.start(ids);
    if (useImageCompare.getState().draft?.imageIds[0] !== image.id) return;
    navigate("/images/compare", { state: { imageCompareFromChat: true } });
  }}><Columns2 size={17} /></button>;
}
