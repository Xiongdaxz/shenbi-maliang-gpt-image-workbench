function imageExtensionFromMime(mimeType: string) {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.toLowerCase();
  if (!subtype) return "png";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype;
}

function namedClipboardImageFile(file: File) {
  if (file.name) return file;
  const extension = imageExtensionFromMime(file.type || "image/png");
  return new File([file], `pasted-image-${Date.now()}.${extension}`, { type: file.type || "image/png" });
}

export function getClipboardImageFile(data: DataTransfer) {
  const file = Array.from(data.files).find((item) => item.type.startsWith("image/"));
  if (file) return namedClipboardImageFile(file);

  const item = Array.from(data.items).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
  const itemFile = item?.getAsFile();
  return itemFile ? namedClipboardImageFile(itemFile) : null;
}
