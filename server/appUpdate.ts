import { compareSemver, normalizeSemver } from "../src/lib/semver";

const MAX_UPDATE_ENTRIES = 20;

export type VersionedEntry = {
  version: string;
};

export type AppUpdatePayload<T extends VersionedEntry> = {
  serverVersion: string;
  updateAvailable: boolean;
  entries: T[];
  hasMore: boolean;
};

export function buildAppUpdatePayload<T extends VersionedEntry>(
  entries: T[],
  clientVersionValue: unknown,
  serverVersionValue: unknown
): AppUpdatePayload<T> {
  const clientVersion = normalizeSemver(clientVersionValue);
  const serverVersion = normalizeSemver(serverVersionValue);
  if (!clientVersion || !serverVersion) {
    return {
      serverVersion: serverVersion ?? String(serverVersionValue ?? "unknown"),
      updateAvailable: false,
      entries: [],
      hasMore: false
    };
  }

  const updateAvailable = compareSemver(clientVersion, serverVersion) === -1;
  if (!updateAvailable) {
    return { serverVersion, updateAvailable: false, entries: [], hasMore: false };
  }

  const matchingEntries = entries
    .filter((entry) => {
      const entryVersion = normalizeSemver(entry.version);
      return entryVersion
        && compareSemver(entryVersion, clientVersion) === 1
        && (compareSemver(entryVersion, serverVersion) === -1 || compareSemver(entryVersion, serverVersion) === 0);
    })
    .sort((left, right) => compareSemver(right.version, left.version) ?? 0);

  return {
    serverVersion,
    updateAvailable: true,
    entries: matchingEntries.slice(0, MAX_UPDATE_ENTRIES),
    hasMore: matchingEntries.length > MAX_UPDATE_ENTRIES
  };
}
