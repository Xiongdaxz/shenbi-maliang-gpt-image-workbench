import { networkInterfaces } from "node:os";

function ipv4Parts(value: string) {
  const parts = value.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function loopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function localLanIpv4() {
  const virtualAdapterPattern = /(?:loopback|vethernet|virtual|vmware|virtualbox|docker|wsl|hyper-v|tailscale|zerotier)/i;
  const candidates = Object.entries(networkInterfaces()).flatMap(([adapterName, addresses]) =>
    (addresses ?? []).flatMap((entry) => {
      const family = String(entry.family).toLowerCase();
      const parts = ipv4Parts(entry.address);
      if (entry.internal || (family !== "ipv4" && family !== "4") || !parts || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)) return [];
      let score = 20;
      if (parts[0] === 192 && parts[1] === 168) score = 40;
      else if (parts[0] === 10) score = 35;
      else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) score = 30;
      else if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) score = 25;
      if (virtualAdapterPattern.test(adapterName)) score -= 100;
      return [{ address: entry.address, adapterName, score }];
    })
  );
  candidates.sort((left, right) => right.score - left.score || left.adapterName.localeCompare(right.adapterName) || left.address.localeCompare(right.address));
  return candidates[0]?.address ?? "";
}

export function resolvePublicHttpOrigin(value: string, lanAddress = "") {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (loopbackHostname(url.hostname) && ipv4Parts(lanAddress) && !loopbackHostname(lanAddress)) url.hostname = lanAddress;
    return url.origin;
  } catch {
    return "";
  }
}
