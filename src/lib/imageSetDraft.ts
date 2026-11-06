import type { ImageSet, ImageSetInput } from "../types";
import { presentCreativeResponse } from "./creativePresentation";

/** Preserve stored wording when an unchanged field was only simplified for display. */
export function preserveImageSetSource(input: ImageSetInput & { revision?: number }, source: ImageSet): ImageSetInput & { revision?: number } {
  if (input.revision !== source.revision) return input;
  const shown = presentCreativeResponse({ set: source }).set;
  return { ...input, name: input.name === shown.name ? source.name : input.name, brief: input.brief === shown.brief ? source.brief : input.brief,
    items: input.items.map(item => {
      const original = source.items.find(value => value.id === item.id), displayed = shown.items.find(value => value.id === item.id);
      return original && displayed && item.purpose === displayed.purpose ? { ...item, purpose: original.purpose } : item;
    }) };
}
