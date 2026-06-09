const EXTERNAL_ASSET_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

export function publicAssetPath(path: string) {
  if (!path || EXTERNAL_ASSET_PATTERN.test(path)) return path;
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path.replace(/^\/+/, "")}`;
}
