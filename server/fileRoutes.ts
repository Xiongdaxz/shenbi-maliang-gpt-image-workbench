import type { Context, Hono } from "hono";
import { isConfigAuthed, requireUser } from "./auth";
import { appDb, getOne } from "./db";
import { getOrCreateImageDerivative, normalizeImageVariant, type ImageDerivativeSourceType } from "./imageDerivatives";
import { imageExtensionFromMime, mimeTypeFromPath } from "./imageFiles";
import { readStoredFile } from "./secureFiles";
import type { AssetRow, ImageAssetReferenceRow, ImageRow, MessageSourceReferenceRow, UserRow } from "./types";
import { createHash } from "node:crypto";
import { approvedCaseSql, reviewableCaseSql, reviewableSharedAssetSql, visibleAssetSql } from "./utils";

type DownloadOptionVariant = "thumb" | "preview" | "original";

type DownloadSource = {
  sourceType: ImageDerivativeSourceType;
  sourceId: string;
  path: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  nameSeed: string;
  fallbackName: string;
};

const DOWNLOAD_VARIANTS: Array<{
  variant: DownloadOptionVariant;
  label: string;
  description: string;
  suffix: string;
}> = [
  { variant: "thumb", label: "缩略图", description: "WebP，小文件", suffix: "缩略图" },
  { variant: "preview", label: "预览图", description: "WebP，快速查看", suffix: "预览图" },
  { variant: "original", label: "原图", description: "保留原格式和最高质量", suffix: "原图" }
];

function downloadUrl(sourceType: ImageDerivativeSourceType, sourceId: string, variant: DownloadOptionVariant) {
  const collection =
    sourceType === "image"
      ? "images"
      : sourceType === "asset"
        ? "assets"
        : sourceType === "message-source-reference"
          ? "message-source-references"
          : "image-references";
  const baseUrl = `/api/files/${collection}/${encodeURIComponent(sourceId)}`;
  return variant === "original" ? baseUrl : `${baseUrl}?variant=${variant}`;
}

function sanitizeDownloadBaseName(value: string, fallback: string) {
  const clean = (value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\.(png|jpe?g|webp|avif)$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return clean || fallback;
}

function downloadName(source: DownloadSource, suffix: string, mimeType: string) {
  const baseName = sanitizeDownloadBaseName(source.nameSeed, source.fallbackName);
  const extension = imageExtensionFromMime(mimeType || source.mimeType || mimeTypeFromPath(source.path));
  return `${baseName}-${suffix}.${extension}`;
}

async function downloadOptionForVariant(source: DownloadSource, variant: DownloadOptionVariant) {
  const config = DOWNLOAD_VARIANTS.find((item) => item.variant === variant)!;
  if (variant === "original") {
    const mimeType = source.mimeType || mimeTypeFromPath(source.path);
    return {
      variant,
      label: config.label,
      description: config.description,
      url: downloadUrl(source.sourceType, source.sourceId, variant),
      downloadName: downloadName(source, config.suffix, mimeType),
      mimeType,
      fileSize: source.fileSize || 0,
      width: source.width || 0,
      height: source.height || 0
    };
  }
  const derivative = await getOrCreateImageDerivative(
    { sourceType: source.sourceType, sourceId: source.sourceId, path: source.path },
    variant
  );
  return {
    variant,
    label: config.label,
    description: config.description,
    url: downloadUrl(source.sourceType, source.sourceId, variant),
    downloadName: downloadName(source, config.suffix, derivative.mimeType),
    mimeType: derivative.mimeType,
    fileSize: derivative.size || 0,
    width: derivative.width || 0,
    height: derivative.height || 0
  };
}

async function imageDownloadOptions(source: DownloadSource) {
  const options = [];
  for (const config of DOWNLOAD_VARIANTS) {
    options.push(await downloadOptionForVariant(source, config.variant));
  }
  return options;
}

function imageResponse(buffer: Buffer, mimeType: string) {
  const etag = `"${createHash("sha1").update(buffer).digest("base64url").slice(0, 20)}"`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType || "image/png",
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "ETag": etag,
      "Vary": "Cookie"
    }
  });
}

function imageCaseAccessSql(statusSql: string) {
  return `(
    exists (select 1 from case_items where case_items.image_id = images.id and ${statusSql})
    or exists (
      select 1
      from case_group_images
      join case_items on case_items.group_id = case_group_images.group_id
      where case_group_images.image_id = images.id
        and ${statusSql}
    )
  )`;
}

function referenceCaseAccessSql(statusSql: string) {
  return `(
    exists (select 1 from case_items where case_items.image_id = image_asset_references.image_id and ${statusSql})
    or exists (
      select 1
      from case_group_images
      join case_items on case_items.group_id = case_group_images.group_id
      where case_group_images.image_id = image_asset_references.image_id
        and ${statusSql}
    )
  )`;
}

function assetCaseAccessSql(statusSql: string) {
  return `(
    exists (select 1 from case_items where case_items.asset_id = assets.id and ${statusSql})
    or exists (
      select 1
      from case_group_images
      join case_items on case_items.group_id = case_group_images.group_id
      where case_group_images.asset_id = assets.id
        and ${statusSql}
    )
  )`;
}

async function assetForFileAccess(c: Context) {
  const user = await requireUser(c);
  const configAuthed = isConfigAuthed(c);
  if (!user && !configAuthed) return { asset: null, unauthorized: true };
  const visibilityClauses: string[] = [];
  const params: Array<string | number> = [String(c.req.param("assetId") ?? "")];
  if (user) {
    visibilityClauses.push(visibleAssetSql("assets"));
    params.push(user.id);
    visibilityClauses.push(assetCaseAccessSql(approvedCaseSql("case_items")));
    visibilityClauses.push(assetCaseAccessSql("case_items.user_id = ?"));
    params.push(user.id, user.id);
  }
  if (configAuthed) visibilityClauses.push(reviewableSharedAssetSql("assets"));
  if (configAuthed) visibilityClauses.push(assetCaseAccessSql(reviewableCaseSql("case_items")));
  const asset = getOne<AssetRow>(
    appDb,
    `select *
     from assets
     where id = ?
       and (
         ${visibilityClauses.join(" or ")}
       )`,
    ...params
  );
  return { asset, unauthorized: false };
}

async function storedImageResponse(
  sourceType: ImageDerivativeSourceType,
  sourceId: string,
  path: string,
  mimeType: string,
  variantQuery: unknown
) {
  const variant = normalizeImageVariant(variantQuery);
  if (variant !== "original") {
    try {
      const derivative = await getOrCreateImageDerivative({ sourceType, sourceId, path }, variant);
      return imageResponse(derivative.buffer, derivative.mimeType);
    } catch (error) {
      console.warn("图片派生图读取失败，回退原图", sourceType, sourceId, variant, error);
    }
  }
  try {
    return imageResponse(await readStoredFile(path), mimeType || mimeTypeFromPath(path));
  } catch (error) {
    console.warn("图片文件读取失败", path, error);
    return null;
  }
}

export function registerFileRoutes(api: Hono) {
  api.get("/files/user-avatar/:userId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (c.req.param("userId") !== user.id) return c.json({ error: "头像不存在" }, 404);
    const row = getOne<Pick<UserRow, "avatar_path" | "avatar_mime_type">>(
      appDb,
      "select avatar_path, avatar_mime_type from users where id = ?",
      user.id
    );
    if (!row?.avatar_path) return c.json({ error: "头像不存在" }, 404);
    try {
      return imageResponse(await readStoredFile(row.avatar_path), row.avatar_mime_type || "image/png");
    } catch (error) {
      console.warn("用户头像读取失败", user.id, error);
      return c.json({ error: "头像文件不存在" }, 404);
    }
  });

  api.get("/files/images/:imageId/download-options", async (c) => {
    const user = await requireUser(c);
    const configAuthed = isConfigAuthed(c);
    if (!user && !configAuthed) return c.json({ error: "未登录" }, 401);
    const visibilityClauses: string[] = [];
    const params: Array<string | number> = [c.req.param("imageId")];
    if (user) {
      visibilityClauses.push("user_id = ?");
      params.push(user.id);
    }
    visibilityClauses.push(imageCaseAccessSql(approvedCaseSql("case_items")));
    if (configAuthed) visibilityClauses.push(imageCaseAccessSql(reviewableCaseSql("case_items")));
    const image = getOne<ImageRow>(
      appDb,
      `select *
       from images
       where id = ?
         and (
           ${visibilityClauses.join(" or ")}
         )`,
      ...params
    );
    if (!image) return c.json({ error: "图片不存在" }, 404);
    try {
      return c.json({
        options: await imageDownloadOptions({
          sourceType: "image",
          sourceId: image.id,
          path: image.path,
          mimeType: image.mime_type,
          fileSize: image.image_file_size,
          width: image.image_width,
          height: image.image_height,
          nameSeed: image.prompt,
          fallbackName: "图片"
        })
      });
    } catch (error) {
      console.warn("图片下载选项读取失败", image.id, error);
      return c.json({ error: "图片文件不存在" }, 404);
    }
  });

  api.get("/files/assets/:assetId/download-options", async (c) => {
    const { asset, unauthorized } = await assetForFileAccess(c);
    if (unauthorized) return c.json({ error: "未登录" }, 401);
    if (!asset) return c.json({ error: "素材不存在" }, 404);
    try {
      return c.json({
        options: await imageDownloadOptions({
          sourceType: "asset",
          sourceId: asset.id,
          path: asset.path,
          mimeType: asset.mime_type,
          fileSize: asset.size,
          width: asset.image_width,
          height: asset.image_height,
          nameSeed: asset.name,
          fallbackName: "素材图片"
        })
      });
    } catch (error) {
      console.warn("素材下载选项读取失败", asset.id, error);
      return c.json({ error: "素材文件不存在" }, 404);
    }
  });

  api.get("/files/image-references/:referenceId/download-options", async (c) => {
    const user = await requireUser(c);
    const configAuthed = isConfigAuthed(c);
    if (!user && !configAuthed) return c.json({ error: "未登录" }, 401);
    const visibilityClauses: string[] = [];
    const params: Array<string | number> = [c.req.param("referenceId")];
    if (user) {
      visibilityClauses.push("image_asset_references.user_id = ?");
      visibilityClauses.push("images.user_id = ?");
      params.push(user.id, user.id);
    }
    visibilityClauses.push(referenceCaseAccessSql(approvedCaseSql("case_items")));
    if (configAuthed) visibilityClauses.push(referenceCaseAccessSql(reviewableCaseSql("case_items")));
    const reference = getOne<ImageAssetReferenceRow>(
      appDb,
      `select image_asset_references.*
       from image_asset_references
       left join images on images.id = image_asset_references.image_id
       where image_asset_references.id = ?
         and (
           ${visibilityClauses.join(" or ")}
         )`,
      ...params
    );
    if (!reference) return c.json({ error: "引用图片不存在" }, 404);
    try {
      return c.json({
        options: await imageDownloadOptions({
          sourceType: "image-reference",
          sourceId: reference.id,
          path: reference.path,
          mimeType: reference.mime_type,
          fileSize: reference.size,
          width: reference.image_width,
          height: reference.image_height,
          nameSeed: reference.source_name,
          fallbackName: "引用素材"
        })
      });
    } catch (error) {
      console.warn("引用图片下载选项读取失败", reference.id, error);
      return c.json({ error: "引用图片文件不存在" }, 404);
    }
  });

  api.get("/files/message-source-references/:referenceId/download-options", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const reference = getOne<MessageSourceReferenceRow>(
      appDb,
      "select * from message_source_references where id = ? and user_id = ?",
      c.req.param("referenceId"),
      user.id
    );
    if (!reference) return c.json({ error: "引用素材不存在" }, 404);
    try {
      return c.json({
        options: await imageDownloadOptions({
          sourceType: "message-source-reference",
          sourceId: reference.id,
          path: reference.path,
          mimeType: reference.mime_type,
          fileSize: reference.size,
          width: reference.image_width,
          height: reference.image_height,
          nameSeed: reference.source_name,
          fallbackName: "引用素材"
        })
      });
    } catch (error) {
      console.warn("消息引用素材下载选项读取失败", reference.id, error);
      return c.json({ error: "下载选项读取失败" }, 500);
    }
  });

  api.get("/files/images/:imageId", async (c) => {
    const user = await requireUser(c);
    const configAuthed = isConfigAuthed(c);
    if (!user && !configAuthed) return c.json({ error: "未登录" }, 401);
    const visibilityClauses: string[] = [];
    const params: Array<string | number> = [c.req.param("imageId")];
    if (user) {
      visibilityClauses.push("user_id = ?");
      params.push(user.id);
    }
    visibilityClauses.push(imageCaseAccessSql(approvedCaseSql("case_items")));
    if (configAuthed) visibilityClauses.push(imageCaseAccessSql(reviewableCaseSql("case_items")));
    const image = getOne<ImageRow>(
      appDb,
      `select *
       from images
       where id = ?
         and (
           ${visibilityClauses.join(" or ")}
         )`,
      ...params
    );
    if (!image) return c.json({ error: "图片不存在" }, 404);
    return (await storedImageResponse("image", image.id, image.path, image.mime_type, c.req.query("variant"))) ?? c.json({ error: "图片文件不存在" }, 404);
  });

  api.get("/files/assets/:assetId", async (c) => {
    const { asset, unauthorized } = await assetForFileAccess(c);
    if (unauthorized) return c.json({ error: "未登录" }, 401);
    if (!asset) return c.json({ error: "素材不存在" }, 404);
    return (await storedImageResponse("asset", asset.id, asset.path, asset.mime_type, c.req.query("variant"))) ?? c.json({ error: "素材文件不存在" }, 404);
  });

  api.get("/files/image-references/:referenceId", async (c) => {
    const user = await requireUser(c);
    const configAuthed = isConfigAuthed(c);
    if (!user && !configAuthed) return c.json({ error: "未登录" }, 401);
    const visibilityClauses: string[] = [];
    const params: Array<string | number> = [c.req.param("referenceId")];
    if (user) {
      visibilityClauses.push("image_asset_references.user_id = ?");
      visibilityClauses.push("images.user_id = ?");
      params.push(user.id, user.id);
    }
    visibilityClauses.push(referenceCaseAccessSql(approvedCaseSql("case_items")));
    if (configAuthed) visibilityClauses.push(referenceCaseAccessSql(reviewableCaseSql("case_items")));
    const reference = getOne<ImageAssetReferenceRow>(
      appDb,
      `select image_asset_references.*
       from image_asset_references
       left join images on images.id = image_asset_references.image_id
       where image_asset_references.id = ?
         and (
           ${visibilityClauses.join(" or ")}
         )`,
      ...params
    );
    if (!reference) return c.json({ error: "引用图片不存在" }, 404);
    return (await storedImageResponse("image-reference", reference.id, reference.path, reference.mime_type, c.req.query("variant"))) ?? c.json({ error: "引用图片文件不存在" }, 404);
  });

  api.get("/files/message-source-references/:referenceId", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const reference = getOne<MessageSourceReferenceRow>(
      appDb,
      "select * from message_source_references where id = ? and user_id = ?",
      c.req.param("referenceId"),
      user.id
    );
    if (!reference) return c.json({ error: "引用素材不存在" }, 404);
    return (await storedImageResponse("message-source-reference", reference.id, reference.path, reference.mime_type, c.req.query("variant"))) ?? c.json({ error: "引用素材文件不存在" }, 404);
  });
}
