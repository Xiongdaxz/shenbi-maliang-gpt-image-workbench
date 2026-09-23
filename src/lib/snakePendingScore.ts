export type PendingSnakeScore = { score: number; revision: number };

type SnakeScoreStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageForScore(storage?: SnakeScoreStorage): SnakeScoreStorage | null {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(userId: string) {
  return `gpt-image.snake-pending-score:${userId}`;
}

export function pendingSnakeScore(userId: string, storage?: SnakeScoreStorage): PendingSnakeScore | null {
  if (!userId) return null;
  try {
    const raw = storageForScore(storage)?.getItem(storageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingSnakeScore;
    return Number.isSafeInteger(value.score) && value.score > 0
      && Number.isSafeInteger(value.revision) && value.revision >= 0
      ? value : null;
  } catch {
    return null;
  }
}

export function rememberPendingSnakeScore(userId: string, score: number, revision: number, storage?: SnakeScoreStorage) {
  if (!userId || !Number.isSafeInteger(score) || score <= 0 || !Number.isSafeInteger(revision) || revision < 0) return;
  try {
    const target = storageForScore(storage);
    if (!target) return;
    const current = pendingSnakeScore(userId, target);
    if (current && current.revision > revision) return;
    target.setItem(storageKey(userId), JSON.stringify({
      score: current?.revision === revision ? Math.max(current.score, score) : score,
      revision
    }));
  } catch {
    // Saving to the server still works when browser storage is unavailable.
  }
}

export function clearPendingSnakeScore(userId: string, saved: PendingSnakeScore, storage?: SnakeScoreStorage) {
  if (!userId) return;
  try {
    const target = storageForScore(storage);
    if (!target) return;
    const pending = pendingSnakeScore(userId, target);
    if (!pending || pending.revision !== saved.revision || pending.score > saved.score) return;
    target.removeItem(storageKey(userId));
  } catch {
    // A blocked storage API must not interrupt the game.
  }
}

export function discardPendingSnakeScoreBeforeRevision(userId: string, revision: number, storage?: SnakeScoreStorage) {
  if (!userId) return;
  try {
    const target = storageForScore(storage);
    if (!target) return;
    const pending = pendingSnakeScore(userId, target);
    if (!pending || pending.revision >= revision) return;
    target.removeItem(storageKey(userId));
  } catch {
    // A blocked storage API must not interrupt the game.
  }
}
