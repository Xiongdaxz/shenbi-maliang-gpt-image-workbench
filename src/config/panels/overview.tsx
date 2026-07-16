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
import type { ConfigAssetReviewItem, ConfigCaseReviewItem, ConfigChangelogSyncItem } from "../../api/config";
import { ConfirmDialog, CustomSelect, PromptDialog, useToast } from "../../ui";
import {
  ConfigHeader,
  REQUEST_LOG_PAGE_SIZE,
  SwitchControl,
  durationLabel,
  emptyProvider,
  formatDate,
  inputDateOffset,
  inputDateValue,
  nextChangelogVersion,
  numberLabel,
  percentLabel,
  providerDateFromId,
  shouldAutoRefreshAccountUsage,
  todayInputDate,
  uniqueProviderFormId,
  isGeneratedProviderId,
  isGeneratedProviderName
} from "../shared";

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

function orderedStatisticsDates(startDate: string, endDate: string) {
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

function statisticsRangeMatchesFilters(
  range: ConfigStatistics["range"],
  filters: { preset?: string; startDate?: string; endDate?: string }
) {
  if (filters.preset) return range.preset === filters.preset;
  if (!filters.startDate || !filters.endDate) return false;
  const expected = orderedStatisticsDates(filters.startDate, filters.endDate);
  return range.preset === "custom" && range.startDate === expected.startDate && range.endDate === expected.endDate;
}

export function StatisticsPanel() {
  const [preset, setPreset] = useState<StatisticsPreset>("7d");
  const [startDate, setStartDate] = useState(inputDateOffset(-6));
  const [endDate, setEndDate] = useState(todayInputDate());
  const [category, setCategory] = useState<StatisticsCategory>("all");
  const statisticsFilters = useMemo(
    () => (preset === "custom" ? { startDate, endDate } : { preset }),
    [endDate, preset, startDate]
  );
  const statisticsQueryKey = useMemo(
    () => (
      preset === "custom"
        ? ["config-statistics", "custom", startDate, endDate]
        : ["config-statistics", preset]
    ),
    [endDate, preset, startDate]
  );
  const statistics = useQuery({
    queryKey: statisticsQueryKey,
    queryFn: ({ signal }) => configApi.statistics(statisticsFilters, { signal }),
    gcTime: 0
  });
  const rawData = statistics.data?.statistics;
  const data =
    rawData && statisticsRangeMatchesFilters(rawData.range, statisticsFilters)
      ? rawData
      : undefined;

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
    if (!range || !statisticsRangeMatchesFilters(range, statisticsFilters)) return;
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, [
    statistics.data?.statistics.range.endDate,
    statistics.data?.statistics.range.preset,
    statistics.data?.statistics.range.startDate,
    statisticsFilters
  ]);

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
      {statistics.isLoading || (statistics.isFetching && !data) ? <div className="settings-empty">统计数据加载中...</div> : null}
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
        <StatCard label="今日实时图片" value={data.summary.todayImages} hint={`生成 ${numberLabel(data.summary.todayGenerationImages)} · 编辑 ${numberLabel(data.summary.todayEditImages)} · 重试 ${numberLabel(data.summary.todayRetryGeneratedImages)}`} />
        <StatCard label="请求数" value={data.summary.totalRequests} hint={`失败 ${numberLabel(data.summary.failedRequests)} · 重试 ${numberLabel(data.summary.retryRequests)}`} />
        <StatCard label="成功率" value={percentLabel(data.summary.successRate)} hint={`平均耗时 ${durationLabel(data.summary.averageDurationMs)}`} />
        <StatCard label="渠道数" value={data.summary.totalProviders} hint={`启用 ${numberLabel(data.summary.enabledProviders)}`} />
        <StatCard label="可用图片账号" value={data.summary.availableAccounts} hint={`Codex 限流/异常 ${numberLabel(data.summary.limitedOrAbnormalAccounts)}`} />
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
        <StatCard label="Codex 限流" value={data.accounts.totals.limited} />
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

export function ChangelogPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const changelog = useQuery({ queryKey: ["config-changelog"], queryFn: configApi.changelog });
  const suggestedNewVersion = useMemo(
    () => nextChangelogVersion(changelog.data?.entries[0]?.version),
    [changelog.data?.entries]
  );
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; entry?: ChangelogEntry } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ChangelogEntry | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncItems, setSyncItems] = useState<ConfigChangelogSyncItem[]>([]);
  const [selectedSyncVersions, setSelectedSyncVersions] = useState<string[]>([]);
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
  const previewSync = useMutation({
    mutationFn: configApi.previewChangelogSync,
    onSuccess: (result) => {
      setSyncItems(result.entries);
      setSelectedSyncVersions(result.entries.filter((item) => item.action !== "unchanged").map((item) => item.version));
    }
  });
  const syncMarkdown = useMutation({
    mutationFn: configApi.syncChangelog,
    onSuccess: (result) => {
      setSyncDialogOpen(false);
      showToast(`已同步 ${result.selected} 条记录，新增 ${result.inserted} 条，更新 ${result.updated} 条`);
      queryClient.invalidateQueries({ queryKey: ["config-changelog"] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
    }
  });

  function closeDialog() {
    save.reset();
    setDialog(null);
  }

  function openSyncDialog() {
    previewSync.reset();
    syncMarkdown.reset();
    setSyncItems([]);
    setSelectedSyncVersions([]);
    setSyncDialogOpen(true);
    previewSync.mutate();
  }

  function closeSyncDialog() {
    if (syncMarkdown.isPending) return;
    setSyncDialogOpen(false);
    previewSync.reset();
    syncMarkdown.reset();
  }

  return (
    <section className="config-card">
      <ConfigHeader title="更新日志" desc="更新记录默认来自数据库；需要时可从 docs/changelog.md 预览并手动选择同步。" />
      <div className="config-file-actions changelog-file-actions">
        <span>编辑 docs/changelog.md 后，点击“从 Markdown 同步”并勾选要写入的版本。</span>
        <button className="secondary-btn" onClick={openSyncDialog} disabled={previewSync.isPending}>
          <RefreshCw size={16} />
          {previewSync.isPending ? "读取中" : "从 Markdown 同步"}
        </button>
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
            <div className="changelog-entry-meta">
              <h3>{entry.version}</h3>
              <time>{entry.date || "-"}</time>
            </div>
            <MarkdownView markdown={entry.content} className="changelog-entry-content" />
            <div className="row-actions changelog-entry-actions">
              <button className="secondary-btn" onClick={() => setDialog({ mode: "edit", entry })}>
                编辑
              </button>
              <button className="danger-btn" onClick={() => setRemoveTarget(entry)}>
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
      {dialog ? (
        <ChangelogDialog
          mode={dialog.mode}
          entry={dialog.entry}
          suggestedVersion={dialog.mode === "create" ? suggestedNewVersion : undefined}
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
      {syncDialogOpen ? (
        <ChangelogSyncDialog
          items={syncItems}
          selectedVersions={selectedSyncVersions}
          loading={previewSync.isPending}
          syncing={syncMarkdown.isPending}
          error={previewSync.error ?? syncMarkdown.error}
          onClose={closeSyncDialog}
          onToggle={(version) => {
            setSelectedSyncVersions((current) =>
              current.includes(version) ? current.filter((item) => item !== version) : [...current, version]
            );
          }}
          onToggleAll={() => {
            const selectableVersions = syncItems
              .filter((item) => item.action !== "unchanged")
              .map((item) => item.version);
            const allSelected = selectableVersions.length > 0
              && selectableVersions.every((version) => selectedSyncVersions.includes(version));
            setSelectedSyncVersions(allSelected ? [] : selectableVersions);
          }}
          onSubmit={() => syncMarkdown.mutate(selectedSyncVersions)}
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

function ChangelogSyncDialog({
  items,
  selectedVersions,
  loading,
  syncing,
  error,
  onClose,
  onToggle,
  onToggleAll,
  onSubmit
}: {
  items: ConfigChangelogSyncItem[];
  selectedVersions: string[];
  loading: boolean;
  syncing: boolean;
  error: Error | null;
  onClose: () => void;
  onToggle: (version: string) => void;
  onToggleAll: () => void;
  onSubmit: () => void;
}) {
  const selected = new Set(selectedVersions);
  const changedCount = items.filter((item) => item.action !== "unchanged").length;
  const allSelected = changedCount > 0
    && items.filter((item) => item.action !== "unchanged").every((item) => selected.has(item.version));

  return (
    <div className="modal-backdrop">
      <section className="case-modal changelog-sync-modal">
        <header>
          <h3>从 Markdown 同步更新日志</h3>
          <button onClick={onClose} disabled={syncing}>关闭</button>
        </header>
        <div className="changelog-sync-form">
          <p className="changelog-sync-hint">
            以下内容读取自 docs/changelog.md，只会同步勾选的版本。“内容一致”表示 Markdown 与数据库中的日期和正文相同，无需同步。
          </p>
          {loading ? <div className="settings-empty">正在读取 Markdown 日志...</div> : null}
          {!loading && items.length > 0 ? (
            <>
              <div className="changelog-sync-toolbar">
                <div className="changelog-sync-summary">
                  <span>共 {items.length} 条</span>
                  <span>待新增 {items.filter((item) => item.action === "create").length}</span>
                  <span>待更新 {items.filter((item) => item.action === "update").length}</span>
                  <span>内容一致 {items.filter((item) => item.action === "unchanged").length}</span>
                  <span>已选 {selectedVersions.length}</span>
                </div>
                <div className="row-actions">
                  <button className="secondary-btn" type="button" onClick={onToggleAll} disabled={syncing || changedCount === 0}>
                    {allSelected ? "取消全选" : changedCount > 0 ? "全选待同步" : "暂无可同步项"}
                  </button>
                </div>
              </div>
              <div className="changelog-sync-list">
                {items.map((item) => (
                  <label
                    className={cx(
                      "changelog-sync-item",
                      `action-${item.action}`,
                      selected.has(item.version) && "is-selected",
                      item.action === "unchanged" && "is-current"
                    )}
                    key={item.version}
                    aria-disabled={item.action === "unchanged"}
                  >
                    {item.action === "unchanged" ? (
                      <span className="changelog-sync-current-marker" aria-label="内容一致" title="内容一致，无需同步">
                        <Check size={14} strokeWidth={2.6} />
                      </span>
                    ) : (
                      <>
                        <input
                          type="checkbox"
                          checked={selected.has(item.version)}
                          onChange={() => onToggle(item.version)}
                          disabled={syncing}
                        />
                        <span className="changelog-sync-checkbox" aria-hidden="true">
                          {selected.has(item.version) ? <Check size={14} strokeWidth={2.8} /> : null}
                        </span>
                      </>
                    )}
                    <span className="changelog-sync-item-body">
                      <span className="changelog-sync-item-meta">
                        <strong>{item.version}</strong>
                        <time>{item.date}</time>
                        <span className="changelog-sync-action">
                          {item.action === "create" ? "待新增" : item.action === "update" ? "待更新" : "内容一致"}
                        </span>
                      </span>
                      <MarkdownView markdown={item.content} className="changelog-sync-content" />
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
          {!loading && items.length === 0 && !error ? <div className="settings-empty">Markdown 中没有可同步的版本记录。</div> : null}
          <div className="row-actions changelog-sync-actions">
            <button className="secondary-btn" type="button" onClick={onClose} disabled={syncing}>取消</button>
            <button className="primary-btn" type="button" onClick={onSubmit} disabled={syncing || loading || selectedVersions.length === 0}>
              <RefreshCw size={16} />
              {syncing ? "同步中" : `同步已选 ${selectedVersions.length} 条`}
            </button>
          </div>
          {error ? <div className="form-error">{error.message}</div> : null}
        </div>
      </section>
    </div>
  );
}

function ChangelogDialog({
  mode,
  entry,
  suggestedVersion,
  saving,
  error,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  entry?: ChangelogEntry;
  suggestedVersion?: string;
  saving: boolean;
  error?: Error | null;
  onClose: () => void;
  onSubmit: (payload: Pick<ChangelogEntry, "version" | "date" | "content">) => void;
}) {
  const versionEditedRef = useRef(false);
  const [version, setVersion] = useState(entry?.version ?? suggestedVersion ?? "");
  const [date, setDate] = useState(entry?.date || todayInputDate());
  const [content, setContent] = useState(entry?.content ?? "");
  const canSubmit = version.trim() && date.trim() && content.trim();

  useEffect(() => {
    if (mode !== "create" || versionEditedRef.current) return;
    setVersion(suggestedVersion ?? "");
  }, [mode, suggestedVersion]);

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
            <input
              value={version}
              onChange={(event) => {
                versionEditedRef.current = true;
                setVersion(event.target.value);
              }}
              placeholder="例如 v0.1.1"
              autoFocus
            />
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
