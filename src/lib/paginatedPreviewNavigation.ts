export type PendingPreviewRequest = {
  index: number;
  sourceKey: string;
  errorUpdateCount: number;
};

export function resolvePendingPreviewRequest(
  pending: PendingPreviewRequest | null,
  options: {
    sourceKey: string;
    itemCount: number;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isFetchNextPageError: boolean;
    errorUpdateCount: number;
  }
) {
  if (!pending) return undefined;
  if (pending.sourceKey !== options.sourceKey) return null;
  if (options.isFetchNextPageError && options.errorUpdateCount > pending.errorUpdateCount) return null;
  if (pending.index < options.itemCount) return pending.index;
  if (!options.hasNextPage && !options.isFetchingNextPage) return null;
  return undefined;
}
