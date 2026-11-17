import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import { isPublicIpAddress } from "./ipLocation";

const MAX_METADATA_BYTES = 16 * 1024;
const cache = new Map<string, { expires: number; value: CimdMetadata }>();
export type CimdMetadata = {
  client_id: string; client_name: string; application_type: "native";
  redirect_uris: string[]; grant_types: string[]; response_types: string[]; token_endpoint_auth_method: "none";
};

// Roll out only after real client OAuth tests; DCR remains available on the same issuer.
export function cimdEnabled() { return Bun.env.MALIANG_MCP_CIMD === "true"; }

export function validateCimdUrl(value: string) {
  const url = new URL(value);
  if (url.href !== value || url.origin !== "https://chatgpt.com" || url.username || url.password || url.search || url.hash
    || !/^\/oauth\/codex\/(?:[A-Za-z0-9_-]{1,128}\/)?client\.json$/.test(url.pathname)) {
    throw new Error("Unsupported CIMD client metadata URL");
  }
  return url;
}

export function publicCimdAddress(address: string) {
  if (isIP(address) === 4) return isPublicIpAddress(address);
  const normalized = address.toLowerCase();
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/.test(normalized)
    && !/^2002:|^2001:(?:0*:|0*2:|db8:)/.test(normalized) && isPublicIpAddress(address);
}

async function fetchPinnedMetadata(url: URL): Promise<unknown> {
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("CIMD DNS timeout")), 5000); })
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((entry) => !publicCimdAddress(entry.address))) throw new Error("Invalid CIMD destination");
  const address = addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = get(url, {
      agent: false, family: address.family,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { accept: "application/json" }
    }, (response) => {
      if (response.socket.remoteAddress?.replace(/^::ffff:/, "") !== address.address) {
        response.destroy(); reject(new Error("CIMD destination changed")); return;
      }
      if (response.statusCode !== 200 || !/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(String(response.headers["content-type"] ?? ""))) {
        response.destroy(); reject(new Error("Invalid CIMD metadata response")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_METADATA_BYTES) { req.destroy(new Error("CIMD metadata too large")); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("Invalid CIMD JSON")); }
      });
    });
    const timeout = setTimeout(() => req.destroy(new Error("CIMD metadata timeout")), 5000);
    req.on("close", () => clearTimeout(timeout));
    req.on("error", reject);
  });
}

export function parseCimdMetadata(clientId: string, value: unknown): CimdMetadata {
  validateCimdUrl(clientId);
  if (!value || typeof value !== "object") throw new Error("Invalid CIMD metadata");
  const metadata = value as Record<string, unknown>;
  if (metadata.client_id !== clientId || metadata.token_endpoint_auth_method !== "none"
    || metadata.application_type !== "native" || typeof metadata.client_name !== "string"
    || !metadata.client_name.trim() || metadata.client_name.length > 120) throw new Error("Invalid CIMD client identity");
  const redirectUris = metadata.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 8) throw new Error("Invalid CIMD redirects");
  for (const raw of redirectUris) {
    if (typeof raw !== "string" || raw.length > 2048) throw new Error("Invalid CIMD redirect");
    const uri = new URL(raw);
    if (uri.protocol !== "http:" || uri.hostname !== "127.0.0.1" || uri.port || uri.username || uri.password || uri.search || uri.hash
      || !/^\/callback(?:\/[A-Za-z0-9_-]{1,128})?$/.test(uri.pathname)) throw new Error("Invalid CIMD loopback redirect");
  }
  const grants = metadata.grant_types;
  if (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.length > 2
    || grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")) throw new Error("Invalid CIMD grants");
  if (!Array.isArray(metadata.response_types) || metadata.response_types.length !== 1 || metadata.response_types[0] !== "code") throw new Error("Invalid CIMD response type");
  return { client_id: clientId, client_name: metadata.client_name, application_type: "native", redirect_uris: redirectUris,
    grant_types: grants, response_types: ["code"], token_endpoint_auth_method: "none" };
}

export async function resolveCimdMetadata(clientId: string) {
  const url = validateCimdUrl(clientId);
  const cached = cache.get(clientId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = parseCimdMetadata(clientId, await fetchPinnedMetadata(url));
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(clientId, { expires: Date.now() + 10 * 60_000, value });
  return value;
}

export function cimdRedirectMatches(registered: string[], requested: string) {
  try {
    const uri = new URL(requested);
    if (uri.protocol !== "http:" || uri.hostname !== "127.0.0.1" || uri.username || uri.password || uri.search || uri.hash) return false;
    uri.port = "";
    return registered.includes(uri.href);
  } catch { return false; }
}
