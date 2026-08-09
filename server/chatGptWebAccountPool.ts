export type ChatGptWebAccountSelectionMode = "priority" | "round_robin" | "random";

export function selectAvailableChatGptWebAccount<T extends { id: string }>(
  candidates: T[],
  mode: ChatGptWebAccountSelectionMode,
  cursor: number,
  excludedAccountIds: ReadonlySet<string>,
  randomValue = Math.random()
) {
  if (mode === "random") {
    const available = candidates.filter((candidate) => !excludedAccountIds.has(candidate.id));
    if (available.length === 0) return { account: null, nextCursor: cursor };
    const index = Math.min(available.length - 1, Math.max(0, Math.floor(randomValue * available.length)));
    return { account: available[index] ?? null, nextCursor: cursor };
  }

  if (mode === "round_robin") {
    const startIndex = candidates.length > 0
      ? ((Math.trunc(cursor) % candidates.length) + candidates.length) % candidates.length
      : 0;
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const candidateIndex = (startIndex + offset) % candidates.length;
      const candidate = candidates[candidateIndex];
      if (!candidate || excludedAccountIds.has(candidate.id)) continue;
      return { account: candidate, nextCursor: candidateIndex + 1 };
    }
    return { account: null, nextCursor: cursor };
  }

  return {
    account: candidates.find((candidate) => !excludedAccountIds.has(candidate.id)) ?? null,
    nextCursor: cursor
  };
}
