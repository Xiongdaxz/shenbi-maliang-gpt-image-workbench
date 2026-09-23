export function staticAssetCacheControl(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (normalizedPath.endsWith("/index.html") || normalizedPath === "index.html") return "no-store";
  if (normalizedPath.includes("/assets/") || normalizedPath.startsWith("assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "";
}
