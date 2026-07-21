import type { Context } from "hono";

export type Pagination = {
  enabled: boolean;
  limit: number;
  offset: number;
};

const DEFAULT_PAGE_LIMIT = 60;
const MAX_PAGE_LIMIT = 120;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function paginationFromQuery(c: Context): Pagination {
  const rawLimit = c.req.query("limit");
  const enabled = rawLimit !== undefined;
  const requestedLimit = positiveInteger(rawLimit, DEFAULT_PAGE_LIMIT);
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(0, positiveInteger(c.req.query("offset"), 0));
  return { enabled, limit, offset };
}

export function boundedPaginationFromQuery(c: Context): Pagination {
  const pagination = paginationFromQuery(c);
  return pagination.enabled ? pagination : { enabled: true, limit: DEFAULT_PAGE_LIMIT, offset: 0 };
}

export function pageInfo(total: number, pagination: Pagination) {
  return {
    limit: pagination.enabled ? pagination.limit : total,
    offset: pagination.enabled ? pagination.offset : 0,
    total,
    hasMore: pagination.enabled && pagination.offset + pagination.limit < total
  };
}

export function pageSlice<T>(items: T[], pagination: Pagination) {
  if (!pagination.enabled) return items;
  return items.slice(pagination.offset, pagination.offset + pagination.limit);
}
