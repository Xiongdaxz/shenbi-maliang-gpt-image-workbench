export type CompareLibraryCandidate = { id: string; thumbnailUrl: string; title: string };
export type CompareLibrarySnapshot = { ownerId: string; candidates: CompareLibraryCandidate[] };

/** Keep unloaded candidates for the entire comparison, independently of selection. */
export function rememberCompareCandidates(previous: CompareLibrarySnapshot, ownerId: string, incoming: CompareLibraryCandidate[]): CompareLibrarySnapshot {
  const candidates = new Map((previous.ownerId === ownerId ? previous.candidates : []).map((item) => [item.id, item]));
  let changed = previous.ownerId !== ownerId;
  for (const item of incoming) {
    const old = candidates.get(item.id);
    const next = { ...item, thumbnailUrl: item.thumbnailUrl || old?.thumbnailUrl || "", title: item.title || old?.title || "" };
    if (old && old.thumbnailUrl === next.thumbnailUrl && old.title === next.title) continue;
    candidates.set(item.id, next);
    changed = true;
  }
  return changed ? { ownerId, candidates: [...candidates.values()] } : previous;
}

export function compareLibraryCandidates(snapshot: CompareLibrarySnapshot, loaded: CompareLibraryCandidate[]) {
  const loadedIds = new Set(loaded.map((item) => item.id));
  return [...snapshot.candidates.filter((item) => !loadedIds.has(item.id)), ...loaded];
}
