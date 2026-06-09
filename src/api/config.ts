import type {
  BrandingAsset,
  BrandingDefaults,
  BrandingSettings,
  DebugSettings,
  ConfigStatistics,
  GlobalSwitchSetting,
  GlobalSwitchType,
  ImageAccount,
  ChangelogEntry,
  ImageGenerationMode,
  ModelRequestLog,
  PromptOptimizerProvider,
  ProviderConfig,
  ProviderRequestLog,
  ProxyConfig,
  RegistrationSettings,
  SafetyReviewLog,
  SafetyReviewSettings,
  SmsSettings,
  SmtpSettings,
  StarterCopySettings,
  StarterDailyCopy,
  Team,
  User
} from "../types";
import { request } from "./client";

type ConfigUser = {
  id: string;
  teamId: string;
  teamName: string;
  account: string;
  username: string;
  email: string;
  phone: string;
  disabled: boolean;
  hasConfigAccess: boolean;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  imageCount: number;
};

type CpaConfig = {
  enabled: boolean;
  syncUrl: string;
  passwordSecret: string;
  frequencyMinutes: number;
};

type ChangelogPayload = {
  version: string;
  date?: string;
  content: string;
};

type ConfigAssetReviewStatus = "pending" | "approved" | "rejected" | "all";
type ConfigCaseReviewStatus = "pending" | "approved" | "rejected" | "all";

export type ConfigBrandingResult = {
  settings: BrandingSettings;
  assets: BrandingAsset[];
  defaults: BrandingDefaults;
};

export type ConfigAssetReviewItem = {
  id: string;
  name: string;
  url: string;
  previewUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
  space: "private" | "shared";
  shared: boolean;
  shareStatus: "none" | "pending" | "approved" | "rejected";
  shareRequestedAt: string;
  shareReviewedAt: string;
  shareRejectReason: string;
  sourceUsername: string;
  sourceAccount: string;
  teamName: string;
  createdAt: string;
  categoryIds: string[];
  categoryNames: string[];
};

export type ConfigCaseReviewItem = {
  id: string;
  groupId: string;
  title: string;
  prompt: string;
  url: string;
  previewUrl: string;
  thumbnailUrl: string;
  imageWidth: number;
  imageHeight: number;
  imageFileSize: number;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewRequestedAt: string;
  reviewedAt: string;
  rejectReason: string;
  sourceUsername: string;
  sourceAccount: string;
  teamName: string;
  createdAt: string;
  categoryIds: string[];
  categoryNames: string[];
};

export type PromptOptimizerProviderModelsResult = {
  endpoint: string;
  durationMs: number;
  models: string[];
  defaultModel: string;
  availabilityStatus: PromptOptimizerProvider["availabilityStatus"];
  availabilityError: string;
  availabilityCheckedAt: string;
};

export type PromptOptimizerProviderTestResult = PromptOptimizerProviderModelsResult & {
  ok: boolean;
  message: string;
};

export const configApi = {
  status: () => request<{ setupRequired: boolean; authenticated: boolean }>("/api/config/auth/status"),
  setup: (password: string) =>
    request<{ ok: boolean }>("/api/config/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  login: (password: string) =>
    request<{ ok: boolean }>("/api/config/auth/login", {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  logout: () => request<{ ok: boolean }>("/api/config/auth/logout", { method: "POST" }),
  globalSwitches: () => request<{ switches: GlobalSwitchSetting[] }>("/api/config/global-switches"),
  saveGlobalSwitch: (type: GlobalSwitchType, enabled: boolean) =>
    request<{ switch: GlobalSwitchSetting; switches: GlobalSwitchSetting[] }>(`/api/config/global-switches/${encodeURIComponent(type)}`, {
      method: "PUT",
      body: JSON.stringify({ enabled })
    }),
  branding: () => request<ConfigBrandingResult>("/api/config/branding"),
  saveBranding: (settings: BrandingSettings) =>
    request<ConfigBrandingResult>("/api/config/branding", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  resetBranding: () =>
    request<ConfigBrandingResult>("/api/config/branding/reset", {
      method: "POST"
    }),
  uploadBrandingAsset: (form: FormData) =>
    request<ConfigBrandingResult>("/api/config/branding/assets", {
      method: "POST",
      body: form
    }),
  updateBrandingAsset: (id: string, patch: Partial<Pick<BrandingAsset, "name" | "enabled" | "sortOrder">>) =>
    request<ConfigBrandingResult>(`/api/config/branding/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  deleteBrandingAsset: (id: string) =>
    request<ConfigBrandingResult>(`/api/config/branding/assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  registrationSettings: () => request<{ settings: RegistrationSettings }>("/api/config/registration-settings"),
  saveRegistrationSettings: (settings: Pick<RegistrationSettings, "enabled">) =>
    request<{ settings: RegistrationSettings }>("/api/config/registration-settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  teams: () => request<{ teams: Team[] }>("/api/config/teams"),
  createTeam: (payload: { name: string; description: string }) =>
    request<{ team: Team }>("/api/config/teams", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateTeam: (id: string, payload: { name: string; description: string }) =>
    request<{ ok: boolean }>(`/api/config/teams/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteTeam: (id: string) => request<{ ok: boolean }>(`/api/config/teams/${id}`, { method: "DELETE" }),
  smtpSettings: () => request<{ settings: SmtpSettings }>("/api/config/smtp-settings"),
  saveSmtpSettings: (settings: SmtpSettings) =>
    request<{ settings: SmtpSettings }>("/api/config/smtp-settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  testSmtpSettings: (email: string) =>
    request<{ ok: boolean }>("/api/config/smtp-settings/test", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  smsSettings: () => request<{ settings: SmsSettings }>("/api/config/sms-settings"),
  saveSmsSettings: (settings: SmsSettings) =>
    request<{ settings: SmsSettings }>("/api/config/sms-settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  testSmsSettings: (phone: string) =>
    request<{ ok: boolean }>("/api/config/sms-settings/test", {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  users: (filters?: { teamId?: string; keyword?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filters?.teamId) params.set("teamId", filters.teamId);
    if (filters?.keyword) params.set("keyword", filters.keyword);
    if (filters?.status) params.set("status", filters.status);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ users: ConfigUser[] }>(`/api/config/users${suffix}`);
  },
  allUsers: () => request<{ users: ConfigUser[] }>("/api/config/users"),
  createUser: (payload: { account: string; username: string; email?: string; phone?: string; password: string; teamId: string; disabled: boolean; hasConfigAccess: boolean }) =>
    request<{ ok: boolean } | { user: User }>("/api/config/users", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateUser: (id: string, payload: { account?: string; username?: string; email?: string; phone?: string; teamId?: string; disabled?: boolean; hasConfigAccess?: boolean }) =>
    request<{ ok: boolean }>(`/api/config/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  resetPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(`/api/config/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  deleteUser: (id: string) => request<{ ok: boolean }>(`/api/config/users/${id}`, { method: "DELETE" }),
  assetReviews: (filters?: { status?: ConfigAssetReviewStatus; keyword?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.keyword) params.set("keyword", filters.keyword);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{
      assets: ConfigAssetReviewItem[];
      counts: { pending: number; approved: number; rejected: number };
    }>(`/api/config/assets/reviews${suffix}`);
  },
  approveAssetReview: (id: string) =>
    request<{ ok: boolean }>(`/api/config/assets/reviews/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  rejectAssetReview: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/api/config/assets/reviews/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  caseReviews: (filters?: { status?: ConfigCaseReviewStatus; keyword?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.keyword) params.set("keyword", filters.keyword);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{
      cases: ConfigCaseReviewItem[];
      counts: { pending: number; approved: number; rejected: number };
    }>(`/api/config/cases/reviews${suffix}`);
  },
  approveCaseReview: (id: string) =>
    request<{ ok: boolean }>(`/api/config/cases/reviews/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  rejectCaseReview: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/api/config/cases/reviews/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  statistics: (filters?: { preset?: string; startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.preset) params.set("preset", filters.preset);
    if (filters?.startDate) params.set("startDate", filters.startDate);
    if (filters?.endDate) params.set("endDate", filters.endDate);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ statistics: ConfigStatistics }>(`/api/config/statistics${suffix}`);
  },
  changelog: () =>
    request<{ entries: ChangelogEntry[] }>("/api/config/changelog"),
  createChangelogEntry: (payload: ChangelogPayload) =>
    request<{ entries: ChangelogEntry[] }>("/api/config/changelog", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateChangelogEntry: (id: string, payload: ChangelogPayload) =>
    request<{ entries: ChangelogEntry[] }>(
      `/api/config/changelog/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    ),
  deleteChangelogEntry: (id: string) =>
    request<{ entries: ChangelogEntry[] }>(
      `/api/config/changelog/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),
  imageAccounts: () =>
    request<{
      summary: {
        total: number;
        available: number;
        totalQuota: number;
        remainingQuota: number;
        usageTracked: number;
        averageCodex5hUsedPercent: number | null;
        averageCodexWeekUsedPercent: number | null;
      };
      accounts: ImageAccount[];
    }>("/api/config/image-accounts"),
  refreshImageAccountUsage: (id?: string) =>
    request<{ ok: boolean; updated: number; failed: number; skipped: number; message: string }>(
      id
        ? `/api/config/image-accounts/${encodeURIComponent(id)}/refresh-usage`
        : "/api/config/image-accounts/refresh-usage",
      { method: "POST" }
    ),
  createImageAccount: (account: Partial<ImageAccount>) =>
    request<{ account: ImageAccount | null }>("/api/config/image-accounts", {
      method: "POST",
      body: JSON.stringify(account)
    }),
  updateImageAccount: (id: string, account: Partial<ImageAccount>) =>
    request<{ account: ImageAccount | null }>(`/api/config/image-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(account)
    }),
  deleteImageAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/config/image-accounts/${id}`, { method: "DELETE" }),
  imageMode: () => request<{ imageMode: ImageGenerationMode }>("/api/config/image-mode"),
  saveImageMode: (imageMode: Pick<ImageGenerationMode, "mode" | "resultRetryCount">) =>
    request<{ imageMode: ImageGenerationMode }>("/api/config/image-mode", {
      method: "PUT",
      body: JSON.stringify(imageMode)
    }),
  providers: () => request<{ providers: ProviderConfig[] }>("/api/config/providers"),
  saveProviders: (providers: ProviderConfig[]) =>
    request<{ ok: boolean }>("/api/config/providers", {
      method: "PUT",
      body: JSON.stringify({ providers })
    }),
  promptOptimizerProviders: () =>
    request<{ providers: PromptOptimizerProvider[] }>("/api/config/prompt-optimizer-providers"),
  savePromptOptimizerProviders: (providers: PromptOptimizerProvider[]) =>
    request<{ ok: boolean }>("/api/config/prompt-optimizer-providers", {
      method: "PUT",
      body: JSON.stringify({ providers })
    }),
  promptOptimizerProviderModels: (provider: PromptOptimizerProvider) =>
    request<PromptOptimizerProviderModelsResult>("/api/config/prompt-optimizer-providers/models", {
      method: "POST",
      body: JSON.stringify(provider)
    }),
  testPromptOptimizerProvider: (provider: PromptOptimizerProvider) =>
    request<PromptOptimizerProviderTestResult>("/api/config/prompt-optimizer-providers/test", {
      method: "POST",
      body: JSON.stringify(provider)
    }),
  safetyReview: () =>
    request<{ settings: SafetyReviewSettings; logs: SafetyReviewLog[] }>("/api/config/safety-review"),
  saveSafetyReview: (settings: SafetyReviewSettings) =>
    request<{ settings: SafetyReviewSettings; logs: SafetyReviewLog[] }>("/api/config/safety-review", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  starterCopySettings: () =>
    request<{ settings: StarterCopySettings | null; today: StarterDailyCopy | null }>("/api/config/starter-copy-settings"),
  saveStarterCopySettings: (settings: StarterCopySettings) =>
    request<{ settings: StarterCopySettings | null }>("/api/config/starter-copy-settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  regenerateStarterCopies: () =>
    request<{ today: StarterDailyCopy | null }>("/api/config/starter-copy-settings/regenerate", {
      method: "POST"
    }),
  proxy: () => request<{ proxy: ProxyConfig }>("/api/config/proxy"),
  saveProxy: (proxy: ProxyConfig) =>
    request<{ proxy: ProxyConfig }>("/api/config/proxy", {
      method: "PUT",
      body: JSON.stringify(proxy)
    }),
  debug: () => request<{ debug: DebugSettings }>("/api/config/debug"),
  saveDebug: (debug: DebugSettings) =>
    request<{ debug: DebugSettings }>("/api/config/debug", {
      method: "PUT",
      body: JSON.stringify(debug)
    }),
  requestLogs: () => request<{ logs: ProviderRequestLog[] }>("/api/config/request-logs"),
  modelRequestLogs: (filters: { success?: "all" | "success" | "failure"; purpose?: string; providerId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.success === "success") params.set("success", "true");
    if (filters.success === "failure") params.set("success", "false");
    if (filters.purpose) params.set("purpose", filters.purpose);
    if (filters.providerId) params.set("providerId", filters.providerId);
    if (filters.limit) params.set("limit", String(filters.limit));
    const query = params.toString();
    return request<{ logs: ModelRequestLog[] }>(`/api/config/model-request-logs${query ? `?${query}` : ""}`);
  },
  cpa: () =>
    request<{
      account: CpaConfig & {
        lastStatus: string;
        updatedAt: string;
      };
      nextAutoSyncAt: string;
      runs: Array<{
        id: string;
        status: string;
        message: string;
        startedAt: string;
        finishedAt: string;
      }>;
    }>("/api/config/cpa"),
  saveCpa: (account: CpaConfig) =>
    request<{ ok: boolean }>("/api/config/cpa", {
      method: "PUT",
      body: JSON.stringify(account)
    }),
  syncCpa: () =>
    request<{ status: string; message: string; created?: number; updated?: number; skipped?: number }>(
      "/api/config/cpa/sync",
      { method: "POST" }
    ),
  audit: () =>
    request<{
      logs: Array<{ id: string; action: string; detail: Record<string, unknown>; createdAt: string }>;
    }>("/api/config/audit")
};
