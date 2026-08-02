import { isIP } from "node:net";

const DEFAULT_IP_LOCATION_ENDPOINT = "https://ipwho.is/";
const POSITIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type PublicIpLocation = {
  ip: string;
  region: string;
};

type CacheEntry = {
  expiresAt: number;
  value: PublicIpLocation | null;
};

const locationCache = new Map<string, CacheEntry>();
const locationRequests = new Map<string, Promise<PublicIpLocation | null>>();

export function normalizeIpAddress(value: unknown) {
  const input = String(value ?? "").trim().toLowerCase();
  if (input.startsWith("::ffff:")) {
    const ipv4 = input.slice(7);
    return isIP(ipv4) === 4 ? ipv4 : input;
  }
  return input.split("%")[0] ?? input;
}

function isPublicIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(value: string) {
  if (value === "::" || value === "::1") return false;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff")) return false;
  if (/^fe[89ab]/.test(value)) return false;
  if (value.startsWith("2001:db8:")) return false;
  return true;
}

export function isPublicIpAddress(value: unknown) {
  const ip = normalizeIpAddress(value);
  const version = isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip);
  return false;
}

function regionText(payload: Record<string, unknown>) {
  const parts = [payload.country, payload.region, payload.city]
    .map((value) => String(value ?? "").trim())
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
  return parts.join(" · ");
}

export async function queryPublicIpLocation(
  sourceIp: unknown,
  options: { endpoint?: string; fetcher?: FetchLike; timeoutMs?: number } = {}
): Promise<PublicIpLocation | null> {
  const source = normalizeIpAddress(sourceIp);
  if (!isPublicIpAddress(source)) return null;
  const endpoint = String(options.endpoint ?? DEFAULT_IP_LOCATION_ENDPOINT).trim() || DEFAULT_IP_LOCATION_ENDPOINT;
  const url = new URL(encodeURIComponent(source), endpoint);
  url.searchParams.set("lang", "zh-CN");
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(500, options.timeoutMs ?? 2500))
    });
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, unknown>;
    if (payload.success === false) return null;
    const resolvedIp = normalizeIpAddress(payload.ip);
    if (!isPublicIpAddress(resolvedIp) || resolvedIp !== source) return null;
    return { ip: source, region: regionText(payload) };
  } catch {
    return null;
  }
}

export async function resolvePublicIpLocation(sourceIp: unknown) {
  const source = normalizeIpAddress(sourceIp);
  if (!isPublicIpAddress(source)) return null;
  const cacheKey = source;
  const timestamp = Date.now();
  const cached = locationCache.get(cacheKey);
  if (cached && cached.expiresAt > timestamp) return cached.value;
  const pending = locationRequests.get(cacheKey);
  if (pending) return pending;
  const request = queryPublicIpLocation(source).then((value) => {
    locationCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + (value ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS)
    });
    return value;
  }).finally(() => {
    locationRequests.delete(cacheKey);
  });
  locationRequests.set(cacheKey, request);
  return request;
}
