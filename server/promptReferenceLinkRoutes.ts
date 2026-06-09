import type { Hono } from "hono";
import { requireUser } from "./auth";
import { appDb, getAll, getOne, run } from "./db";
import { makeId, now } from "./utils";

type PromptReferenceLinkRow = {
  id: string;
  title: string;
  url: string;
  thumbnail_url: string;
  metadata_title: string;
  metadata_image_url: string;
  metadata_icon_url: string;
  metadata_fetched_at: string;
  created_at: string;
  updated_at: string;
};

type LinkMetadata = {
  title: string;
  imageUrl: string;
  iconUrl: string;
};

const metadataCache = new Map<string, { expiresAt: number; metadata: LinkMetadata }>();
const METADATA_CACHE_MS = 15 * 60 * 1000;
const METADATA_FETCH_TIMEOUT_MS = 4500;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function attrValue(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? "");
}

function resolveUrl(value: string, baseUrl: string) {
  if (!value.trim()) return "";
  try {
    return new URL(value.trim(), baseUrl).toString();
  } catch {
    return "";
  }
}

function fallbackIconUrl(url: string) {
  try {
    return new URL("/favicon.ico", url).toString();
  } catch {
    return "";
  }
}

function extractMetadata(html: string, url: string): LinkMetadata {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = decodeHtmlEntities(titleMatch?.[1] ?? "");
  let imageUrl = "";
  let iconUrl = "";
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = (attrValue(tag, "property") || attrValue(tag, "name")).toLowerCase();
    const content = attrValue(tag, "content");
    if (!title && (key === "og:title" || key === "twitter:title")) title = content;
    if (!imageUrl && (key === "og:image" || key === "twitter:image" || key === "twitter:image:src")) {
      imageUrl = resolveUrl(content, url);
    }
  }
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = attrValue(tag, "rel").toLowerCase();
    if (!rel.includes("icon")) continue;
    const href = resolveUrl(attrValue(tag, "href"), url);
    if (href) {
      iconUrl = href;
      break;
    }
  }
  return { title, imageUrl, iconUrl: iconUrl || fallbackIconUrl(url) };
}

async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  const cached = metadataCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.metadata;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
  let metadata: LinkMetadata = { title: "", imageUrl: "", iconUrl: fallbackIconUrl(url) };
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 GPT Image Workbench",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && contentType.toLowerCase().includes("text/html")) {
      metadata = extractMetadata(await response.text(), url);
    }
  } catch {
    // Metadata is best-effort; the saved URL should remain usable even if the site blocks fetching.
  } finally {
    clearTimeout(timeoutId);
  }

  metadataCache.set(url, { expiresAt: Date.now() + METADATA_CACHE_MS, metadata });
  return metadata;
}

function fallbackTitle(url: string) {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function storedLinkMetadata(row: PromptReferenceLinkRow): LinkMetadata | null {
  if (!row.metadata_fetched_at) return null;
  return {
    title: row.metadata_title.trim(),
    imageUrl: row.metadata_image_url.trim(),
    iconUrl: row.metadata_icon_url.trim() || fallbackIconUrl(row.url)
  };
}

function storeLinkMetadata(linkId: string, metadata: LinkMetadata, fetchedAt = now()) {
  run(
    appDb,
    `update prompt_reference_links
     set metadata_title = ?, metadata_image_url = ?, metadata_icon_url = ?, metadata_fetched_at = ?
     where id = ?`,
    metadata.title,
    metadata.imageUrl,
    metadata.iconUrl,
    fetchedAt,
    linkId
  );
}

async function ensureStoredLinkMetadata(row: PromptReferenceLinkRow) {
  const stored = storedLinkMetadata(row);
  if (stored) return stored;
  const metadata = await fetchLinkMetadata(row.url);
  storeLinkMetadata(row.id, metadata);
  return metadata;
}

async function publicPromptReferenceLink(row: PromptReferenceLinkRow) {
  const metadata = await ensureStoredLinkMetadata(row);
  const titleOverride = row.title.trim();
  const thumbnailOverride = row.thumbnail_url.trim();
  return {
    id: row.id,
    title: titleOverride || metadata.title || fallbackTitle(row.url),
    titleOverride,
    url: row.url,
    thumbnailUrl: thumbnailOverride || metadata.imageUrl,
    thumbnailUrlOverride: thumbnailOverride,
    iconUrl: metadata.iconUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeHttpUrl(value: unknown, label: string, required = true) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return required ? { error: `请填写${label}` } : { url: "" };
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: `${label}必须是 http 或 https 地址` };
    return { url: parsed.toString() };
  } catch {
    return { error: `${label}格式不正确` };
  }
}

export function registerPromptReferenceLinkRoutes(api: Hono) {
  api.get("/prompt-reference-links", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const rows = getAll<PromptReferenceLinkRow>(
      appDb,
      "select * from prompt_reference_links order by updated_at desc, created_at desc, rowid desc"
    );
    return c.json({ links: await Promise.all(rows.map(publicPromptReferenceLink)) });
  });

  api.post("/prompt-reference-links", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    const normalizedUrl = normalizeHttpUrl(body.url, "链接地址");
    const normalizedThumbnailUrl = normalizeHttpUrl(body.thumbnailUrl, "缩略图地址", false);
    if (normalizedUrl.error) return c.json({ error: normalizedUrl.error }, 400);
    if (normalizedThumbnailUrl.error) return c.json({ error: normalizedThumbnailUrl.error }, 400);
    const linkUrl = normalizedUrl.url!;
    const thumbnailUrl = normalizedThumbnailUrl.url ?? "";

    const timestamp = now();
    const id = makeId("promptlink");
    const metadata = await fetchLinkMetadata(linkUrl);
    run(
      appDb,
      `insert into prompt_reference_links (
        id, title, url, thumbnail_url, metadata_title, metadata_image_url,
        metadata_icon_url, metadata_fetched_at, created_at, updated_at
      )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      linkUrl,
      thumbnailUrl,
      metadata.title,
      metadata.imageUrl,
      metadata.iconUrl,
      timestamp,
      timestamp,
      timestamp
    );
    const link = getOne<PromptReferenceLinkRow>(appDb, "select * from prompt_reference_links where id = ?", id);
    return c.json({ link: await publicPromptReferenceLink(link!) });
  });

  api.patch("/prompt-reference-links/:linkId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const linkId = c.req.param("linkId");
    const existing = getOne<PromptReferenceLinkRow>(appDb, "select * from prompt_reference_links where id = ?", linkId);
    if (!existing) return c.json({ error: "灵感链接不存在" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    const normalizedUrl = normalizeHttpUrl(body.url, "链接地址");
    const normalizedThumbnailUrl = normalizeHttpUrl(body.thumbnailUrl, "缩略图地址", false);
    if (normalizedUrl.error) return c.json({ error: normalizedUrl.error }, 400);
    if (normalizedThumbnailUrl.error) return c.json({ error: normalizedThumbnailUrl.error }, 400);
    const linkUrl = normalizedUrl.url!;
    const thumbnailUrl = normalizedThumbnailUrl.url ?? "";

    const timestamp = now();
    const shouldRefreshMetadata = linkUrl !== existing.url || !existing.metadata_fetched_at;
    const metadata = shouldRefreshMetadata ? await fetchLinkMetadata(linkUrl) : storedLinkMetadata(existing)!;
    run(
      appDb,
      `update prompt_reference_links
       set title = ?, url = ?, thumbnail_url = ?,
           metadata_title = ?, metadata_image_url = ?, metadata_icon_url = ?, metadata_fetched_at = ?,
           updated_at = ?
       where id = ?`,
      title,
      linkUrl,
      thumbnailUrl,
      metadata.title,
      metadata.imageUrl,
      metadata.iconUrl,
      shouldRefreshMetadata ? timestamp : existing.metadata_fetched_at,
      timestamp,
      linkId
    );
    const link = getOne<PromptReferenceLinkRow>(appDb, "select * from prompt_reference_links where id = ?", linkId);
    return c.json({ link: await publicPromptReferenceLink(link!) });
  });

  api.delete("/prompt-reference-links/:linkId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const linkId = c.req.param("linkId");
    const existing = getOne<PromptReferenceLinkRow>(appDb, "select * from prompt_reference_links where id = ?", linkId);
    if (!existing) return c.json({ error: "灵感链接不存在" }, 404);
    run(appDb, "delete from prompt_reference_links where id = ?", linkId);
    metadataCache.delete(existing.url);
    return c.json({ ok: true });
  });
}
