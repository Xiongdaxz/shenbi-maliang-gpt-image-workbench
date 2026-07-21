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
import { ProjectLogo } from "../../components/ProjectLogo";
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
  GlobalSwitchRow,
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
  routeModeLabels,
  shouldAutoRefreshAccountUsage,
  todayInputDate,
  uniqueProviderFormId,
  isGeneratedProviderId,
  isGeneratedProviderName
} from "../shared";

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

export function SmtpSettingsPanel() {
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

export function SmsSettingsPanel() {
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

function brandingAssetPreviewUrl(asset: BrandingAsset) {
  return asset.thumbnailUrl || asset.previewUrl || asset.url;
}

function brandingAssetPanelPreviewUrl(asset: BrandingAsset | null | undefined) {
  return asset?.previewUrl || asset?.thumbnailUrl || asset?.url || "";
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
        {brandingAssetPreviewUrl(asset) ? <img src={brandingAssetPreviewUrl(asset)} alt={asset.name} /> : <ImageIcon size={28} />}
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

export function BrandingSettingsPanel() {
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
      ? uniqueBrandingAssetsByUrl(brandingAssetsFor(assets, "favicon"), activeId)
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
      <GlobalSwitchRow
        type="github_entry"
        title="GitHub 入口"
        desc="控制用户设置“关于”中的 GitHub 仓库入口；关闭后改用更新日志图标。"
        defaultEnabled
        invalidateQueryKeys={["branding"]}
      />
      {query.isLoading ? <div className="settings-empty">品牌配置加载中...</div> : null}
      <div className="branding-top-grid">
        <div className="branding-preview-panel">
          <h2>实际预览</h2>
          <div className="branding-preview-shell">
            <div className="branding-preview-sidebar">
              {brandingAssetPanelPreviewUrl(activeLogo) ? <img src={brandingAssetPanelPreviewUrl(activeLogo)} alt={form.siteName} /> : <ProjectLogo alt={form.siteName} />}
              <span>{form.siteName}</span>
            </div>
            <div className="branding-preview-login" style={{ backgroundImage: brandingAssetPanelPreviewUrl(firstLightBackground) ? `url("${brandingAssetPanelPreviewUrl(firstLightBackground)}")` : undefined }}>
              {brandingAssetPanelPreviewUrl(lightTitle) ? <img src={brandingAssetPanelPreviewUrl(lightTitle)} alt={form.siteName} /> : null}
            </div>
            <div className="branding-preview-login dark" style={{ backgroundImage: brandingAssetPanelPreviewUrl(firstDarkBackground) ? `url("${brandingAssetPanelPreviewUrl(firstDarkBackground)}")` : undefined }}>
              {brandingAssetPanelPreviewUrl(darkTitle) ? <img src={brandingAssetPanelPreviewUrl(darkTitle)} alt={form.siteName} /> : null}
            </div>
          </div>
          <small>当前图标：{activeFavicon?.name || "默认浏览器图标"}</small>
        </div>
        <div className="branding-section branding-basic-section">
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
            <p>用于浏览器标签页和收藏夹，可单独上传小尺寸图标。</p>
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

export function ProxyPanel() {
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

export function DebugSettingsPanel() {
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
        desc="用于本地排查图片编辑问题，平时保持关闭。"
      />
      <div className="debug-settings-list">
        <div className="switch-row debug-setting-row">
          <span className="debug-setting-copy">
            <strong>编辑调试文件</strong>
            <small>保存 mask.png 和 request.json。</small>
          </span>
          <SwitchControl
            checked={form.imageEditMask}
            disabled={save.isPending}
            label={form.imageEditMask ? "已启用" : "已关闭"}
            onChange={(checked) => setSwitchTarget({ key: "imageEditMask", checked })}
          />
        </div>
        {form.updatedAt ? <div className="debug-setting-meta">最近更新：{formatDate(form.updatedAt)}</div> : null}
      </div>
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

function emptyBackupSettings(): BackupSettings {
  return {
    enabled: true,
    runTime: "03:00",
    retentionDays: 3,
    backupDir: "backups",
    resolvedBackupDir: "",
    updatedAt: ""
  };
}

type BackupSettingsPayload = Pick<BackupSettings, "enabled" | "runTime" | "retentionDays" | "backupDir">;

function backupSettingsPayload(settings: BackupSettings): BackupSettingsPayload {
  return {
    enabled: settings.enabled,
    runTime: settings.runTime,
    retentionDays: Math.max(1, Math.min(3650, Math.trunc(Number(settings.retentionDays) || 3))),
    backupDir: settings.backupDir.trim() || "backups"
  };
}

function backupSettingsKey(settings: BackupSettingsPayload) {
  return JSON.stringify(settings);
}

const backupSourceLabels: Record<BackupRun["source"], string> = {
  manual: "手动",
  scheduled: "自动"
};

const backupStatusLabels: Record<BackupRun["status"], string> = {
  running: "备份中",
  succeeded: "成功",
  failed: "失败",
  deleted: "已删除"
};

function backupSizeLabel(value: number) {
  return formatImageFileSize(value) || `${Math.max(0, Math.round(value || 0))} B`;
}

function backupDurationLabel(value: number) {
  const durationMs = Math.max(0, Math.round(value || 0));
  if (!durationMs) return "-";
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)} 秒`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)} 分钟`;
  const hours = minutes / 60;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} 小时`;
}

function downloadBackup(run: BackupRun) {
  const link = document.createElement("a");
  link.href = configApi.backupDownloadUrl(run.id);
  link.download = run.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

type BackupQueryData = {
  settings: BackupSettings;
  nextAutoBackupAt: string;
  running: boolean;
  runs: BackupRun[];
};

export function BackupPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const backups = useQuery({ queryKey: ["config-backups"], queryFn: configApi.backups });
  const [form, setForm] = useState<BackupSettings>(emptyBackupSettings());
  const [deleteTarget, setDeleteTarget] = useState<BackupRun | null>(null);
  const [backupSettingsLoaded, setBackupSettingsLoaded] = useState(false);
  const formRef = useRef(form);
  const lastSavedSettingsKeyRef = useRef("");
  const pendingSaveKeyRef = useRef("");

  const currentSettingsPayload = useMemo(() => backupSettingsPayload(form), [form.backupDir, form.enabled, form.retentionDays, form.runTime]);
  const currentSettingsKey = useMemo(() => backupSettingsKey(currentSettingsPayload), [currentSettingsPayload]);

  const save = useMutation({
    mutationFn: async (settings: BackupSettingsPayload) => {
      const requestedKey = backupSettingsKey(settings);
      const data = await configApi.saveBackupSettings(settings);
      return { ...data, requestedKey };
    },
    onMutate: (settings) => {
      pendingSaveKeyRef.current = backupSettingsKey(settings);
    },
    onSuccess: (data) => {
      if (pendingSaveKeyRef.current === data.requestedKey) pendingSaveKeyRef.current = "";
      lastSavedSettingsKeyRef.current = data.requestedKey;
      queryClient.setQueryData<BackupQueryData>(["config-backups"], (old) =>
        old ? { ...old, settings: data.settings, nextAutoBackupAt: data.nextAutoBackupAt } : old
      );
      if (backupSettingsKey(backupSettingsPayload(formRef.current)) === data.requestedKey) {
        setForm(data.settings);
        showToast("备份配置已自动保存");
      }
    },
    onError: (error) => {
      pendingSaveKeyRef.current = "";
      showToast(error instanceof Error ? error.message : "备份配置自动保存失败", "error");
    }
  });
  const runNow = useMutation({
    mutationFn: configApi.runBackup,
    onSuccess: (data) => {
      showToast("备份任务已开始");
      queryClient.setQueryData<BackupQueryData>(["config-backups"], (old) =>
        old
          ? {
              ...old,
              nextAutoBackupAt: data.nextAutoBackupAt,
              running: true,
              runs: [data.run, ...old.runs.filter((run) => run.id !== data.run.id)]
            }
          : old
      );
    }
  });
  const selectDirectory = useMutation({
    mutationFn: () => configApi.selectBackupDirectory(form.backupDir.trim() || "backups"),
    onSuccess: (data) => {
      if (!data.directory) {
        showToast("未选择目录", "info");
        return;
      }
      const nextForm = { ...form, backupDir: data.directory, resolvedBackupDir: data.directory };
      setForm(nextForm);
      if (backupSettingsLoaded) save.mutate(backupSettingsPayload(nextForm));
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => configApi.deleteBackup(id),
    onSuccess: () => {
      setDeleteTarget(null);
      showToast("备份已删除");
      queryClient.invalidateQueries({ queryKey: ["config-backups"] });
    }
  });

  useEffect(() => {
    if (!backups.data?.settings) return;
    setForm(backups.data.settings);
    lastSavedSettingsKeyRef.current = backupSettingsKey(backupSettingsPayload(backups.data.settings));
    pendingSaveKeyRef.current = "";
    setBackupSettingsLoaded(true);
  }, [backups.data?.settings]);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    if (!backupSettingsLoaded) return;
    if (currentSettingsKey === lastSavedSettingsKeyRef.current || currentSettingsKey === pendingSaveKeyRef.current) return;
    const timer = window.setTimeout(() => {
      save.mutate(currentSettingsPayload);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [backupSettingsLoaded, currentSettingsKey, currentSettingsPayload]);

  const latestRun = backups.data?.runs[0] ?? null;
  const nextAutoBackupAt = backups.data?.nextAutoBackupAt || "";
  const savedResolvedDir = backups.data?.settings.resolvedBackupDir || form.resolvedBackupDir;

  return (
    <section className="config-card">
      <ConfigHeader title="数据备份" desc="备份运行数据库和图片素材文件；备份包包含敏感配置，请保存到可信目录。" />
      <div className="provider-form backup-form">
        <div className="backup-auto-field">
          <span className="backup-field-label">自动备份</span>
          <div className="backup-auto-control">
            <span>启用自动备份</span>
            <SwitchControl
              checked={form.enabled}
              label={form.enabled ? "已启用" : "已关闭"}
              onChange={(enabled) => setForm({ ...form, enabled })}
            />
          </div>
        </div>
        <label>
          每日备份时间
          <input
            type="time"
            value={form.runTime}
            onChange={(event) => setForm({ ...form, runTime: event.target.value })}
          />
        </label>
        <label>
          保留天数
          <input
            type="number"
            min={1}
            max={3650}
            step={1}
            value={form.retentionDays}
            onChange={(event) => setForm({ ...form, retentionDays: Number(event.target.value) })}
          />
        </label>
        <div className="backup-directory-row">
          <label>
            备份目录
            <input
              value={form.backupDir}
              onChange={(event) => setForm({ ...form, backupDir: event.target.value })}
              placeholder="backups"
            />
          </label>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => selectDirectory.mutate()}
            disabled={selectDirectory.isPending}
          >
            {selectDirectory.isPending ? <LoaderCircle className="spin-icon" size={16} /> : <FolderOpen size={16} />}
            {selectDirectory.isPending ? "选择中" : "选择目录"}
          </button>
        </div>
        <div className="backup-form-meta">
          {savedResolvedDir ? (
            <span title={savedResolvedDir}>
              <strong>实际目录</strong>
              {savedResolvedDir}
            </span>
          ) : null}
          {form.updatedAt ? (
            <span>
              <strong>更新</strong>
              {formatDate(form.updatedAt)}
            </span>
          ) : null}
        </div>
        {save.error ? <div className="form-error">{save.error.message}</div> : null}
        {runNow.error ? <div className="form-error">{runNow.error.message}</div> : null}
        {selectDirectory.error ? <div className="form-error">{selectDirectory.error.message}</div> : null}
      </div>
      <div className="backup-panel-toolbar">
        <div className="backup-summary">
          <div className="backup-summary-head">
            <span className="backup-summary-label">最近备份</span>
            {latestRun ? (
              <span className={cx("backup-run-pill", `is-${latestRun.status}`)}>
                {backupSourceLabels[latestRun.source]} · {backupStatusLabels[latestRun.status]}
              </span>
            ) : (
              <span className="backup-run-pill is-empty">暂无备份记录</span>
            )}
            {latestRun?.finishedAt || latestRun?.startedAt ? (
              <time>{formatDate(latestRun.finishedAt || latestRun.startedAt)}</time>
            ) : null}
          </div>
          <div className="backup-summary-meta">
            {latestRun?.fileName ? <span title={latestRun.fileName}>{latestRun.fileName}</span> : <span>等待首次备份</span>}
            {latestRun?.fileSize ? <span>{backupSizeLabel(latestRun.fileSize)}</span> : null}
            {latestRun && latestRun.status !== "running" ? <span>耗时 {backupDurationLabel(latestRun.durationMs)}</span> : null}
            {nextAutoBackupAt ? <span>下次 {formatDate(nextAutoBackupAt)}</span> : null}
          </div>
          {latestRun?.error ? <div className="backup-summary-error">{latestRun.error}</div> : null}
        </div>
        <div className="backup-toolbar-actions">
          <button className="secondary-btn" type="button" onClick={() => backups.refetch()} disabled={backups.isFetching}>
            {backups.isFetching ? <LoaderCircle className="spin-icon" size={16} /> : <RefreshCw size={16} />}
            刷新
          </button>
          <button className="secondary-btn" type="button" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            {runNow.isPending ? <LoaderCircle className="spin-icon" size={16} /> : <Archive size={16} />}
            立即备份
          </button>
        </div>
      </div>
      <div className="table-wrap backup-table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>来源</th>
              <th>状态</th>
              <th>文件</th>
              <th>目录</th>
              <th>文件数</th>
              <th>耗时</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {backups.data?.runs.map((run) => (
              <tr key={run.id}>
                <td>{formatDate(run.finishedAt || run.startedAt)}</td>
                <td>{backupSourceLabels[run.source]}</td>
                <td>
                  {backupStatusLabels[run.status]}
                  {run.error ? <small>{run.error}</small> : null}
                </td>
                <td>
                  {run.fileName || "-"}
                  {run.fileSize > 0 ? <small>{backupSizeLabel(run.fileSize)}</small> : null}
                </td>
                <td title={run.resolvedBackupDir}>
                  {run.backupDir}
                  <small>{run.resolvedBackupDir}</small>
                </td>
                <td>{run.fileCount || "-"}</td>
                <td>{run.status === "running" ? "进行中" : backupDurationLabel(run.durationMs)}</td>
                <td>
                  <button
                    className="secondary-btn"
                    type="button"
                    disabled={run.status !== "succeeded"}
                    onClick={() => downloadBackup(run)}
                  >
                    <Download size={15} />
                    下载
                  </button>
                  <button
                    className="danger-btn"
                    type="button"
                    disabled={run.status === "running" || run.status === "deleted"}
                    onClick={() => setDeleteTarget(run)}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {!backups.isLoading && backups.data?.runs.length === 0 ? (
              <tr>
                <td colSpan={8}>暂无备份记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除备份"
        description={deleteTarget ? `确认删除备份「${deleteTarget.fileName || deleteTarget.id}」？删除后无法从后台下载该备份包。` : ""}
        confirmText="删除"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </section>
  );
}

function requestStatusLabel(item: ProviderRequestLog) {
  const status = item.statusCode == null ? "" : ` ${item.statusCode}`;
  if (item.cancelled) return "已终止";
  if (!item.success) return `失败${status}`;
  return item.statusCode ? `${item.statusCode}` : "成功";
}

function requestStatusClass(item: ProviderRequestLog) {
  if (item.cancelled) return "cancelled";
  return item.success ? "success" : "failed";
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

export function ModelRequestLogsPanel() {
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

export function RequestLogsPanel() {
  const logs = useInfiniteQuery({
    queryKey: ["config-request-logs", "paged"],
    queryFn: ({ pageParam }) => configApi.requestLogs({ limit: REQUEST_LOG_PAGE_SIZE, offset: Number(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined)
  });
  const logItems = useMemo(() => logs.data?.pages.flatMap((page) => page.logs) ?? [], [logs.data?.pages]);
  const logPages = logs.data?.pages;
  const lastPageInfo = logPages && logPages.length > 0 ? logPages[logPages.length - 1]?.pageInfo : undefined;
  const requestLogLoadMoreRef = useInfinitePageLoader({
    fetchNextPage: () => logs.fetchNextPage(),
    hasNextPage: Boolean(logs.hasNextPage),
    isFetchingNextPage: logs.isFetchingNextPage
  });
  return (
    <section className="config-card">
      <ConfigHeader title="请求日志" desc="记录最近图片请求实际使用的渠道、调用方式、重试次数和接口地址。" />
      <div className="config-file-actions request-log-actions">
        <button className="secondary-btn" onClick={() => logs.refetch()}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>
      <div className="table-wrap request-log-wrap">
        <table className="request-log-table">
          <colgroup>
            <col className="request-log-meta-col" />
            <col className="request-log-source-account-col" />
            <col className="request-log-provider-col" />
            <col className="request-log-route-col" />
            <col className="request-log-result-col" />
            <col className="request-log-endpoint-col" />
          </colgroup>
          <thead>
            <tr>
              <th>时间/用户</th>
              <th>来源账号</th>
              <th>渠道</th>
              <th>调用方式</th>
              <th>结果</th>
              <th>接口地址</th>
            </tr>
          </thead>
          <tbody>
            {logItems.map((item) => {
              const routeLabel = requestRouteLabel(item);
              return (
                <tr key={item.id}>
                  <td className="request-log-meta-cell">
                    <strong>{formatDate(item.createdAt)}</strong>
                    <span>{requestUserLabel(item)}</span>
                    {item.account && item.account !== requestUserLabel(item) ? <small>{item.account}</small> : null}
                  </td>
                  <td title={item.sourceAccountName || item.sourceAccountId || "-"}>
                    <span className="request-log-ellipsis">{item.sourceAccountName || "-"}</span>
                    {item.sourceAccountEmail && item.sourceAccountEmail !== item.sourceAccountName ? (
                      <small className="request-log-ellipsis">{item.sourceAccountEmail}</small>
                    ) : null}
                  </td>
                  <td><span className="request-log-ellipsis" title={item.providerName}>{item.providerName}</span></td>
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
                  <td className="request-log-result-cell">
                    <div>
                      <span className={cx("request-log-status-pill", requestStatusClass(item))}>{requestStatusLabel(item)}</span>
                      <span>{item.operation === "edit" ? "编辑" : "生成"}</span>
                    </div>
                    <small>{requestAttemptLabel(item) || "首次请求"} · {item.durationMs} ms</small>
                  </td>
                  <td className="endpoint-cell">
                    <span className="request-endpoint-text" title={item.endpoint}>{item.endpoint}</span>
                    {item.cancelled ? <small>用户手动终止</small> : item.error ? <small>{item.error}</small> : null}
                    {item.responseSnapshot ? (
                      <details className="request-response-snapshot">
                        <summary>响应快照</summary>
                        <pre>{item.responseSnapshot}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!logs.isLoading && logItems.length === 0 ? (
              <tr>
                <td colSpan={6}>暂无调用记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div ref={requestLogLoadMoreRef} className="config-page-load-sentinel" aria-hidden="true" />
      {logs.isFetchingNextPage ? <div className="request-log-load-state">正在加载更多...</div> : null}
      {!logs.hasNextPage && logItems.length > 0 ? (
        <div className="request-log-load-state">已显示全部 {lastPageInfo?.total ?? logItems.length} 条</div>
      ) : null}
    </section>
  );
}

export function AuditPanel() {
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
