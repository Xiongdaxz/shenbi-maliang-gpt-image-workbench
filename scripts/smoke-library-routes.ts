import { Hono } from "hono";
import { registerCaseRoutes } from "../server/caseRoutes";
import { registerLibraryRoutes } from "../server/libraryRoutes";
import { appDb, getOne } from "../server/db";
import { APP_COOKIE } from "../server/constants";
import { utcNow } from "../server/utils";

const session = getOne<{ id: string }>(
  appDb,
  "select id from user_auth_sessions where expires_at > ? order by created_at desc limit 1",
  utcNow()
);

if (!session) {
  if (Bun.env.SMOKE_ALLOW_SKIP === "1") {
    console.log("没有可用的登录会话，按 SMOKE_ALLOW_SKIP=1 跳过图库路由冒烟测试");
    process.exit(0);
  }
  throw new Error("没有可用的登录会话；如需显式跳过，请设置 SMOKE_ALLOW_SKIP=1");
}

const app = new Hono();
registerLibraryRoutes(app);
registerCaseRoutes(app);
const headers = { Cookie: `${APP_COOKIE}=${session.id}` };
const baseUrl = String(Bun.env.SMOKE_BASE_URL ?? "").replace(/\/$/, "");

type SmokeResult = { path: string; status: number; body: string; data: unknown };

async function smokeRequest(path: string, expectedStatus = 200): Promise<SmokeResult> {
  const startedAt = performance.now();
  const response = baseUrl
    ? await fetch(`${baseUrl}/api${path}`, { headers })
    : await app.request(path, { headers });
  const body = await response.text();
  console.log(JSON.stringify({
    path,
    status: response.status,
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    bytes: Buffer.byteLength(body),
    serverTiming: response.headers.get("server-timing"),
    preview: body.slice(0, 120)
  }));
  if (response.status !== expectedStatus) throw new Error(`${path} expected ${expectedStatus}, received ${response.status}`);
  return { path, status: response.status, body, data: body ? JSON.parse(body) : null };
}

const initialResults = new Map<string, SmokeResult>();
for (const path of [
  "/library/images?limit=30",
  "/library/images/facets",
  "/library/assets?limit=30",
  "/library/assets/facets",
  "/library/cases?limit=30",
  "/library/cases/facets",
  "/cases/categories",
  "/cases/starter?limit=10"
]) {
  initialResults.set(path, await smokeRequest(path));
}

type SmokePageItem = { id: string; title?: string; categoryIds?: string[]; categoryNames?: string[]; [key: string]: unknown };
type SmokePage = { items: SmokePageItem[]; pageInfo: { limit: number; nextCursor: string | null; hasMore: boolean } };

for (const path of ["/library/images?limit=30", "/library/assets?limit=30", "/library/cases?limit=30"]) {
  const result = initialResults.get(path)!;
  const page = result.data as SmokePage;
  if (page.items.length > 30) throw new Error(`${path} returned more than 30 items`);
  if (Buffer.byteLength(result.body) > 150_000) throw new Error(`${path} exceeded the 150KB card payload target`);
  for (const item of page.items) {
    if ("originalUrl" in item || "previewUrl" in item || "referenceImages" in item || "images" in item) {
      throw new Error(`${path} leaked detail-only fields`);
    }
  }
}

const casePage = initialResults.get("/library/cases?limit=30")!.data as SmokePage;
const allCaseItems = [...casePage.items];
if (casePage.pageInfo.hasMore && casePage.pageInfo.nextCursor) {
  let cursor: string | null = casePage.pageInfo.nextCursor;
  let pageCount = 1;
  while (cursor) {
    const next = await smokeRequest(`/library/cases?limit=30&cursor=${encodeURIComponent(cursor)}`);
    const nextPage = next.data as SmokePage;
    const loadedIds = new Set(allCaseItems.map((item) => item.id));
    if (nextPage.items.some((item) => loadedIds.has(item.id))) throw new Error("case cursor pages contain duplicate groups");
    allCaseItems.push(...nextPage.items);
    cursor = nextPage.pageInfo.hasMore ? nextPage.pageInfo.nextCursor : null;
    pageCount += 1;
    if (pageCount > 2_000) throw new Error("case cursor smoke exceeded 2000 pages");
  }
  await smokeRequest(`/library/cases?limit=30&keyword=cursor-scope-change&cursor=${encodeURIComponent(casePage.pageInfo.nextCursor)}`, 400);
}

const legacyItemsById = new Map<string, SmokePageItem>();
let legacyOffset = 0;
for (let pageIndex = 0; pageIndex < 2_000; pageIndex += 1) {
  const legacy = await smokeRequest(`/cases?limit=120&offset=${legacyOffset}`);
  const legacyData = legacy.data as {
    categories?: Array<{ items?: SmokePageItem[] }>;
    pageInfo?: { limit?: number; hasMore?: boolean };
  };
  for (const item of legacyData.categories?.flatMap((category) => category.items ?? []) ?? []) {
    legacyItemsById.set(String(item.groupId ?? item.id), item);
  }
  if (!legacyData.pageInfo?.hasMore) break;
  legacyOffset += Number(legacyData.pageInfo.limit ?? 120);
  if (pageIndex === 1_999) throw new Error("legacy case smoke exceeded 2000 pages");
}
const legacyItems = Array.from(legacyItemsById.values());
const libraryIds = new Set(allCaseItems.map((item) => item.id));
const legacyIds = new Set(legacyItems.map((item) => String(item.groupId ?? item.id)));
if (libraryIds.size !== legacyIds.size || [...libraryIds].some((id) => !legacyIds.has(id))) {
  throw new Error(`library/legacy case group mismatch: library=${libraryIds.size}, legacy=${legacyIds.size}`);
}
for (const item of allCaseItems) {
  const legacyItem = legacyItemsById.get(item.id);
  for (const field of ["useCount", "favoriteCount", "favorited", "imageCount", "downloadSourceType", "downloadSourceId"] as const) {
    if (legacyItem?.[field] !== item[field]) throw new Error(`library/legacy case ${field} mismatch for ${item.id}`);
  }
}

const caseKeyword = casePage.items.find((item) => item.categoryNames?.[0])?.categoryNames?.[0]
  ?? casePage.items.find((item) => item.title)?.title
  ?? "smoke-no-match";
await smokeRequest(`/library/cases?limit=30&keyword=${encodeURIComponent(caseKeyword)}&favoriteOnly=true`);
await smokeRequest(`/library/cases/facets?keyword=${encodeURIComponent(caseKeyword)}`);

const assetPage = initialResults.get("/library/assets?limit=30")!.data as SmokePage;
const assetCategoryId = assetPage.items.find((item) => item.categoryIds?.[0])?.categoryIds?.[0];
if (assetCategoryId) await smokeRequest(`/library/assets?limit=30&categoryIds=${encodeURIComponent(assetCategoryId)}`);
const assetFacets = initialResults.get("/library/assets/facets")!.data as { spaces?: { shared?: number } };
if ((assetFacets.spaces?.shared ?? 0) > 0) {
  const sharedLabelResult = await smokeRequest(`/library/assets?limit=30&keyword=${encodeURIComponent("共享")}`);
  if ((sharedLabelResult.data as SmokePage).items.length === 0) throw new Error("shared asset label search returned no results");
}

const starter = initialResults.get("/cases/starter?limit=10")!.data as { items: SmokePageItem[] };
if (starter.items.length > 10) throw new Error("starter endpoint returned more than 10 items");
if (starter.items.length > 0 && allCaseItems.length - starter.items.length >= 10) {
  const starterIds = starter.items.map((item) => item.id);
  const refreshedStarter = await smokeRequest(
    `/cases/starter?limit=10&excludeIds=${encodeURIComponent(JSON.stringify(starterIds))}`
  );
  const refreshedItems = (refreshedStarter.data as { items: SmokePageItem[] }).items;
  const previousIds = new Set(starterIds);
  if (refreshedItems.some((item) => previousIds.has(item.id))) {
    throw new Error("starter refresh repeated an excluded inspiration group despite enough alternatives");
  }
}
