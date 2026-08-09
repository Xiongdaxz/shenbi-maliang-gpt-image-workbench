export function resolveChatSessionTransition(previousSessionKey: string, sessionId: string | null | undefined) {
  const sessionKey = sessionId ?? "";
  return {
    sessionKey,
    changed: previousSessionKey !== sessionKey
  };
}
