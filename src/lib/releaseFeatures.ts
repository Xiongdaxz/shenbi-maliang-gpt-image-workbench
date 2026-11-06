export const SERIES_CREATION_AVAILABLE = false;

export function isSeriesCreationPath(path: string) {
  return path === "/image-sets" || path.startsWith("/image-sets/");
}
