import type {
  AssetItem,
  CaseCategory,
  ChatSession,
  ChangelogEntry,
  ImageDownloadOption,
  ImageBatchDeleteResult,
  ImageBatchDownloadTicket,
  ImageBatchDownloadVariant,
  ImageBatchResult,
  ImageDeleteImpact,
  ImageEditSuggestion,
  ImageGenerationMode,
  ImageJob,
  LoginAssets,
  Message,
  PromptReferenceLink,
  PromptTemplate,
  PromptTemplateFormDraft,
  PromptTemplateFormValues,
  PromptTemplateLanguage,
  PromptTemplateOutput,
  PromptTemplateResult,
  PromptTemplateRules,
  PromptTemplateComponent,
  PublicBranding,
  ProviderConfig,
  SearchHistoryItem,
  SearchHistoryScope,
  StarterDailyCopy,
  User,
  UserPreferences,
  WorkImage
} from "../types";
import { ApiError, request } from "./client";
import type { AppearanceMode } from "../lib/appearance";
import type { PromptColorScheme, PromptColorSchemePayload } from "../lib/promptColorSchemes";
import type { PromptTemplateOptimizeStyle } from "../lib/promptOptimizeStyles";
export type { PromptColorScheme, PromptColorSchemePayload } from "../lib/promptColorSchemes";
export type { PromptTemplateOptimizeStyle } from "../lib/promptOptimizeStyles";
export type { LoginAssets, PublicBranding } from "../types";

export type PageInfo = {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
};

export type PagedResponse<T> = {
  pageInfo: PageInfo;
} & T;

export type CaseCounts = {
  all: number;
  mine: number;
  favorite: number;
  byCategory: Record<string, number>;
};

export type AssetCounts = {
  tags: {
    all: number;
    byCategory: Record<string, number>;
  };
  spaces: {
    all: number;
    shared: number;
    private: number;
  };
};

export type ImageCounts = {
  all: number;
  favorite: number;
};

export type GenerateImagePayload = {
  sessionId?: string;
  providerId?: string;
  prompt: string;
  language?: string;
  size?: string;
  quality?: string;
  n?: number;
  background?: "auto" | "opaque" | "transparent";
  outputFormat?: "png" | "webp";
  output_format?: "png" | "webp";
  caseItemId?: string;
  revisionRootId?: string;
  editedMessageId?: string;
  branchId?: string;
  parentBranchId?: string;
  branchForkMessageId?: string;
  branchRootMessageId?: string;
};

export type EditImagePayload = GenerateImagePayload & {
  sourceImageIds: string[];
  sourceAssetIds?: string[];
  sourceCaseItemIds?: string[];
  sourceReferenceIds?: string[];
  sourceInlineImages?: Array<{ id?: string; name?: string; dataUrl: string }>;
  referenceAssetId?: string;
  maskDataUrl?: string;
  inputFidelity?: "low" | "high";
  input_fidelity?: "low" | "high";
  hideReference?: boolean;
};

export type PromptReferenceLinkPayload = {
  title?: string;
  url: string;
  thumbnailUrl?: string;
};

type PageQuery = {
  limit?: number;
  offset?: number;
  keyword?: string;
};

type CasePageQuery = PageQuery & {
  categoryIds?: string[];
  mineOnly?: boolean;
  favoriteOnly?: boolean;
};

type AssetPageQuery = PageQuery & {
  categoryIds?: string[];
  space?: "all" | AssetItem["space"];
};

type ImagePageQuery = PageQuery & {
  sort?: "asc" | "desc";
  favoriteOnly?: boolean;
};

type PromptTemplateScope = "all" | "mine" | "shared";

export type PromptTemplateCounts = Record<PromptTemplateScope, number>;

type PromptTemplateQuery = {
  scope?: PromptTemplateScope;
  keyword?: string;
};

type PromptTemplateResultsQuery = Pick<PageQuery, "limit" | "offset">;

export type PromptTemplatePayload = {
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  optimizeStyle?: PromptTemplateOptimizeStyle;
  components: PromptTemplateComponent[];
  rules: PromptTemplateRules;
  output: PromptTemplateOutput;
};

export type PromptTemplateOptimizePayload = {
  language: PromptTemplateLanguage;
  formValues: PromptTemplateFormValues;
  basePrompt: string;
  optimizeStyle?: PromptTemplateOptimizeStyle;
  customInstruction?: string;
};
export type PromptTextOptimizePayload = {
  prompt: string;
  optimizeStyle?: PromptTemplateOptimizeStyle;
  imageCount?: number;
  customInstruction?: string;
};
export type PromptTextOptimizeResponse = {
  prompt: string;
  negativePrompt?: string;
  providerName?: string;
  model?: string;
  streamed: boolean;
};

type PromptTemplateOptimizeResponse = { result: PromptTemplateResult | null };
type PromptTemplateOptimizeStreamResponse = PromptTemplateOptimizeResponse & { streamed: boolean };
export type PromptTemplateStreamDelta = {
  delta: string;
  language?: "zh" | "en";
  phase?: "optimize" | "translate";
  reset?: boolean;
};
type PromptTemplateOptimizeStreamHandlers = {
  onDelta?: (delta: PromptTemplateStreamDelta) => void;
};
type PromptTemplateTranslatePayload = {
  prompt: string;
  negativePrompt?: string;
  signature?: string;
};
export type PromptTemplateBaseTranslation = {
  templateId: string;
  signature: string;
  basePrompt: string;
  basePromptEn: string;
  negativePrompt: string;
  negativePromptEn: string;
  providerName: string;
  model: string;
  updatedAt: string;
};
type PromptTemplateTranslateResponse = {
  text: string;
  negativeText?: string;
  translation?: PromptTemplateBaseTranslation | null;
  streamed: boolean;
};

export type PromptTemplateExportDownload = {
  id: string;
  variant: "ai" | "basic";
  status: "active" | "expired" | "revoked" | "downloaded";
  issuedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

type SessionQuery = {
  archived?: boolean;
} & Pick<PageQuery, "limit" | "offset" | "keyword">;

function queryString(params: Record<string, string | number | boolean | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    search.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

function parseApiBody(text: string) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

function apiErrorMessage(data: unknown, fallback: string) {
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string" && error.trim()) return error.trim();
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  }
  return fallback;
}

function parsePromptTemplateOptimizeFrame(frame: string) {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const text = dataLines.join("\n").trim();
  if (!text) return { event, data: {} };
  return { event, data: parseApiBody(text) };
}

async function readPromptTemplateOptimizeStream(response: Response, handlers: PromptTemplateOptimizeStreamHandlers = {}) {
  if (!response.body) throw new ApiError("浏览器不支持流式响应", response.status || 500);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PromptTemplateResult | null = null;
  let completed = false;
  const handleFrame = (frame: string) => {
    const { event, data } = parsePromptTemplateOptimizeFrame(frame);
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    if (event === "delta") {
      const delta = String(record.delta ?? "");
      if (delta) {
        handlers.onDelta?.({
          delta,
          language: record.language === "en" ? "en" : "zh",
          phase: record.phase === "translate" ? "translate" : "optimize",
          reset: Boolean(record.reset)
        });
      }
      return;
    }
    if (event === "done") {
      result = (record.result ?? null) as PromptTemplateResult | null;
      completed = true;
      return;
    }
    if (event === "error") {
      throw new ApiError(apiErrorMessage(record, "AI 优化失败"), 502);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) handleFrame(buffer);
  if (!completed) throw new ApiError("流式优化响应未完成，请重试", response.status || 502);
  return { result, streamed: true };
}

async function optimizePromptTemplateStream(
  id: string,
  payload: PromptTemplateOptimizePayload,
  handlers: PromptTemplateOptimizeStreamHandlers = {}
): Promise<PromptTemplateOptimizeStreamResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30 * 60 * 1000);
  try {
    const response = await fetch(`/api/prompt-templates/${encodeURIComponent(id)}/optimize`, {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Accept": "text/event-stream, application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok) {
      const data = parseApiBody(await response.text());
      throw new ApiError(apiErrorMessage(data, response.statusText || "请求失败"), response.status);
    }
    if (contentType.includes("text/event-stream")) {
      return readPromptTemplateOptimizeStream(response, handlers);
    }
    const data = parseApiBody(await response.text());
    if (typeof data === "string") throw new ApiError("接口返回数据格式不正确", response.status || 500);
    return { ...(data as PromptTemplateOptimizeResponse), streamed: false };
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError("请求超时，请重新生成", 408);
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readPromptTextOptimizeStream(response: Response, handlers: PromptTemplateOptimizeStreamHandlers = {}): Promise<PromptTextOptimizeResponse> {
  if (!response.body) throw new ApiError("浏览器不支持流式响应", response.status || 500);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PromptTextOptimizeResponse | null = null;
  let completed = false;
  const handleFrame = (frame: string) => {
    const { event, data } = parsePromptTemplateOptimizeFrame(frame);
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    if (event === "delta") {
      const delta = String(record.delta ?? "");
      if (delta) {
        handlers.onDelta?.({
          delta,
          language: record.language === "en" ? "en" : "zh",
          phase: record.phase === "translate" ? "translate" : "optimize",
          reset: Boolean(record.reset)
        });
      }
      return;
    }
    if (event === "done") {
      result = {
        prompt: String(record.prompt ?? ""),
        negativePrompt: String(record.negativePrompt ?? ""),
        providerName: String(record.providerName ?? ""),
        model: String(record.model ?? ""),
        streamed: true
      };
      completed = true;
      return;
    }
    if (event === "error") {
      throw new ApiError(apiErrorMessage(record, "AI 优化失败"), 502);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) handleFrame(buffer);
  if (!completed || !result) throw new ApiError("流式优化响应未完成，请重试", response.status || 502);
  return result;
}

async function optimizePromptTextStream(
  payload: PromptTextOptimizePayload,
  handlers: PromptTemplateOptimizeStreamHandlers = {}
): Promise<PromptTextOptimizeResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30 * 60 * 1000);
  try {
    const response = await fetch("/api/prompt-optimizer/optimize", {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Accept": "text/event-stream, application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok) {
      const data = parseApiBody(await response.text());
      throw new ApiError(apiErrorMessage(data, response.statusText || "请求失败"), response.status);
    }
    if (contentType.includes("text/event-stream")) {
      return readPromptTextOptimizeStream(response, handlers);
    }
    const data = parseApiBody(await response.text());
    if (typeof data === "string") throw new ApiError("接口返回数据格式不正确", response.status || 500);
    const record = data as Record<string, unknown>;
    return {
      prompt: String(record.prompt ?? ""),
      negativePrompt: String(record.negativePrompt ?? ""),
      providerName: String(record.providerName ?? ""),
      model: String(record.model ?? ""),
      streamed: false
    };
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError("请求超时，请重新生成", 408);
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function translatePromptTemplateStream(
  id: string,
  payload: PromptTemplateTranslatePayload,
  handlers: PromptTemplateOptimizeStreamHandlers = {}
): Promise<PromptTemplateTranslateResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30 * 60 * 1000);
  try {
    const response = await fetch(`/api/prompt-templates/${encodeURIComponent(id)}/translate`, {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Accept": "text/event-stream, application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const data = parseApiBody(await response.text());
      throw new ApiError(apiErrorMessage(data, response.statusText || "请求失败"), response.status);
    }
    if (!response.body) throw new ApiError("浏览器不支持流式响应", response.status || 500);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let negativeText = "";
    let translation: PromptTemplateBaseTranslation | null = null;
    let completed = false;
    const handleFrame = (frame: string) => {
      const { event, data } = parsePromptTemplateOptimizeFrame(frame);
      const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
      if (event === "delta") {
        const delta = String(record.delta ?? "");
        if (delta) handlers.onDelta?.({ delta, language: "en", phase: "translate", reset: Boolean(record.reset) });
        return;
      }
      if (event === "done") {
        text = String(record.text ?? "");
        negativeText = String(record.negativeText ?? "");
        translation = (record.translation ?? null) as PromptTemplateBaseTranslation | null;
        completed = true;
        return;
      }
      if (event === "error") {
        throw new ApiError(apiErrorMessage(record, "提示词翻译失败"), 502);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        handleFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) handleFrame(buffer);
    if (!completed) throw new ApiError("流式翻译响应未完成，请重试", response.status || 502);
    return { text, negativeText, translation, streamed: true };
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError("请求超时，请重新生成", 408);
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const api = {
  me: () => request<{ user: User | null }>("/api/auth/me"),
  branding: () => request<PublicBranding>("/api/branding"),
  loginAssets: () => request<LoginAssets>("/api/login-assets"),
  registrationStatus: () => request<{ enabled: boolean }>("/api/auth/registration-status"),
  login: (account: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ account, password })
    }),
  sendRegisterCode: (email: string) =>
    request<{ ok: boolean; expiresInSeconds: number; cooldownSeconds: number }>("/api/auth/register/code", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  register: (payload: { email: string; code: string; password: string; inviteCode?: string }) =>
    request<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  sendPhoneRegisterCode: (phone: string) =>
    request<{ ok: boolean; expiresInSeconds: number; cooldownSeconds: number }>("/api/auth/register/sms-code", {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  registerByPhone: (payload: { phone: string; code: string; password: string; inviteCode?: string }) =>
    request<{ user: User }>("/api/auth/register/phone", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  sendPasswordResetCode: (email: string) =>
    request<{ ok: boolean; expiresInSeconds: number; cooldownSeconds: number }>("/api/auth/password-reset/code", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  resetPasswordByEmail: (payload: { email: string; code: string; password: string }) =>
    request<{ ok: boolean }>("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  sendPhonePasswordResetCode: (phone: string) =>
    request<{ ok: boolean; expiresInSeconds: number; cooldownSeconds: number }>("/api/auth/password-reset/sms-code", {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  resetPasswordByPhone: (payload: { phone: string; code: string; password: string }) =>
    request<{ ok: boolean }>("/api/auth/password-reset/phone", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  deleteAccount: (confirmationText: string) =>
    request<{ ok: boolean }>("/api/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmationText })
    }),
  configAccess: () => request<{ ok: boolean }>("/api/auth/config-access", { method: "POST" }),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  changeUsername: (username: string) =>
    request<{ user: User }>("/api/auth/change-username", {
      method: "POST",
      body: JSON.stringify({ username })
    }),
  saveAppearanceMode: (appearanceMode: AppearanceMode) =>
    request<{ user: User }>("/api/auth/appearance-mode", {
      method: "POST",
      body: JSON.stringify({ appearanceMode })
    }),
  saveUserPreferences: (preferences: Partial<UserPreferences>) =>
    request<{ user: User }>("/api/auth/preferences", {
      method: "POST",
      body: JSON.stringify(preferences)
    }),
  suggestUsername: () => request<{ username: string; usernames?: string[] }>("/api/auth/username-suggestion", { method: "POST" }),
  uploadAvatar: (form: FormData) =>
    request<{ user: User }>("/api/auth/avatar", {
      method: "POST",
      body: form
    }),
  providers: () => request<{ providers: ProviderConfig[]; imageMode: ImageGenerationMode }>("/api/providers"),
  starterCopiesToday: (language?: string) => request<StarterDailyCopy>(`/api/starter-copies/today${queryString({ language })}`),
  changelog: () => request<{ entries: ChangelogEntry[] }>("/api/changelog"),
  sessions: (params?: SessionQuery, init?: RequestInit) =>
    request<PagedResponse<{ sessions: ChatSession[] }>>(
      `/api/sessions${queryString({
        archived: params?.archived ? 1 : undefined,
        limit: params?.limit,
        offset: params?.offset,
        keyword: params?.keyword
      })}`,
      init
    ),
  createSession: (payload?: { prompt?: string; title?: string }) =>
    request<{ session: ChatSession }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }),
  archiveSession: (sessionId: string, archived: boolean) =>
    request<{ session: ChatSession }>(`/api/sessions/${sessionId}/archive`, {
      method: "PATCH",
      body: JSON.stringify({ archived })
    }),
  pinSession: (sessionId: string, pinned: boolean) =>
    request<{ session: ChatSession }>(`/api/sessions/${sessionId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned })
    }),
  renameSession: (sessionId: string, title: string) =>
    request<{ session: ChatSession }>(`/api/sessions/${sessionId}/title`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    }),
  archiveAllSessions: () =>
    request<{ ok: boolean; archived: number }>("/api/sessions/archive-all", {
      method: "POST"
    }),
  unarchiveAllSessions: () =>
    request<{ ok: boolean; restored: number }>("/api/sessions/unarchive-all", {
      method: "POST"
    }),
  deleteSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${sessionId}`, {
      method: "DELETE"
    }),
  deleteAllSessions: () =>
    request<{ ok: boolean; deleted: number }>("/api/sessions", {
      method: "DELETE"
    }),
  messages: (sessionId: string, init?: RequestInit) =>
    request<{ messages: Message[] }>(`/api/sessions/${sessionId}/messages`, init),
  sessionImageJobs: (sessionId: string, status = "running", init?: RequestInit) =>
    request<{ jobs: ImageJob[] }>(`/api/sessions/${sessionId}/image-jobs?status=${encodeURIComponent(status)}`, init),
  retryImageJob: (jobId: string) =>
    request<{ sessionId: string; job: ImageJob | null; image: WorkImage | null; images?: WorkImage[]; error?: string }>(
      `/api/image-jobs/${jobId}/retry`,
      { method: "POST" }
    ),
  searchHistory: (scope: SearchHistoryScope, limit = 12) =>
    request<{ history: SearchHistoryItem[] }>(`/api/search-history?scope=${encodeURIComponent(scope)}&limit=${encodeURIComponent(String(limit))}`),
  recordSearchHistory: (payload: { scope: SearchHistoryScope; keyword: string }) =>
    request<{ history: SearchHistoryItem | null }>("/api/search-history", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteSearchHistory: (id: string) =>
    request<{ ok: boolean }>(`/api/search-history/${id}`, {
      method: "DELETE"
    }),
  clearSearchHistory: (scope: SearchHistoryScope) =>
    request<{ ok: boolean }>(`/api/search-history?scope=${encodeURIComponent(scope)}`, {
      method: "DELETE"
    }),
  cases: (params?: CasePageQuery) =>
    request<PagedResponse<{ categories: CaseCategory[]; counts?: CaseCounts }>>(
      `/api/cases${queryString({
        limit: params?.limit,
        offset: params?.offset,
        keyword: params?.keyword,
        categoryIds: params?.categoryIds,
        mineOnly: params?.mineOnly,
        favoriteOnly: params?.favoriteOnly
      })}`
    ),
  createCaseCategory: (name: string) =>
    request<{ category: CaseCategory }>("/api/cases/categories", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  promptReferenceLinks: () => request<{ links: PromptReferenceLink[] }>("/api/prompt-reference-links"),
  promptColorSchemes: (params?: { includeDeleted?: boolean }) =>
    request<{ schemes: PromptColorScheme[] }>(`/api/prompt-color-schemes${queryString({ includeDeleted: params?.includeDeleted ? 1 : undefined })}`),
  createPromptColorScheme: (payload: PromptColorSchemePayload) =>
    request<{ scheme: PromptColorScheme | null }>("/api/prompt-color-schemes", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updatePromptColorScheme: (id: string, payload: PromptColorSchemePayload) =>
    request<{ scheme: PromptColorScheme | null }>(`/api/prompt-color-schemes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePromptColorScheme: (id: string) =>
    request<{ ok: boolean }>(`/api/prompt-color-schemes/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  restoreDefaultPromptColorSchemes: () =>
    request<{ schemes: PromptColorScheme[] }>("/api/prompt-color-schemes/defaults/restore", {
      method: "POST"
    }),
  createPromptReferenceLink: (payload: PromptReferenceLinkPayload) =>
    request<{ link: PromptReferenceLink }>("/api/prompt-reference-links", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updatePromptReferenceLink: (linkId: string, payload: PromptReferenceLinkPayload) =>
    request<{ link: PromptReferenceLink }>(`/api/prompt-reference-links/${linkId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePromptReferenceLink: (linkId: string) =>
    request<{ ok: boolean }>(`/api/prompt-reference-links/${linkId}`, {
      method: "DELETE"
    }),
  promptTemplates: (params?: PromptTemplateQuery) =>
    request<{ templates: PromptTemplate[]; counts?: PromptTemplateCounts }>(
      `/api/prompt-templates${queryString({
        scope: params?.scope,
        keyword: params?.keyword
      })}`
    ),
  updatePromptTemplateOptimizeStyle: (id: string, optimizeStyle: PromptTemplateOptimizeStyle) =>
    request<{ template: PromptTemplate | null }>(`/api/prompt-templates/${encodeURIComponent(id)}/optimize-style`, {
      method: "PUT",
      body: JSON.stringify({ optimizeStyle })
    }),
  promptTemplateExportDownloads: (id: string, query: Pick<PageQuery, "limit" | "offset"> = {}) => {
    const params = new URLSearchParams();
    if (query.limit) params.set("limit", String(query.limit));
    if (query.offset) params.set("offset", String(query.offset));
    const search = params.toString();
    return request<PagedResponse<{ downloads: PromptTemplateExportDownload[]; counts?: Record<string, number> }>>(
      `/api/prompt-templates/${encodeURIComponent(id)}/export-downloads${search ? `?${search}` : ""}`
    );
  },
  revokePromptTemplateExportDownloads: (id: string) =>
    request<{ revokedAt: number; revokedCount: number; downloads: PromptTemplateExportDownload[] }>(
      `/api/prompt-templates/${encodeURIComponent(id)}/export-downloads/revoke`,
      { method: "POST" }
    ),
  createPromptTemplate: (payload: PromptTemplatePayload) =>
    request<{ template: PromptTemplate | null }>("/api/prompt-templates", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  restoreDefaultPromptTemplates: () =>
    request<{ templates: PromptTemplate[]; created: number }>("/api/prompt-templates/defaults/restore", {
      method: "POST"
    }),
  updatePromptTemplate: (id: string, payload: PromptTemplatePayload) =>
    request<{ template: PromptTemplate | null }>(`/api/prompt-templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePromptTemplate: (id: string) =>
    request<{ ok: boolean }>(`/api/prompt-templates/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  copyPromptTemplate: (id: string) =>
    request<{ template: PromptTemplate | null }>(`/api/prompt-templates/${encodeURIComponent(id)}/copy`, {
      method: "POST"
    }),
  sharePromptTemplate: (id: string, shared: boolean) =>
    request<{ template: PromptTemplate | null }>(`/api/prompt-templates/${encodeURIComponent(id)}/share`, {
      method: "PUT",
      body: JSON.stringify({ shared })
    }),
  promptTemplateFormDraft: (id: string) =>
    request<{ draft: PromptTemplateFormDraft | null }>(`/api/prompt-templates/${encodeURIComponent(id)}/form-draft`),
  savePromptTemplateFormDraft: (id: string, formValues: PromptTemplateFormValues) =>
    request<{ draft: PromptTemplateFormDraft | null }>(`/api/prompt-templates/${encodeURIComponent(id)}/form-draft`, {
      method: "PUT",
      body: JSON.stringify({ formValues })
    }),
  optimizePromptTemplate: (id: string, payload: PromptTemplateOptimizePayload) =>
    request<{ result: PromptTemplateResult | null }>(`/api/prompt-templates/${encodeURIComponent(id)}/optimize`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  optimizePromptTemplateStream,
  optimizePromptTextStream,
  translatePromptTemplateStream,
  promptTemplateBaseTranslation: (id: string, signature: string) =>
    request<{ translation: PromptTemplateBaseTranslation | null; staleTranslation?: PromptTemplateBaseTranslation | null }>(
      `/api/prompt-templates/${encodeURIComponent(id)}/base-translation${queryString({ signature })}`
    ),
  promptTemplateResults: (id: string, params?: PromptTemplateResultsQuery) =>
    request<PagedResponse<{ results: PromptTemplateResult[] }>>(
      `/api/prompt-templates/${encodeURIComponent(id)}/results${queryString({
        limit: params?.limit,
        offset: params?.offset
      })}`
    ),
  deletePromptTemplateResult: (id: string) =>
    request<{ ok: boolean }>(`/api/prompt-template-results/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  assetCategories: () => request<{ categories: CaseCategory[] }>("/api/assets/categories"),
  createAssetCategory: (name: string) =>
    request<{ category: CaseCategory }>("/api/assets/categories", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  images: (params?: ImagePageQuery) =>
    request<PagedResponse<{ images: WorkImage[]; counts?: ImageCounts }>>(
      `/api/images${queryString({
        limit: params?.limit,
        offset: params?.offset,
        keyword: params?.keyword,
        sort: params?.sort,
        favoriteOnly: params?.favoriteOnly
      })}`
    ),
  suggestImageAssetCategories: (imageId: string) =>
    request<{ image: WorkImage; categoryIds: string[]; generated: boolean }>(
      `/api/images/${encodeURIComponent(imageId)}/asset-suggestions`,
      { method: "POST" }
    ),
  suggestImageCaseFields: (imageId: string) =>
    request<{ image: WorkImage; title: string; categoryIds: string[]; generated: boolean }>(
      `/api/images/${encodeURIComponent(imageId)}/case-suggestions`,
      { method: "POST" }
    ),
  imageEditSuggestions: (imageId: string, language?: string) =>
    request<{ imageId: string; suggestions: ImageEditSuggestion[]; generated: boolean }>(
      `/api/images/${encodeURIComponent(imageId)}/edit-suggestions${queryString({ language })}`
    ),
  generate: (payload: GenerateImagePayload) =>
    request<{ sessionId: string; job: ImageJob | null; image: WorkImage | null; images?: WorkImage[]; error?: string }>("/api/images/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  edit: (payload: EditImagePayload) =>
    request<{ sessionId: string; job: ImageJob | null; image: WorkImage | null; images?: WorkImage[]; error?: string }>("/api/images/edit", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  assets: (params?: AssetPageQuery) =>
    request<PagedResponse<{ assets: AssetItem[]; counts?: AssetCounts }>>(
      `/api/assets${queryString({
        limit: params?.limit,
        offset: params?.offset,
        keyword: params?.keyword,
        categoryIds: params?.categoryIds,
        space: params?.space
      })}`
    ),
  uploadAsset: (form: FormData) =>
    request<{ asset: AssetItem; created?: boolean; duplicateScope?: "shared" | "own" }>("/api/assets/upload", {
      method: "POST",
      body: form
    }),
  addAssetFromImage: (payload: { imageId?: string; caseItemId?: string; name?: string; spaceMode?: "private" | "shared" | "private_shared"; categoryIds?: string[] }) =>
    request<{ asset: AssetItem | null; created: boolean; duplicateScope?: "shared" | "own" }>("/api/assets/from-image", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  addAssetsFromImages: (payload: { imageIds: string[]; spaceMode: "private" | "shared" | "private_shared"; autoCategory: true; duplicateMode: "skip" }) =>
    request<ImageBatchResult>("/api/assets/from-images", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  setImageFavorite: (imageId: string, favorited: boolean) =>
    request<{ favorited: boolean; favoriteCount: number }>(`/api/images/${imageId}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorited })
    }),
  setImageBatchFavorite: (imageIds: string[], favorited: boolean) =>
    request<ImageBatchResult & { favorited: boolean }>("/api/images/batch/favorite", {
      method: "PUT",
      body: JSON.stringify({ imageIds, favorited })
    }),
  deleteImage: (imageId: string) =>
    request<{ ok: boolean }>(`/api/images/${imageId}`, {
      method: "DELETE"
    }),
  imageBatchDeletePreview: (imageIds: string[]) =>
    request<{ requested: number; impact: ImageDeleteImpact }>("/api/images/batch/delete-preview", {
      method: "POST",
      body: JSON.stringify({ imageIds })
    }),
  deleteImagesBatch: (imageIds: string[], confirmAssociated: boolean) =>
    request<ImageBatchDeleteResult>("/api/images/batch/delete", {
      method: "POST",
      body: JSON.stringify({ imageIds, confirmAssociated })
    }),
  createImageBatchDownload: (payload: { imageIds: string[]; variant: ImageBatchDownloadVariant; includeManifest: boolean }) =>
    request<ImageBatchDownloadTicket>("/api/files/images/batch-downloads", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateAsset: (assetId: string, payload: { name?: string; space?: AssetItem["space"]; shared?: boolean; categoryIds?: string[] }) =>
    request<{ asset: AssetItem }>(`/api/assets/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteAsset: (assetId: string) =>
    request<{ ok: boolean }>(`/api/assets/${assetId}`, {
      method: "DELETE"
    }),
  imageDownloadOptions: (imageId: string) =>
    request<{ options: ImageDownloadOption[] }>(`/api/files/images/${encodeURIComponent(imageId)}/download-options`),
  assetDownloadOptions: (assetId: string) =>
    request<{ options: ImageDownloadOption[] }>(`/api/files/assets/${encodeURIComponent(assetId)}/download-options`),
  imageReferenceDownloadOptions: (referenceId: string) =>
    request<{ options: ImageDownloadOption[] }>(`/api/files/image-references/${encodeURIComponent(referenceId)}/download-options`),
  addCase: (payload: { imageId?: string; imageIds?: string[]; assetId?: string; coverImageId?: string; categoryIds: string[]; title: string; prompt: string; includeReferences?: boolean; autoCategory?: boolean; duplicateMode?: "skip" }) =>
    request<{ caseItems: Array<Record<string, string | number | boolean | string[]>>; skipped: number; createdImageIds?: string[]; skippedImageIds?: string[] }>("/api/cases", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  addCasesFromImages: (payload: { imageIds: string[]; includeReferences: boolean }) =>
    request<ImageBatchResult>("/api/cases/from-images", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  setCaseCover: (caseId: string, payload: { imageId?: string; groupImageId?: string; sourceId?: string; assetId?: string }) =>
    request<{ ok: boolean; groupId: string; coverImageId: string }>(`/api/cases/${caseId}/cover`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  updateCase: (caseId: string, payload: { title: string; prompt: string; categoryIds?: string[]; categoryId?: string; includeReferences?: boolean }) =>
    request<{ caseItems: Array<Record<string, string | number | boolean | string[]>> }>(`/api/cases/${caseId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  setCaseFavorite: (caseId: string, favorited: boolean) =>
    request<{ favorited: boolean; favoriteCount: number }>(`/api/cases/${caseId}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorited })
    }),
  submitCaseReview: (caseId: string) =>
    request<{ ok: boolean; groupId: string; reviewStatus: "pending" | "approved" | "rejected" }>(
      `/api/cases/${encodeURIComponent(caseId)}/review/submit`,
      { method: "POST" }
    ),
  deleteCase: (caseId: string) =>
    request<{ ok: boolean }>(`/api/cases/${caseId}`, {
      method: "DELETE"
    })
};
