import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  Bug,
  Check,
  Database,
  FolderOpen,
  ImageIcon,
  KeyRound,
  Lightbulb,
  LogOut,
  Mail,
  Network,
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
import { api, configApi } from "./api";
import { LightweightLineChart } from "./components/LightweightChart";
import { MarkdownView } from "./components/MarkdownView";
import { ProjectLogo } from "./components/ProjectLogo";
import { DEFAULT_SITE_NAME, useDocumentBranding } from "./lib/branding";
import { copyTextToClipboard } from "./lib/clipboard";
import { cx } from "./lib/cx";
import { formatImageFileSize } from "./lib/format";
import type {
  ChangelogEntry,
  BrandingAsset,
  BrandingAssetType,
  BrandingSettings,
  ConfigStatistics,
  DebugSettings,
  ImageAccount,
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
} from "./types";
import type { ConfigAssetReviewItem, ConfigCaseReviewItem } from "./api/config";
import { ConfirmDialog, CustomSelect, PromptDialog, ToastProvider, useToast } from "./ui";

const CONFIG_TAB_STORAGE_KEY = "gpt-image.config.activeTab";
const ACCOUNT_USAGE_AUTO_REFRESH_STORAGE_KEY = "gpt-image.config.accountUsageAutoRefreshAt";
const ACCOUNT_USAGE_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const CONFIG_TAB_VALUES = [
  "statistics",
  "users",
  "teams",
  "assetReviews",
  "caseReviews",
  "imageAccounts",
  "providers",
  "promptOptimizer",
  "safetyReview",
  "smtp",
  "sms",
  "starterCopy",
  "branding",
  "imageMode",
  "cpa",
  "proxy",
  "debug",
  "changelog",
  "modelLogs",
  "requests",
  "audit"
] as const;

type ConfigTabValue = (typeof CONFIG_TAB_VALUES)[number];
type ConfigNavCategoryValue = "overview" | "members" | "content" | "generation" | "system";
type ConfigNavItem = {
  value: ConfigTabValue;
  label: string;
  Icon: typeof Activity;
};

const CONFIG_NAV_ITEMS: ConfigNavItem[] = [
  { value: "statistics", label: "数据统计", Icon: Activity },
  { value: "users", label: "用户账号", Icon: Users },
  { value: "teams", label: "团队管理", Icon: Shield },
  { value: "assetReviews", label: "素材审核", Icon: FolderOpen },
  { value: "caseReviews", label: "灵感审核", Icon: Lightbulb },
  { value: "imageAccounts", label: "账号池", Icon: ShieldCheck },
  { value: "providers", label: "渠道配置", Icon: KeyRound },
  { value: "promptOptimizer", label: "模型配置", Icon: WandSparkles },
  { value: "safetyReview", label: "安全审核", Icon: ShieldCheck },
  { value: "smtp", label: "邮件配置", Icon: Mail },
  { value: "sms", label: "短信配置", Icon: Smartphone },
  { value: "starterCopy", label: "空白页文案", Icon: Bot },
  { value: "branding", label: "品牌设置", Icon: ImageIcon },
  { value: "imageMode", label: "模式配置", Icon: SlidersHorizontal },
  { value: "cpa", label: "CPA 同步", Icon: RefreshCw },
  { value: "proxy", label: "代理配置", Icon: Network },
  { value: "debug", label: "调试配置", Icon: Bug },
  { value: "changelog", label: "更新日志", Icon: ScrollText },
  { value: "modelLogs", label: "模型日志", Icon: Bot },
  { value: "requests", label: "请求日志", Icon: Activity },
  { value: "audit", label: "审计", Icon: Database }
];

const CONFIG_NAV_CATEGORIES: Array<{
  value: ConfigNavCategoryValue;
  label: string;
  items: ConfigTabValue[];
}> = [
  { value: "overview", label: "概览", items: ["statistics"] },
  { value: "members", label: "组织", items: ["users", "teams"] },
  { value: "content", label: "内容", items: ["assetReviews", "caseReviews", "starterCopy", "changelog"] },
  { value: "generation", label: "生成", items: ["imageAccounts", "providers", "promptOptimizer", "safetyReview", "imageMode", "cpa"] },
  { value: "system", label: "系统", items: ["branding", "smtp", "sms", "proxy", "debug", "modelLogs", "requests", "audit"] }
];

function isConfigTabValue(value: string | null | undefined): value is ConfigTabValue {
  return Boolean(value) && CONFIG_TAB_VALUES.includes(value as ConfigTabValue);
}

function configNavItemsForCategory(categoryValue: ConfigNavCategoryValue) {
  const category = CONFIG_NAV_CATEGORIES.find((item) => item.value === categoryValue) ?? CONFIG_NAV_CATEGORIES[0];
  return category.items
    .map((value) => CONFIG_NAV_ITEMS.find((item) => item.value === value))
    .filter((item): item is ConfigNavItem => Boolean(item));
}

function storedConfigTab(): ConfigTabValue {
  try {
    const value = window.localStorage.getItem(CONFIG_TAB_STORAGE_KEY);
    if (value === "file") return "debug";
    return isConfigTabValue(value) ? value : "statistics";
  } catch {
    return "statistics";
  }
}

function shouldAutoRefreshAccountUsage() {
  try {
    const nowMs = Date.now();
    const lastRefreshMs = Number(window.localStorage.getItem(ACCOUNT_USAGE_AUTO_REFRESH_STORAGE_KEY) ?? 0);
    if (Number.isFinite(lastRefreshMs) && nowMs - lastRefreshMs < ACCOUNT_USAGE_AUTO_REFRESH_INTERVAL_MS) return false;
    window.localStorage.setItem(ACCOUNT_USAGE_AUTO_REFRESH_STORAGE_KEY, String(nowMs));
  } catch {
    // If browser storage is unavailable, keep the per-mount guard below as the fallback.
  }
  return true;
}

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

type ConfigUserPayload = {
  account: string;
  username: string;
  email: string;
  phone: string;
  password?: string;
  teamId: string;
  disabled: boolean;
  hasConfigAccess: boolean;
};

type UserSwitchConfirm = {
  kind: "status" | "configAccess";
  user: ConfigUser;
};

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function userSwitchConfirmCopy(confirm: UserSwitchConfirm | null) {
  if (!confirm) return { title: "", description: "", confirmText: "确认", destructive: false };
  const account = confirm.user.account || confirm.user.username;
  if (confirm.kind === "status") {
    const nextEnabled = confirm.user.disabled;
    return {
      title: nextEnabled ? "启用账号" : "禁用账号",
      description: nextEnabled
        ? `确认启用账号「${account}」？启用后该成员可以继续登录和使用系统。`
        : `确认禁用账号「${account}」？禁用后该成员将无法继续登录和使用系统。`,
      confirmText: nextEnabled ? "启用" : "禁用",
      destructive: !nextEnabled
    };
  }
  const nextAllowed = !confirm.user.hasConfigAccess;
  return {
    title: nextAllowed ? "开启管理权限" : "关闭管理权限",
    description: nextAllowed
      ? `确认给账号「${account}」开启管理权限？开启后该成员可以从头像菜单进入管理后台。`
      : `确认关闭账号「${account}」的管理权限？关闭后该成员将不能从头像菜单进入管理后台。`,
    confirmText: nextAllowed ? "开启" : "关闭",
    destructive: !nextAllowed
  };
}

function todayInputDate() {
  return inputDateValue(new Date());
}

function inputDateValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function inputDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return inputDateValue(date);
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function percentLabel(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function durationLabel(value: number) {
  if (!value) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function providerChannelCode(channel: ProviderConfig["channel"]) {
  return channel === "chatgpt_web" ? "CHATGPT-WEB" : channel.toUpperCase();
}

function providerIdTimestamp(value = new Date()) {
  return [
    value.getFullYear(),
    padNumber(value.getMonth() + 1),
    padNumber(value.getDate()),
    padNumber(value.getHours()),
    padNumber(value.getMinutes())
  ].join("");
}

function providerFormId(channel: ProviderConfig["channel"], value = new Date()) {
  return `${providerChannelCode(channel)}-${providerIdTimestamp(value)}`;
}

function providerDateFromId(id: string) {
  const match = id.match(/-(\d{12})$/);
  if (!match) return new Date();
  const value = match[1];
  const date = new Date(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12))
  );
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function uniqueProviderFormId(channel: ProviderConfig["channel"], existingIds: string[] = [], value = new Date()) {
  const usedIds = new Set(existingIds);
  const nextDate = new Date(value);
  for (let index = 0; index < 1440; index += 1) {
    const id = providerFormId(channel, nextDate);
    if (!usedIds.has(id)) return id;
    nextDate.setMinutes(nextDate.getMinutes() + 1);
  }
  return providerFormId(channel, new Date());
}

function isGeneratedProviderName(name: string) {
  return [
    "新的图片接口",
    "新的官网渠道",
    "新的 CPA 渠道",
    "新的 API 渠道",
    "本地图像接口",
    "CPA 额度代理",
    "ChatGPT 官网",
    "API 直连",
    "default-cpa",
    "default-chatgpt-web",
    "default-api"
  ].includes(name.trim()) || /^(CPA|API|CHATGPT-WEB)-\d{12}$/.test(name.trim());
}

function isGeneratedProviderId(id: string) {
  const normalized = id.trim();
  return (
    normalized === "" ||
    normalized === "local-gpt-image" ||
    /^provider(?:-id)?[-_]/.test(normalized) ||
    /^default-(cpa|chatgpt-web|api)(?:-\d+)?$/.test(normalized) ||
    /^(CPA|API|CHATGPT-WEB)-\d{12}$/.test(normalized)
  );
}

function emptyProvider(channel: ProviderConfig["channel"] = "api", existingIds: string[] = []): ProviderConfig {
  const id = uniqueProviderFormId(channel, existingIds);
  const provider: ProviderConfig = {
    id,
    name: id,
    type: "openai-compatible",
    channel,
    enabled: true,
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    apiKeyValue: "",
    routeMode: "images_api",
    generationPath: "/v1/images/generations",
    editPath: "/v1/images/edits",
    responsesPath: "/v1/responses",
    model: "gpt-image-2",
    responsesModel: "gpt-5.5",
    sizes: ["1024x1024", "1536x2048", "1152x2048", "2048x1536", "2048x1152"],
    qualities: ["low", "medium", "high"],
    defaultSize: "auto",
    defaultQuality: "high",
    responseImagePath: "data[0].b64_json",
    proxyEnabled: false,
    quotaMode: "codex_first",
    webAccountId: "",
    webAccountIds: [],
    webAccountMode: "priority",
    webCookies: ""
  };
  return channel === "api" ? provider : providerWithChannelDefaults(provider, channel);
}

export default function ConfigApp() {
  const status = useQuery({ queryKey: ["config-status"], queryFn: configApi.status });
  const branding = useQuery({ queryKey: ["branding"], queryFn: api.branding });

  useDocumentBranding(branding.data);

  if (status.isLoading) {
    return <div className="center-screen">加载配置入口...</div>;
  }

  if (status.data?.setupRequired) {
    return <ConfigAuth mode="setup" />;
  }

  if (!status.data?.authenticated) {
    return <ConfigAuth mode="login" />;
  }

  return (
    <ToastProvider>
      <ConfigDashboard />
    </ToastProvider>
  );
}

function ConfigAuth({ mode }: { mode: "setup" | "login" }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => (mode === "setup" ? configApi.setup(password) : configApi.login(password)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config-status"] })
  });

  return (
    <main className="config-login">
      <section className="login-panel">
        <div className="config-login-brand">
          <div className="brand-mark">
            <ProjectLogo className="config-login-logo" />
          </div>
          <div className="config-login-title">
            <h1>{mode === "setup" ? "初始化配置入口" : "配置入口登录"}</h1>
            <p>{mode === "setup" ? "设置独立的配置页面密码。" : "请输入配置页面独立密码。"}</p>
          </div>
        </div>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <label>
            配置密码
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoFocus
            />
          </label>
          {mutation.error ? <div className="form-error">{mutation.error.message}</div> : null}
          <button className="primary-btn" disabled={mutation.isPending}>
            {mode === "setup" ? "创建配置密码" : "进入配置页面"}
          </button>
        </form>
      </section>
    </main>
  );
}

function ConfigDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ConfigTabValue>(storedConfigTab);
  const logout = useMutation({
    mutationFn: configApi.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config-status"] })
  });

  function changeActiveTab(value: string) {
    if (!isConfigTabValue(value)) return;
    setActiveTab(value);
    try {
      window.localStorage.setItem(CONFIG_TAB_STORAGE_KEY, value);
    } catch {
      // Keep the current in-memory tab even when browser storage is blocked.
    }
  }

  return (
    <Tabs.Root value={activeTab} onValueChange={changeActiveTab} className="config-shell">
      <aside className="config-side">
        <div className="brand-row">
          <ProjectLogo className="config-side-logo" />
          <span>配置中心</span>
        </div>
        <nav className="config-nav" aria-label="配置菜单">
          {CONFIG_NAV_CATEGORIES.map((category) => (
            <section className="config-nav-section" key={category.value}>
              <div className="config-nav-heading">{category.label}</div>
              <Tabs.List className="config-nav-section-list" aria-label={`${category.label}配置菜单`}>
                {configNavItemsForCategory(category.value).map(({ value, label, Icon }) => (
                  <Tabs.Trigger value={value} key={value}>
                    <Icon size={16} />
                    {label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </section>
          ))}
        </nav>
        <button className="ghost-btn" onClick={() => logout.mutate()}>
          <LogOut size={16} />
          退出配置入口
        </button>
      </aside>
      <main className="config-main">
        <Tabs.Content value="statistics">
          <StatisticsPanel />
        </Tabs.Content>
        <Tabs.Content value="users">
          <AccountSearchPanel />
        </Tabs.Content>
        <Tabs.Content value="teams">
          <TeamAccountPanel />
        </Tabs.Content>
        <Tabs.Content value="assetReviews">
          <AssetReviewPanel />
        </Tabs.Content>
        <Tabs.Content value="caseReviews">
          <CaseReviewPanel />
        </Tabs.Content>
        <Tabs.Content value="imageAccounts">
          <ImageAccountPoolPanel />
        </Tabs.Content>
        <Tabs.Content value="providers">
          <ProvidersPanel />
        </Tabs.Content>
        <Tabs.Content value="promptOptimizer">
          <PromptOptimizerPanel />
        </Tabs.Content>
        <Tabs.Content value="safetyReview">
          <SafetyReviewPanel />
        </Tabs.Content>
        <Tabs.Content value="smtp">
          <SmtpSettingsPanel />
        </Tabs.Content>
        <Tabs.Content value="sms">
          <SmsSettingsPanel />
        </Tabs.Content>
        <Tabs.Content value="starterCopy">
          <StarterCopySettingsPanel />
        </Tabs.Content>
        <Tabs.Content value="branding">
          <BrandingSettingsPanel />
        </Tabs.Content>
        <Tabs.Content value="imageMode">
          <ImageModePanel />
        </Tabs.Content>
        <Tabs.Content value="cpa">
          <CpaPanel />
        </Tabs.Content>
        <Tabs.Content value="proxy">
          <ProxyPanel />
        </Tabs.Content>
        <Tabs.Content value="debug">
          <DebugSettingsPanel />
        </Tabs.Content>
        <Tabs.Content value="changelog">
          <ChangelogPanel />
        </Tabs.Content>
        <Tabs.Content value="modelLogs">
          <ModelRequestLogsPanel />
        </Tabs.Content>
        <Tabs.Content value="requests">
          <RequestLogsPanel />
        </Tabs.Content>
        <Tabs.Content value="audit">
          <AuditPanel />
        </Tabs.Content>
      </main>
    </Tabs.Root>
  );
}

type StatisticsCategory = "all" | "users" | "images" | "requests" | "accounts" | "failures";

const statisticsPresetOptions: Array<{ value: Exclude<StatisticsPreset, "custom">; label: string }> = [
  { value: "today", label: "今日" },
  { value: "yesterday", label: "昨日" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "365d", label: "近 1 年" },
  { value: "month", label: "本月" },
  { value: "year", label: "今年" }
];

const statisticsCategories: Array<{ value: StatisticsCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "users", label: "用户团队" },
  { value: "images", label: "图片产出" },
  { value: "requests", label: "渠道请求" },
  { value: "accounts", label: "图片账号" },
  { value: "failures", label: "失败分析" }
];

function statisticsPresetDateRange(nextPreset: Exclude<StatisticsPreset, "custom">) {
  const today = new Date();
  let start = new Date(today);
  let end = new Date(today);
  if (nextPreset === "yesterday") {
    start.setDate(today.getDate() - 1);
    end.setDate(today.getDate() - 1);
  } else if (nextPreset === "7d") {
    start.setDate(today.getDate() - 6);
  } else if (nextPreset === "30d") {
    start.setDate(today.getDate() - 29);
  } else if (nextPreset === "365d") {
    start.setDate(today.getDate() - 364);
  } else if (nextPreset === "month") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (nextPreset === "year") {
    start = new Date(today.getFullYear(), 0, 1);
  } else if (nextPreset === "lastYear") {
    start = new Date(today.getFullYear() - 1, 0, 1);
    end = new Date(today.getFullYear() - 1, 11, 31);
  }
  return { startDate: inputDateValue(start), endDate: inputDateValue(end) };
}

function StatisticsPanel() {
  const [preset, setPreset] = useState<StatisticsPreset>("7d");
  const [startDate, setStartDate] = useState(inputDateOffset(-6));
  const [endDate, setEndDate] = useState(todayInputDate());
  const [category, setCategory] = useState<StatisticsCategory>("all");
  const filters = preset === "custom" ? { startDate, endDate } : { preset };
  const statistics = useQuery({
    queryKey: ["config-statistics", preset, startDate, endDate],
    queryFn: () => configApi.statistics(filters)
  });
  const data = statistics.data?.statistics;

  function show(section: Exclude<StatisticsCategory, "all">) {
    return category === "all" || category === section;
  }

  function selectPreset(nextPreset: Exclude<StatisticsPreset, "custom">) {
    const range = statisticsPresetDateRange(nextPreset);
    setPreset(nextPreset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }

  useEffect(() => {
    const range = statistics.data?.statistics.range;
    if (!range) return;
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, [statistics.data?.statistics.range.startDate, statistics.data?.statistics.range.endDate]);

  return (
    <section className="config-card statistics-page">
      <ConfigHeader title="数据统计" desc="按时间范围查看系统整体、用户团队、图片产出、渠道请求、图片账号和失败情况。" />
      <div className="statistics-sticky-filters">
        <div className="statistics-toolbar">
          <div className="statistics-category-tabs" role="tablist" aria-label="统计分类">
            {statisticsCategories.map((item) => (
              <button
                key={item.value}
                type="button"
                className={category === item.value ? "active" : ""}
                onClick={() => setCategory(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="statistics-date-controls">
            <div className="statistics-preset-row">
              {statisticsPresetOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={preset === item.value ? "active" : ""}
                  onClick={() => selectPreset(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="statistics-date-range">
              <label aria-label="开始日期">
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    setPreset("custom");
                  }}
                />
              </label>
              <span className="statistics-date-separator">至</span>
              <label aria-label="结束日期">
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                    setPreset("custom");
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
      {statistics.isLoading ? <div className="settings-empty">统计数据加载中...</div> : null}
      {statistics.error ? <div className="form-error">{statistics.error.message}</div> : null}
      {data ? (
        <div className="statistics-sections">
          {category === "all" ? <StatisticsSummarySection data={data} /> : null}
          {show("users") ? <StatisticsUserTeamSection data={data} /> : null}
          {show("images") ? <StatisticsImageSection data={data} /> : null}
          {show("requests") ? <StatisticsRequestSection data={data} /> : null}
          {show("accounts") ? <StatisticsAccountSection data={data} /> : null}
          {show("failures") ? <StatisticsFailureSection data={data} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function StatisticsSection({
  title,
  desc,
  children
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="statistics-section">
      <header className="statistics-section-head">
        <h3>{title}</h3>
        <p>{desc}</p>
      </header>
      {children}
    </section>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="statistics-card">
      <span>{label}</span>
      <strong>{typeof value === "number" ? numberLabel(value) : value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function StatisticsLineChart({
  title,
  data,
  series
}: {
  title?: string;
  data: ConfigStatistics["trends"];
  series: Array<{ key: keyof ConfigStatistics["trends"][number]; label: string; className: string }>;
}) {
  return (
    <LightweightLineChart
      title={title}
      data={data}
      valueLabel={numberLabel}
      series={series.map((item) => ({
        id: String(item.key),
        label: item.label,
        tone: item.className as "primary" | "muted" | "danger",
        value: (row: ConfigStatistics["trends"][number]) => Number(row[item.key] ?? 0)
      }))}
    />
  );
}

function StatisticsBarList({
  items,
  valueLabel = (value: number) => numberLabel(value)
}: {
  items: Array<{ label: string; value: number; detail?: string }>;
  valueLabel?: (value: number) => string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (items.length === 0) {
    return (
      <div className="statistics-bar-list empty">
        <div className="settings-empty">暂无数据</div>
      </div>
    );
  }
  return (
    <div className="statistics-bar-list">
      {items.map((item) => {
        const width = item.value > 0 ? Math.max(4, (item.value / max) * 100) : 0;
        return (
          <div className="statistics-bar-row" key={`${item.label}-${item.detail ?? ""}`}>
            <div>
              <span title={item.label}>{item.label}</span>
              <strong>{valueLabel(item.value)}</strong>
            </div>
            <span className="statistics-bar-track">
              <span style={{ width: `${width}%` }} />
            </span>
            {item.detail ? <small title={item.detail}>{item.detail}</small> : null}
          </div>
        );
      })}
    </div>
  );
}

function StatisticsListPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="statistics-list-panel">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function StatisticsSummarySection({ data }: { data: ConfigStatistics }) {
  return (
    <StatisticsSection title="系统总览" desc={`当前统计范围：${data.range.startDate} 至 ${data.range.endDate}`}>
      <div className="statistics-card-grid summary">
        <StatCard label="用户数" value={data.summary.totalUsers} hint={`启用 ${numberLabel(data.summary.enabledUsers)} · 管理 ${numberLabel(data.summary.managerUsers)}`} />
        <StatCard label="图片数" value={data.summary.totalImages} hint={`生成 ${numberLabel(data.summary.generationImages)} · 编辑 ${numberLabel(data.summary.editImages)} · 重试 ${numberLabel(data.summary.retryGeneratedImages)}`} />
        <StatCard label="今日图片数" value={data.summary.todayImages} hint={`生成 ${numberLabel(data.summary.todayGenerationImages)} · 编辑 ${numberLabel(data.summary.todayEditImages)} · 重试 ${numberLabel(data.summary.todayRetryGeneratedImages)}`} />
        <StatCard label="请求数" value={data.summary.totalRequests} hint={`失败 ${numberLabel(data.summary.failedRequests)} · 重试 ${numberLabel(data.summary.retryRequests)}`} />
        <StatCard label="成功率" value={percentLabel(data.summary.successRate)} hint={`平均耗时 ${durationLabel(data.summary.averageDurationMs)}`} />
        <StatCard label="渠道数" value={data.summary.totalProviders} hint={`启用 ${numberLabel(data.summary.enabledProviders)}`} />
        <StatCard label="可用图片账号" value={data.summary.availableAccounts} hint={`限流/异常 ${numberLabel(data.summary.limitedOrAbnormalAccounts)}`} />
      </div>
      <StatisticsLineChart
        title="图片趋势"
        data={data.trends}
        series={[
          { key: "generationImages", label: "生成", className: "primary" },
          { key: "editImages", label: "编辑", className: "muted" }
        ]}
      />
    </StatisticsSection>
  );
}

function StatisticsUserTeamSection({ data }: { data: ConfigStatistics }) {
  return (
    <StatisticsSection title="用户团队" desc="查看用户活跃、团队产出和管理权限账号分布。">
      <div className="statistics-card-grid compact">
        <StatCard label="全部用户" value={data.users.totals.total} />
        <StatCard label="启用用户" value={data.users.totals.enabled} />
        <StatCard label="禁用用户" value={data.users.totals.disabled} />
        <StatCard label="管理权限" value={data.users.totals.managers} />
      </div>
      <div className="statistics-three-column">
        <StatisticsListPanel title="用户图片数排行">
          <StatisticsBarList
            items={data.users.imageRankings.map((item) => ({
              label: item.username,
              value: item.imageCount,
              detail: `${item.account || "未记录账号"} · ${item.teamName}`
            }))}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="用户请求数排行">
          <StatisticsBarList
            items={data.users.requestRankings.map((item) => ({
              label: item.username,
              value: item.requestCount,
              detail: `${item.account || "未记录账号"} · ${item.teamName}`
            }))}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="用户失败数排行">
          <StatisticsBarList
            items={data.users.failureRankings.map((item) => ({
              label: item.username,
              value: item.failureCount,
              detail: `${item.account || "未记录账号"} · 最近 ${formatDate(item.lastActiveAt)}`
            }))}
          />
        </StatisticsListPanel>
      </div>
      <div className="table-wrap statistics-table-wrap">
        <table>
          <thead>
            <tr>
              <th>团队</th>
              <th>用户</th>
              <th>会话</th>
              <th>图片</th>
              <th>请求</th>
              <th>成功率</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((team) => (
              <tr key={team.teamId}>
                <td>{team.teamName}</td>
                <td>{team.userCount}</td>
                <td>{team.sessionCount}</td>
                <td>{team.imageCount}</td>
                <td>{team.requestCount}</td>
                <td>{percentLabel(team.successRate)}</td>
              </tr>
            ))}
            {data.teams.length === 0 ? (
              <tr>
                <td colSpan={6}>暂无团队数据</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </StatisticsSection>
  );
}

function StatisticsImageSection({ data }: { data: ConfigStatistics }) {
  return (
    <StatisticsSection title="图片产出" desc="按生成、编辑、用户、团队和渠道观察图片产出。">
      <div className="statistics-card-grid compact">
        <StatCard label="图片总数" value={data.images.totals.total} />
        <StatCard label="生成" value={data.images.totals.generation} />
        <StatCard label="编辑" value={data.images.totals.edit} />
        <StatCard label="重试生成" value={data.images.totals.retryGenerated} />
      </div>
      <StatisticsLineChart
        title="生成 / 编辑趋势"
        data={data.trends}
        series={[
          { key: "generationImages", label: "生成", className: "primary" },
          { key: "editImages", label: "编辑", className: "muted" }
        ]}
      />
      <div className="statistics-three-column">
        <StatisticsListPanel title="按用户">
          <StatisticsBarList
            items={data.images.byUser.map((item) => ({
              label: item.username,
              value: item.imageCount,
              detail: `${item.account || "未记录账号"} · ${item.teamName}`
            }))}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="按团队">
          <StatisticsBarList
            items={data.images.byTeam.map((item) => ({
              label: item.teamName,
              value: item.imageCount,
              detail: `用户 ${numberLabel(item.userCount)} · 请求 ${numberLabel(item.requestCount)}`
            }))}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="按渠道">
          <StatisticsBarList
            items={data.images.byProvider.map((item) => ({
              label: item.providerName,
              value: item.imageCount,
              detail: `重试生成 ${numberLabel(item.retryImageCount)}`
            }))}
          />
        </StatisticsListPanel>
      </div>
    </StatisticsSection>
  );
}

function StatisticsRequestSection({ data }: { data: ConfigStatistics }) {
  return (
    <StatisticsSection title="渠道请求" desc="按渠道、调用方式和具体渠道查看请求质量。">
      <div className="statistics-card-grid compact">
        <StatCard label="请求数" value={data.providers.totals.totalRequests} />
        <StatCard label="成功率" value={percentLabel(data.providers.totals.successRate)} />
        <StatCard label="重试请求" value={data.providers.totals.retryRequests} hint={`自动 ${numberLabel(data.providers.totals.autoRetryCount)} · 手动 ${numberLabel(data.providers.totals.manualRetryCount)}`} />
        <StatCard label="重试成功率" value={percentLabel(data.providers.totals.retrySuccessRate)} hint={`成功 ${numberLabel(data.providers.totals.retrySuccessRequests)} · 失败 ${numberLabel(data.providers.totals.retryFailureRequests)}`} />
        <StatCard label="平均耗时" value={durationLabel(data.providers.totals.averageDurationMs)} />
        <StatCard label="失败数" value={data.providers.totals.failedRequests} />
      </div>
      <div className="statistics-two-column">
        <StatisticsListPanel title="按渠道">
          <StatisticsBarList
            items={data.providers.byChannel.map((item) => ({
              label: item.label,
              value: item.requestCount,
              detail: `成功率 ${percentLabel(item.successRate)} · 重试 ${numberLabel(item.retryRequestCount)} · ${durationLabel(item.averageDurationMs)}`
            }))}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="按调用方式">
          <StatisticsBarList
            items={data.providers.byRoute.map((item) => ({
              label: item.label || `${item.channelLabel || item.channel} / ${item.routeMode}`,
              value: item.requestCount,
              detail: `成功 ${numberLabel(item.successCount)} · 失败 ${numberLabel(item.failureCount)} · 重试 ${numberLabel(item.retryRequestCount)}`
            }))}
          />
        </StatisticsListPanel>
      </div>
      <div className="statistics-two-column">
        <StatisticsListPanel title="渠道耗时排行">
          <StatisticsBarList
            items={[...data.providers.byProvider]
              .filter((item) => item.requestCount > 0)
              .sort((left, right) => right.averageDurationMs - left.averageDurationMs)
              .slice(0, 10)
              .map((item) => ({
                label: item.providerName,
                value: item.averageDurationMs,
                detail: `请求 ${numberLabel(item.requestCount)} · 重试 ${numberLabel(item.retryRequestCount)} · 成功率 ${percentLabel(item.successRate)}`
              }))}
            valueLabel={durationLabel}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="渠道失败排行">
          <StatisticsBarList
            items={[...data.providers.byProvider]
              .filter((item) => item.failureCount > 0)
              .sort((left, right) => right.failureCount - left.failureCount)
              .slice(0, 10)
              .map((item) => ({
                label: item.providerName,
                value: item.failureCount,
                detail: item.lastError || `${item.channel} · 暂无错误摘要`
              }))}
          />
        </StatisticsListPanel>
      </div>
      <div className="table-wrap statistics-table-wrap">
        <table>
          <thead>
            <tr>
              <th>渠道</th>
              <th>类型</th>
              <th>请求</th>
              <th>重试</th>
              <th>失败</th>
              <th>成功率</th>
              <th>平均耗时</th>
              <th>最近错误</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.byProvider.map((provider) => (
              <tr key={provider.providerId || provider.providerName}>
                <td>{provider.providerName}</td>
                <td>{provider.channel}</td>
                <td>{provider.requestCount}</td>
                <td>{provider.retryRequestCount}</td>
                <td>{provider.failureCount}</td>
                <td>{percentLabel(provider.successRate)}</td>
                <td>{durationLabel(provider.averageDurationMs)}</td>
                <td className="endpoint-cell">
                  <span>{provider.lastError || "-"}</span>
                </td>
              </tr>
            ))}
            {data.providers.byProvider.length === 0 ? (
              <tr>
                <td colSpan={8}>暂无渠道请求数据</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </StatisticsSection>
  );
}

function StatisticsAccountSection({ data }: { data: ConfigStatistics }) {
  return (
    <StatisticsSection title="图片账号" desc="查看号池状态、本地调用排行和最近 CPA 同步结果。">
      <div className="statistics-card-grid compact">
        <StatCard label="账号总数" value={data.accounts.totals.total} />
        <StatCard label="正常" value={data.accounts.totals.normal} />
        <StatCard label="限流" value={data.accounts.totals.limited} />
        <StatCard label="异常" value={data.accounts.totals.abnormal} />
        <StatCard label="禁用" value={data.accounts.totals.disabled} />
      </div>
      <div className="statistics-two-column">
        <StatisticsListPanel title="账号状态分布">
          <StatisticsBarList items={data.accounts.statusCounts.map((item) => ({ label: item.label, value: item.count }))} />
        </StatisticsListPanel>
        <StatisticsListPanel title="本地请求排行">
          <StatisticsBarList
            items={data.accounts.rankings.map((item) => ({
              label: item.name,
              value: item.requestCount,
              detail: `${item.status || "未知"} · 最近 ${formatDate(item.lastRequestAt)}`
            }))}
          />
        </StatisticsListPanel>
      </div>
      <div className="statistics-two-column">
        <StatisticsListPanel title="本地成功排行">
          <StatisticsBarList
            items={[...data.accounts.rankings]
              .filter((item) => item.successCount > 0)
              .sort((left, right) => right.successCount - left.successCount)
              .map((item) => ({
                label: item.name,
                value: item.successCount,
                detail: `失败 ${numberLabel(item.failureCount)} · 最近 ${formatDate(item.lastRequestAt)}`
              }))}
          />
        </StatisticsListPanel>
        <StatisticsListPanel title="本地失败排行">
          <StatisticsBarList
            items={[...data.accounts.rankings]
              .filter((item) => item.failureCount > 0)
              .sort((left, right) => right.failureCount - left.failureCount)
              .map((item) => ({
                label: item.name,
                value: item.failureCount,
                detail: `成功 ${numberLabel(item.successCount)} · 最近 ${formatDate(item.lastRequestAt)}`
              }))}
          />
        </StatisticsListPanel>
      </div>
      <p className="muted">
        最近同步：
        {data.accounts.latestSyncRun
          ? `${data.accounts.latestSyncRun.status} · ${data.accounts.latestSyncRun.message} · ${formatDate(data.accounts.latestSyncRun.finishedAt)}`
          : "暂无同步记录"}
      </p>
    </StatisticsSection>
  );
}

function StatisticsFailureSection({ data }: { data: ConfigStatistics }) {
  const { showToast } = useToast();

  async function copyFailureError(error: string) {
    const copied = await copyTextToClipboard(error);
    showToast(copied ? "错误信息已复制" : "复制失败", copied ? "success" : "error");
  }

  return (
    <StatisticsSection title="失败分析" desc="定位高频错误、失败渠道和最近失败请求。">
      <div className="statistics-card-grid compact">
        <StatCard label="失败总数" value={data.failures.total} />
        <StatCard label="失败率" value={percentLabel(data.failures.failureRate)} />
      </div>
      <div className="statistics-failure-stack">
        <div className="statistics-two-column">
          <StatisticsListPanel title="按渠道聚合">
            <StatisticsBarList
              items={data.failures.byProvider.map((item) => ({
                label: item.providerName,
                value: item.count,
                detail: formatDate(item.lastAt)
              }))}
            />
          </StatisticsListPanel>
          <StatisticsListPanel title="按账号聚合">
            <StatisticsBarList
              items={data.failures.byAccount.map((item) => ({
                label: item.name,
                value: item.count,
                detail: formatDate(item.lastAt)
              }))}
            />
          </StatisticsListPanel>
        </div>
        <StatisticsListPanel title="高频错误摘要">
          <StatisticsBarList
            items={data.failures.groups.map((item) => ({
              label: item.error,
              value: item.count,
              detail: `${item.providerName || "未记录渠道"} · ${item.routeMode || "未记录方式"}`
            }))}
          />
        </StatisticsListPanel>
      </div>
      <div className="table-wrap statistics-table-wrap">
        <table className="statistics-failure-table">
          <colgroup>
            <col className="failure-time-col" />
            <col className="failure-user-col" />
            <col className="failure-provider-col" />
            <col className="failure-route-col" />
            <col className="failure-account-col" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>渠道</th>
              <th>调用方式</th>
              <th>图片账号</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {data.failures.recent.map((item) => {
              const fullError = item.fullError || item.error;
              const userTitle = [item.username, item.account].filter(Boolean).join(" / ") || "未记录用户";
              return (
                <tr key={item.id}>
                  <td title={item.createdAt}>{formatDate(item.createdAt)}</td>
                  <td title={userTitle}>
                    {item.username}
                    {item.account && item.account !== item.username ? <small>{item.account}</small> : null}
                  </td>
                  <td title={item.providerName}>{item.providerName}</td>
                  <td title={item.routeMode}>{item.routeMode}</td>
                  <td title={item.sourceAccountName || "-"}>{item.sourceAccountName || "-"}</td>
                  <td className="endpoint-cell">
                    <button
                      type="button"
                      className="failure-error-copy"
                      title={fullError}
                      onClick={() => copyFailureError(fullError)}
                    >
                      {fullError}
                    </button>
                  </td>
                </tr>
              );
            })}
            {data.failures.recent.length === 0 ? (
              <tr>
                <td colSpan={6}>暂无失败记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </StatisticsSection>
  );
}

function TeamAccountPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const teams = useQuery({ queryKey: ["config-teams"], queryFn: configApi.teams });
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  const [teamDialog, setTeamDialog] = useState<{ mode: "create" | "edit"; team?: Team } | null>(null);
  const [userDialog, setUserDialog] = useState<{
    mode: "create" | "edit";
    user?: ConfigUser;
    teamId?: string;
  } | null>(null);
  const [resetUser, setResetUser] = useState<ConfigUser | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "team"; team: Team }
    | { kind: "user"; user: ConfigUser }
    | null
  >(null);
  const [switchConfirm, setSwitchConfirm] = useState<UserSwitchConfirm | null>(null);
  const switchConfirmCopy = userSwitchConfirmCopy(switchConfirm);
  const allUserCount = useMemo(
    () => teams.data?.teams.reduce((sum, team) => sum + team.userCount, 0) ?? 0,
    [teams.data?.teams]
  );
  const selectedTeam =
    selectedTeamId === "all" ? null : teams.data?.teams.find((team) => team.id === selectedTeamId) ?? null;
  const teamUsers = useQuery({
    queryKey: ["config-users", { teamId: selectedTeam?.id ?? "all" }],
    queryFn: () => configApi.users(selectedTeam?.id ? { teamId: selectedTeam.id } : undefined),
    enabled: Boolean(teams.data)
  });
  const createTeam = useMutation({
    mutationFn: (payload: { name: string; description: string }) => configApi.createTeam(payload),
    onSuccess: () => {
      setTeamDialog(null);
      showToast("团队已新增");
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const updateTeam = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; description: string } }) =>
      configApi.updateTeam(id, payload),
    onSuccess: () => {
      setTeamDialog(null);
      showToast("团队已保存");
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const deleteTeam = useMutation({
    mutationFn: (id: string) => configApi.deleteTeam(id),
    onSuccess: () => {
      showToast("团队已删除");
      setSelectedTeamId("");
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const createUser = useMutation({
    mutationFn: (payload: ConfigUserPayload & { password: string }) => configApi.createUser(payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已新增");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const updateUser = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfigUserPayload }) =>
      configApi.updateUser(id, payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已保存");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const toggleUser = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => configApi.updateUser(id, { disabled }),
    onSuccess: () => {
      showToast("账号状态已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const toggleConfigAccess = useMutation({
    mutationFn: ({ id, hasConfigAccess }: { id: string; hasConfigAccess: boolean }) =>
      configApi.updateUser(id, { hasConfigAccess }),
    onSuccess: () => {
      showToast("管理权限已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => configApi.resetPassword(id, password),
    onSuccess: () => {
      setResetUser(null);
      showToast("密码已重置");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => configApi.deleteUser(id),
    onSuccess: () => {
      showToast("账号已删除");
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });

  useEffect(() => {
    if (!selectedTeamId) setSelectedTeamId("all");
  }, [selectedTeamId, teams.data?.teams]);

  return (
    <section className="config-card">
      <ConfigHeader title="团队管理" desc="左侧按团队筛选账号，右侧维护账号与团队信息。" />
      <div className="team-manager">
        <aside className="team-tree">
          <button className="secondary-btn full" onClick={() => setTeamDialog({ mode: "create" })}>
            新增团队
          </button>
          <div className="team-tree-list">
            <button
              type="button"
              className={selectedTeamId === "all" ? "team-option active" : "team-option"}
              onClick={() => setSelectedTeamId("all")}
            >
              <span className="team-option-name">全部分组</span>
              <span className="team-option-count">{allUserCount}</span>
            </button>
            {teams.data?.teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={selectedTeam?.id === team.id ? "team-option editable active" : "team-option editable"}
                onClick={() => setSelectedTeamId(team.id)}
              >
                <span className="team-option-name">{team.name}</span>
                <span className="team-option-count">{team.userCount}</span>
                <span
                  className="team-option-edit"
                  role="button"
                  tabIndex={0}
                  aria-label={`编辑团队 ${team.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setTeamDialog({ mode: "edit", team });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setTeamDialog({ mode: "edit", team });
                  }}
                >
                  <Pencil size={14} />
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="team-detail">
          <div className="team-detail-head">
            <div>
              <h3>{selectedTeam?.name ?? "全部分组"}</h3>
              <p>
                {selectedTeam
                  ? selectedTeam.description || "暂无说明"
                  : `${teams.data?.teams.length ?? 0} 个团队，${allUserCount} 个账号`}
              </p>
            </div>
            {teams.data?.teams.length ? (
              <div className="row-actions">
                <button
                  className="secondary-btn"
                  onClick={() => setUserDialog({ mode: "create", teamId: selectedTeam?.id ?? teams.data?.teams[0]?.id })}
                >
                  新增账号
                </button>
                {selectedTeam ? (
                  <button
                    className="danger-btn"
                    onClick={() => setConfirmAction({ kind: "team", team: selectedTeam })}
                  >
                    删除团队
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <UserTable
            users={teamUsers.data?.users ?? []}
            onEdit={(user) => setUserDialog({ mode: "edit", user })}
            onToggle={(user) => setSwitchConfirm({ kind: "status", user })}
            onConfigAccessToggle={(user) => setSwitchConfirm({ kind: "configAccess", user })}
            onReset={(user) => setResetUser(user)}
            onDelete={(user) => setConfirmAction({ kind: "user", user })}
          />
        </section>
      </div>
      {teamDialog ? (
        <TeamDialog
          mode={teamDialog.mode}
          team={teamDialog.team}
          onClose={() => setTeamDialog(null)}
          onSubmit={(payload) => {
            if (teamDialog.mode === "create") createTeam.mutate(payload);
            else updateTeam.mutate({ id: teamDialog.team!.id, payload });
          }}
        />
      ) : null}
      {userDialog ? (
        <UserDialog
          mode={userDialog.mode}
          user={userDialog.user}
          teams={teams.data?.teams ?? []}
          defaultTeamId={userDialog.teamId ?? selectedTeam?.id}
          onClose={() => setUserDialog(null)}
          onSubmit={(payload) => {
            if (userDialog.mode === "create") {
              createUser.mutate(payload as ConfigUserPayload & { password: string });
            } else {
              updateUser.mutate({
                id: userDialog.user!.id,
                payload: {
                  account: payload.account,
                  username: payload.username,
                  email: payload.email,
                  phone: payload.phone,
                  teamId: payload.teamId,
                  disabled: payload.disabled,
                  hasConfigAccess: payload.hasConfigAccess
                }
              });
            }
          }}
        />
      ) : null}
      <PromptDialog
        open={Boolean(resetUser)}
        title="重置密码"
        label="新密码"
        type="password"
        description={resetUser ? `为账号「${resetUser.account}」设置新密码。` : undefined}
        confirmText="重置密码"
        onCancel={() => setResetUser(null)}
        onSubmit={(password) => {
          if (resetUser) resetPassword.mutate({ id: resetUser.id, password });
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.kind === "team" ? "删除团队" : "删除账号"}
        description={
          confirmAction?.kind === "team"
            ? `确认删除团队「${confirmAction.team.name}」？团队下有账号时不能删除。`
            : confirmAction?.kind === "user"
              ? `确认删除账号「${confirmAction.user.account}」？该账号的对话、图片和素材记录会一起删除。`
              : ""
        }
        confirmText="删除"
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.kind === "team") deleteTeam.mutate(confirmAction.team.id);
          if (confirmAction?.kind === "user") deleteUser.mutate(confirmAction.user.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title={switchConfirmCopy.title}
        description={switchConfirmCopy.description}
        confirmText={switchConfirmCopy.confirmText}
        destructive={switchConfirmCopy.destructive}
        onCancel={() => setSwitchConfirm(null)}
        onConfirm={() => {
          if (!switchConfirm) return;
          if (switchConfirm.kind === "status") {
            toggleUser.mutate({ id: switchConfirm.user.id, disabled: !switchConfirm.user.disabled });
          } else {
            toggleConfigAccess.mutate({
              id: switchConfirm.user.id,
              hasConfigAccess: !switchConfirm.user.hasConfigAccess
            });
          }
          setSwitchConfirm(null);
        }}
      />
    </section>
  );
}

function AccountSearchPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userDialog, setUserDialog] = useState<{ mode: "create" | "edit"; user?: ConfigUser } | null>(null);
  const [resetUser, setResetUser] = useState<ConfigUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConfigUser | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<UserSwitchConfirm | null>(null);
  const switchConfirmCopy = userSwitchConfirmCopy(switchConfirm);
  const registrationSettings = useQuery({
    queryKey: ["config-registration-settings"],
    queryFn: configApi.registrationSettings
  });
  const registrationEnabled = registrationSettings.data?.settings.enabled ?? false;
  const teams = useQuery({ queryKey: ["config-teams"], queryFn: configApi.teams });
  const users = useQuery({
    queryKey: ["config-users", { keyword, teamFilter, statusFilter }],
    queryFn: () => configApi.users({ keyword, teamId: teamFilter, status: statusFilter })
  });
  const saveRegistrationSettings = useMutation({
    mutationFn: (enabled: boolean) => configApi.saveRegistrationSettings({ enabled }),
    onSuccess: (data) => {
      showToast(data.settings.enabled ? "自助注册已开启" : "自助注册已关闭");
      queryClient.invalidateQueries({ queryKey: ["config-registration-settings"] });
    }
  });
  const createUser = useMutation({
    mutationFn: (payload: ConfigUserPayload & { password: string }) => configApi.createUser(payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已新增");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const updateUser = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfigUserPayload }) =>
      configApi.updateUser(id, payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已保存");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const toggleUser = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => configApi.updateUser(id, { disabled }),
    onSuccess: () => {
      showToast("账号状态已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const toggleConfigAccess = useMutation({
    mutationFn: ({ id, hasConfigAccess }: { id: string; hasConfigAccess: boolean }) =>
      configApi.updateUser(id, { hasConfigAccess }),
    onSuccess: () => {
      showToast("管理权限已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => configApi.resetPassword(id, password),
    onSuccess: () => {
      setResetUser(null);
      showToast("密码已重置");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => configApi.deleteUser(id),
    onSuccess: () => {
      setDeleteTarget(null);
      showToast("账号已删除");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });

  return (
    <section className="config-card">
      <ConfigHeader title="用户账号" desc="支持按账号、邮箱、手机号、团队和状态搜索筛选普通用户。" />
      <div className="switch-row account-registration-row">
        <div className="switch-row-copy">
          <span>自助注册</span>
          <small>关闭后 C 端无法获取注册验证码或完成注册；后台新增账号不受影响。</small>
        </div>
        <SwitchControl
          checked={registrationEnabled}
          disabled={registrationSettings.isLoading || saveRegistrationSettings.isPending}
          label={registrationEnabled ? "已开启" : "已关闭"}
          onChange={(enabled) => saveRegistrationSettings.mutate(enabled)}
        />
      </div>
      {saveRegistrationSettings.error ? <div className="form-error">{saveRegistrationSettings.error.message}</div> : null}
      <div className="filter-bar">
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索账号/用户名/邮箱/手机号" />
        <CustomSelect
          value={teamFilter}
          onChange={setTeamFilter}
          options={[
            { value: "", label: "全部团队" },
            ...(teams.data?.teams.map((team) => ({ value: team.id, label: team.name })) ?? [])
          ]}
        />
        <CustomSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "", label: "全部状态" },
            { value: "enabled", label: "启用" },
            { value: "disabled", label: "禁用" }
          ]}
        />
        <button className="secondary-btn" onClick={() => setUserDialog({ mode: "create" })}>
          新增账号
        </button>
      </div>
      <UserTable
        users={users.data?.users ?? []}
        onEdit={(user) => setUserDialog({ mode: "edit", user })}
        onToggle={(user) => setSwitchConfirm({ kind: "status", user })}
        onConfigAccessToggle={(user) => setSwitchConfirm({ kind: "configAccess", user })}
        onReset={(user) => setResetUser(user)}
        onDelete={(user) => setDeleteTarget(user)}
      />
      {userDialog ? (
        <UserDialog
          mode={userDialog.mode}
          user={userDialog.user}
          teams={teams.data?.teams ?? []}
          defaultTeamId={teamFilter || teams.data?.teams[0]?.id}
          onClose={() => setUserDialog(null)}
          onSubmit={(payload) => {
            if (userDialog.mode === "create") {
              createUser.mutate(payload as ConfigUserPayload & { password: string });
            } else {
              updateUser.mutate({
                id: userDialog.user!.id,
                payload: {
                  account: payload.account,
                  username: payload.username,
                  email: payload.email,
                  phone: payload.phone,
                  teamId: payload.teamId,
                  disabled: payload.disabled,
                  hasConfigAccess: payload.hasConfigAccess
                }
              });
            }
          }}
        />
      ) : null}
      <PromptDialog
        open={Boolean(resetUser)}
        title="重置密码"
        label="新密码"
        type="password"
        description={resetUser ? `为账号「${resetUser.account}」设置新密码。` : undefined}
        confirmText="重置密码"
        onCancel={() => setResetUser(null)}
        onSubmit={(password) => {
          if (resetUser) resetPassword.mutate({ id: resetUser.id, password });
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除账号"
        description={deleteTarget ? `确认删除账号「${deleteTarget.account}」？该账号的对话、图片和素材记录会一起删除。` : ""}
        confirmText="删除"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteUser.mutate(deleteTarget.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title={switchConfirmCopy.title}
        description={switchConfirmCopy.description}
        confirmText={switchConfirmCopy.confirmText}
        destructive={switchConfirmCopy.destructive}
        onCancel={() => setSwitchConfirm(null)}
        onConfirm={() => {
          if (!switchConfirm) return;
          if (switchConfirm.kind === "status") {
            toggleUser.mutate({ id: switchConfirm.user.id, disabled: !switchConfirm.user.disabled });
          } else {
            toggleConfigAccess.mutate({
              id: switchConfirm.user.id,
              hasConfigAccess: !switchConfirm.user.hasConfigAccess
            });
          }
          setSwitchConfirm(null);
        }}
      />
    </section>
  );
}

function ChangelogPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const changelog = useQuery({ queryKey: ["config-changelog"], queryFn: configApi.changelog });
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; entry?: ChangelogEntry } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ChangelogEntry | null>(null);
  const save = useMutation({
    mutationFn: ({
      mode,
      id,
      payload
    }: {
      mode: "create" | "edit";
      id?: string;
      payload: Pick<ChangelogEntry, "version" | "date" | "content">;
    }) =>
      mode === "edit" && id
        ? configApi.updateChangelogEntry(id, payload)
        : configApi.createChangelogEntry(payload),
    onSuccess: (_data, variables) => {
      setDialog(null);
      showToast(variables.mode === "edit" ? "更新日志已保存" : "更新日志已新增");
      queryClient.invalidateQueries({ queryKey: ["config-changelog"] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
    }
  });
  const remove = useMutation({
    mutationFn: configApi.deleteChangelogEntry,
    onSuccess: () => {
      setRemoveTarget(null);
      showToast("更新日志已删除");
      queryClient.invalidateQueries({ queryKey: ["config-changelog"] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
    }
  });

  function closeDialog() {
    save.reset();
    setDialog(null);
  }

  return (
    <section className="config-card">
      <ConfigHeader title="更新日志" desc="真实记录存入配置数据库；静态 Markdown 文档由管理员自行维护，不参与系统读取。" />
      <div className="config-file-actions changelog-file-actions">
        <span>在这里维护用户可见的版本记录。</span>
        <button className="primary-btn" onClick={() => setDialog({ mode: "create" })}>
          <Plus size={16} />
          新增日志
        </button>
      </div>
      <div className="changelog-admin-list">
        {changelog.isLoading ? <div className="settings-empty">更新日志加载中...</div> : null}
        {changelog.error ? <div className="form-error">{changelog.error.message}</div> : null}
        {!changelog.isLoading && changelog.data?.entries.length === 0 ? <div className="settings-empty">暂无更新日志</div> : null}
        {changelog.data?.entries.map((entry) => (
          <article className="changelog-admin-entry" key={entry.id}>
            <header>
              <div>
                <h3>{entry.version}</h3>
                <span>{entry.date || "-"}</span>
              </div>
              <div className="row-actions">
                <button className="secondary-btn" onClick={() => setDialog({ mode: "edit", entry })}>
                  编辑
                </button>
                <button className="danger-btn" onClick={() => setRemoveTarget(entry)}>
                  删除
                </button>
              </div>
            </header>
            <MarkdownView markdown={entry.content} />
          </article>
        ))}
      </div>
      {dialog ? (
        <ChangelogDialog
          mode={dialog.mode}
          entry={dialog.entry}
          saving={save.isPending}
          error={save.error}
          onClose={closeDialog}
          onSubmit={(payload) =>
            save.mutate({
              mode: dialog.mode,
              id: dialog.entry?.id,
              payload
            })
          }
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="删除更新日志"
        description={removeTarget ? `确认删除版本「${removeTarget.version}」的更新记录？` : ""}
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

function ChangelogDialog({
  mode,
  entry,
  saving,
  error,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  entry?: ChangelogEntry;
  saving: boolean;
  error?: Error | null;
  onClose: () => void;
  onSubmit: (payload: Pick<ChangelogEntry, "version" | "date" | "content">) => void;
}) {
  const [version, setVersion] = useState(entry?.version ?? "");
  const [date, setDate] = useState(entry?.date || todayInputDate());
  const [content, setContent] = useState(entry?.content ?? "");
  const canSubmit = version.trim() && date.trim() && content.trim();

  return (
    <div className="modal-backdrop">
      <section className="case-modal changelog-modal">
        <header>
          <h3>{mode === "create" ? "新增更新日志" : "编辑更新日志"}</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="changelog-form">
          <label>
            版本号
            <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="例如 v0.1.1" autoFocus />
          </label>
          <label>
            发布日期
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <div className="changelog-editor-grid wide">
            <label className="changelog-editor-field">
              更新记录（Markdown）
              <textarea
                rows={14}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={"- 新增功能\n- 修复问题"}
              />
            </label>
            <div className="changelog-editor-field">
              <span>预览</span>
              <div className="changelog-preview">
                <MarkdownView markdown={content.trim() || "暂无预览"} />
              </div>
            </div>
          </div>
          <div className="row-actions">
            <button className="secondary-btn" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button
              className="primary-btn"
              onClick={() => onSubmit({ version: version.trim(), date: date.trim(), content })}
              disabled={saving || !canSubmit}
            >
              <Save size={16} />
              {saving ? "保存中" : "保存日志"}
            </button>
          </div>
          {error ? <div className="form-error wide">{error.message}</div> : null}
        </div>
      </section>
    </div>
  );
}

type AssetReviewStatusFilter = "pending" | "approved" | "rejected" | "all";
type CaseReviewStatusFilter = "pending" | "approved" | "rejected" | "all";

function GlobalSwitchRow({
  type,
  title,
  desc,
  defaultEnabled,
  invalidateQueryKeys
}: {
  type: GlobalSwitchType;
  title: string;
  desc: string;
  defaultEnabled: boolean;
  invalidateQueryKeys?: string[];
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const switches = useQuery({ queryKey: ["config-global-switches"], queryFn: configApi.globalSwitches });
  const setting = switches.data?.switches.find((item) => item.type === type);
  const enabled = setting?.enabled ?? defaultEnabled;
  const save = useMutation({
    mutationFn: (nextEnabled: boolean) => configApi.saveGlobalSwitch(type, nextEnabled),
    onSuccess: (data) => {
      showToast(data.switch.enabled ? `${title}已开启` : `${title}已关闭`);
      queryClient.invalidateQueries({ queryKey: ["config-global-switches"] });
      for (const key of invalidateQueryKeys ?? []) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "开关保存失败", "error")
  });
  return (
    <div className="switch-row">
      <div className="switch-row-copy">
        <span>{title}</span>
        <small>{desc}</small>
      </div>
      <SwitchControl
        checked={enabled}
        disabled={switches.isLoading || save.isPending}
        label={enabled ? "已开启" : "已关闭"}
        onChange={(nextEnabled) => save.mutate(nextEnabled)}
      />
    </div>
  );
}

const assetReviewStatusOptions: Array<{ value: AssetReviewStatusFilter; label: string }> = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "未通过" },
  { value: "all", label: "全部" }
];

const caseReviewStatusOptions: Array<{ value: CaseReviewStatusFilter; label: string }> = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "未通过" },
  { value: "all", label: "全部" }
];

function assetReviewStatusLabel(status: ConfigAssetReviewItem["shareStatus"]) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已通过";
  if (status === "rejected") return "未通过";
  return "未申请";
}

function caseReviewStatusLabel(status: ConfigCaseReviewItem["reviewStatus"]) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已通过";
  if (status === "rejected") return "未通过";
  return "已通过";
}

function AssetReviewPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<AssetReviewStatusFilter>("pending");
  const [keyword, setKeyword] = useState("");
  const [approveTarget, setApproveTarget] = useState<ConfigAssetReviewItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ConfigAssetReviewItem | null>(null);
  const reviews = useQuery({
    queryKey: ["config-asset-reviews", status, keyword],
    queryFn: () => configApi.assetReviews({ status, keyword })
  });
  const approve = useMutation({
    mutationFn: (id: string) => configApi.approveAssetReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-asset-reviews"] });
      setApproveTarget(null);
      showToast("素材已通过审核");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => configApi.rejectAssetReview(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-asset-reviews"] });
      setRejectTarget(null);
      showToast("素材已拒绝共享");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const counts = reviews.data?.counts ?? { pending: 0, approved: 0, rejected: 0 };
  const statusCount = (value: AssetReviewStatusFilter) => {
    if (value === "pending") return counts.pending;
    if (value === "approved") return counts.approved;
    if (value === "rejected") return counts.rejected;
    return counts.pending + counts.approved + counts.rejected;
  };

  return (
    <section className="config-card">
      <ConfigHeader title="素材审核" desc="用户主动申请共享后才会出现在这里；审核通过后才进入共享素材区。" />
      <GlobalSwitchRow
        type="asset_review"
        title="素材审核"
        desc="关闭后，新提交共享的素材会直接公开；历史待审素材仍保留当前状态。"
        defaultEnabled
        invalidateQueryKeys={["config-asset-reviews"]}
      />
      <div className="asset-review-toolbar">
        <div className="provider-filter-tabs" role="tablist" aria-label="素材审核状态">
          {assetReviewStatusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              className={status === option.value ? "active" : ""}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
              <span>{statusCount(option.value)}</span>
            </button>
          ))}
        </div>
        <input
          className="asset-review-search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索素材、用户、账号或标签"
        />
      </div>
      <div className="table-wrap asset-review-table-wrap">
        <table>
          <thead>
            <tr>
              <th>素材</th>
              <th>提交用户</th>
              <th>标签</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>审核时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {reviews.data?.assets.map((asset) => (
              <tr key={asset.id}>
                <td>
                  <div className="asset-review-media">
                    <img src={asset.thumbnailUrl || asset.previewUrl || asset.url} alt={asset.name} />
                    <div>
                      <strong>{asset.name}</strong>
                      <span>
                        {asset.imageWidth > 0 && asset.imageHeight > 0 ? `${asset.imageWidth} x ${asset.imageHeight}` : "尺寸未知"}
                        {formatImageFileSize(asset.size) ? ` · ${formatImageFileSize(asset.size)}` : ""}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="asset-review-user">
                    <strong>{asset.sourceUsername}</strong>
                    <span>{asset.sourceAccount || "-"} · {asset.teamName}</span>
                  </div>
                </td>
                <td>{asset.categoryNames.length > 0 ? asset.categoryNames.join("、") : "-"}</td>
                <td>
                  <span className={cx("asset-review-status", asset.shareStatus)}>{assetReviewStatusLabel(asset.shareStatus)}</span>
                  {asset.shareStatus === "rejected" && asset.shareRejectReason ? <small>{asset.shareRejectReason}</small> : null}
                </td>
                <td>{formatDate(asset.shareRequestedAt || asset.createdAt)}</td>
                <td>{formatDate(asset.shareReviewedAt)}</td>
                <td className="row-actions compact-actions">
                  <a className="secondary-btn" href={asset.url} target="_blank" rel="noreferrer">预览</a>
                  {asset.shareStatus !== "approved" ? (
                    <button className="primary-btn" onClick={() => setApproveTarget(asset)}>
                      {asset.shareStatus === "rejected" ? "改为通过" : "通过"}
                    </button>
                  ) : null}
                  {asset.shareStatus !== "rejected" ? (
                    <button className="danger-btn" onClick={() => setRejectTarget(asset)}>
                      {asset.shareStatus === "approved" ? "改为未通过" : "拒绝"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {reviews.isLoading ? (
              <tr>
                <td colSpan={7}>素材审核加载中...</td>
              </tr>
            ) : null}
            {reviews.error ? (
              <tr>
                <td colSpan={7} className="form-error">{reviews.error.message}</td>
              </tr>
            ) : null}
            {!reviews.isLoading && !reviews.error && (reviews.data?.assets.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7}>暂无素材审核记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(approveTarget)}
        title={approveTarget?.shareStatus === "rejected" ? "改为通过素材共享" : "通过素材共享"}
        description={
          approveTarget
            ? approveTarget.shareStatus === "rejected"
              ? `确认将“${approveTarget.name}”改为已通过？通过后所有用户都能在共享素材中查看和使用。`
              : `确认通过“${approveTarget.name}”？通过后所有用户都能在共享素材中查看和使用。`
            : ""
        }
        confirmText={approve.isPending ? "处理中" : approveTarget?.shareStatus === "rejected" ? "改为通过" : "通过"}
        onCancel={() => setApproveTarget(null)}
        onConfirm={() => {
          if (approveTarget && !approve.isPending) approve.mutate(approveTarget.id);
        }}
      />
      <PromptDialog
        open={Boolean(rejectTarget)}
        title={rejectTarget?.shareStatus === "approved" ? "改为未通过素材" : "拒绝素材共享"}
        label="拒绝原因"
        confirmText={reject.isPending ? "处理中" : rejectTarget?.shareStatus === "approved" ? "改为未通过" : "拒绝"}
        onCancel={() => setRejectTarget(null)}
        onSubmit={(reason) => {
          if (rejectTarget && !reject.isPending) reject.mutate({ id: rejectTarget.id, reason: reason.trim() });
        }}
      />
    </section>
  );
}

function CaseReviewPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<CaseReviewStatusFilter>("pending");
  const [keyword, setKeyword] = useState("");
  const [approveTarget, setApproveTarget] = useState<ConfigCaseReviewItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ConfigCaseReviewItem | null>(null);
  const reviews = useQuery({
    queryKey: ["config-case-reviews", status, keyword],
    queryFn: () => configApi.caseReviews({ status, keyword })
  });
  const approve = useMutation({
    mutationFn: (id: string) => configApi.approveCaseReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-case-reviews"] });
      setApproveTarget(null);
      showToast("灵感已通过审核");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => configApi.rejectCaseReview(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-case-reviews"] });
      setRejectTarget(null);
      showToast("灵感已拒绝公开");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "审核失败", "error")
  });
  const counts = reviews.data?.counts ?? { pending: 0, approved: 0, rejected: 0 };
  const statusCount = (value: CaseReviewStatusFilter) => {
    if (value === "pending") return counts.pending;
    if (value === "approved") return counts.approved;
    if (value === "rejected") return counts.rejected;
    return counts.pending + counts.approved + counts.rejected;
  };

  return (
    <section className="config-card">
      <ConfigHeader title="灵感审核" desc="用户加入灵感空间后先进入审核；通过后才进入公共灵感空间。" />
      <GlobalSwitchRow
        type="case_review"
        title="灵感审核"
        desc="关闭后，新加入灵感会直接公开；历史待审灵感仍保留当前状态。"
        defaultEnabled
        invalidateQueryKeys={["config-case-reviews"]}
      />
      <div className="asset-review-toolbar">
        <div className="provider-filter-tabs" role="tablist" aria-label="灵感审核状态">
          {caseReviewStatusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              className={status === option.value ? "active" : ""}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
              <span>{statusCount(option.value)}</span>
            </button>
          ))}
        </div>
        <input
          className="asset-review-search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索灵感、提示词、用户、账号或风格"
        />
      </div>
      <div className="table-wrap asset-review-table-wrap">
        <table>
          <thead>
            <tr>
              <th>灵感</th>
              <th>提交用户</th>
              <th>风格</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>审核时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {reviews.data?.cases.map((item) => (
              <tr key={item.groupId || item.id}>
                <td>
                  <div className="asset-review-media">
                    <img src={item.thumbnailUrl || item.previewUrl || item.url} alt={item.title} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {item.imageWidth > 0 && item.imageHeight > 0 ? `${item.imageWidth} x ${item.imageHeight}` : "尺寸未知"}
                        {formatImageFileSize(item.imageFileSize) ? ` · ${formatImageFileSize(item.imageFileSize)}` : ""}
                      </span>
                      <small>{item.prompt}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="asset-review-user">
                    <strong>{item.sourceUsername}</strong>
                    <span>{item.sourceAccount || "-"} · {item.teamName}</span>
                  </div>
                </td>
                <td>{item.categoryNames.length > 0 ? item.categoryNames.join("、") : "-"}</td>
                <td>
                  <span className={cx("asset-review-status", item.reviewStatus)}>{caseReviewStatusLabel(item.reviewStatus)}</span>
                  {item.reviewStatus === "rejected" && item.rejectReason ? <small>{item.rejectReason}</small> : null}
                </td>
                <td>{formatDate(item.reviewRequestedAt || item.createdAt)}</td>
                <td>{formatDate(item.reviewedAt)}</td>
                <td className="row-actions compact-actions">
                  <a className="secondary-btn" href={item.url} target="_blank" rel="noreferrer">预览</a>
                  {item.reviewStatus !== "approved" ? (
                    <button className="primary-btn" onClick={() => setApproveTarget(item)}>
                      {item.reviewStatus === "rejected" ? "改为通过" : "通过"}
                    </button>
                  ) : null}
                  {item.reviewStatus !== "rejected" ? (
                    <button className="danger-btn" onClick={() => setRejectTarget(item)}>
                      {item.reviewStatus === "approved" ? "改为未通过" : "拒绝"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {reviews.isLoading ? (
              <tr>
                <td colSpan={7}>灵感审核加载中...</td>
              </tr>
            ) : null}
            {reviews.error ? (
              <tr>
                <td colSpan={7} className="form-error">{reviews.error.message}</td>
              </tr>
            ) : null}
            {!reviews.isLoading && !reviews.error && (reviews.data?.cases.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7}>暂无灵感审核记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(approveTarget)}
        title={approveTarget?.reviewStatus === "rejected" ? "改为通过灵感" : "通过灵感公开"}
        description={
          approveTarget
            ? approveTarget.reviewStatus === "rejected"
              ? `确认将“${approveTarget.title}”改为已通过？通过后所有用户都能在灵感空间中查看和使用。`
              : `确认通过“${approveTarget.title}”？通过后所有用户都能在灵感空间中查看和使用。`
            : ""
        }
        confirmText={approve.isPending ? "处理中" : approveTarget?.reviewStatus === "rejected" ? "改为通过" : "通过"}
        onCancel={() => setApproveTarget(null)}
        onConfirm={() => {
          if (approveTarget && !approve.isPending) approve.mutate(approveTarget.groupId || approveTarget.id);
        }}
      />
      <PromptDialog
        open={Boolean(rejectTarget)}
        title={rejectTarget?.reviewStatus === "approved" ? "改为未通过灵感" : "拒绝灵感公开"}
        label="拒绝原因"
        confirmText={reject.isPending ? "处理中" : rejectTarget?.reviewStatus === "approved" ? "改为未通过" : "拒绝"}
        onCancel={() => setRejectTarget(null)}
        onSubmit={(reason) => {
          if (rejectTarget && !reject.isPending) reject.mutate({ id: rejectTarget.groupId || rejectTarget.id, reason: reason.trim() });
        }}
      />
    </section>
  );
}

function UserTable({
  users,
  onEdit,
  onToggle,
  onConfigAccessToggle,
  onReset,
  onDelete
}: {
  users: ConfigUser[];
  onEdit: (user: ConfigUser) => void;
  onToggle: (user: ConfigUser) => void;
  onConfigAccessToggle: (user: ConfigUser) => void;
  onReset: (user: ConfigUser) => void;
  onDelete: (user: ConfigUser) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户名</th>
            <th>账号</th>
            <th>邮箱</th>
            <th>手机号</th>
            <th>团队</th>
            <th>状态</th>
            <th>管理权限</th>
            <th>对话</th>
            <th>图片</th>
            <th>最近登录</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.account}</td>
              <td>{user.email || "-"}</td>
              <td>{user.phone || "-"}</td>
              <td>{user.teamName}</td>
              <td>
                <SwitchControl
                  checked={!user.disabled}
                  label={user.disabled ? "禁用" : "启用"}
                  onChange={() => onToggle(user)}
                />
              </td>
              <td>
                <SwitchControl
                  checked={user.hasConfigAccess}
                  label={user.hasConfigAccess ? "有" : "无"}
                  onChange={() => onConfigAccessToggle(user)}
                />
              </td>
              <td>{user.sessionCount}</td>
              <td>{user.imageCount}</td>
              <td>{formatDate(user.lastLoginAt)}</td>
              <td>{formatDate(user.createdAt)}</td>
              <td className="row-actions compact-actions">
                <button className="secondary-btn" onClick={() => onEdit(user)}>编辑</button>
                <button className="secondary-btn" onClick={() => onReset(user)}>重置密码</button>
                <button className="danger-btn" onClick={() => onDelete(user)}>删除</button>
              </td>
            </tr>
          ))}
          {users.length === 0 ? (
            <tr>
              <td colSpan={12}>暂无账号</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TeamDialog({
  mode,
  team,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  team?: Team;
  onClose: () => void;
  onSubmit: (payload: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");

  return (
    <div className="modal-backdrop">
      <section className="case-modal compact-modal">
        <header>
          <h3>{mode === "create" ? "新增团队" : "编辑团队"}</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <label>
          团队名称
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label>
          团队说明
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="row-actions">
          <button className="secondary-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={() => onSubmit({ name, description })} disabled={!name.trim()}>
            保存
          </button>
        </div>
      </section>
    </div>
  );
}

function UserDialog({
  mode,
  user,
  teams,
  defaultTeamId,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  user?: ConfigUser;
  teams: Team[];
  defaultTeamId?: string;
  onClose: () => void;
  onSubmit: (payload: ConfigUserPayload) => void;
}) {
  const [account, setAccount] = useState(user?.account ?? "");
  const [username, setUsername] = useState(user?.username ?? user?.account ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [password, setPassword] = useState("");
  const [teamId, setTeamId] = useState(user?.teamId ?? defaultTeamId ?? teams[0]?.id ?? "");
  const [disabled, setDisabled] = useState(user?.disabled ?? false);
  const [hasConfigAccess, setHasConfigAccess] = useState(user?.hasConfigAccess ?? false);

  return (
    <div className="modal-backdrop">
      <section className="case-modal compact-modal">
        <header>
          <h3>{mode === "create" ? "新增账号" : "编辑账号"}</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <label>
          账号
          <input value={account} onChange={(event) => setAccount(event.target.value)} autoFocus />
        </label>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="可选，用于邮箱登录和找回密码" />
        </label>
        <label>
          手机号
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="可选，手机号登录预留" />
        </label>
        {mode === "create" ? (
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        ) : null}
        <label>
          团队
          <CustomSelect
            value={teamId}
            onChange={setTeamId}
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            placeholder="选择团队"
          />
        </label>
        <div className="switch-row">
          <span>账号状态</span>
          <SwitchControl
            checked={!disabled}
            label={disabled ? "禁用" : "启用"}
            onChange={(checked) => setDisabled(!checked)}
          />
        </div>
        <div className="switch-row">
          <span>管理权限</span>
          <SwitchControl
            checked={hasConfigAccess}
            label={hasConfigAccess ? "有" : "无"}
            onChange={setHasConfigAccess}
          />
        </div>
        <div className="row-actions">
          <button className="secondary-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-btn"
            disabled={!account.trim() || !teamId || (mode === "create" && !password)}
            onClick={() => onSubmit({ account, username, email, phone, password, teamId, disabled, hasConfigAccess })}
          >
            保存
          </button>
        </div>
      </section>
    </div>
  );
}

const accountStatusLabels: Record<ImageAccount["status"], string> = {
  normal: "可用",
  limited: "限流",
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
    authJson: account.authJson,
    authInfoJson: account.authInfoJson,
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
  const dynamicWindows = Array.isArray(account.codexUsageWindows)
    ? account.codexUsageWindows.filter((window) => {
        return window && typeof window === "object" && typeof window.label === "string" && window.label.trim();
      })
    : [];
  const usageWindows =
    dynamicWindows.length > 0
      ? dynamicWindows
      : [
          { label: "5 小时限额", usedPercent: account.codex5hUsedPercent, resetAt: account.codex5hResetAt },
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
                { value: "limited", label: "限流" },
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
              onChange={(event) => setForm({ ...form, authJson: event.target.value })}
              placeholder="可粘贴完整授权 JSON，系统会尽量提取邮箱、类型和令牌"
            />
          </label>
          <label className="wide">
            认证信息 JSON
            <textarea
              rows={4}
              value={form.authInfoJson ?? ""}
              onChange={(event) => setForm({ ...form, authInfoJson: event.target.value })}
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

function ImageAccountPoolPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const didAutoRefreshUsage = useRef(false);
  const accounts = useQuery({ queryKey: ["config-image-accounts"], queryFn: configApi.imageAccounts });
  const providers = useQuery({ queryKey: ["config-providers"], queryFn: configApi.providers });
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; account?: ImageAccount } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ImageAccount | null>(null);
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
      <ConfigHeader title="账号管理" desc="维护图片账号号池、额度、优先级和同步状态。" />
      <div className="stat-strip">
        <span>账号 {accounts.data?.summary.total ?? 0}</span>
        <span>可用 {accounts.data?.summary.available ?? 0}</span>
      </div>
      <div className="account-list-actions">
        <button className="secondary-btn" onClick={() => refreshUsage.mutate(undefined)} disabled={refreshUsage.isPending}>
          <RefreshCw className={refreshUsage.isPending ? "spin-icon" : undefined} size={16} />
          全部刷新额度
        </button>
        <button className="primary-btn" onClick={() => setDialog({ mode: "create" })}>
          <Plus size={16} />
          新增账号
        </button>
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
                      onClick={() => setDialog({ mode: "edit", account })}
                      aria-label="编辑账号"
                      title="编辑账号"
                    >
                      <Pencil size={15} />
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

const channelLabels: Record<ProviderConfig["channel"], string> = {
  cpa: "CPA 额度代理",
  chatgpt_web: "ChatGPT 官网",
  api: "API 直连"
};

const routeModeLabels: Record<ProviderConfig["routeMode"], string> = {
  images_api: "图片接口直连",
  responses: "Responses 接口",
  auto: "失败自动切换"
};

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

function ImageModePanel() {
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

  const selectedCount =
    mode === "cpa"
      ? counts.cpa
      : mode === "chatgpt_web"
        ? counts.chatgptWeb
        : mode === "api"
          ? counts.api
          : counts.total;

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
      <div className="mode-current">
        <span>当前选择</span>
        <strong>{imageModeLabels[mode]}</strong>
        <small>
          {selectedCount > 0
            ? `当前模式有 ${selectedCount} 条启用渠道。`
            : "当前模式下没有启用渠道，请先补充或启用对应渠道。"}
        </small>
      </div>
      <div className="mode-request-policy">
        <div>
          <strong>请求策略</strong>
          <small>图片接口调用或图片结果保存出现错误时自动重试。默认值为 1；留空表示不自动重试。</small>
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
          保存请求策略
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

function providerWithChannelDefaults(
  provider: ProviderConfig,
  channel: ProviderConfig["channel"],
  options: { preserveIdentity?: boolean; existingIds?: string[] } = {}
): ProviderConfig {
  const generatedId = options.preserveIdentity
    ? provider.id
    : isGeneratedProviderId(provider.id)
      ? uniqueProviderFormId(channel, options.existingIds, providerDateFromId(provider.id))
      : provider.id;
  const common = {
    ...provider,
    id: generatedId,
    name: !options.preserveIdentity && isGeneratedProviderName(provider.name) ? generatedId : provider.name,
    channel
  };
  if (channel === "chatgpt_web") {
    return {
      ...common,
      type: "chatgpt-web",
      baseUrl: "https://chatgpt.com/backend-api",
      apiKeyEnv: "",
      routeMode: "images_api",
      generationPath: "/f/conversation",
      editPath: "/f/conversation",
      responsesPath: "/codex/responses",
      model: "gpt-image-2",
      quotaMode: provider.quotaMode || "codex_first",
      webAccountMode: provider.webAccountMode || "priority",
      proxyEnabled: true
    };
  }
  if (channel === "cpa") {
    return {
      ...common,
      type: "openai-compatible",
      baseUrl: "http://127.0.0.1:8317",
      apiKeyEnv: "GPT_IMAGE_API_KEY",
      routeMode: "images_api",
      generationPath: "/v1/images/generations",
      editPath: "/v1/images/edits",
      responsesPath: "/v1/responses",
      proxyEnabled: false
    };
  }
  return {
    ...common,
    type: "openai-compatible",
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    routeMode: "images_api",
    generationPath: "/v1/images/generations",
    editPath: "/v1/images/edits",
    responsesPath: "/v1/responses",
    proxyEnabled: false
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

function SwitchControl({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={checked ? "switch-control checked" : "switch-control"}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
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

function ProvidersPanel() {
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

function emptySmtpSettings(defaultFromName = DEFAULT_SITE_NAME): SmtpSettings {
  return {
    enabled: false,
    useProxy: false,
    host: "",
    port: 465,
    secure: true,
    username: "",
    passwordSecret: "",
    fromName: defaultFromName,
    fromEmail: "",
    testRecipientEmail: "",
    updatedAt: ""
  };
}

function normalizeSmtpSettings(form: SmtpSettings, defaultFromName = DEFAULT_SITE_NAME): SmtpSettings {
  const port = Number(form.port);
  return {
    ...form,
    host: form.host.trim(),
    port: Number.isFinite(port) ? Math.max(1, Math.min(65535, Math.trunc(port))) : 465,
    username: form.username.trim(),
    passwordSecret: form.passwordSecret,
    fromName: form.fromName.trim() || defaultFromName,
    fromEmail: form.fromEmail.trim().toLowerCase(),
    testRecipientEmail: form.testRecipientEmail.trim().toLowerCase()
  };
}

function SmtpSettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-smtp-settings"], queryFn: configApi.smtpSettings });
  const branding = useQuery({ queryKey: ["branding"], queryFn: api.branding });
  const defaultFromName = branding.data?.siteName?.trim() || DEFAULT_SITE_NAME;
  const [form, setForm] = useState<SmtpSettings>(() => emptySmtpSettings(defaultFromName));
  const save = useMutation({
    mutationFn: () => configApi.saveSmtpSettings(normalizeSmtpSettings(form, defaultFromName)),
    onSuccess: (data) => {
      setForm(data.settings);
      showToast("邮件配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-smtp-settings"] });
    }
  });
  const test = useMutation({
    mutationFn: () => configApi.testSmtpSettings(form.testRecipientEmail.trim() || form.fromEmail.trim()),
    onSuccess: () => showToast("测试邮件已发送")
  });

  useEffect(() => {
    if (!query.data?.settings) return;
    const settings = query.data.settings;
    setForm({
      ...settings,
      fromName: !settings.updatedAt && settings.fromName === DEFAULT_SITE_NAME ? defaultFromName : settings.fromName
    });
  }, [defaultFromName, query.data?.settings]);

  const patch = (value: Partial<SmtpSettings>) => setForm((current) => ({ ...current, ...value }));

  return (
    <section className="config-card smtp-settings-card">
      <ConfigHeader title="邮件配置" desc="用于 C 端邮箱注册验证码和找回密码验证码发送。" />
      {query.isLoading ? <div className="settings-empty">邮件配置加载中...</div> : null}
      <div className="provider-form smtp-form">
        <div className="switch-row smtp-switch-row">
          <span>启用邮件服务</span>
          <SwitchControl
            checked={form.enabled}
            label={form.enabled ? "已启用" : "已关闭"}
            onChange={(enabled) => patch({ enabled })}
          />
        </div>
        <div className="switch-row smtp-switch-row">
          <div className="switch-row-copy">
            <span>使用代理发送邮件</span>
            <small>开启后使用“代理配置”中已启用的代理地址，适合 Gmail SMTP。</small>
          </div>
          <SwitchControl
            checked={form.useProxy}
            label={form.useProxy ? "使用代理" : "不使用"}
            onChange={(useProxy) => patch({ useProxy })}
          />
        </div>
        <label>
          SMTP 服务器
          <input value={form.host} onChange={(event) => patch({ host: event.target.value })} placeholder="smtp.example.com" />
        </label>
        <label>
          端口
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(event) => patch({ port: Number(event.target.value) })}
          />
        </label>
        <div className="switch-row">
          <span>SSL/TLS</span>
          <SwitchControl
            checked={form.secure}
            label={form.secure ? "开启" : "关闭"}
            onChange={(secure) => patch({ secure })}
          />
        </div>
        <label>
          SMTP 账号
          <input value={form.username} onChange={(event) => patch({ username: event.target.value })} placeholder="通常为邮箱账号" />
        </label>
        <label>
          密码/授权码
          <input
            type="password"
            value={form.passwordSecret}
            onChange={(event) => patch({ passwordSecret: event.target.value })}
            placeholder="保存后会自动隐藏"
          />
        </label>
        <label>
          发件人名称
          <input value={form.fromName} onChange={(event) => patch({ fromName: event.target.value })} />
        </label>
        <label>
          发件邮箱
          <input value={form.fromEmail} onChange={(event) => patch({ fromEmail: event.target.value })} placeholder="noreply@example.com" />
        </label>
        <label>
          测试收件邮箱
          <input
            value={form.testRecipientEmail}
            onChange={(event) => patch({ testRecipientEmail: event.target.value })}
            placeholder="用于测试 SMTP 是否可用，留空则发送到发件邮箱"
          />
        </label>
        <div className="row-actions">
          <button className="primary-btn" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={16} />
            {save.isPending ? "保存中" : "保存配置"}
          </button>
          <button className="secondary-btn" type="button" onClick={() => test.mutate()} disabled={test.isPending}>
            <Mail size={16} />
            {test.isPending ? "发送中" : "发送测试邮件"}
          </button>
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {test.error ? <div className="form-error">{test.error.message}</div> : null}
      </div>
    </section>
  );
}

function emptySmsSettings(): SmsSettings {
  return {
    enabled: false,
    provider: "tencent",
    secretId: "",
    secretKeySecret: "",
    region: "ap-guangzhou",
    smsSdkAppId: "",
    signName: "",
    registerTemplateId: "",
    passwordResetTemplateId: "",
    templateParamOrder: "code",
    testPhone: "",
    updatedAt: ""
  };
}

function normalizeSmsPhone(value: string) {
  let phone = value.replace(/[\s-]/g, "").trim();
  if (phone.startsWith("+86")) phone = phone.slice(3);
  if (phone.startsWith("0086")) phone = phone.slice(4);
  if (phone.startsWith("86") && phone.length === 13) phone = phone.slice(2);
  return phone;
}

function normalizeSmsSettings(form: SmsSettings): SmsSettings {
  return {
    ...form,
    provider: "tencent",
    secretId: form.secretId.trim(),
    secretKeySecret: form.secretKeySecret,
    region: form.region.trim() || "ap-guangzhou",
    smsSdkAppId: form.smsSdkAppId.trim(),
    signName: form.signName.trim(),
    registerTemplateId: form.registerTemplateId.trim(),
    passwordResetTemplateId: form.passwordResetTemplateId.trim(),
    templateParamOrder: form.templateParamOrder
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .join(",") || "code",
    testPhone: normalizeSmsPhone(form.testPhone)
  };
}

function SmsSettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-sms-settings"], queryFn: configApi.smsSettings });
  const [form, setForm] = useState<SmsSettings>(emptySmsSettings());
  const save = useMutation({
    mutationFn: () => configApi.saveSmsSettings(normalizeSmsSettings(form)),
    onSuccess: (data) => {
      setForm(data.settings);
      showToast("短信配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-sms-settings"] });
    }
  });
  const test = useMutation({
    mutationFn: () => configApi.testSmsSettings(normalizeSmsPhone(form.testPhone)),
    onSuccess: () => showToast("测试短信已发送")
  });

  useEffect(() => {
    if (!query.data?.settings) return;
    setForm(query.data.settings);
  }, [query.data?.settings]);

  const patch = (value: Partial<SmsSettings>) => setForm((current) => ({ ...current, ...value }));

  return (
    <section className="config-card smtp-settings-card">
      <ConfigHeader title="短信配置" desc="用于 C 端手机号注册验证码和手机号找回密码验证码发送，当前支持腾讯云短信。" />
      {query.isLoading ? <div className="settings-empty">短信配置加载中...</div> : null}
      <div className="provider-form smtp-form">
        <div className="switch-row smtp-switch-row">
          <span>启用短信服务</span>
          <SwitchControl
            checked={form.enabled}
            label={form.enabled ? "已启用" : "已关闭"}
            onChange={(enabled) => patch({ enabled })}
          />
        </div>
        <label>
          短信供应商
          <input value="腾讯云短信" disabled />
        </label>
        <label>
          SecretId
          <input value={form.secretId} onChange={(event) => patch({ secretId: event.target.value })} placeholder="腾讯云访问密钥 SecretId" />
        </label>
        <label>
          SecretKey
          <input
            type="password"
            value={form.secretKeySecret}
            onChange={(event) => patch({ secretKeySecret: event.target.value })}
            placeholder="保存后会自动隐藏"
          />
        </label>
        <label>
          地域
          <input value={form.region} onChange={(event) => patch({ region: event.target.value })} placeholder="ap-guangzhou" />
        </label>
        <label>
          短信应用 ID
          <input value={form.smsSdkAppId} onChange={(event) => patch({ smsSdkAppId: event.target.value })} placeholder="SmsSdkAppId" />
        </label>
        <label>
          短信签名
          <input value={form.signName} onChange={(event) => patch({ signName: event.target.value })} placeholder="审核通过的签名名称，不带【】" />
        </label>
        <label>
          注册验证码模板 ID
          <input value={form.registerTemplateId} onChange={(event) => patch({ registerTemplateId: event.target.value })} placeholder="TemplateId" />
        </label>
        <label>
          找回密码模板 ID
          <input value={form.passwordResetTemplateId} onChange={(event) => patch({ passwordResetTemplateId: event.target.value })} placeholder="留空则复用注册模板" />
        </label>
        <label>
          模板变量顺序
          <input value={form.templateParamOrder} onChange={(event) => patch({ templateParamOrder: event.target.value })} placeholder="code 或 code,minutes" />
          <small>按短信模板变量顺序填写。`code` 表示验证码，`minutes` 表示 10 分钟。</small>
        </label>
        <label>
          测试手机号
          <input value={form.testPhone} onChange={(event) => patch({ testPhone: event.target.value })} placeholder="中国大陆 11 位手机号" />
        </label>
        <div className="row-actions">
          <button className="primary-btn" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={16} />
            {save.isPending ? "保存中" : "保存配置"}
          </button>
          <button className="secondary-btn" type="button" onClick={() => test.mutate()} disabled={test.isPending || !form.testPhone.trim()}>
            <Smartphone size={16} />
            {test.isPending ? "发送中" : "发送测试短信"}
          </button>
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {test.error ? <div className="form-error">{test.error.message}</div> : null}
      </div>
    </section>
  );
}

function emptyStarterCopySettings(): StarterCopySettings {
  return {
    enabled: true,
    copyCount: 20,
    updatedAt: ""
  };
}

function normalizeStarterCopyCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 20;
  return Math.max(0, Math.min(100, Math.trunc(count)));
}

function normalizeStarterCopySettings(settings?: StarterCopySettings | null): StarterCopySettings {
  const fallback = emptyStarterCopySettings();
  return {
    ...fallback,
    ...settings,
    enabled: Boolean(settings?.enabled ?? fallback.enabled),
    copyCount: normalizeStarterCopyCount(settings?.copyCount ?? fallback.copyCount)
  };
}

function sourceLabel(source: string) {
  if (source === "ai") return "AI 生成";
  if (source === "fallback") return "本地兜底";
  return source || "-";
}

function StarterCopyPreview({ copy }: { copy: StarterDailyCopy | null | undefined }) {
  if (!copy) return <p className="muted">今日暂未生成文案。</p>;
  return (
    <div className="starter-copy-preview">
      <div className="starter-copy-status-line">
        <span>日期：{copy.date || "-"}</span>
        <span>来源：{sourceLabel(copy.source)}</span>
        <span>状态：{copy.status || (copy.copies.length > 0 ? "success" : "-")}</span>
        {copy.generatedAt ? <span>生成：{formatDate(copy.generatedAt)}</span> : null}
      </div>
      {copy.error ? <div className="form-error">{copy.error}</div> : null}
      {copy.copies.length > 0 ? (
        <div className="starter-copy-chip-list">
          {copy.copies.map((item, index) => (
            <span key={`${index}-${item}`}>{index + 1}. {item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StarterCopySettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-starter-copy-settings"], queryFn: configApi.starterCopySettings });
  const [form, setForm] = useState<StarterCopySettings>(emptyStarterCopySettings());
  const save = useMutation({
    mutationFn: () => configApi.saveStarterCopySettings(normalizeStarterCopySettings(form)),
    onSuccess: (data) => {
      if (data.settings) setForm(normalizeStarterCopySettings(data.settings));
      showToast("每日文案配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-starter-copy-settings"] });
    }
  });
  const regenerate = useMutation({
    mutationFn: configApi.regenerateStarterCopies,
    onSuccess: () => {
      showToast("今日文案已更新");
      queryClient.invalidateQueries({ queryKey: ["config-starter-copy-settings"] });
    },
    onError: (error) => {
      showToast(error.message || "每日文案更新失败", "error");
      queryClient.invalidateQueries({ queryKey: ["config-starter-copy-settings"] });
    }
  });

  useEffect(() => {
    if (query.data?.settings) setForm(normalizeStarterCopySettings(query.data.settings));
  }, [query.data?.settings]);

  const patch = (patchValue: Partial<StarterCopySettings>) => setForm((value) => ({ ...value, ...patchValue }));
  return (
    <section className="config-card starter-copy-settings-card">
      <ConfigHeader title="空白页每日文案" desc="开启后每天凌晨由启用的语言模型生成生图相关互动文案；关闭或失败时继续使用本地固定文案。" />
      <div className="provider-form starter-copy-form">
        <div className="switch-row starter-copy-switch-row">
          <span>AI 每日文案</span>
          <SwitchControl checked={form.enabled} label={form.enabled ? "启用" : "停用"} onChange={(enabled) => patch({ enabled })} />
        </div>
        <label>
          生成数量
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={form.copyCount}
            onChange={(event) => patch({ copyCount: normalizeStarterCopyCount(event.target.value) })}
          />
        </label>
        <div className="prompt-optimizer-protocol">
          <Bot size={17} />
          <span>可设置 0-100 条，默认生成 20 条；文案覆盖海报、商品图、UI 设计、销售物料、人事招聘、业务展业、汇报封面、日常社交、生日祝福、旅行宠物、美食家居和 Logo 等创作方向。</span>
        </div>
        <div className="row-actions">
          <button className="primary-btn" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={16} />
            保存配置
          </button>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => regenerate.mutate()}
            disabled={!form.enabled || save.isPending || regenerate.isPending}
            aria-busy={regenerate.isPending}
          >
            <RefreshCw className={regenerate.isPending ? "spin-icon" : undefined} size={16} />
            立即更新文案
          </button>
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {regenerate.error ? <div className="form-error">{regenerate.error.message}</div> : null}
      </div>
      <StarterCopyPreview copy={query.data?.today} />
    </section>
  );
}

function emptyBrandingSettings(): BrandingSettings {
  return {
    siteName: DEFAULT_SITE_NAME,
    activeLogoAssetId: "",
    activeFaviconAssetId: "",
    activeLoginTitleLightAssetId: "",
    activeLoginTitleDarkAssetId: "",
    loginBackgroundLightAssetIds: [],
    loginBackgroundDarkAssetIds: [],
    updatedAt: ""
  };
}

function normalizeBrandingSettings(settings?: BrandingSettings | null): BrandingSettings {
  const fallback = emptyBrandingSettings();
  return {
    ...fallback,
    ...settings,
    siteName: settings?.siteName?.trim() || DEFAULT_SITE_NAME,
    loginBackgroundLightAssetIds: Array.isArray(settings?.loginBackgroundLightAssetIds)
      ? settings.loginBackgroundLightAssetIds.filter(Boolean)
      : [],
    loginBackgroundDarkAssetIds: Array.isArray(settings?.loginBackgroundDarkAssetIds)
      ? settings.loginBackgroundDarkAssetIds.filter(Boolean)
      : []
  };
}

function brandingAssetsFor(assets: BrandingAsset[], type: BrandingAssetType) {
  return assets
    .filter((asset) => asset.type === type)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

function brandingAssetById(assets: BrandingAsset[], id: string) {
  return assets.find((asset) => asset.id === id) ?? null;
}

function uniqueBrandingAssetsByUrl(assets: BrandingAsset[], activeId?: string) {
  const unique: BrandingAsset[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    const key = asset.url || asset.id;
    const existingIndex = unique.findIndex((item) => (item.url || item.id) === key);
    if (existingIndex >= 0) {
      if (asset.id === activeId) unique[existingIndex] = asset;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(asset);
  }
  return unique;
}

function moveBrandingId(ids: string[], id: string, direction: -1 | 1) {
  const index = ids.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

function brandingMeta(asset: BrandingAsset) {
  const size = formatImageFileSize(asset.size);
  const dimensions = asset.imageWidth > 0 && asset.imageHeight > 0 ? `${asset.imageWidth} x ${asset.imageHeight}` : "";
  return [dimensions, size].filter(Boolean).join(" · ") || (asset.source === "builtin" ? "系统默认资源" : "自定义资源");
}

function BrandingUploadButton({
  type,
  label,
  disabled,
  onUpload
}: {
  type: BrandingAssetType;
  label: string;
  disabled?: boolean;
  onUpload: (type: BrandingAssetType, file: File) => void;
}) {
  return (
    <label className={cx("upload-btn", "branding-upload-button", disabled && "disabled")}>
      <Upload size={16} />
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        disabled={disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0] ?? null;
          input.value = "";
          if (file) onUpload(type, file);
        }}
      />
    </label>
  );
}

function BrandingAssetCard({
  asset,
  selected,
  order,
  actions,
  onRename,
  onDelete
}: {
  asset: BrandingAsset;
  selected?: boolean;
  order?: number;
  actions: ReactNode;
  onRename: (asset: BrandingAsset) => void;
  onDelete: (asset: BrandingAsset) => void;
}) {
  return (
    <article className={cx("branding-asset-card", selected && "selected")}>
      <div className="branding-asset-preview">
        {asset.url ? <img src={asset.url} alt={asset.name} /> : <ImageIcon size={28} />}
        {selected ? <span className="branding-selected-badge">{order ? `第 ${order} 张` : "当前使用"}</span> : null}
      </div>
      <div className="branding-asset-body">
        <div className="branding-asset-title">
          <strong>{asset.name}</strong>
          <span>{asset.source === "builtin" ? "系统默认" : "自定义"}</span>
        </div>
        <small>{brandingMeta(asset)}</small>
      </div>
      <div className="branding-asset-actions">
        {actions}
        <button className="icon-btn" type="button" aria-label="重命名资源" onClick={() => onRename(asset)}>
          <Pencil size={15} />
        </button>
        <button
          className="icon-btn danger-icon"
          type="button"
          aria-label="删除资源"
          disabled={asset.source === "builtin"}
          onClick={() => onDelete(asset)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

function BrandingSettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-branding"], queryFn: configApi.branding });
  const [form, setForm] = useState<BrandingSettings>(emptyBrandingSettings());
  const [renameTarget, setRenameTarget] = useState<BrandingAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandingAsset | null>(null);
  const assets = query.data?.assets ?? [];

  const refreshBrandingQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["config-branding"] });
    queryClient.invalidateQueries({ queryKey: ["branding"] });
  };

  const save = useMutation({
    mutationFn: () => configApi.saveBranding(normalizeBrandingSettings(form)),
    onSuccess: (data) => {
      setForm(normalizeBrandingSettings(data.settings));
      showToast("品牌设置已保存");
      refreshBrandingQueries();
    }
  });
  const reset = useMutation({
    mutationFn: configApi.resetBranding,
    onSuccess: (data) => {
      setForm(normalizeBrandingSettings(data.settings));
      showToast("已恢复系统默认品牌");
      refreshBrandingQueries();
    }
  });
  const upload = useMutation({
    mutationFn: ({ type, file }: { type: BrandingAssetType; file: File }) => {
      const formData = new FormData();
      formData.set("type", type);
      formData.set("file", file);
      return configApi.uploadBrandingAsset(formData);
    },
    onSuccess: (data) => {
      setForm(normalizeBrandingSettings(data.settings));
      showToast("品牌图片已上传");
      refreshBrandingQueries();
    }
  });
  const updateAsset = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<BrandingAsset, "name" | "enabled" | "sortOrder">> }) =>
      configApi.updateBrandingAsset(id, patch),
    onSuccess: (data) => {
      setForm(normalizeBrandingSettings(data.settings));
      setRenameTarget(null);
      showToast("品牌资源已更新");
      refreshBrandingQueries();
    }
  });
  const deleteAsset = useMutation({
    mutationFn: (id: string) => configApi.deleteBrandingAsset(id),
    onSuccess: (data) => {
      setForm(normalizeBrandingSettings(data.settings));
      setDeleteTarget(null);
      showToast("品牌资源已删除");
      refreshBrandingQueries();
    }
  });

  useEffect(() => {
    if (query.data?.settings) setForm(normalizeBrandingSettings(query.data.settings));
  }, [query.data?.settings]);

  const patch = (value: Partial<BrandingSettings>) => setForm((current) => ({ ...current, ...value }));
  const uploadDisabled = upload.isPending || save.isPending || reset.isPending;
  const activeLogo = brandingAssetById(assets, form.activeLogoAssetId);
  const activeFavicon = brandingAssetById(assets, form.activeFaviconAssetId);
  const lightTitle = brandingAssetById(assets, form.activeLoginTitleLightAssetId);
  const darkTitle = brandingAssetById(assets, form.activeLoginTitleDarkAssetId);
  const firstLightBackground = form.loginBackgroundLightAssetIds.map((id) => brandingAssetById(assets, id)).find(Boolean);
  const firstDarkBackground = form.loginBackgroundDarkAssetIds.map((id) => brandingAssetById(assets, id)).find(Boolean);

  function handleUpload(type: BrandingAssetType, file: File) {
    upload.mutate({ type, file });
  }

  function toggleBackground(type: "light" | "dark", assetId: string) {
    const key = type === "light" ? "loginBackgroundLightAssetIds" : "loginBackgroundDarkAssetIds";
    const current = form[key];
    const selected = current.includes(assetId);
    if (selected && current.length <= 1) {
      showToast("至少保留一张登录背景", "error");
      return;
    }
    patch({ [key]: selected ? current.filter((id) => id !== assetId) : [...current, assetId] } as Partial<BrandingSettings>);
  }

  function moveBackground(type: "light" | "dark", assetId: string, direction: -1 | 1) {
    const key = type === "light" ? "loginBackgroundLightAssetIds" : "loginBackgroundDarkAssetIds";
    patch({ [key]: moveBrandingId(form[key], assetId, direction) } as Partial<BrandingSettings>);
  }

  function renderLogoCards(type: "logo" | "favicon") {
    const activeId = type === "logo" ? form.activeLogoAssetId : form.activeFaviconAssetId;
    const label = type === "logo" ? "设为 Logo" : "设为图标";
    const assetsForType = type === "favicon"
      ? uniqueBrandingAssetsByUrl([...brandingAssetsFor(assets, "favicon"), ...brandingAssetsFor(assets, "logo")], activeId)
      : brandingAssetsFor(assets, "logo");
    return (
      <div className="branding-asset-grid">
        {assetsForType.map((asset) => (
          <BrandingAssetCard
            asset={asset}
            key={`${type}-${asset.id}`}
            selected={asset.id === activeId}
            actions={
              <button
                className="secondary-btn compact"
                type="button"
                disabled={asset.id === activeId}
                onClick={() => patch(type === "logo" ? { activeLogoAssetId: asset.id } : { activeFaviconAssetId: asset.id })}
              >
                <Check size={14} />
                {label}
              </button>
            }
            onRename={setRenameTarget}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>
    );
  }

  function renderTitleCards() {
    return (
      <div className="branding-asset-grid">
        {brandingAssetsFor(assets, "login_title").map((asset) => {
          const selectedLight = asset.id === form.activeLoginTitleLightAssetId;
          const selectedDark = asset.id === form.activeLoginTitleDarkAssetId;
          return (
            <BrandingAssetCard
              asset={asset}
              key={asset.id}
              selected={selectedLight || selectedDark}
              actions={
                <>
                  <button
                    className="secondary-btn compact"
                    type="button"
                    disabled={selectedLight}
                    onClick={() => patch({ activeLoginTitleLightAssetId: asset.id })}
                  >
                    浅色标题
                  </button>
                  <button
                    className="secondary-btn compact"
                    type="button"
                    disabled={selectedDark}
                    onClick={() => patch({ activeLoginTitleDarkAssetId: asset.id })}
                  >
                    暗色标题
                  </button>
                </>
              }
              onRename={setRenameTarget}
              onDelete={setDeleteTarget}
            />
          );
        })}
      </div>
    );
  }

  function renderBackgroundCards(type: "light" | "dark") {
    const assetType: BrandingAssetType = type === "light" ? "login_background_light" : "login_background_dark";
    const selectedIds = type === "light" ? form.loginBackgroundLightAssetIds : form.loginBackgroundDarkAssetIds;
    return (
      <div className="branding-asset-grid branding-background-grid">
        {brandingAssetsFor(assets, assetType).map((asset) => {
          const order = selectedIds.indexOf(asset.id) + 1;
          return (
            <BrandingAssetCard
              asset={asset}
              key={asset.id}
              selected={order > 0}
              order={order > 0 ? order : undefined}
              actions={
                <>
                  <button
                    className={cx("secondary-btn compact", order > 0 && "active")}
                    type="button"
                    onClick={() => toggleBackground(type, asset.id)}
                  >
                    {order > 0 ? "移出轮播" : "参与轮播"}
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label="向前排序"
                    disabled={order <= 1}
                    onClick={() => moveBackground(type, asset.id, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label="向后排序"
                    disabled={order <= 0 || order >= selectedIds.length}
                    onClick={() => moveBackground(type, asset.id, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </>
              }
              onRename={setRenameTarget}
              onDelete={setDeleteTarget}
            />
          );
        })}
      </div>
    );
  }

  return (
    <section className="config-card branding-settings-card">
      <ConfigHeader title="品牌设置" desc="配置全站统一的站点名称、Logo、登录页标题图和登录背景；系统默认资源会保留为可选项。" />
      {query.isLoading ? <div className="settings-empty">品牌配置加载中...</div> : null}
      <div className="branding-top-grid">
        <div className="branding-section">
          <h2>基础信息</h2>
          <div className="provider-form branding-basic-form">
            <label>
              站点名称
              <input value={form.siteName} maxLength={40} onChange={(event) => patch({ siteName: event.target.value })} />
            </label>
            <div className="row-actions">
              <button className="primary-btn" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
                <Save size={16} />
                保存品牌设置
              </button>
              <button className="secondary-btn" type="button" onClick={() => reset.mutate()} disabled={reset.isPending || save.isPending}>
                <RotateCcw size={16} />
                恢复默认
              </button>
            </div>
          </div>
        </div>
        <div className="branding-preview-panel">
          <h2>实际预览</h2>
          <div className="branding-preview-shell">
            <div className="branding-preview-sidebar">
              {activeLogo?.url ? <img src={activeLogo.url} alt={form.siteName} /> : <ProjectLogo alt={form.siteName} />}
              <span>{form.siteName}</span>
            </div>
            <div className="branding-preview-login" style={{ backgroundImage: firstLightBackground?.url ? `url("${firstLightBackground.url}")` : undefined }}>
              {lightTitle?.url ? <img src={lightTitle.url} alt={form.siteName} /> : null}
            </div>
            <div className="branding-preview-login dark" style={{ backgroundImage: firstDarkBackground?.url ? `url("${firstDarkBackground.url}")` : undefined }}>
              {darkTitle?.url ? <img src={darkTitle.url} alt={form.siteName} /> : null}
            </div>
          </div>
          <small>当前图标：{activeFavicon?.name || "默认浏览器图标"}</small>
        </div>
      </div>

      <div className="branding-section">
        <div className="branding-section-head">
          <div>
            <h2>Logo</h2>
            <p>用于工作台侧栏、配置中心和空白页品牌标识。建议上传透明 PNG 或 WebP。</p>
          </div>
          <BrandingUploadButton type="logo" label="上传 Logo" disabled={uploadDisabled} onUpload={handleUpload} />
        </div>
        {renderLogoCards("logo")}
      </div>

      <div className="branding-section">
        <div className="branding-section-head">
          <div>
            <h2>浏览器图标</h2>
            <p>可复用 Logo，也可以单独上传小尺寸图标。</p>
          </div>
          <BrandingUploadButton type="favicon" label="上传图标" disabled={uploadDisabled} onUpload={handleUpload} />
        </div>
        {renderLogoCards("favicon")}
      </div>

      <div className="branding-section">
        <div className="branding-section-head">
          <div>
            <h2>登录标题图</h2>
            <p>登录页左侧品牌标题图，可分别设置浅色和暗色主题。</p>
          </div>
          <BrandingUploadButton type="login_title" label="上传标题图" disabled={uploadDisabled} onUpload={handleUpload} />
        </div>
        {renderTitleCards()}
      </div>

      <div className="branding-section">
        <div className="branding-section-head">
          <div>
            <h2>浅色登录背景</h2>
            <p>勾选多张后登录页自动轮播，可用箭头调整显示顺序。</p>
          </div>
          <BrandingUploadButton type="login_background_light" label="上传浅色背景" disabled={uploadDisabled} onUpload={handleUpload} />
        </div>
        {renderBackgroundCards("light")}
      </div>

      <div className="branding-section">
        <div className="branding-section-head">
          <div>
            <h2>暗色登录背景</h2>
            <p>暗色主题下使用的登录背景池，默认保留当前暗色背景图。</p>
          </div>
          <BrandingUploadButton type="login_background_dark" label="上传暗色背景" disabled={uploadDisabled} onUpload={handleUpload} />
        </div>
        {renderBackgroundCards("dark")}
      </div>

      {save.error ? <div className="form-error">{save.error.message}</div> : null}
      {reset.error ? <div className="form-error">{reset.error.message}</div> : null}
      {upload.error ? <div className="form-error">{upload.error.message}</div> : null}
      {updateAsset.error ? <div className="form-error">{updateAsset.error.message}</div> : null}
      {deleteAsset.error ? <div className="form-error">{deleteAsset.error.message}</div> : null}

      <PromptDialog
        open={Boolean(renameTarget)}
        title="重命名品牌资源"
        label="资源名称"
        defaultValue={renameTarget?.name ?? ""}
        confirmText="保存名称"
        onSubmit={(name) => {
          if (!renameTarget) return;
          updateAsset.mutate({ id: renameTarget.id, patch: { name } });
        }}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除品牌资源"
        description={deleteTarget ? `确定删除“${deleteTarget.name}”？系统默认资源不能删除，正在使用的资源需要先切换。` : ""}
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteAsset.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

function PromptOptimizerPanel() {
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
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td className="provider-name-cell">
                    <strong>{provider.name}</strong>
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
                    <PromptOptimizerAvailabilityTag provider={provider} />
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

function safetyReviewUserLabel(log: SafetyReviewLog) {
  return log.username || log.account || log.userId || "-";
}

function SafetyReviewPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ["config-safety-review"], queryFn: configApi.safetyReview });
  const [form, setForm] = useState<SafetyReviewSettings>(emptySafetyReviewSettings());
  const save = useMutation({
    mutationFn: () => configApi.saveSafetyReview(normalizeSafetyReviewSettings(form)),
    onSuccess: (data) => {
      setForm(normalizeSafetyReviewSettings(data.settings));
      showToast("安全审核配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-safety-review"] });
    }
  });

  useEffect(() => {
    if (query.data?.settings) setForm(normalizeSafetyReviewSettings(query.data.settings));
  }, [query.data?.settings]);

  function patch(patchValue: Partial<SafetyReviewSettings>) {
    setForm((value) => ({ ...value, ...patchValue }));
  }

  const logs = query.data?.logs ?? [];

  return (
    <section className="config-card">
      <ConfigHeader
        title="安全审核"
        desc="只审核对话里用户提交的生图/图生图提示词。关闭后不会调用审核模型，也不会拦截请求。"
      />
      <div className="provider-form safety-review-form">
        <div className="switch-row smtp-switch-row">
          <div className="switch-row-copy">
            <strong>文本审核总开关</strong>
            <small>开启后只在对话提交生图前审核用户提示词，命中拦截时不调用图片渠道。</small>
          </div>
          <SwitchControl
            checked={form.enabled}
            disabled={save.isPending}
            label={form.enabled ? "已启用" : "已关闭"}
            onChange={(enabled) => patch({ enabled })}
          />
        </div>
        <label>
          审核异常策略
          <CustomSelect
            value={form.failurePolicy}
            onChange={(failurePolicy) => patch({ failurePolicy: failurePolicy === "block" ? "block" : "allow" })}
            options={[
              { value: "allow", label: "异常时放行" },
              { value: "block", label: "异常时拦截" }
            ]}
          />
        </label>
        <label>
          拦截提示文案
          <textarea
            rows={3}
            value={form.blockMessage}
            onChange={(event) => patch({ blockMessage: event.target.value })}
            placeholder="当前提示词可能存在安全风险，请调整后再试。"
          />
        </label>
        <div className="form-actions">
          <button className="primary-btn" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={16} />
            保存安全审核配置
          </button>
          <button className="secondary-btn" type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={query.isFetching ? "spin-icon" : undefined} size={16} />
            刷新记录
          </button>
        </div>
        <p className="muted">
          审核模型复用“模型配置”里排序最靠前的启用供应商；V1 只拦截模型返回 block 的提示词，review 仅记录。
        </p>
        {form.updatedAt ? <p className="muted">最近更新：{formatDate(form.updatedAt)}</p> : null}
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {query.error ? <div className="form-error">{query.error.message}</div> : null}
      </div>
      <div className="table-wrap">
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
                <td>{safetyReviewDecisionLabel(log)}</td>
                <td>
                  {safetyReviewRiskLabel(log.riskLevel)}
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

function emptyProxy(): ProxyConfig {
  return {
    enabled: false,
    url: "",
    retryCount: 2,
    applyChatgptWeb: true,
    applyCpa: false,
    applyApi: false,
    updatedAt: ""
  };
}

function ProxyPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const proxy = useQuery({ queryKey: ["config-proxy"], queryFn: configApi.proxy });
  const [form, setForm] = useState<ProxyConfig>(emptyProxy());
  const save = useMutation({
    mutationFn: () => {
      const url = form.url.trim();
      const rawRetryCount = Number(form.retryCount);
      const retryCount = Number.isFinite(rawRetryCount) ? Math.max(0, Math.min(10, Math.trunc(rawRetryCount))) : 2;
      if (form.enabled && !url) throw new Error("启用代理必须填写代理地址");
      return configApi.saveProxy({ ...form, url, retryCount });
    },
    onSuccess: (data) => {
      setForm(data.proxy);
      showToast("代理配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-proxy"] });
    }
  });

  useEffect(() => {
    if (proxy.data?.proxy) setForm(proxy.data.proxy);
  }, [proxy.data?.proxy]);

  return (
    <section className="config-card">
      <ConfigHeader title="代理配置" desc="启用后，允许使用代理的请求会走该地址；代理请求失败时按重试次数自动重试。" />
      <div className="provider-form proxy-form">
        <div className="switch-row proxy-switch-row">
          <span>启用代理</span>
          <SwitchControl
            checked={form.enabled}
            label={form.enabled ? "已启用" : "已关闭"}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
        </div>
        <label className="wide">
          代理地址
          <input
            value={form.url}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            placeholder="http://127.0.0.1:7890"
          />
        </label>
        <label>
          重试次数
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            value={form.retryCount}
            onChange={(event) => setForm({ ...form, retryCount: Number(event.target.value) })}
          />
        </label>
        <button className="primary-btn" onClick={() => save.mutate()}>
          <Save size={16} />
          保存代理配置
        </button>
        {form.updatedAt ? <p className="muted">最近更新：{formatDate(form.updatedAt)}</p> : null}
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
      </div>
    </section>
  );
}

function emptyDebugSettings(): DebugSettings {
  return {
    imageEditMask: false,
    updatedAt: ""
  };
}

function DebugSettingsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const debug = useQuery({ queryKey: ["config-debug"], queryFn: configApi.debug });
  const [form, setForm] = useState<DebugSettings>(emptyDebugSettings());
  const [switchTarget, setSwitchTarget] = useState<{ key: "imageEditMask"; checked: boolean } | null>(null);
  const save = useMutation({
    mutationFn: (next: DebugSettings) => configApi.saveDebug(next),
    onSuccess: (data) => {
      setForm(data.debug);
      setSwitchTarget(null);
      showToast("调试配置已保存");
      queryClient.invalidateQueries({ queryKey: ["config-debug"] });
    }
  });

  useEffect(() => {
    if (debug.data?.debug) setForm(debug.data.debug);
  }, [debug.data?.debug]);

  function applyDebugSwitch(key: "imageEditMask", checked: boolean) {
    if (save.isPending) return;
    const previous = form;
    const next = { ...form, [key]: checked };
    setForm(next);
    save.mutate(next, {
      onError: () => {
        setForm(previous);
        setSwitchTarget(null);
      }
    });
  }

  return (
    <section className="config-card">
      <ConfigHeader
        title="调试配置"
        desc="仅用于本地排查图片编辑 Mask 问题。开启后会在 data/debug/image-edits/任务ID/ 下保存调试文件，切换开关会自动保存。"
      />
      <div className="debug-settings-list">
        <div className="switch-row">
          <span className="debug-setting-copy">
            <strong>保存编辑遮罩和请求信息</strong>
            <small>带 Mask 局部重绘时保存 mask.png 和 request.json，用来检查遮罩范围、提示词、来源图和实际调用渠道。</small>
          </span>
          <SwitchControl
            checked={form.imageEditMask}
            disabled={save.isPending}
            label={form.imageEditMask ? "已启用" : "已关闭"}
            onChange={(checked) => setSwitchTarget({ key: "imageEditMask", checked })}
          />
        </div>
      </div>
      <p className="muted">
        接口响应不需要额外开关：图片任务的原始响应摘要会自动保存到数据库 image_jobs.response_json，图片 base64 会被省略。
      </p>
      {form.updatedAt ? <p className="muted">最近更新：{formatDate(form.updatedAt)}</p> : null}
      {save.error ? <div className="form-error">{save.error.message}</div> : null}
      <ConfirmDialog
        open={Boolean(switchTarget)}
        title={switchTarget?.checked ? "开启调试保存" : "关闭调试保存"}
        description={
          switchTarget?.checked
            ? "确认开启调试保存？开启后会保存编辑遮罩和请求信息，方便排查图片编辑问题。"
            : "确认关闭调试保存？关闭后新的图片编辑不会再保存这些调试文件。"
        }
        confirmText={switchTarget?.checked ? "开启" : "关闭"}
        destructive={false}
        onCancel={() => setSwitchTarget(null)}
        onConfirm={() => {
          if (!switchTarget) return;
          applyDebugSwitch(switchTarget.key, switchTarget.checked);
        }}
      />
    </section>
  );
}

function CpaPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const cpa = useQuery({ queryKey: ["config-cpa"], queryFn: configApi.cpa });
  const [form, setForm] = useState({
    enabled: false,
    syncUrl: "",
    passwordSecret: "",
    frequencyMinutes: 60
  });
  const save = useMutation({
    mutationFn: () => {
      const syncUrl = form.syncUrl.trim();
      const passwordSecret = form.passwordSecret.trim();
      if (form.enabled && !syncUrl) throw new Error("启用 CPA 同步必须填写管理地址");
      if (form.enabled && !passwordSecret) throw new Error("启用 CPA 同步必须填写访问密码");
      return configApi.saveCpa({ ...form, syncUrl, passwordSecret });
    },
    onSuccess: () => {
      showToast("CPA 配置已保存");
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
    if (cpa.data?.account) setForm(cpa.data.account);
  }, [cpa.data?.account]);

  const latestSyncAt = cpa.data?.runs[0]?.finishedAt || cpa.data?.account.updatedAt || "";
  const lastStatus = cpa.data?.account.lastStatus || "暂无同步记录";
  const nextAutoSyncAt = cpa.data?.nextAutoSyncAt || "";

  return (
    <section className="config-card">
      <ConfigHeader title="CPA 同步" desc="填写 CPA 管理地址和访问密码，从远端同步图片账号号池。" />
      <div className="cpa-panel-toolbar">
        <div className="cpa-status-card">
          <div className="cpa-status-head">
            <span>最近状态</span>
            {latestSyncAt ? <small>最近更新：{formatDate(latestSyncAt)}</small> : null}
          </div>
          <strong title={lastStatus}>{lastStatus}</strong>
          {sync.data?.message ? <small>本次结果：{sync.data.message}</small> : null}
          {nextAutoSyncAt ? <small>下次自动同步：{formatDate(nextAutoSyncAt)}</small> : null}
        </div>
        <button className="secondary-btn" onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={sync.isPending ? "spin-icon" : undefined} size={16} />
          立即同步
        </button>
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
        <div className="row-actions">
          <button className="primary-btn" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={16} />
            保存 CPA 配置
          </button>
        </div>
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
                <td className="cpa-run-status">{run.status}</td>
                <td className="cpa-run-message">
                  <span title={run.message}>{run.message}</span>
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

function requestStatusLabel(item: ProviderRequestLog) {
  if (!item.success) return "失败";
  return item.statusCode ? `${item.statusCode}` : "成功";
}

function requestUserLabel(item: ProviderRequestLog) {
  return item.username || item.account || item.userId || "未记录";
}

function requestRouteLabel(item: ProviderRequestLog) {
  return `${channelLabels[item.channel as ProviderConfig["channel"]] ?? item.channel} / ${
    routeModeLabels[item.routeMode as ProviderConfig["routeMode"]] ?? item.routeMode
  }`;
}

function requestAttemptLabel(item: ProviderRequestLog) {
  const attemptNo = Math.max(1, Number(item.attemptNo) || 1);
  const maxAttempts = Math.max(1, Number(item.maxAttempts) || 1);
  if (item.isRetry) return `自动重试 ${attemptNo}/${maxAttempts}`;
  return maxAttempts > 1 ? `第 ${attemptNo}/${maxAttempts} 次` : "";
}

const MODEL_REQUEST_PURPOSE_OPTIONS = [
  { value: "all", label: "全部场景" },
  { value: "config.models", label: "配置获取模型" },
  { value: "config.test", label: "配置测试" },
  { value: "prompt.optimize", label: "提示词优化" },
  { value: "prompt.translate", label: "提示词翻译" },
  { value: "template.optimize", label: "表单优化" },
  { value: "template.translate", label: "表单翻译" },
  { value: "title.generate", label: "标题生成" },
  { value: "starter.copy", label: "每日文案" },
  { value: "safety.review", label: "安全审核" }
];

const MODEL_REQUEST_SUCCESS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "success", label: "成功" },
  { value: "failure", label: "失败" }
];

function modelRequestPurposeLabel(value: string) {
  return MODEL_REQUEST_PURPOSE_OPTIONS.find((item) => item.value === value)?.label ?? (value || "-");
}

function modelRequestUserLabel(item: ModelRequestLog) {
  if (item.username || item.account) return item.username || item.account;
  if (item.source === "config") return "配置测试";
  if (item.source === "starter-copy") return "系统";
  return item.userId || "系统";
}

function modelRequestSourceLabel(source: string) {
  const value = source.trim();
  if (!value) return "";
  if (value === "chat-title" || value === "对话标题自动生成失败") return "对话标题";
  if (value === "asset-name" || value === "素材名称自动生成失败") return "素材名称";
  if (value === "config") return "配置";
  if (value === "prompt-optimizer") return "提示词优化";
  if (value === "prompt-template") return "提示词模板";
  if (value === "prompt-template-export") return "导出网页";
  if (value === "starter-copy") return "空白页文案";
  if (value === "image_generation") return "图片生成";
  if (value === "image_edit") return "图片编辑";
  if (value.endsWith("自动生成失败")) return value.slice(0, -"自动生成失败".length);
  return value;
}

function modelRequestStatusLabel(item: ModelRequestLog) {
  const status = item.statusCode == null ? "" : ` ${item.statusCode}`;
  return item.success ? `成功${status}` : `失败${status}`;
}

function modelRequestAttemptLabel(item: ModelRequestLog) {
  const attemptCount = Math.max(0, Number(item.attemptCount) || 0);
  if (attemptCount <= 0) return "未发起";
  const maxAttempts = Math.max(1, Number(item.retryCount) + 1);
  return maxAttempts > 1 ? `${attemptCount}/${maxAttempts}` : `${attemptCount}`;
}

function ModelRequestLogsPanel() {
  const [successFilter, setSuccessFilter] = useState<"all" | "success" | "failure">("all");
  const [purposeFilter, setPurposeFilter] = useState("all");
  const filters = {
    success: successFilter,
    purpose: purposeFilter === "all" ? "" : purposeFilter,
    limit: 100
  };
  const logs = useQuery({
    queryKey: ["config-model-request-logs", filters],
    queryFn: () => configApi.modelRequestLogs(filters)
  });
  return (
    <section className="config-card">
      <ConfigHeader title="模型日志" desc="记录语言模型调用的场景、供应商、状态、重试次数和接口地址；不保存请求正文和响应正文。" />
      <div className="model-log-actions">
        <CustomSelect
          className="model-log-status-filter"
          value={successFilter}
          onChange={(value) => setSuccessFilter(value as "all" | "success" | "failure")}
          options={MODEL_REQUEST_SUCCESS_OPTIONS}
          menuWidth={160}
        />
        <CustomSelect
          className="model-log-purpose-filter"
          value={purposeFilter}
          onChange={setPurposeFilter}
          options={MODEL_REQUEST_PURPOSE_OPTIONS}
          menuWidth={220}
        />
        <button className="secondary-btn" onClick={() => logs.refetch()}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>
      <div className="table-wrap">
        <table className="request-log-table model-log-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>场景</th>
              <th>用户</th>
              <th>供应商</th>
              <th>模型</th>
              <th>状态</th>
              <th>尝试</th>
              <th>耗时</th>
              <th>接口地址</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.logs.map((item) => (
              <tr key={item.id}>
                <td>{formatDate(item.createdAt)}</td>
                <td>
                  {modelRequestPurposeLabel(item.purpose)}
                  {modelRequestSourceLabel(item.source) ? <small>{modelRequestSourceLabel(item.source)}</small> : null}
                </td>
                <td>
                  {modelRequestUserLabel(item)}
                  {item.account && item.account !== modelRequestUserLabel(item) ? <small>{item.account}</small> : null}
                </td>
                <td>{item.providerName || item.providerId || "-"}</td>
                <td>{item.model || "-"}</td>
                <td>{modelRequestStatusLabel(item)}</td>
                <td>{modelRequestAttemptLabel(item)}</td>
                <td>{item.durationMs} ms</td>
                <td className="endpoint-cell">
                  <span>{item.method} {item.endpoint}</span>
                  {item.error ? <small>{item.error}</small> : null}
                </td>
              </tr>
            ))}
            {logs.data?.logs.length === 0 ? (
              <tr>
                <td colSpan={9}>暂无模型调用记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequestLogsPanel() {
  const logs = useQuery({ queryKey: ["config-request-logs"], queryFn: configApi.requestLogs });
  return (
    <section className="config-card">
      <ConfigHeader title="请求日志" desc="记录最近图片请求实际使用的渠道、调用方式、重试次数和接口地址。" />
      <div className="config-file-actions">
        <button className="secondary-btn" onClick={() => logs.refetch()}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>
      <div className="table-wrap">
        <table className="request-log-table">
          <colgroup>
            <col className="request-log-time-col" />
            <col className="request-log-user-col" />
            <col className="request-log-source-account-col" />
            <col className="request-log-provider-col" />
            <col className="request-log-route-col" />
            <col className="request-log-operation-col" />
            <col className="request-log-status-col" />
            <col className="request-log-duration-col" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>来源账号</th>
              <th>渠道</th>
              <th>调用方式</th>
              <th>操作</th>
              <th>状态</th>
              <th>耗时</th>
              <th>接口地址</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.logs.map((item) => {
              const routeLabel = requestRouteLabel(item);
              return (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    {requestUserLabel(item)}
                    {item.account && item.account !== requestUserLabel(item) ? <small>{item.account}</small> : null}
                  </td>
                  <td title={item.sourceAccountName || item.sourceAccountId || "-"}>
                    {item.sourceAccountName || "-"}
                    {item.sourceAccountEmail && item.sourceAccountEmail !== item.sourceAccountName ? (
                      <small>{item.sourceAccountEmail}</small>
                    ) : null}
                  </td>
                  <td>{item.providerName}</td>
                  <td className="request-route-cell">
                    <span
                      className="request-route-tip"
                      title={routeLabel}
                      data-request-tip={routeLabel}
                      aria-label={routeLabel}
                    >
                      <span className="request-route-text">{routeLabel}</span>
                    </span>
                  </td>
                  <td>
                    {item.operation === "edit" ? "编辑" : "生成"}
                    {requestAttemptLabel(item) ? <small>{requestAttemptLabel(item)}</small> : null}
                  </td>
                  <td>{requestStatusLabel(item)}</td>
                  <td>{item.durationMs} ms</td>
                  <td className="endpoint-cell">
                    <span>{item.endpoint}</span>
                    {item.error ? <small>{item.error}</small> : null}
                  </td>
                </tr>
              );
            })}
            {logs.data?.logs.length === 0 ? (
              <tr>
                <td colSpan={9}>暂无调用记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditPanel() {
  const audit = useQuery({ queryKey: ["config-audit"], queryFn: configApi.audit });
  return (
    <section className="config-card">
      <ConfigHeader title="配置审计" desc="记录配置入口的重要操作。" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>动作</th>
              <th>详情</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {audit.data?.logs.map((log) => (
              <tr key={log.id}>
                <td>{log.action}</td>
                <td>{JSON.stringify(log.detail)}</td>
                <td>{formatDate(log.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfigHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <header className="page-header compact">
      <h1>{title}</h1>
      <p>{desc}</p>
    </header>
  );
}
