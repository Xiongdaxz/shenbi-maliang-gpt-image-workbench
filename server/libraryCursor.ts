import { createHash } from "node:crypto";

export type LibraryKind = "images" | "assets" | "cases";
export type LibrarySortDirection = "asc" | "desc";

export type LibraryCursor = {
  v: 1;
  kind: LibraryKind;
  signature: string;
  sort: LibrarySortDirection;
  createdAt: string;
  id: string;
};

const DEFAULT_LIBRARY_LIMIT = 30;
const MAX_LIBRARY_LIMIT = 60;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)])
  );
}

export function libraryFilterSignature(kind: LibraryKind, filters: Record<string, unknown>) {
  const input = JSON.stringify({ kind, filters: canonicalValue(filters) });
  return createHash("sha256").update(input).digest("base64url").slice(0, 20);
}

export function libraryLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIBRARY_LIMIT;
  return Math.min(MAX_LIBRARY_LIMIT, Math.max(1, parsed));
}

export function encodeLibraryCursor(input: Omit<LibraryCursor, "v">) {
  return Buffer.from(JSON.stringify({ v: 1, ...input } satisfies LibraryCursor), "utf8").toString("base64url");
}

export function decodeLibraryCursor(
  value: unknown,
  expected: { kind: LibraryKind; signature: string; sort: LibrarySortDirection }
): LibraryCursor | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8")) as Partial<LibraryCursor>;
    if (
      parsed.v !== 1 ||
      parsed.kind !== expected.kind ||
      parsed.signature !== expected.signature ||
      parsed.sort !== expected.sort ||
      typeof parsed.createdAt !== "string" ||
      !parsed.createdAt ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("cursor scope mismatch");
    }
    return parsed as LibraryCursor;
  } catch {
    throw new Error("无效或已过期的图库游标");
  }
}

export function libraryCursorWhere(
  cursor: LibraryCursor | null,
  columns: { createdAt: string; id: string },
  sort: LibrarySortDirection
) {
  if (!cursor) return { sql: "", params: [] as string[] };
  const operator = sort === "asc" ? ">" : "<";
  return {
    sql: ` and (${columns.createdAt} ${operator} ? or (${columns.createdAt} = ? and ${columns.id} ${operator} ?))`,
    params: [cursor.createdAt, cursor.createdAt, cursor.id]
  };
}

export function libraryPageInfo<T extends { createdAt: string; id: string }>(
  rows: T[],
  limit: number,
  input: { kind: LibraryKind; signature: string; sort: LibrarySortDirection }
) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    pageInfo: {
      limit,
      nextCursor: hasMore && last
        ? encodeLibraryCursor({ ...input, createdAt: last.createdAt, id: last.id })
        : null,
      hasMore
    }
  };
}
