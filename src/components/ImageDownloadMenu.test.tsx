import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImageDownloadOptions, type ImageDownloadSource } from "./ImageDownloadMenu";
import type { ImageDownloadOption } from "../types";

const options: ImageDownloadOption[] = ["original", "preview", "thumb"].map((variant) => ({
  variant: variant as ImageDownloadOption["variant"], label: variant, description: "fixture", url: `/fixture/${variant}`, downloadName: `fixture-${variant}.png`,
  width: 1024, height: 1536, mimeType: "image/png", fileSize: 2048
}));
function renderOptions(source: ImageDownloadSource, cachedKey: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(cachedKey, { options });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}>
    <ImageDownloadOptions source={source} enabled={false} onDownload={() => undefined} />
  </QueryClientProvider>);
  client.clear();
  return html;
}

describe("shared image download choices", () => {
  test("download choices retain original, preview and thumbnail variants with their metadata", () => {
    const html = renderOptions({ type: "image", id: "a" }, ["image-download-options", "image", "a", ""]);
    expect(html.match(/role="menuitem"/g)?.length).toBe(3);
    expect(html).toContain("原图");
    expect(html).toContain("预览图");
    expect(html).toContain("缩略图");
    expect(html).toContain("1024×1536 · PNG · 2 KB");
  });
  test("choices from another image or source type are not reused", () => {
    expect(renderOptions({ type: "image", id: "b" }, ["image-download-options", "image", "a", ""])).not.toContain('role="menuitem"');
    expect(renderOptions({ type: "asset", id: "a" }, ["image-download-options", "image", "a", ""])).not.toContain('role="menuitem"');
  });
  test("shared download choices remain isolated by share token", () => {
    expect(renderOptions({ type: "shared-image", id: "a", token: "second" }, ["image-download-options", "shared-image", "a", "first"])).not.toContain('role="menuitem"');
  });
});
