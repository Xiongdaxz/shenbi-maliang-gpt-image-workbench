import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";

const ITEM_COUNT = Math.max(1, Number.parseInt(Bun.env.LIBRARY_BENCHMARK_COUNT ?? "100000", 10));
const SAMPLE_COUNT = Math.max(3, Number.parseInt(Bun.env.LIBRARY_BENCHMARK_SAMPLES ?? "10", 10));
const COLD_SAMPLE_COUNT = Math.max(1, Number.parseInt(Bun.env.LIBRARY_BENCHMARK_COLD_SAMPLES ?? "1", 10));
const benchmarkRoot = await mkdtemp(path.join(tmpdir(), "gpt-image-library-benchmark-"));
let benchmarkAppDb: { close: (throwOnError?: boolean) => void } | null = null;
let benchmarkConfigDb: { close: (throwOnError?: boolean) => void } | null = null;
process.env.GPT_IMAGE_DATA_DIR = benchmarkRoot;
process.env.GPT_IMAGE_APP_DB_PATH = ":memory:";
process.env.GPT_IMAGE_CONFIG_DB_PATH = ":memory:";

function stableId(prefix: string, index: number) {
  return `${prefix}_${String(index).padStart(6, "0")}`;
}

function createdAtFor(index: number) {
  const day = 1 + Math.floor(index / 86_400);
  const seconds = index % 86_400;
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return `2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000`;
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

try {
  const { appDb, configDb } = await import("../server/db");
  benchmarkAppDb = appDb;
  benchmarkConfigDb = configDb;
  const [{ initAppDb }, { registerLibraryRoutes }, { APP_COOKIE }, cursorModule] = await Promise.all([
    import("../server/schema"),
    import("../server/libraryRoutes"),
    import("../server/constants"),
    import("../server/libraryCursor")
  ]);
  initAppDb();
  appDb.exec("pragma synchronous = off");

  const userId = "benchmark-user";
  const sessionId = "benchmark-session";
  const timestamp = "2026-07-20T00:00:00.000";
  appDb.query(`insert into users (id, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?)`)
    .run(userId, userId, "benchmark", timestamp, timestamp);
  appDb.query(`insert into user_auth_sessions (id, user_id, expires_at, created_at) values (?, ?, ?, ?)`)
    .run(sessionId, userId, "2099-01-01T00:00:00.000", timestamp);
  appDb.query(`insert or ignore into case_categories (id, type, name, slug, sort_order) values ('benchmark-case-category', 'case', 'Benchmark', 'benchmark', 1)`).run();

  const imageInsert = appDb.query(`
    insert into images (
      id, user_id, session_id, path, prompt, kind, size, quality, provider_id,
      image_width, image_height, image_file_size, created_at
    ) values (?, ?, ?, ?, ?, 'generation', '1024x1024', 'high', 'benchmark', 1024, 1024, 250000, ?)
  `);
  const assetInsert = appDb.query(`
    insert into assets (
      id, user_id, space, shared, share_status, name, path, mime_type, size,
      image_width, image_height, created_at
    ) values (?, ?, 'private', 0, 'none', ?, ?, 'image/png', 250000, 1024, 1024, ?)
  `);
  const caseInsert = appDb.query(`
    insert into case_items (
      id, group_id, category_id, user_id, include_references, review_status,
      title, prompt, image_url, created_at
    ) values (?, ?, 'benchmark-case-category', ?, 1, 'approved', ?, ?, ?, ?)
  `);
  const seed = appDb.transaction(() => {
    for (let index = 0; index < ITEM_COUNT; index += 1) {
      const createdAt = createdAtFor(index);
      imageInsert.run(stableId("image", index), userId, "benchmark-image-session", `benchmark/image/${index}.png`, `benchmark image ${index}`, createdAt);
      assetInsert.run(stableId("asset", index), userId, `benchmark asset ${index}`, `benchmark/asset/${index}.png`, createdAt);
      caseInsert.run(
        stableId("case", index),
        stableId("case-group", index),
        userId,
        `benchmark case ${index}`,
        `benchmark prompt ${index}`,
        `https://example.invalid/${index}.png`,
        createdAt
      );
    }
  });
  const seedStartedAt = performance.now();
  seed();
  const seedDurationMs = performance.now() - seedStartedAt;

  const app = new Hono();
  registerLibraryRoutes(app);
  const headers = { Cookie: `${APP_COOKIE}=${sessionId}` };
  async function request(pathname: string) {
    const startedAt = performance.now();
    const response = await app.request(pathname, { headers });
    const body = await response.text();
    if (!response.ok) throw new Error(`${pathname} failed with ${response.status}: ${body.slice(0, 200)}`);
    return { durationMs: performance.now() - startedAt, bytes: Buffer.byteLength(body), body };
  }
  async function samples(pathname: string) {
    await request(pathname);
    const values = [];
    let bytes = 0;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const result = await request(pathname);
      values.push(result.durationMs);
      bytes = result.bytes;
    }
    return { p95Ms: Number(percentile95(values).toFixed(1)), bytes };
  }
  async function coldSamples(pathname: string) {
    const values = [];
    let bytes = 0;
    for (let index = 0; index < COLD_SAMPLE_COUNT; index += 1) {
      const separator = pathname.includes("?") ? "&" : "?";
      const result = await request(`${pathname}${separator}keyword=${encodeURIComponent(`__cold_facet_${index}__`)}`);
      values.push(result.durationMs);
      bytes = result.bytes;
    }
    return { p95Ms: Number(percentile95(values).toFixed(1)), bytes };
  }

  const deepIndex = Math.max(0, Math.floor(ITEM_COUNT * 0.1));
  const imageCursor = cursorModule.encodeLibraryCursor({
    kind: "images",
    signature: cursorModule.libraryFilterSignature("images", { keyword: "", favoriteOnly: false, sessionId: "", anchorId: "", sort: "desc" }),
    sort: "desc",
    createdAt: createdAtFor(deepIndex),
    id: stableId("image", deepIndex)
  });
  const assetCursor = cursorModule.encodeLibraryCursor({
    kind: "assets",
    signature: cursorModule.libraryFilterSignature("assets", { keyword: "", categoryIds: [], space: "all" }),
    sort: "desc",
    createdAt: createdAtFor(deepIndex),
    id: stableId("asset", deepIndex)
  });
  const caseCursor = cursorModule.encodeLibraryCursor({
    kind: "cases",
    signature: cursorModule.libraryFilterSignature("cases", { keyword: "", categoryIds: [], mineOnly: false, favoriteOnly: false }),
    sort: "desc",
    createdAt: createdAtFor(deepIndex),
    id: stableId("case-group", deepIndex)
  });
  const anchorIndex = Math.floor(ITEM_COUNT / 2);
  const anchorId = stableId("image", anchorIndex);
  const [olderAnchorResult, newerAnchorResult] = await Promise.all([
    request(`/library/images?limit=15&sessionId=benchmark-image-session&anchorId=${encodeURIComponent(anchorId)}&sort=desc`),
    request(`/library/images?limit=15&sessionId=benchmark-image-session&anchorId=${encodeURIComponent(anchorId)}&sort=asc`)
  ]);
  const olderAnchorPage = JSON.parse(olderAnchorResult.body) as { items: Array<{ id: string }> };
  const newerAnchorPage = JSON.parse(newerAnchorResult.body) as { items: Array<{ id: string }> };
  if (olderAnchorPage.items[0]?.id !== anchorId || newerAnchorPage.items[0]?.id !== anchorId) {
    throw new Error("bidirectional image anchor pages must both start from the requested image");
  }
  if (anchorIndex > 0 && olderAnchorPage.items[1]?.id !== stableId("image", anchorIndex - 1)) {
    throw new Error("descending image anchor page skipped the immediate older image");
  }
  if (anchorIndex + 1 < ITEM_COUNT && newerAnchorPage.items[1]?.id !== stableId("image", anchorIndex + 1)) {
    throw new Error("ascending image anchor page skipped the immediate newer image");
  }

  const results = {
    itemCountPerLibrary: ITEM_COUNT,
    samples: SAMPLE_COUNT,
    coldSamples: COLD_SAMPLE_COUNT,
    seedDurationMs: Number(seedDurationMs.toFixed(1)),
    lists: {
      images: await samples("/library/images?limit=30"),
      assets: await samples("/library/assets?limit=30"),
      cases: await samples("/library/cases?limit=30")
    },
    deepCursor: {
      images: await samples(`/library/images?limit=30&cursor=${encodeURIComponent(imageCursor)}`),
      assets: await samples(`/library/assets?limit=30&cursor=${encodeURIComponent(assetCursor)}`),
      cases: await samples(`/library/cases?limit=30&cursor=${encodeURIComponent(caseCursor)}`)
    },
    hotFacets: {
      images: await samples("/library/images/facets"),
      assets: await samples("/library/assets/facets"),
      cases: await samples("/library/cases/facets")
    },
    coldFacets: {
      images: await coldSamples("/library/images/facets"),
      assets: await coldSamples("/library/assets/facets"),
      cases: await coldSamples("/library/cases/facets")
    }
  };
  console.log(JSON.stringify(results, null, 2));

  for (const result of Object.values(results.lists)) {
    if (result.bytes > 150_000) throw new Error(`card payload exceeded 150KB: ${result.bytes}`);
    if (result.p95Ms > 250) throw new Error(`hot list p95 exceeded 250ms: ${result.p95Ms}`);
  }
  for (const result of Object.values(results.deepCursor)) {
    if (result.p95Ms > 250) throw new Error(`deep cursor p95 exceeded 250ms: ${result.p95Ms}`);
  }
  for (const result of Object.values(results.hotFacets)) {
    if (result.p95Ms > 400) throw new Error(`facet p95 exceeded 400ms: ${result.p95Ms}`);
  }

} catch (error) {
  console.error("library benchmark failed before cleanup", error);
  throw error;
} finally {
  try { benchmarkAppDb?.close(); } catch { /* released when the benchmark process exits */ }
  try { benchmarkConfigDb?.close(); } catch { /* released when the benchmark process exits */ }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(benchmarkRoot, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`temporary benchmark directory will be left for OS cleanup: ${benchmarkRoot}`, error);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
