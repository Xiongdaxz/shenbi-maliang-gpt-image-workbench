import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Archive,
  Bot,
  Bug,
  Check,
  Database,
  Download,
  FolderOpen,
  ImageIcon,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Mail,
  Network,
  PanelLeft,
  Pencil,
  ScrollText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
  Users,
  WandSparkles
} from "lucide-react";
import { api, configApi } from "../../api";
import { LightweightLineChart } from "../../components/LightweightChart";
import { MarkdownView } from "../../components/MarkdownView";
import { useInfinitePageLoader } from "../../hooks/useInfinitePageLoader";
import { DEFAULT_SITE_NAME } from "../../lib/branding";
import { copyTextToClipboard } from "../../lib/clipboard";
import { cx } from "../../lib/cx";
import { formatImageFileSize } from "../../lib/format";
import type {
  BackupRun,
  BackupSettings,
  ChangelogEntry,
  BrandingAsset,
  BrandingAssetType,
  BrandingSettings,
  ConfigStatistics,
  DebugSettings,
  ImageAccount,
  ImageAccountImportPreviewItem,
  ImageAccountImportSource,
  ImageGenerationMode,
  GlobalSwitchType,
  ModelRequestLog,
  PromptOptimizerProvider,
  ProviderConfig,
  ProviderRequestLog,
  ProxyConfig,
  SafetyReviewLog,
  SafetyReviewSettings,
  SmsSettings,
  StatisticsPreset,
  SmtpSettings,
  StarterCopySettings,
  StarterDailyCopy,
  Team
} from "../../types";
import type { ConfigAssetReviewItem, ConfigCaseReviewItem } from "../../api/config";
import { ConfirmDialog, CustomSelect, PromptDialog, useToast } from "../../ui";
import {
  ConfigHeader,
  REQUEST_LOG_PAGE_SIZE,
  SwitchControl,
  channelLabels,
  durationLabel,
  emptyProvider,
  formatDate,
  inputDateOffset,
  inputDateValue,
  nextChangelogVersion,
  numberLabel,
  percentLabel,
  providerDateFromId,
  providerIdTimestamp,
  providerWithChannelDefaults,
  routeModeLabels,
  shouldAutoRefreshAccountUsage,
  todayInputDate,
  uniqueProviderFormId,
  isGeneratedProviderId,
  isGeneratedProviderName
} from "../shared";

const accountStatusLabels: Record<ImageAccount["status"], string> = {
  normal: "可用",
  limited: "Codex 限流",
  abnormal: "异常",
  disabled: "禁用"
};

function accountPlanTone(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "empty";
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("plus")) return "plus";
  if (["prolite", "pro", "team", "business", "enterprise"].some((plan) => tokens.includes(plan))) return "premium";
  return "standard";
}

function accountPlanLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("prolite")) return `${value} 5x`;
  if (tokens.includes("pro")) return `${value} 20x`;
  return value;
}

function accountPlanTip(value: string) {
  const normalized = value.trim().toLowerCase();
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("prolite")) return "5x 额度";
  if (tokens.includes("pro")) return "20x 额度";
  return "标准额度";
}

function AccountPlanTag({ value }: { value: string | null | undefined }) {
  const label = String(value ?? "").trim();
  if (!label) return <span className="account-empty-value">-</span>;
  return (
    <span
      className={cx("account-tag", "account-plan-tag", `plan-${accountPlanTone(label)}`)}
      data-account-tip={accountPlanTip(label)}
    >
      {accountPlanLabel(label)}
    </span>
  );
}

function AccountStatusTag({ status }: { status: ImageAccount["status"] }) {
  return (
    <span className={cx("account-tag", "account-status-tag", `status-${status}`)}>
      {accountStatusLabels[status]}
    </span>
  );
}

function emptyImageAccountForm(): Partial<ImageAccount> {
  return {
    name: "",
    channelId: "",
    email: "",
    accountType: "",
    status: "normal",
    quota: 0,
    usedQuota: 0,
    priority: 0,
    accessToken: "",
    authJson: "",
    authInfoJson: "",
    note: ""
  };
}

function formatJsonTextareaValue(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function parseJsonTextareaValue(value: string | null | undefined): unknown | null {
  const text = String(value ?? "").trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstStringFromJsonValue(source: unknown, keys: string[], depth = 0): string {
  if (!source || depth > 8) return "";
  if (typeof source === "string") {
    const parsed = parseJsonTextareaValue(source);
    return parsed ? firstStringFromJsonValue(parsed, keys, depth + 1) : "";
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = firstStringFromJsonValue(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof source !== "object") return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  for (const value of Object.values(record)) {
    const found = firstStringFromJsonValue(value, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function jsonFileName(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text.split(/[\\/]/).pop()?.trim() ?? text;
}

function extractAccountJsonMeta(value: string | null | undefined) {
  const parsed = parseJsonTextareaValue(value);
  if (!parsed) {
    return { accessToken: "", email: "", accountType: "", accountId: "", remoteName: "", displayName: "" };
  }
  const remoteName =
    firstStringFromJsonValue(parsed, ["remote_name", "remoteName", "name", "file_name", "fileName"]) ||
    jsonFileName(firstStringFromJsonValue(parsed, ["path"]));
  const email = firstStringFromJsonValue(parsed, ["email", "account_email", "accountEmail", "username", "account"]);
  const accountType = firstStringFromJsonValue(parsed, ["account_type", "accountType", "type", "plan_type", "planType", "chatgpt_plan_type", "chatgptPlanType"]);
  const accountId = firstStringFromJsonValue(parsed, ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId"]);
  return {
    accessToken: firstStringFromJsonValue(parsed, ["access_token", "accessToken", "token"]),
    email,
    accountType,
    accountId,
    remoteName,
    displayName: firstStringFromJsonValue(parsed, ["label", "display_name", "displayName"]) || email || remoteName || accountId
  };
}

function applyAccountJsonMeta(form: Partial<ImageAccount>, authJson: string) {
  const meta = extractAccountJsonMeta(authJson);
  const currentName = String(form.name ?? "").trim();
  const currentEmail = String(form.email ?? "").trim();
  const nextName =
    !currentName || currentName === currentEmail || currentName === "图片账号"
      ? meta.displayName || currentName
      : currentName;
  return {
    ...form,
    authJson,
    ...(meta.accessToken ? { accessToken: meta.accessToken } : {}),
    ...(meta.email ? { email: meta.email } : {}),
    ...(meta.accountType ? { accountType: meta.accountType } : {}),
    ...(meta.remoteName ? { remoteName: meta.remoteName } : {}),
    ...(nextName ? { name: nextName } : {})
  };
}

function imageAccountFormFromAccount(account?: ImageAccount): Partial<ImageAccount> {
  if (!account) return emptyImageAccountForm();
  return {
    name: account.name,
    remoteName: account.remoteName,
    channelId: account.channelId,
    email: account.email,
    accountType: account.accountType,
    status: account.status,
    quota: account.quota,
    usedQuota: account.usedQuota,
    priority: account.priority,
    accessToken: account.accessToken,
    authJson: formatJsonTextareaValue(account.authJson),
    authInfoJson: formatJsonTextareaValue(account.authInfoJson),
    note: account.note
  };
}

function imageAccountSyncLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "synced") return "已同步";
  if (normalized === "pending") return "待同步";
  if (normalized === "failed") return "同步失败";
  if (normalized === "remote") return "远端";
  return "本地";
}

function formatUsagePercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-";
}

function formatUsageReset(value: string | null | undefined) {
  if (!value) return "";
  return formatDate(value);
}

function accountCreditsLabel(account: ImageAccount) {
  if (account.codexCreditsUnlimited) return "无限";
  return account.codexCreditsBalance || "-";
}

function accountCreditsLine(account: ImageAccount) {
  const updatedAt = account.codexUsageUpdatedAt ? ` · 刷新 ${formatDate(account.codexUsageUpdatedAt)}` : "";
  return `Credits：${accountCreditsLabel(account)}${updatedAt}`;
}

function AccountUsageBar({ label, value, resetAt }: { label: string; value: number | null; resetAt: string }) {
  const usedPercent =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(Math.max(0, Math.min(100, value)) * 10) / 10
      : null;
  const remainingPercent = usedPercent === null ? null : Math.max(0, Math.round((100 - usedPercent) * 10) / 10);
  return (
    <div className="account-usage-row">
      <div className="account-usage-line">
        <span>{label}</span>
        <span className="account-usage-meta">
          <strong>{formatUsagePercent(remainingPercent)}</strong>
          {resetAt ? <small>{formatUsageReset(resetAt)}</small> : null}
        </span>
      </div>
      <div className="account-usage-bar" aria-hidden="true">
        <span style={{ width: `${remainingPercent ?? 0}%` }} />
      </div>
    </div>
  );
}

function AccountUsageCell({ account }: { account: ImageAccount }) {
  const rawDynamicWindows = Array.isArray(account.codexUsageWindows)
    ? account.codexUsageWindows.filter((window) => {
        return window && typeof window === "object" && typeof window.label === "string" && window.label.trim();
      })
    : [];
  // Previous releases wrote the primary response window twice: once as a hard-coded
  // 5-hour limit and again as the weekly limit. Hide only that exact stale duplicate;
  // a real, separately reset 5-hour window would still be displayed.
  const dynamicWindows = rawDynamicWindows.filter((window) => {
    if (window.label.replace(/\s+/g, "") !== "5小时限额") return true;
    return !rawDynamicWindows.some(
      (candidate) =>
        candidate.label.replace(/\s+/g, "") === "周限额" &&
        candidate.usedPercent === window.usedPercent &&
        candidate.resetAt === window.resetAt
    );
  });
  const usageWindows =
    dynamicWindows.length > 0
      ? dynamicWindows
      : [
          { label: "周限额", usedPercent: account.codexWeekUsedPercent, resetAt: account.codexWeekResetAt }
        ].filter((item) => item.usedPercent !== null || item.resetAt);
  const hasUsage = usageWindows.length > 0;
  const missingToken = !account.accessToken && !account.hasAuthJson;
  return (
    <div className="account-usage-cell">
      {hasUsage ? (
        <>
          {usageWindows.map((window) => (
            <AccountUsageBar
              key={`${window.label}-${window.resetAt}`}
              label={window.label}
              value={window.usedPercent}
              resetAt={window.resetAt}
            />
          ))}
          <small>{accountCreditsLine(account)}</small>
        </>
      ) : (
        <span className="muted">{account.codexUsageError || (missingToken ? "缺少 Access Token" : "暂未获取")}</span>
      )}
    </div>
  );
}

function AccountCpaStats({ account }: { account: ImageAccount }) {
  return (
    <div className="account-request-stats">
      <span>成功 {account.usageSuccessCount}</span>
      <span>失败 {account.usageFailureCount}</span>
    </div>
  );
}

function AccountLocalStats({ account }: { account: ImageAccount }) {
  const hasStats = account.localSuccessCount > 0 || account.localFailureCount > 0 || Boolean(account.localLastRequestAt);
  if (!hasStats) {
    return <span className="muted">仅统计官网号池调用</span>;
  }
  return (
    <div className="account-request-stats">
      <span>成功调用 {account.localSuccessCount}</span>
      <span>失败调用 {account.localFailureCount}</span>
      {account.localLastRequestAt ? <small>最近 {formatDate(account.localLastRequestAt)}</small> : null}
    </div>
  );
}

function accountAuthInfoLabel(account: ImageAccount) {
  if (account.hasAuthJson && account.hasAuthInfoJson) return "授权 / 认证";
  if (account.hasAuthJson) return "授权";
  if (account.hasAuthInfoJson) return "认证";
  return "-";
}

function ImageAccountDialog({
  mode,
  account,
  providers,
  error,
  saving,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  account?: ImageAccount;
  providers: ProviderConfig[];
  error?: Error | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Partial<ImageAccount>) => void;
}) {
  const [form, setForm] = useState<Partial<ImageAccount>>(() => imageAccountFormFromAccount(account));

  return (
    <div className="modal-backdrop">
      <section className="case-modal image-account-modal">
        <header>
          <h3>{mode === "create" ? "新增图片账号" : "编辑图片账号"}</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="provider-form image-account-form">
          <label>
            账号名称
            <input
              value={form.name ?? ""}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoFocus
            />
          </label>
          <label>
            绑定渠道
            <CustomSelect
              value={form.channelId ?? ""}
              onChange={(value) => setForm({ ...form, channelId: value })}
              options={[
                { value: "", label: "不绑定" },
                ...providers.map((provider) => ({ value: provider.id, label: provider.name }))
              ]}
            />
          </label>
          <label>
            邮箱
            <input value={form.email ?? ""} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            订阅套餐
            <input
              value={form.accountType ?? ""}
              onChange={(event) => setForm({ ...form, accountType: event.target.value })}
              placeholder="Free / Plus / Pro / Team"
            />
          </label>
          <label>
            状态
            <CustomSelect
              value={form.status ?? "normal"}
              onChange={(value) => setForm({ ...form, status: value as ImageAccount["status"] })}
              options={[
                { value: "normal", label: "可用" },
                { value: "limited", label: "Codex 限流" },
                { value: "abnormal", label: "异常" },
                { value: "disabled", label: "禁用" }
              ]}
            />
          </label>
          <label>
            优先级
            <input
              type="number"
              value={form.priority ?? 0}
              onChange={(event) => setForm({ ...form, priority: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            总额度
            <input
              type="number"
              min={0}
              value={form.quota ?? 0}
              onChange={(event) => setForm({ ...form, quota: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            已用额度
            <input
              type="number"
              min={0}
              value={form.usedQuota ?? 0}
              onChange={(event) => setForm({ ...form, usedQuota: Number(event.target.value) || 0 })}
            />
          </label>
          <label className="wide">
            访问令牌
            <input
              value={form.accessToken ?? ""}
              onChange={(event) => setForm({ ...form, accessToken: event.target.value })}
              placeholder="可留空；保存后会脱敏显示"
            />
          </label>
          <label className="wide">
            授权 JSON
            <textarea
              rows={5}
              value={form.authJson ?? ""}
              onChange={(event) => setForm((current) => applyAccountJsonMeta(current, event.target.value))}
              onBlur={() =>
                setForm((current) => {
                  const formatted = formatJsonTextareaValue(current.authJson);
                  return applyAccountJsonMeta(current, formatted);
                })
              }
              placeholder="可粘贴完整授权 JSON，系统会尽量提取邮箱、类型和令牌"
            />
          </label>
          <label className="wide">
            认证信息 JSON
            <textarea
              rows={4}
              value={form.authInfoJson ?? ""}
              onChange={(event) => setForm({ ...form, authInfoJson: event.target.value })}
              onBlur={() => setForm((current) => ({ ...current, authInfoJson: formatJsonTextareaValue(current.authInfoJson) }))}
              placeholder="CPA 同步的 id_token / 账号认证信息"
            />
          </label>
          <label className="wide">
            备注
            <textarea
              rows={3}
              value={form.note ?? ""}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <div className="row-actions">
            <button className="secondary-btn" onClick={onClose}>
              取消
            </button>
            <button className="primary-btn" onClick={() => onSubmit(form)} disabled={saving}>
              <Save size={16} />
              {mode === "create" ? "新增账号" : "保存账号"}
            </button>
          </div>
          {error ? <div className="form-error">{error.message}</div> : null}
        </div>
      </section>
    </div>
  );
}

function importActionLabel(item: ImageAccountImportPreviewItem) {
  if (item.status === "error") return "跳过";
  if (item.action === "update") return "更新";
  if (item.action === "create") return "新增";
  return "跳过";
}

function importStatusLabel(item: ImageAccountImportPreviewItem) {
  if (item.status === "error") return item.error || "不可导入";
  if (item.duplicateName) return `${item.duplicateReason}：${item.duplicateName}`;
  return "可导入";
}

function importSourceKey(items: ImageAccountImportSource[], channelId: string) {
  return JSON.stringify({
    channelId,
    items: items.map((item) => ({
      id: item.id ?? "",
      name: item.name ?? "",
      content: item.content ?? "",
      value: item.value ?? null
    }))
  });
}

function ImageAccountBulkImportDialog({
  providers,
  onClose,
  onImported
}: {
  providers: ProviderConfig[];
  onClose: () => void;
  onImported: (result: { message: string; appendedToProvider: boolean }) => void;
}) {
  const [channelId, setChannelId] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [fileSources, setFileSources] = useState<ImageAccountImportSource[]>([]);
  const [fileError, setFileError] = useState("");
  const [previewItems, setPreviewItems] = useState<ImageAccountImportPreviewItem[]>([]);
  const [previewKey, setPreviewKey] = useState("");
  const sources = useMemo<ImageAccountImportSource[]>(() => {
    const items = [...fileSources];
    if (pasteContent.trim()) items.push({ id: "pasted-content", name: "粘贴内容", content: pasteContent });
    return items;
  }, [fileSources, pasteContent]);
  const sourcesKey = useMemo(() => importSourceKey(sources, channelId), [sources, channelId]);
  const readyItems = previewItems.filter((item) => item.status === "ready");
  const dirtyPreview = previewItems.length > 0 && previewKey !== sourcesKey;
  const selectedProvider = providers.find((provider) => provider.id === channelId);
  const preview = useMutation({
    mutationFn: (payload: { items: ImageAccountImportSource[]; channelId: string; sourceKey: string }) =>
      configApi.previewImageAccountImport({ items: payload.items, channelId: payload.channelId }),
    onSuccess: (result, payload) => {
      setPreviewItems(result.items);
      setPreviewKey(payload.sourceKey);
    }
  });
  const confirmImport = useMutation({
    mutationFn: () =>
      configApi.importImageAccounts({
        items: sources,
        channelId,
        rowIds: readyItems.map((item) => item.rowId)
      }),
    onSuccess: (result) => {
      onImported(result);
    }
  });

  useEffect(() => {
    if (sources.length === 0) {
      setPreviewItems([]);
      setPreviewKey("");
      return;
    }
    const timer = window.setTimeout(() => {
      preview.mutate({ items: sources, channelId, sourceKey: sourcesKey });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [sourcesKey]);

  async function handleFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    setFileError("");
    setPreviewItems([]);
    setPreviewKey("");
    if (selectedFiles.length === 0) return;
    try {
      const nextSources = await Promise.all(
        selectedFiles.map(async (file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          content: await file.text()
        }))
      );
      setFileSources(nextSources);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "文件读取失败");
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="case-modal image-account-import-modal">
        <header>
          <h3>批量导入图片账号</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="provider-form image-account-import-form">
          <div className="image-account-import-layout">
            <div className="import-options-panel">
              <label>
                绑定渠道
                <CustomSelect
                  value={channelId}
                  onChange={(value) => {
                    setChannelId(value);
                    setPreviewItems([]);
                    setPreviewKey("");
                  }}
                  options={[
                    { value: "", label: "不绑定渠道" },
                    ...providers.map((provider) => ({ value: provider.id, label: `${provider.name} · ${provider.channel}` }))
                  ]}
                />
                {selectedProvider?.channel === "chatgpt_web" ? (
                  <small>导入成功后会自动加入该 ChatGPT Web 渠道的号池选择。</small>
                ) : null}
              </label>
              <label className="image-account-file-input">
                上传 JSON
                <input
                  type="file"
                  accept=".json,application/json,text/json,text/plain"
                  multiple
                  onChange={(event) => {
                    void handleFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <small>{fileSources.length > 0 ? `已选择 ${fileSources.length} 个文件，已自动解析` : "支持选择多个 .json 文件"}</small>
              </label>
              <label>
                粘贴 JSON
                <textarea
                  rows={9}
                  value={pasteContent}
                  onChange={(event) => {
                    setPasteContent(event.target.value);
                    setPreviewItems([]);
                    setPreviewKey("");
                  }}
                  placeholder="支持单个 JSON、JSON 数组、{ files: [...] } 或一行一个 JSON"
                />
              </label>
              <div className="row-actions image-account-import-actions">
                <button className="secondary-btn" type="button" onClick={onClose}>
                  取消
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => confirmImport.mutate()}
                  disabled={confirmImport.isPending || preview.isPending || dirtyPreview || readyItems.length === 0}
                >
                  <Save size={16} />
                  {confirmImport.isPending ? "导入中" : "确认导入"}
                </button>
              </div>
              {fileError ? <div className="form-error">{fileError}</div> : null}
              {preview.error ? <div className="form-error">{preview.error.message}</div> : null}
              {confirmImport.error ? <div className="form-error">{confirmImport.error.message}</div> : null}
            </div>
            <div className="import-preview-panel">
              <div className="import-preview-header">
                <strong>导入预览</strong>
                <span>{preview.isPending || dirtyPreview ? "自动解析中" : readyItems.length > 0 ? `${readyItems.length} 个可导入` : "等待输入"}</span>
              </div>
              {previewItems.length > 0 ? (
                <div className="import-preview">
                  <div className="import-preview-summary">
                    <span>总计 {previewItems.length}</span>
                    <span>新增 {previewItems.filter((item) => item.action === "create").length}</span>
                    <span>更新 {previewItems.filter((item) => item.action === "update").length}</span>
                    <span>跳过 {previewItems.filter((item) => item.status === "error").length}</span>
                  </div>
                  <div className="table-wrap import-preview-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>来源</th>
                          <th>账号</th>
                          <th>套餐</th>
                          <th>Account ID</th>
                          <th>Token</th>
                          <th>动作</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewItems.map((item) => (
                          <tr key={item.rowId} className={item.status === "error" ? "import-row-error" : undefined}>
                            <td>{item.sourceName}</td>
                            <td>
                              <strong>{item.name || "-"}</strong>
                              <small>{item.email || item.remoteName || "-"}</small>
                            </td>
                            <td>{item.accountType || "-"}</td>
                            <td className="mono-cell">{item.accountId || "-"}</td>
                            <td>{item.hasAccessToken ? item.tokenPreview || "已识别" : "缺少"}</td>
                            <td>{importActionLabel(item)}</td>
                            <td>{importStatusLabel(item)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="import-preview-empty">
                  {sources.length === 0 ? "上传文件或粘贴 JSON 后会自动解析。" : "正在准备预览..."}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ImageAccountPoolPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const didAutoRefreshUsage = useRef(false);
  const accounts = useQuery({ queryKey: ["config-image-accounts"], queryFn: configApi.imageAccounts });
  const providers = useQuery({ queryKey: ["config-providers"], queryFn: configApi.providers });
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; account?: ImageAccount } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ImageAccount | null>(null);
  const loadAccountForEdit = useMutation({
    mutationFn: (accountId: string) => configApi.imageAccount(accountId),
    onSuccess: (result) => {
      if (result.account) setDialog({ mode: "edit", account: result.account });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "账号详情读取失败", "error")
  });
  const save = useMutation({
    mutationFn: ({
      mode,
      accountId,
      payload
    }: {
      mode: "create" | "edit";
      accountId?: string;
      payload: Partial<ImageAccount>;
    }) => (mode === "edit" && accountId ? configApi.updateImageAccount(accountId, payload) : configApi.createImageAccount(payload)),
    onSuccess: (_data, variables) => {
      setDialog(null);
      showToast(variables.mode === "edit" ? "图片账号已保存" : "图片账号已新增");
      queryClient.invalidateQueries({ queryKey: ["config-image-accounts"] });
    }
  });
  const remove = useMutation({
    mutationFn: configApi.deleteImageAccount,
    onSuccess: () => {
      setDialog(null);
      setRemoveTarget(null);
      showToast("图片账号已删除");
      queryClient.invalidateQueries({ queryKey: ["config-image-accounts"] });
    }
  });
  const refreshUsage = useMutation({
    mutationFn: (accountId?: string) => configApi.refreshImageAccountUsage(accountId),
    onSuccess: (result) => {
      showToast(result.message);
      queryClient.invalidateQueries({ queryKey: ["config-image-accounts"] });
    }
  });

  useEffect(() => {
    if (didAutoRefreshUsage.current || !accounts.isSuccess) return;
    didAutoRefreshUsage.current = true;
    if (!shouldAutoRefreshAccountUsage()) return;
    refreshUsage.mutate(undefined);
  }, [accounts.isSuccess]);

  function closeDialog() {
    save.reset();
    setDialog(null);
  }

  return (
    <section className="config-card">
      <div className="account-pool-head">
        <div className="account-pool-title">
          <div>
            <h1>账号管理</h1>
            <p>维护图片账号号池、额度、优先级和同步状态。</p>
          </div>
        </div>
        <div className="account-list-actions">
          <div className="account-pool-stats" aria-label="账号池统计">
            <span><strong>{accounts.data?.summary.total ?? 0}</strong>账号</span>
            <span><strong>{accounts.data?.summary.available ?? 0}</strong>可用</span>
          </div>
          <button className="secondary-btn" onClick={() => refreshUsage.mutate(undefined)} disabled={refreshUsage.isPending}>
            <RefreshCw className={refreshUsage.isPending ? "spin-icon" : undefined} size={16} />
            全部刷新额度
          </button>
          <button className="secondary-btn" onClick={() => setImportDialogOpen(true)}>
            <Upload size={16} />
            批量导入
          </button>
          <button className="primary-btn" onClick={() => setDialog({ mode: "create" })}>
            <Plus size={16} />
            新增账号
          </button>
        </div>
      </div>
      {refreshUsage.error ? <div className="form-error">{refreshUsage.error.message}</div> : null}
      <div className="table-wrap account-table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>订阅套餐</th>
              <th>状态</th>
              <th>Codex 额度</th>
              <th>CPA统计</th>
              <th>本地统计</th>
              <th>认证信息</th>
              <th>优先级</th>
              <th>同步</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.data?.accounts.map((account) => {
              const refreshingThisAccount = refreshUsage.isPending && refreshUsage.variables === account.id;
              return (
                <tr key={account.id}>
                  <td>
                    <strong>{account.name}</strong>
                    <small>{account.email || "未填写邮箱"}</small>
                  </td>
                  <td>
                    <AccountPlanTag value={account.accountType} />
                  </td>
                  <td>
                    <AccountStatusTag status={account.status} />
                  </td>
                  <td>
                    <AccountUsageCell account={account} />
                  </td>
                  <td>
                    <AccountCpaStats account={account} />
                  </td>
                  <td>
                    <AccountLocalStats account={account} />
                  </td>
                  <td>{accountAuthInfoLabel(account)}</td>
                  <td>{account.priority}</td>
                  <td>{imageAccountSyncLabel(account.syncStatus)}</td>
                  <td className="row-actions compact-actions">
                    <button
                      className="account-action-icon secondary-btn"
                      onClick={() => refreshUsage.mutate(account.id)}
                      disabled={refreshUsage.isPending}
                      aria-label={refreshingThisAccount ? "刷新额度中" : "刷新额度"}
                      title={refreshingThisAccount ? "刷新额度中" : "刷新额度"}
                    >
                      <RefreshCw className={refreshingThisAccount ? "spin-icon" : undefined} size={15} />
                    </button>
                    <button
                      className="account-action-icon secondary-btn"
                      onClick={() => loadAccountForEdit.mutate(account.id)}
                      disabled={loadAccountForEdit.isPending}
                      aria-label="编辑账号"
                      title={loadAccountForEdit.isPending ? "读取账号详情中" : "编辑账号"}
                    >
                      <Pencil className={loadAccountForEdit.isPending && loadAccountForEdit.variables === account.id ? "spin-icon" : undefined} size={15} />
                    </button>
                    <button
                      className="account-action-icon danger-btn"
                      onClick={() => setRemoveTarget(account)}
                      aria-label="删除账号"
                      title="删除账号"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {accounts.data?.accounts.length === 0 ? (
              <tr>
                <td colSpan={10}>暂无图片账号</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog ? (
        <ImageAccountDialog
          mode={dialog.mode}
          account={dialog.account}
          providers={providers.data?.providers ?? []}
          error={save.error}
          saving={save.isPending}
          onClose={closeDialog}
          onSubmit={(payload) =>
            save.mutate({
              mode: dialog.mode,
              accountId: dialog.account?.id,
              payload
            })
          }
        />
      ) : null}
      {importDialogOpen ? (
        <ImageAccountBulkImportDialog
          providers={providers.data?.providers ?? []}
          onClose={() => setImportDialogOpen(false)}
          onImported={(result) => {
            setImportDialogOpen(false);
            showToast(result.appendedToProvider ? `${result.message}，已加入官网渠道号池` : result.message);
            queryClient.invalidateQueries({ queryKey: ["config-image-accounts"] });
            queryClient.invalidateQueries({ queryKey: ["config-providers"] });
            queryClient.invalidateQueries({ queryKey: ["providers"] });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="删除图片账号"
        description={removeTarget ? `确认删除图片账号「${removeTarget.name}」？` : ""}
        confirmText="删除"
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) remove.mutate(removeTarget.id);
        }}
      />
    </section>
  );
}

const routeModeOptions: Array<{ value: ProviderConfig["routeMode"]; label: string }> = [
  { value: "images_api", label: "图片接口直连：直接请求生成/编辑接口" },
  { value: "responses", label: "Responses 接口：统一走 /v1/responses" },
  { value: "auto", label: "失败自动切换：图片接口失败后自动切换" }
];

const quotaModeOptions: Array<{ value: ProviderConfig["quotaMode"]; label: string; description: string }> = [
  { value: "codex_first", label: "Codex 优先", description: "先走 Codex Responses，失败再走官网会话链路" },
  { value: "official_first", label: "官网优先", description: "先走官网会话链路，失败再走 Codex Responses" },
  { value: "codex_only", label: "只走 Codex", description: "只请求 codex-gpt-image-2 额度链路" },
  { value: "official_only", label: "只走官网", description: "只请求 ChatGPT 官网会话链路" }
];

const webAccountModeLabels: Record<ProviderConfig["webAccountMode"], string> = {
  priority: "按优先级",
  round_robin: "轮询",
  random: "随机"
};

const webAccountModeOptions: Array<{ value: ProviderConfig["webAccountMode"]; label: string; description: string }> = [
  { value: "priority", label: "按优先级", description: "优先使用高优先级账号" },
  { value: "round_robin", label: "轮询", description: "在可用账号之间轮流调用" },
  { value: "random", label: "随机", description: "每次随机挑选可用账号" }
];

const imageModeLabels: Record<ImageGenerationMode["mode"], string> = {
  auto: "自动模式",
  cpa: "CPA 模式",
  chatgpt_web: "官网模式",
  api: "API 模式"
};

const imageModeOptions: Array<{ value: ImageGenerationMode["mode"]; title: string; body: string; foot: string }> = [
  {
    value: "auto",
    title: "自动模式",
    body: "按顺序依次尝试 CPA、ChatGPT 官网和 API 直连渠道。",
    foot: "适合日常使用，某条链路失败后自动尝试下一条。"
  },
  {
    value: "cpa",
    title: "CPA 模式",
    body: "只使用 CPA 额度代理渠道。",
    foot: "适合只消耗 Codex/CPA 额度。"
  },
  {
    value: "chatgpt_web",
    title: "官网模式",
    body: "只使用 ChatGPT 官网逆向渠道，可配置官网额度、Codex 额度或都走。",
    foot: "默认 Codex 优先，失败后可回退官网会话链路。"
  },
  {
    value: "api",
    title: "API 模式",
    body: "只使用 OpenAI 兼容或私有 API 直连渠道。",
    foot: "适合标准 API Key 或第三方兼容接口。"
  }
];

type ProviderChannelFilter = ProviderConfig["channel"] | "all";

function providerChannelFilterOptions(counts: Record<ProviderChannelFilter, number>) {
  return [
    { value: "all", label: "全部", count: counts.all },
    { value: "cpa", label: "CPA", count: counts.cpa },
    { value: "chatgpt_web", label: "ChatGPT 官网", count: counts.chatgpt_web },
    { value: "api", label: "API 直连", count: counts.api }
  ];
}

export function ImageModePanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const imageMode = useQuery({ queryKey: ["config-image-mode"], queryFn: configApi.imageMode });
  const providers = useQuery({ queryKey: ["config-providers"], queryFn: configApi.providers });
  const [mode, setMode] = useState<ImageGenerationMode["mode"]>("auto");
  const [resultRetryCountInput, setResultRetryCountInput] = useState("1");
  const save = useMutation({
    mutationFn: ({
      nextMode,
      resultRetryCount
    }: {
      nextMode: ImageGenerationMode["mode"];
      resultRetryCount: ImageGenerationMode["resultRetryCount"];
      toast: "mode" | "policy";
    }) => configApi.saveImageMode({ mode: nextMode, resultRetryCount }),
    onSuccess: (data, variables) => {
      const savedMode = data.imageMode.mode || variables.nextMode;
      setMode(savedMode);
      setResultRetryCountInput(data.imageMode.resultRetryCount === null ? "" : String(data.imageMode.resultRetryCount));
      showToast(variables.toast === "mode" ? `${imageModeLabels[savedMode]}已启用` : "请求策略已保存");
      queryClient.invalidateQueries({ queryKey: ["config-image-mode"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    }
  });

  useEffect(() => {
    if (!imageMode.data?.imageMode) return;
    setMode(imageMode.data.imageMode.mode);
    setResultRetryCountInput(imageMode.data.imageMode.resultRetryCount === null ? "" : String(imageMode.data.imageMode.resultRetryCount));
  }, [imageMode.data?.imageMode]);

  const counts = useMemo(() => {
    const items = providers.data?.providers ?? [];
    return {
      total: items.filter((item) => item.enabled).length,
      cpa: items.filter((item) => item.enabled && item.channel === "cpa").length,
      chatgptWeb: items.filter((item) => item.enabled && item.channel === "chatgpt_web").length,
      api: items.filter((item) => item.enabled && item.channel === "api").length
    };
  }, [providers.data?.providers]);

  function modeChannelCount(value: ImageGenerationMode["mode"]) {
    if (value === "cpa") return counts.cpa;
    if (value === "chatgpt_web") return counts.chatgptWeb;
    if (value === "api") return counts.api;
    return counts.total;
  }

  function handleModeSelect(nextMode: ImageGenerationMode["mode"]) {
    if (save.isPending || nextMode === mode) return;
    const previousMode = mode;
    setMode(nextMode);
    save.mutate({
      nextMode,
      resultRetryCount: normalizedResultRetryCountInput(),
      toast: "mode"
    }, {
      onError: () => setMode(previousMode)
    });
  }

  function normalizedResultRetryCountInput(): ImageGenerationMode["resultRetryCount"] {
    const text = resultRetryCountInput.trim();
    if (!text) return null;
    const count = Number.parseInt(text, 10);
    if (!Number.isFinite(count)) return null;
    return Math.max(0, Math.min(10, count));
  }

  function saveRequestPolicy() {
    if (save.isPending) return;
    save.mutate({
      nextMode: mode,
      resultRetryCount: normalizedResultRetryCountInput(),
      toast: "policy"
    });
  }

  return (
    <section className="config-card">
      <ConfigHeader title="模式配置" desc="控制图片生成整体从哪类渠道选路。" />
      <div className="mode-request-policy">
        <div>
          <strong>请求策略</strong>
          <small>图片接口调用或图片结果保存出现错误时自动重试。默认 1；留空表示不自动重试。</small>
        </div>
        <label>
          图片结果重试次数
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            value={resultRetryCountInput}
            onChange={(event) => setResultRetryCountInput(event.target.value)}
            placeholder="留空不重试"
          />
        </label>
        <button className="secondary-btn" type="button" onClick={saveRequestPolicy} disabled={save.isPending}>
          <Save size={16} />
          保存策略
        </button>
      </div>
      <div className="mode-grid">
        {imageModeOptions.map((option) => (
          <button
            key={option.value}
            className={mode === option.value ? "active" : ""}
            onClick={() => handleModeSelect(option.value)}
            disabled={save.isPending}
          >
            {mode === option.value ? (
              <span className="mode-card-check" aria-hidden="true">
                <Check size={16} />
              </span>
            ) : null}
            <span className="mode-card-count">{modeChannelCount(option.value)} 条启用渠道</span>
            <strong>{option.title}</strong>
            <span>{option.body}</span>
            <small>{option.foot}</small>
          </button>
        ))}
      </div>
      {save.error ? <div className="form-error">{save.error.message}</div> : null}
    </section>
  );
}

function normalizeWebAccountModeValue(value: unknown): ProviderConfig["webAccountMode"] {
  const normalized = String(value ?? "").trim();
  if (normalized === "round_robin" || normalized === "random") return normalized;
  return "priority";
}

function normalizeProviderForm(provider: ProviderConfig): ProviderConfig {
  const merged = { ...emptyProvider(), ...provider };
  return {
    ...merged,
    proxyEnabled: Boolean(merged.proxyEnabled),
    webAccountIds: Array.isArray(provider.webAccountIds) ? provider.webAccountIds : [],
    webAccountMode: normalizeWebAccountModeValue(provider.webAccountMode)
  };
}

function csvList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function providerAccessSummary(provider: ProviderConfig, accounts: ImageAccount[]) {
  if (provider.channel !== "chatgpt_web") return provider.generationPath || "-";
  const ids = new Set(provider.webAccountIds);
  const selectedAccounts = accounts.filter((account) => ids.has(account.id));
  if (selectedAccounts.length > 0) {
    const names = selectedAccounts.slice(0, 2).map((account) => account.name).join("、");
    return selectedAccounts.length > 2 ? `${names} 等 ${selectedAccounts.length} 个账号` : names;
  }
  return provider.apiKeyValue || provider.webCookies || provider.webAccountId ? "手动凭据" : "未配置账号";
}

function providerDisplayName(provider: ProviderConfig) {
  return provider.name;
}

function ProviderAccountMultiSelect({
  accounts,
  value,
  onChange
}: {
  accounts: ImageAccount[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const selectedIds = new Set(value);
  if (accounts.length === 0) {
    return <div className="account-multi-empty">暂无号池账号</div>;
  }
  return (
    <div className="account-multi-select">
      {accounts.map((account) => {
        const selected = selectedIds.has(account.id);
        return (
          <button
            type="button"
            key={account.id}
            className={selected ? "active" : ""}
            onClick={() =>
              onChange(selected ? value.filter((id) => id !== account.id) : [...value, account.id])
            }
          >
            {selected ? <Check size={15} /> : <span className="account-check-spacer" />}
            <span>
              <strong>{account.name}</strong>
              <small>
                {account.email || account.remoteName || "未填写邮箱"} · {accountStatusLabels[account.status]} ·{" "}
                {account.remainingQuota}/{account.quota}
              </small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProviderDialog({
  mode,
  provider,
  existingProviderIds,
  accounts,
  error,
  saving,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  provider: ProviderConfig;
  existingProviderIds: string[];
  accounts: ImageAccount[];
  error?: Error | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (provider: ProviderConfig) => void;
}) {
  const [form, setForm] = useState<ProviderConfig>(() => normalizeProviderForm(provider));
  const isChatgptWeb = form.channel === "chatgpt_web";
  const isApi = form.channel === "api";
  const isCpa = form.channel === "cpa";
  const usesProviderApiKey = isApi || isCpa;

  function patch(patchValue: Partial<ProviderConfig>) {
    setForm((value) => ({ ...value, ...patchValue }));
  }

  function patchChannel(channel: ProviderConfig["channel"]) {
    setForm((value) =>
      providerWithChannelDefaults(value, channel, {
        preserveIdentity: mode === "edit",
        existingIds: existingProviderIds.filter((id) => id !== value.id)
      })
    );
  }

  return (
    <div className="modal-backdrop">
      <section className="case-modal provider-dialog">
        <header>
          <h3>{mode === "create" ? "新增渠道" : "编辑渠道"}</h3>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="provider-form provider-dialog-form">
          <label>
            名称
            <input value={form.name} onChange={(event) => patch({ name: event.target.value })} autoFocus />
          </label>
          <label>
            接口 ID
            <input value={form.id} readOnly className="readonly-input" />
          </label>
          <label>
            渠道
            <CustomSelect
              value={form.channel}
              onChange={(value) => patchChannel(value as ProviderConfig["channel"])}
              options={[
                { value: "cpa", label: "CPA", description: "CPA 额度代理" },
                { value: "chatgpt_web", label: "ChatGPT 官网", description: "官网额度 / Codex 额度" },
                { value: "api", label: "API 直连", description: "OpenAI 兼容接口" }
              ]}
            />
          </label>
          {!isChatgptWeb ? (
            <label>
              路由方式
              <CustomSelect
                value={form.routeMode}
                onChange={(value) => patch({ routeMode: value as ProviderConfig["routeMode"] })}
                options={routeModeOptions.map((option) => {
                  const [label, description] = option.label.split("：");
                  return { value: option.value, label, description };
                })}
              />
            </label>
          ) : null}
          <label>
            服务地址
            <input value={form.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} />
          </label>
          <div className="provider-switch-row">
            <div className="switch-row">
              <span>使用代理</span>
              <SwitchControl
                checked={form.proxyEnabled}
                label={form.proxyEnabled ? "启用" : "停用"}
                onChange={(proxyEnabled) => patch({ proxyEnabled })}
              />
            </div>
            <div className="switch-row">
              <span>渠道状态</span>
              <SwitchControl
                checked={form.enabled}
                label={form.enabled ? "启用" : "停用"}
                onChange={(enabled) => patch({ enabled })}
              />
            </div>
          </div>
          {usesProviderApiKey ? (
            <label>
              API Key 环境变量
              <input value={form.apiKeyEnv} onChange={(event) => patch({ apiKeyEnv: event.target.value })} />
            </label>
          ) : null}
          {usesProviderApiKey ? (
            <label>
              API Key
              <input
                value={form.apiKeyValue}
                onChange={(event) => patch({ apiKeyValue: event.target.value })}
                placeholder={isCpa ? "CPA Bearer Key，可留空" : "优先建议使用环境变量"}
              />
            </label>
          ) : null}
          {isChatgptWeb ? (
            <label>
              额度来源
              <CustomSelect
                value={form.quotaMode}
                onChange={(value) => patch({ quotaMode: value as ProviderConfig["quotaMode"] })}
                options={quotaModeOptions}
              />
            </label>
          ) : null}
          {isChatgptWeb ? (
            <label>
              账号访问模式
              <CustomSelect
                value={form.webAccountMode}
                onChange={(value) => patch({ webAccountMode: value as ProviderConfig["webAccountMode"] })}
                options={webAccountModeOptions}
              />
            </label>
          ) : null}
          {isChatgptWeb ? (
            <label className="wide">
              号池账号
              <ProviderAccountMultiSelect
                accounts={accounts}
                value={form.webAccountIds}
                onChange={(webAccountIds) => patch({ webAccountIds })}
              />
              <small>CPA 同步账号通常只有 OAuth Access Token，可走 Codex Responses；官网会话链路会先访问 ChatGPT 首页自动预热 Cookie，手动 Cookie 只是防护拦截时的备用项。</small>
            </label>
          ) : null}
          {isChatgptWeb ? (
            <label>
              备用 Access Token
              <input
                value={form.apiKeyValue}
                onChange={(event) => patch({ apiKeyValue: event.target.value })}
                placeholder="ChatGPT access_token"
              />
            </label>
          ) : null}
          {isChatgptWeb ? (
            <label>
              备用 Account ID
              <input value={form.webAccountId} onChange={(event) => patch({ webAccountId: event.target.value })} />
            </label>
          ) : null}
          {isChatgptWeb ? (
            <label className="wide">
              备用 Cookie（可选）
              <textarea rows={3} value={form.webCookies} onChange={(event) => patch({ webCookies: event.target.value })} />
              <small>默认会按参考项目思路预热首页并接住 Set-Cookie；只有遇到网页防护或会话拦截时，才需要从浏览器复制 Cookie 作为兜底。</small>
            </label>
          ) : null}
          {!isChatgptWeb ? (
            <label>
              生成路径
              <input value={form.generationPath} onChange={(event) => patch({ generationPath: event.target.value })} />
            </label>
          ) : null}
          {!isChatgptWeb ? (
            <label>
              编辑路径
              <input value={form.editPath} onChange={(event) => patch({ editPath: event.target.value })} />
            </label>
          ) : null}
          {!isChatgptWeb ? (
            <label>
              Responses 路径
              <input value={form.responsesPath} onChange={(event) => patch({ responsesPath: event.target.value })} />
            </label>
          ) : null}
          <label>
            图片模型
            <input value={form.model} onChange={(event) => patch({ model: event.target.value })} />
          </label>
          <label>
            Responses 主模型
            <input value={form.responsesModel} onChange={(event) => patch({ responsesModel: event.target.value })} />
            <small>
              {isChatgptWeb
                ? "Codex Responses 额度链路使用这个主模型；官网普通额度链路不使用。"
                : "Responses 路由、CPA 遮罩编辑和自动回退到 Responses 时使用；普通 images_api 仍只发图片模型。"}
            </small>
          </label>
          <label>
            尺寸列表
            <input
              value={form.sizes.join(",")}
              onChange={(event) => patch({ sizes: csvList(event.target.value) })}
            />
          </label>
          <label>
            质量列表
            <input
              value={form.qualities.join(",")}
              onChange={(event) => patch({ qualities: csvList(event.target.value) })}
            />
          </label>
          <label>
            默认尺寸
            <input value={form.defaultSize} onChange={(event) => patch({ defaultSize: event.target.value })} />
          </label>
          <label>
            默认质量
            <input value={form.defaultQuality} onChange={(event) => patch({ defaultQuality: event.target.value })} />
          </label>
          {!isChatgptWeb ? (
            <label className="wide">
              base64 响应路径
              <input
                value={form.responseImagePath}
                onChange={(event) => patch({ responseImagePath: event.target.value })}
              />
            </label>
          ) : null}
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-btn" type="button" onClick={() => onSubmit(form)} disabled={saving}>
              <Save size={16} />
              {mode === "create" ? "新增渠道" : "保存渠道"}
            </button>
          </div>
          {error ? <div className="form-error">{error.message}</div> : null}
        </div>
      </section>
    </div>
  );
}

export function ProvidersPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const providersQuery = useQuery({ queryKey: ["config-providers"], queryFn: configApi.providers });
  const accountsQuery = useQuery({ queryKey: ["config-image-accounts"], queryFn: configApi.imageAccounts });
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [channelFilter, setChannelFilter] = useState<ProviderChannelFilter>("all");
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; provider: ProviderConfig } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProviderConfig | null>(null);
  const [switchTarget, setSwitchTarget] = useState<ProviderConfig | null>(null);
  const save = useMutation({
    mutationFn: ({ nextProviders }: { nextProviders: ProviderConfig[]; message: string }) =>
      configApi.saveProviders(nextProviders),
    onSuccess: (_data, variables) => {
      setProviders(variables.nextProviders);
      setDialog(null);
      setRemoveTarget(null);
      setSwitchTarget(null);
      showToast(variables.message);
      queryClient.invalidateQueries({ queryKey: ["config-providers"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    }
  });

  useEffect(() => {
    if (!providersQuery.data?.providers) return;
    setProviders(providersQuery.data.providers.map(normalizeProviderForm));
  }, [providersQuery.data?.providers]);

  const counts = useMemo(
    () => ({
      all: providers.length,
      cpa: providers.filter((provider) => provider.channel === "cpa").length,
      chatgpt_web: providers.filter((provider) => provider.channel === "chatgpt_web").length,
      api: providers.filter((provider) => provider.channel === "api").length
    }),
    [providers]
  );

  const filteredProviders = useMemo(
    () => providers.filter((provider) => channelFilter === "all" || provider.channel === channelFilter),
    [channelFilter, providers]
  );

  function persistProviders(nextProviders: ProviderConfig[], message: string) {
    save.mutate({ nextProviders, message });
  }

  function openCreateDialog() {
    const channel = channelFilter === "all" ? "api" : channelFilter;
    setDialog({ mode: "create", provider: emptyProvider(channel, providers.map((provider) => provider.id)) });
  }

  function saveProviderForm(provider: ProviderConfig) {
    const normalizedForm = normalizeProviderForm(provider);
    const originalId = dialog?.provider.id ?? normalizedForm.id;
    const normalized = dialog?.mode === "edit" ? { ...normalizedForm, id: originalId } : normalizedForm;
    if (!normalized.id.trim()) {
      showToast("接口 ID 不能为空", "error");
      return;
    }
    if (!normalized.name.trim()) {
      showToast("渠道名称不能为空", "error");
      return;
    }
    const duplicated = providers.some((item) => item.id === normalized.id && item.id !== originalId);
    if (duplicated) {
      showToast("接口 ID 已存在", "error");
      return;
    }
    const nextProviders =
      dialog?.mode === "create"
        ? [...providers, normalized]
        : providers.map((item) => (item.id === originalId ? normalized : item));
    persistProviders(nextProviders, dialog?.mode === "create" ? "渠道已新增" : "渠道已保存");
  }

  function toggleProvider(provider: ProviderConfig) {
    setSwitchTarget(provider);
  }

  return (
    <section className="config-card">
      <ConfigHeader title="渠道配置" desc="CPA、ChatGPT 官网和 API 直连统一按渠道维护。" />
      <div className="provider-toolbar">
        <div className="provider-filter-tabs" role="tablist" aria-label="渠道筛选">
          {providerChannelFilterOptions(counts).map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={channelFilter === option.value}
              className={channelFilter === option.value ? "active" : ""}
              onClick={() => setChannelFilter(option.value as ProviderChannelFilter)}
            >
              {option.label}
              <span>{option.count}</span>
            </button>
          ))}
        </div>
        <button className="primary-btn" type="button" onClick={openCreateDialog}>
          <Plus size={16} />
          新增渠道
        </button>
      </div>
      <div className="table-wrap provider-table-wrap">
        <table>
          <thead>
            <tr>
              <th>渠道</th>
              <th>类型</th>
              <th>调用策略</th>
              <th>账号 / 地址</th>
              <th>模型</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredProviders.map((provider) => (
              <tr key={provider.id}>
                <td className="provider-name-cell">
                  <strong>{providerDisplayName(provider)}</strong>
                  <small>{provider.id}</small>
                </td>
                <td>{channelLabels[provider.channel]}</td>
                <td>
                  <span>
                    {provider.channel === "chatgpt_web"
                      ? `${quotaModeOptions.find((option) => option.value === provider.quotaMode)?.label ?? provider.quotaMode} / ${webAccountModeLabels[provider.webAccountMode]}`
                      : routeModeLabels[provider.routeMode]}
                  </span>
                  <small>{provider.proxyEnabled ? "代理已启用" : "代理未启用"}</small>
                </td>
                <td className="endpoint-cell">
                  <span className="provider-account-line">{providerAccessSummary(provider, accountsQuery.data?.accounts ?? [])}</span>
                  <small className="provider-address-line">{provider.baseUrl}</small>
                </td>
                <td>{`${provider.model} / ${provider.responsesModel}`}</td>
                <td>
                  <SwitchControl
                    checked={provider.enabled}
                    disabled={save.isPending}
                    label={provider.enabled ? "启用" : "停用"}
                    onChange={() => toggleProvider(provider)}
                  />
                </td>
                <td className="row-actions compact-actions">
                  <button className="secondary-btn" type="button" onClick={() => setDialog({ mode: "edit", provider })}>
                    <Pencil size={15} />
                    编辑
                  </button>
                  <button
                    className="danger-btn"
                    type="button"
                    onClick={() => setRemoveTarget(provider)}
                    disabled={providers.length <= 1 || save.isPending}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {filteredProviders.length === 0 ? (
              <tr>
                <td colSpan={7}>暂无匹配渠道</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {save.error ? <div className="form-error">{save.error.message}</div> : null}
      {dialog ? (
        <ProviderDialog
          mode={dialog.mode}
          provider={dialog.provider}
          existingProviderIds={providers.map((provider) => provider.id)}
          accounts={accountsQuery.data?.accounts ?? []}
          saving={save.isPending}
          error={save.error}
          onClose={() => setDialog(null)}
          onSubmit={saveProviderForm}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="删除渠道"
        description={removeTarget ? `确认删除渠道「${removeTarget.name}」？` : ""}
        confirmText="删除"
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          persistProviders(
            providers.filter((provider) => provider.id !== removeTarget.id),
            "渠道已删除"
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(switchTarget)}
        title={switchTarget?.enabled ? "停用渠道" : "启用渠道"}
        description={
          switchTarget?.enabled
            ? `确认停用渠道「${switchTarget.name}」？停用后系统不会再使用这个图片通道。`
            : switchTarget
              ? `确认启用渠道「${switchTarget.name}」？启用后系统可以使用这个图片通道。`
              : ""
        }
        confirmText={switchTarget?.enabled ? "停用" : "启用"}
        destructive={Boolean(switchTarget?.enabled)}
        onCancel={() => setSwitchTarget(null)}
        onConfirm={() => {
          if (!switchTarget) return;
          persistProviders(
            providers.map((provider) =>
              provider.id === switchTarget.id ? { ...provider, enabled: !switchTarget.enabled } : provider
            ),
            switchTarget.enabled ? "渠道已停用" : "渠道已启用"
          );
        }}
      />
    </section>
  );
}

function emptyPromptOptimizerProvider(existingIds: string[] = []): PromptOptimizerProvider {
  const used = new Set(existingIds);
  let id = `PROMPTOPT-${providerIdTimestamp(new Date())}`;
  let date = new Date();
  for (let index = 0; used.has(id) && index < 1440; index += 1) {
    date = new Date(date.getTime() + 60 * 1000);
    id = `PROMPTOPT-${providerIdTimestamp(date)}`;
  }
  return {
    id,
    name: "DeepSeek 提示词优化",
    enabled: false,
    baseUrl: "https://api.deepseek.com",
    endpointPath: "/chat/completions",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    apiKeyValue: "",
    model: "deepseek-chat",
    availableModels: [],
    availabilityStatus: "unknown",
    availabilityError: "",
    availabilityCheckedAt: "",
    streamEnabled: false,
    thinkingEnabled: true,
    temperature: null,
    maxTokens: 0,
    retryCount: 2,
    sortOrder: 100,
    createdAt: "",
    updatedAt: ""
  };
}

function normalizePromptOptimizerTemperature(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const temperature = Number(value);
  return Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : null;
}

function normalizePromptOptimizerProvider(provider: PromptOptimizerProvider): PromptOptimizerProvider {
  const availabilityStatus = provider.availabilityStatus === "normal" || provider.availabilityStatus === "abnormal"
    ? provider.availabilityStatus
    : "unknown";
  return {
    ...emptyPromptOptimizerProvider(),
    ...provider,
    enabled: Boolean(provider.enabled),
    endpointPath: provider.endpointPath || "/chat/completions",
    apiKeyEnv: provider.apiKeyEnv ?? "",
    apiKeyValue: provider.apiKeyValue ?? "",
    availableModels: Array.isArray(provider.availableModels)
      ? promptOptimizerModelValues(provider.availableModels)
      : [],
    availabilityStatus,
    availabilityError: provider.availabilityError ?? "",
    availabilityCheckedAt: provider.availabilityCheckedAt ?? "",
    streamEnabled: Boolean(provider.streamEnabled),
    thinkingEnabled: provider.thinkingEnabled ?? true,
    temperature: normalizePromptOptimizerTemperature(provider.temperature),
    maxTokens: Number.isFinite(Number(provider.maxTokens)) ? Math.max(0, Math.min(16000, Math.trunc(Number(provider.maxTokens)))) : 0,
    retryCount: Number.isFinite(Number(provider.retryCount)) ? Math.max(0, Math.min(10, Math.trunc(Number(provider.retryCount)))) : 2,
    sortOrder: Number.isFinite(Number(provider.sortOrder)) ? Number(provider.sortOrder) : 100
  };
}

function promptOptimizerModelValues(models: string[]) {
  const seen = new Set<string>();
  return models
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function promptOptimizerModelSelectOptions(models: string[], currentModel: string) {
  const values = promptOptimizerModelValues(models);
  const modelSet = new Set(values);
  const current = currentModel.trim();
  if (current && !modelSet.has(current)) values.unshift(current);
  return values.map((value) => ({
    value,
    label: value,
    description: value === current && !modelSet.has(value) ? "当前配置" : undefined
  }));
}

const promptOptimizerAvailabilityLabels: Record<PromptOptimizerProvider["availabilityStatus"], string> = {
  unknown: "未测试",
  normal: "正常",
  abnormal: "异常"
};

function PromptOptimizerAvailabilityTag({ provider }: { provider: PromptOptimizerProvider }) {
  return (
    <span
      className={cx("prompt-optimizer-availability-tag", provider.availabilityStatus)}
      title={provider.availabilityError || (provider.availabilityCheckedAt ? `最近测试：${formatDate(provider.availabilityCheckedAt)}` : "")}
    >
      {promptOptimizerAvailabilityLabels[provider.availabilityStatus]}
    </span>
  );
}

function PromptOptimizerDialog({
  mode,
  provider,
  saving,
  error,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  provider: PromptOptimizerProvider;
  saving: boolean;
  error?: Error | null;
  onClose: () => void;
  onSubmit: (provider: PromptOptimizerProvider) => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<PromptOptimizerProvider>(() => normalizePromptOptimizerProvider(provider));
  const [testMessage, setTestMessage] = useState("");
  const patch = (patchValue: Partial<PromptOptimizerProvider>) => setForm((value) => ({ ...value, ...patchValue }));
  const patchConnection = (patchValue: Partial<PromptOptimizerProvider>) =>
    patch({
      ...patchValue,
      availableModels: [],
      availabilityStatus: "unknown",
      availabilityError: "",
      availabilityCheckedAt: ""
    });
  const normalizedForm = normalizePromptOptimizerProvider(form);
  const modelSelectOptions = useMemo(
    () => promptOptimizerModelSelectOptions(normalizedForm.availableModels, normalizedForm.model),
    [normalizedForm.availableModels, normalizedForm.model]
  );
  const applyModelList = (models: string[], defaultModel: string, message: string) => {
    const availableModels = promptOptimizerModelValues(models);
    const nextModel = defaultModel || availableModels[0] || normalizedForm.model;
    const modelSet = new Set(availableModels);
    const patchValue: Partial<PromptOptimizerProvider> = {
      availableModels,
      availabilityStatus: "normal",
      availabilityError: ""
    };
    if (nextModel && (!normalizedForm.model.trim() || !modelSet.has(normalizedForm.model.trim()))) {
      patchValue.model = nextModel;
    }
    patch(patchValue);
    showToast(message);
  };
  const fetchModels = useMutation({
    mutationFn: () => configApi.promptOptimizerProviderModels(normalizedForm),
    onSuccess: (data) => {
      applyModelList(data.models, data.defaultModel, `已获取 ${data.models.length} 个模型`);
      patch({ availabilityCheckedAt: data.availabilityCheckedAt });
      setTestMessage("");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "模型列表获取失败";
      patch({ availabilityStatus: "abnormal", availabilityError: message, availabilityCheckedAt: new Date().toISOString() });
      showToast(message, "error");
    }
  });
  const testProvider = useMutation({
    mutationFn: () => configApi.testPromptOptimizerProvider(normalizedForm),
    onSuccess: (data) => {
      applyModelList(data.models, data.defaultModel, data.message);
      patch({ availabilityCheckedAt: data.availabilityCheckedAt });
      setTestMessage(`${data.message}，耗时 ${data.durationMs}ms`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "供应商测试失败";
      patch({ availabilityStatus: "abnormal", availabilityError: message, availabilityCheckedAt: new Date().toISOString() });
      setTestMessage(message);
      showToast(message, "error");
    }
  });
  return (
    <div className="modal-backdrop">
      <section className="case-modal provider-dialog">
        <header>
          <h3>{mode === "create" ? "新增优化模型" : "编辑优化模型"}</h3>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="provider-form provider-dialog-form">
          <label>
            名称
            <input value={form.name} onChange={(event) => patch({ name: event.target.value })} autoFocus />
          </label>
          <label>
            配置 ID
            <input value={form.id} readOnly className="readonly-input" />
          </label>
          <label>
            Base URL
            <input value={form.baseUrl} onChange={(event) => patchConnection({ baseUrl: event.target.value })} placeholder="https://api.deepseek.com" />
          </label>
          <label>
            Endpoint Path
            <input value={form.endpointPath} onChange={(event) => patchConnection({ endpointPath: event.target.value })} placeholder="/chat/completions" />
          </label>
          <label>
            API Key 环境变量
            <input value={form.apiKeyEnv} onChange={(event) => patchConnection({ apiKeyEnv: event.target.value })} placeholder="DEEPSEEK_API_KEY" />
          </label>
          <label>
            API Key
            <input value={form.apiKeyValue} onChange={(event) => patchConnection({ apiKeyValue: event.target.value })} placeholder="优先建议使用环境变量" />
          </label>
          <label className="wide">
            模型
            <div className="prompt-optimizer-model-row">
              {modelSelectOptions.length > 0 ? (
                <CustomSelect
                  value={form.model}
                  onChange={(model) => patch({ model })}
                  options={modelSelectOptions}
                  placeholder="选择模型"
                  menuWidth={360}
                />
              ) : (
                <input value={form.model} onChange={(event) => patch({ model: event.target.value })} placeholder="deepseek-chat" />
              )}
              <button className="secondary-btn" type="button" onClick={() => fetchModels.mutate()} disabled={fetchModels.isPending || testProvider.isPending}>
                <RefreshCw className={fetchModels.isPending ? "spin-icon" : undefined} size={16} />
                获取模型
              </button>
            </div>
          </label>
          <label>
            排序
            <input type="number" value={form.sortOrder} onChange={(event) => patch({ sortOrder: Number(event.target.value) })} />
          </label>
          <label>
            Temperature
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature ?? ""}
              placeholder="留空使用模型默认值"
              onChange={(event) => patch({ temperature: normalizePromptOptimizerTemperature(event.target.value) })}
            />
          </label>
          <label>
            Max Tokens（0=不限制）
            <input type="number" min={0} max={16000} step={1} value={form.maxTokens} onChange={(event) => patch({ maxTokens: Number(event.target.value) })} />
          </label>
          <label>
            重试次数
            <input type="number" min={0} max={10} step={1} value={form.retryCount} onChange={(event) => patch({ retryCount: Number(event.target.value) })} />
          </label>
          <div className="switch-row">
            <span>流式返回</span>
            <SwitchControl checked={form.streamEnabled} label={form.streamEnabled ? "流式" : "普通"} onChange={(streamEnabled) => patch({ streamEnabled })} />
          </div>
          <div className="switch-row">
            <span>思考模式</span>
            <SwitchControl checked={form.thinkingEnabled} label={form.thinkingEnabled ? "开启" : "关闭"} onChange={(thinkingEnabled) => patch({ thinkingEnabled })} />
          </div>
          <div className="switch-row">
            <span>启用状态</span>
            <SwitchControl checked={form.enabled} label={form.enabled ? "启用" : "停用"} onChange={(enabled) => patch({ enabled })} />
          </div>
          <div className="prompt-optimizer-protocol">
            <Bot size={17} />
            <span>OpenAI Chat Completions 兼容：POST Base URL + Endpoint Path，支持普通 JSON 或 SSE 流式读取；DeepSeek 接口会发送 thinking 参数，Max Tokens 为 0 时不限制；重试只处理网络错误、429 和 5xx 等临时失败。</span>
          </div>
          <div className="prompt-optimizer-test-actions">
            <button className="secondary-btn" type="button" onClick={() => testProvider.mutate()} disabled={fetchModels.isPending || testProvider.isPending}>
              <Network size={16} />
              测试供应商
            </button>
            <PromptOptimizerAvailabilityTag provider={normalizedForm} />
            {testMessage ? <span>{testMessage}</span> : null}
          </div>
          <div className="row-actions">
            <button className="secondary-btn" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-btn" type="button" onClick={() => onSubmit(normalizePromptOptimizerProvider(form))} disabled={saving || fetchModels.isPending || testProvider.isPending}>
              <Save size={16} />
              保存
            </button>
          </div>
          {error ? <div className="form-error">{error.message}</div> : null}
        </div>
      </section>
    </div>
  );
}

export function PromptOptimizerPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const providersQuery = useQuery({ queryKey: ["config-prompt-optimizer-providers"], queryFn: configApi.promptOptimizerProviders });
  const [providers, setProviders] = useState<PromptOptimizerProvider[]>([]);
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; provider: PromptOptimizerProvider } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PromptOptimizerProvider | null>(null);
  const [switchTarget, setSwitchTarget] = useState<PromptOptimizerProvider | null>(null);
  const save = useMutation({
    mutationFn: ({ nextProviders }: { nextProviders: PromptOptimizerProvider[]; message: string }) =>
      configApi.savePromptOptimizerProviders(nextProviders),
    onSuccess: (_data, variables) => {
      setProviders(variables.nextProviders);
      setDialog(null);
      setRemoveTarget(null);
      setSwitchTarget(null);
      showToast(variables.message);
      queryClient.invalidateQueries({ queryKey: ["config-prompt-optimizer-providers"] });
    }
  });

  useEffect(() => {
    if (providersQuery.data?.providers) setProviders(providersQuery.data.providers.map(normalizePromptOptimizerProvider));
  }, [providersQuery.data?.providers]);

  function persist(nextProviders: PromptOptimizerProvider[], message: string) {
    save.mutate({ nextProviders: nextProviders.map(normalizePromptOptimizerProvider), message });
  }

  function saveDialogProvider(provider: PromptOptimizerProvider) {
    if (!provider.name.trim()) {
      showToast("请填写供应商名称", "error");
      return;
    }
    if (!provider.baseUrl.trim() || !provider.endpointPath.trim()) {
      showToast("请填写 Base URL 和 Endpoint Path", "error");
      return;
    }
    if (!provider.model.trim()) {
      showToast("请填写模型名称", "error");
      return;
    }
    const originalId = dialog?.provider.id ?? provider.id;
    const duplicated = providers.some((item) => item.id === provider.id && item.id !== originalId);
    if (duplicated) {
      showToast("配置 ID 已存在", "error");
      return;
    }
    const nextProviders =
      dialog?.mode === "create"
        ? [...providers, provider]
        : providers.map((item) => (item.id === originalId ? { ...provider, id: originalId } : item));
    persist(nextProviders, dialog?.mode === "create" ? "优化模型已新增" : "优化模型已保存");
  }

  const enabledCount = providers.filter((provider) => provider.enabled).length;
  return (
    <>
      <section className="config-card">
        <ConfigHeader title="模型配置" desc="独立维护 AI 优化提示词使用的 OpenAI Chat Completions 兼容语言模型，不复用图片渠道。" />
        <div className="provider-toolbar">
          <div className="prompt-optimizer-summary">
            <strong>{providers.length}</strong>
            <span>供应商</span>
            <strong>{enabledCount}</strong>
            <span>已启用</span>
          </div>
          <button className="primary-btn" type="button" onClick={() => setDialog({ mode: "create", provider: emptyPromptOptimizerProvider(providers.map((provider) => provider.id)) })}>
            <Plus size={16} />
            新增供应商
          </button>
        </div>
        <div className="table-wrap provider-table-wrap">
          <table>
            <thead>
              <tr>
                <th>供应商</th>
                <th>地址</th>
                <th>模型</th>
                <th>参数</th>
                <th>启用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td className="provider-name-cell">
                    <div className="prompt-optimizer-name-line">
                      <strong>{provider.name}</strong>
                      <PromptOptimizerAvailabilityTag provider={provider} />
                    </div>
                    <small>{provider.id}</small>
                  </td>
                  <td className="endpoint-cell">
                    <span className="provider-account-line">{provider.endpointPath}</span>
                    <small className="provider-address-line">{provider.baseUrl}</small>
                  </td>
                  <td>{provider.model}</td>
                  <td>{`T ${provider.temperature ?? "默认"} / ${provider.maxTokens > 0 ? provider.maxTokens : "不限"} / 重试 ${provider.retryCount} / ${provider.streamEnabled ? "流式" : "普通"} / ${provider.thinkingEnabled ? "思考" : "非思考"} / #${provider.sortOrder}`}</td>
                  <td className="prompt-optimizer-status-cell">
                    <SwitchControl
                      checked={provider.enabled}
                      disabled={save.isPending}
                      label={provider.enabled ? "启用" : "停用"}
                      onChange={() => setSwitchTarget(provider)}
                    />
                  </td>
                  <td className="row-actions compact-actions">
                    <button className="secondary-btn" type="button" onClick={() => setDialog({ mode: "edit", provider })}>
                      <Pencil size={15} />
                      编辑
                    </button>
                    <button className="danger-btn" type="button" onClick={() => setRemoveTarget(provider)} disabled={save.isPending}>
                      <Trash2 size={15} />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={6}>暂无模型配置</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {dialog ? (
          <PromptOptimizerDialog
            mode={dialog.mode}
            provider={dialog.provider}
            saving={save.isPending}
            error={save.error}
            onClose={() => setDialog(null)}
            onSubmit={saveDialogProvider}
          />
        ) : null}
        <ConfirmDialog
          open={Boolean(removeTarget)}
          title="删除优化模型"
          description={removeTarget ? `确认删除「${removeTarget.name}」？` : ""}
          confirmText="删除"
          destructive
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => removeTarget && persist(providers.filter((provider) => provider.id !== removeTarget.id), "优化模型已删除")}
        />
        <ConfirmDialog
          open={Boolean(switchTarget)}
          title={switchTarget?.enabled ? "停用优化模型" : "启用优化模型"}
          description={
            switchTarget?.enabled
              ? `确认停用「${switchTarget.name}」？前台不会再使用它优化提示词。`
              : switchTarget
                ? `确认启用「${switchTarget.name}」？排序最靠前的启用模型会被前台使用。`
                : ""
          }
          confirmText={switchTarget?.enabled ? "停用" : "启用"}
          destructive={Boolean(switchTarget?.enabled)}
          onCancel={() => setSwitchTarget(null)}
          onConfirm={() => {
            if (!switchTarget) return;
            persist(
              providers.map((provider) => provider.id === switchTarget.id ? { ...provider, enabled: !provider.enabled } : provider),
              switchTarget.enabled ? "优化模型已停用" : "优化模型已启用"
            );
          }}
        />
      </section>
    </>
  );
}

function emptySafetyReviewSettings(): SafetyReviewSettings {
  return {
    enabled: false,
    failurePolicy: "allow",
    blockMessage: "当前提示词可能存在安全风险，请调整后再试。",
    updatedAt: ""
  };
}

function normalizeSafetyReviewSettings(settings?: SafetyReviewSettings | null): SafetyReviewSettings {
  return {
    enabled: Boolean(settings?.enabled),
    failurePolicy: settings?.failurePolicy === "block" ? "block" : "allow",
    blockMessage: settings?.blockMessage?.trim() || "当前提示词可能存在安全风险，请调整后再试。",
    updatedAt: settings?.updatedAt ?? ""
  };
}

function safetyReviewSceneLabel(scene: string) {
  if (scene === "image_edit") return "图生图";
  if (scene === "image_generation") return "生图";
  return scene || "-";
}

function safetyReviewDecisionLabel(log: SafetyReviewLog) {
  if (log.action === "failure_allow") return "异常放行";
  if (log.action === "failure_block") return "异常拦截";
  if (log.decision === "block") return "拦截";
  if (log.decision === "review") return "记录";
  if (log.decision === "allow") return "通过";
  return "-";
}

function safetyReviewRiskLabel(riskLevel: string) {
  if (riskLevel === "high") return "高";
  if (riskLevel === "medium") return "中";
  if (riskLevel === "low") return "低";
  if (riskLevel === "none") return "无";
  return "-";
}

function safetyReviewDecisionTone(log: SafetyReviewLog) {
  if (log.action === "failure_block" || log.decision === "block") return "blocked";
  if (log.action === "failure_allow" || log.decision === "review") return "review";
  if (log.decision === "allow") return "allowed";
  return "neutral";
}

function safetyReviewUserLabel(log: SafetyReviewLog) {
  return log.username || log.account || log.userId || "-";
}

export function SafetyReviewPanel() {
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-safety-review"], queryFn: configApi.safetyReview });
  const [form, setForm] = useState<SafetyReviewSettings>(emptySafetyReviewSettings());
  const save = useMutation({
    mutationFn: ({ nextSettings }: { nextSettings: SafetyReviewSettings; message: string; autosave?: boolean }) =>
      configApi.saveSafetyReview(normalizeSafetyReviewSettings(nextSettings)),
    onSuccess: (data, variables) => {
      const savedSettings = normalizeSafetyReviewSettings(data.settings);
      setForm((current) => (variables.autosave ? { ...savedSettings, blockMessage: current.blockMessage } : savedSettings));
      showToast(variables.message);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "安全审核配置保存失败", "error")
  });

  useEffect(() => {
    if (query.data?.settings) setForm(normalizeSafetyReviewSettings(query.data.settings));
  }, [query.data?.settings]);

  function patch(patchValue: Partial<SafetyReviewSettings>) {
    setForm((value) => ({ ...value, ...patchValue }));
  }

  function savePatch(patchValue: Partial<SafetyReviewSettings>, message = "安全审核配置已自动保存") {
    const nextForm = normalizeSafetyReviewSettings({ ...form, ...patchValue });
    setForm(nextForm);
    save.mutate({ nextSettings: nextForm, message, autosave: true });
  }

  const logs = query.data?.logs ?? [];

  return (
    <section className="config-card">
      <ConfigHeader
        title="安全审核"
        desc="只审核对话里用户提交的生图/图生图提示词。关闭后不会调用审核模型，也不会拦截请求。"
      />
      <div className="provider-form safety-review-form">
        <div className="safety-review-control-grid">
          <div className="switch-row safety-review-switch-row">
            <div className="switch-row-copy">
              <strong>文本审核总开关</strong>
              <small>开启后在提交生图前审核用户提示词，命中拦截时不调用图片渠道。</small>
            </div>
            <div className="safety-review-inline-controls">
              <SwitchControl
                checked={form.enabled}
                disabled={save.isPending}
                label={form.enabled ? "已启用" : "已关闭"}
                onChange={(enabled) => savePatch({ enabled })}
              />
              <label className="safety-review-policy-field">
                审核异常策略
                <CustomSelect
                  value={form.failurePolicy}
                  disabled={save.isPending}
                  onChange={(failurePolicy) => savePatch({ failurePolicy: failurePolicy === "block" ? "block" : "allow" })}
                  options={[
                    { value: "allow", label: "异常时放行" },
                    { value: "block", label: "异常时拦截" }
                  ]}
                />
              </label>
            </div>
          </div>
        </div>
        <label className="safety-review-message-field">
          拦截提示文案
          <textarea
            rows={3}
            value={form.blockMessage}
            onChange={(event) => patch({ blockMessage: event.target.value })}
            placeholder="当前提示词可能存在安全风险，请调整后再试。"
          />
        </label>
        <div className="safety-review-footer">
          <div className="safety-review-note">
            <span>审核模型复用“模型配置”里排序最靠前的启用供应商；V1 只拦截模型返回 block 的提示词，review 仅记录。</span>
            {form.updatedAt ? <small>最近更新：{formatDate(form.updatedAt)}</small> : null}
          </div>
          <div className="form-actions safety-review-actions">
            <button className="primary-btn" type="button" onClick={() => save.mutate({ nextSettings: form, message: "安全审核配置已保存" })} disabled={save.isPending}>
              <Save size={16} />
              保存配置
            </button>
            <button className="secondary-btn" type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={query.isFetching ? "spin-icon" : undefined} size={16} />
              刷新记录
            </button>
          </div>
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {query.error ? <div className="form-error">{query.error.message}</div> : null}
      </div>
      <div className="table-wrap safety-review-table-wrap">
        <table className="request-log-table safety-review-log-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>场景</th>
              <th>结论</th>
              <th>风险</th>
              <th>提示词</th>
              <th>原因</th>
              <th>模型/耗时</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDate(log.createdAt)}</td>
                <td>
                  {safetyReviewUserLabel(log)}
                  {log.account && log.account !== safetyReviewUserLabel(log) ? <small>{log.account}</small> : null}
                </td>
                <td>{safetyReviewSceneLabel(log.scene)}</td>
                <td>
                  <span className={cx("safety-review-decision", safetyReviewDecisionTone(log))}>{safetyReviewDecisionLabel(log)}</span>
                </td>
                <td>
                  <span className={cx("safety-review-risk", log.riskLevel || "none")}>{safetyReviewRiskLabel(log.riskLevel)}</span>
                  {log.categories.length > 0 ? <small>{log.categories.join("、")}</small> : null}
                </td>
                <td className="endpoint-cell">
                  <span>{log.promptExcerpt || "-"}</span>
                  {log.matchedText.length > 0 ? <small>{`命中：${log.matchedText.join("、")}`}</small> : null}
                </td>
                <td className="endpoint-cell">
                  <span>{log.reason || "-"}</span>
                  {log.error ? <small>{log.error}</small> : null}
                </td>
                <td>
                  {log.providerName || "-"}
                  <small>{`${log.durationMs} ms`}</small>
                </td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr>
                <td colSpan={8}>暂无审核记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function cpaSyncStatusLabel(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return "暂无";
  if (normalized === "succeeded" || normalized === "success") return "成功";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") return "失败";
  if (normalized === "running" || normalized === "syncing") return "同步中";
  if (normalized === "pending" || normalized === "queued") return "等待中";
  if (normalized === "skipped") return "已跳过";
  return String(status ?? "-");
}

function cpaSyncStatusTone(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "succeeded" || normalized === "success") return "succeeded";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") return "failed";
  if (normalized === "running" || normalized === "syncing") return "running";
  if (normalized === "pending" || normalized === "queued") return "pending";
  if (normalized === "skipped") return "skipped";
  return "unknown";
}

function cpaSyncMessageLabel(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "暂无同步记录";
  const match = raw.match(/^(succeeded|success|failed|failure|error|running|syncing|pending|queued|skipped)\b:?\s*(.*)$/i);
  if (!match) return raw;
  const label = cpaSyncStatusLabel(match[1]);
  const rest = match[2]?.trim();
  return rest ? `${label}：${rest}` : label;
}

type CpaFormState = {
  enabled: boolean;
  syncUrl: string;
  passwordSecret: string;
  frequencyMinutes: number;
};

function serializeCpaForm(form: CpaFormState) {
  return JSON.stringify({
    enabled: Boolean(form.enabled),
    syncUrl: form.syncUrl.trim(),
    passwordSecret: form.passwordSecret.trim(),
    frequencyMinutes: Number(form.frequencyMinutes) || 60
  });
}

export function CpaPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const cpa = useQuery({ queryKey: ["config-cpa"], queryFn: configApi.cpa });
  const [form, setForm] = useState<CpaFormState>({
    enabled: false,
    syncUrl: "",
    passwordSecret: "",
    frequencyMinutes: 60
  });
  const cpaAutosaveSnapshotRef = useRef("");
  const save = useMutation({
    mutationFn: (nextForm: CpaFormState) => {
      const syncUrl = nextForm.syncUrl.trim();
      const passwordSecret = nextForm.passwordSecret.trim();
      if (nextForm.enabled && !syncUrl) throw new Error("启用 CPA 同步必须填写管理地址");
      if (nextForm.enabled && !passwordSecret) throw new Error("启用 CPA 同步必须填写访问密码");
      return configApi.saveCpa({ ...nextForm, syncUrl, passwordSecret });
    },
    onSuccess: (_data, nextForm) => {
      cpaAutosaveSnapshotRef.current = serializeCpaForm(nextForm);
      queryClient.invalidateQueries({ queryKey: ["config-cpa"] });
    }
  });
  const sync = useMutation({
    mutationFn: configApi.syncCpa,
    onSuccess: () => {
      showToast("CPA 同步已触发");
      queryClient.invalidateQueries({ queryKey: ["config-cpa"] });
      queryClient.invalidateQueries({ queryKey: ["config-image-accounts"] });
    }
  });

  useEffect(() => {
    if (!cpa.data?.account) return;
    const nextForm = {
      enabled: Boolean(cpa.data.account.enabled),
      syncUrl: cpa.data.account.syncUrl ?? "",
      passwordSecret: cpa.data.account.passwordSecret ?? "",
      frequencyMinutes: Number(cpa.data.account.frequencyMinutes) || 60
    };
    setForm(nextForm);
    cpaAutosaveSnapshotRef.current = serializeCpaForm(nextForm);
  }, [cpa.data?.account]);

  useEffect(() => {
    const snapshot = serializeCpaForm(form);
    if (!cpaAutosaveSnapshotRef.current || snapshot === cpaAutosaveSnapshotRef.current) return;
    if (form.enabled && (!form.syncUrl.trim() || !form.passwordSecret.trim())) return;
    const timer = window.setTimeout(() => save.mutate(form), 650);
    return () => window.clearTimeout(timer);
  }, [form.enabled, form.syncUrl, form.passwordSecret, form.frequencyMinutes]);

  const latestSyncAt = cpa.data?.runs[0]?.finishedAt || cpa.data?.account.updatedAt || "";
  const lastStatus = cpa.data?.account.lastStatus || "暂无同步记录";
  const lastStatusText = cpaSyncMessageLabel(lastStatus);
  const nextAutoSyncAt = cpa.data?.nextAutoSyncAt || "";

  return (
    <section className="config-card">
      <ConfigHeader title="CPA 同步" desc="填写 CPA 管理地址和访问密码，从远端同步图片账号号池。" />
      <div className="cpa-panel-toolbar">
        <div className="cpa-status-card">
          <div className="cpa-status-head">
            <span>最近状态</span>
            <div className="cpa-status-actions">
              {latestSyncAt ? <small>最近更新：{formatDate(latestSyncAt)}</small> : null}
              <button className="secondary-btn" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw className={sync.isPending ? "spin-icon" : undefined} size={16} />
                立即同步
              </button>
            </div>
          </div>
          <strong title={lastStatusText}>{lastStatusText}</strong>
          <div className="cpa-status-meta">
            {sync.data?.message ? <small>本次结果：{cpaSyncMessageLabel(sync.data.message)}</small> : null}
            {nextAutoSyncAt ? <small>下次自动同步：{formatDate(nextAutoSyncAt)}</small> : null}
          </div>
        </div>
      </div>
      <div className="provider-form cpa-form">
        <div className="switch-row cpa-sync-switch">
          <span>启用 CPA 同步</span>
          <SwitchControl
            checked={form.enabled}
            label={form.enabled ? "已启用" : "已关闭"}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
        </div>
        <label>
          CPA 管理地址
          <input
            value={form.syncUrl}
            onChange={(event) => setForm({ ...form, syncUrl: event.target.value })}
            placeholder="例如 http://127.0.0.1:8317"
          />
        </label>
        <label>
          访问密码
          <input
            type="password"
            value={form.passwordSecret}
            onChange={(event) => setForm({ ...form, passwordSecret: event.target.value })}
          />
        </label>
        <label>
          同步频率（分钟）
          <input
            type="number"
            min={5}
            value={form.frequencyMinutes}
            onChange={(event) => setForm({ ...form, frequencyMinutes: Number(event.target.value) || 60 })}
          />
        </label>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {sync.error ? <div className="form-error">{sync.error.message}</div> : null}
      </div>
      <div className="table-wrap cpa-runs-wrap">
        <table className="cpa-runs-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>信息</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {cpa.data?.runs.map((run) => (
              <tr key={run.id}>
                <td className="cpa-run-status">
                  <span className={cx("cpa-run-status-pill", cpaSyncStatusTone(run.status))}>{cpaSyncStatusLabel(run.status)}</span>
                </td>
                <td className="cpa-run-message">
                  <span title={cpaSyncMessageLabel(run.message)}>{cpaSyncMessageLabel(run.message)}</span>
                </td>
                <td className="cpa-run-time">{formatDate(run.finishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
