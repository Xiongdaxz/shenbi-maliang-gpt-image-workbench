import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImageCompareViewport } from "./ImageCompareViewport";
import type { WorkImage } from "../../types";

test("comparison actually selects a different image source and header on preview/original switch", () => {
  const image = { id: "a", url: "/original.png", originalUrl: "/original.png", previewUrl: "/preview.webp", imageWidth: 2048, imageHeight: 3072, imageFileSize: 3_500_000 } as WorkImage;
  const client = new QueryClient();
  client.setQueryData(["image-download-options", "image", "a", ""], { options: [{ variant: "preview", url: image.previewUrl, width: 1067, height: 1600, fileSize: 118_400 }] });
  const noop = () => undefined;
  const render = (wantsOriginal: boolean) => renderToStaticMarkup(<QueryClientProvider client={client}>
    <ImageCompareViewport id="a" label="A" image={image} active view={{ mode: "actual", zoom: 1.3, u: .6, v: .4 }} loading={false} unavailable={false} error={false}
      firstRow lastRow firstColumn favoritePending={false} original={{ status: "ready", src: "blob:original-a", width: 2048, height: 3072, fileSize: 3_510_000 }}
      wantsOriginal={wantsOriginal} wheelMode="pan" onActivate={noop} onReveal={noop} onFavorite={noop} onRetry={noop} onOriginalRetry={noop}
      onGeometry={noop} onDisplayedResource={noop} onZoomBy={noop} onZoomStep={noop} onToggleView={noop} onPan={noop} onCommit={noop} onDragChange={noop}
      infoOpen={false} onInfoOpen={noop} onInfoLeave={noop} />
  </QueryClientProvider>);
  const full = render(true), preview = render(false);
  expect(full).toContain('src="blob:original-a"');
  expect(preview).toContain('src="/preview.webp"');
  expect(preview).not.toContain('src="blob:original-a"');
  expect(full).toContain("2048 × 3072");
  expect(preview).toContain("1067 × 1600");
  expect(full).toContain("3.35M");
  expect(preview).toContain("115.6K");
  const fullLayout = full.match(/style="(width:2662\.4px;[^\"]*);opacity:/)?.[1];
  const previewLayout = preview.match(/style="(width:2662\.4px;[^\"]*);opacity:/)?.[1];
  expect(fullLayout).toBeDefined();
  expect(previewLayout).toBe(fullLayout);
  client.clear();
});
