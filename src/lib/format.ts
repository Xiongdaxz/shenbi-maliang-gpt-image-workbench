export function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatImageFileSize(value: number | null | undefined) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.?0+$/, "")}K`;
  }
  return `${Math.round(bytes)}B`;
}
