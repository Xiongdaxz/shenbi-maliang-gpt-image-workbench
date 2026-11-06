import type { ImageAccount } from "../types";
export type CodexOAuthSession = {
  id: string;
  status: "waiting" | "exchanging" | "saving" | "save_failed" | "succeeded" | "failed" | "expired" | "cancelled";
  message: string;
  authUrl: string;
  redirectUri: string;
  autoCallback: boolean;
  expiresAt: string;
  targetAccountId: string;
  result: { accountId: string; updated: boolean; appendedToProvider: boolean } | null;
};
export type CodexOAuthSessionResult = { session: CodexOAuthSession; account?: ImageAccount | null };
