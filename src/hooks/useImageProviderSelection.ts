import { useEffect, useMemo, useState } from "react";
import { buildSizeOptions } from "../lib/imageOptions";
import type { ProviderConfig } from "../types";

export function useImageProviderSelection(providerOptions: ProviderConfig[]) {
  const [providerId, setProviderId] = useState("");
  const [size, setSize] = useState("");
  const currentProvider = useMemo(() => {
    return providerOptions.find((item) => item.id === providerId) ?? providerOptions[0];
  }, [providerId, providerOptions]);
  const sizeOptions = useMemo(() => buildSizeOptions(currentProvider?.sizes ?? []), [currentProvider]);

  useEffect(() => {
    if (!currentProvider) return;
    if (providerId !== currentProvider.id) setProviderId(currentProvider.id);
    setSize((value) => (!value || sizeOptions.some((item) => item.value === value) ? value : ""));
  }, [currentProvider, providerId, sizeOptions]);

  return {
    currentProvider,
    providerId,
    setProviderId,
    setSize,
    size,
    sizeOptions
  };
}
