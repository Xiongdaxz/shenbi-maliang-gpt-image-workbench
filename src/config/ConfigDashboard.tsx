import { useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Languages, LogOut, PanelLeft } from "lucide-react";
import { api, configApi } from "../api";
import { ProjectLogo } from "../components/ProjectLogo";
import {
  languagePreferenceOptions,
  normalizeLanguagePreference,
  useI18n,
  useSyncI18nPreference,
  type LanguagePreference
} from "../i18n";
import { cx } from "../lib/cx";
import type { UserPreferences } from "../types";
import { CustomSelect, useToast } from "../ui";
import { useConfigCopyScope } from "./configCopy";
import {
  ConfigTabValue,
  CONFIG_NAV_CATEGORIES,
  configNavItemsForCategory,
  isConfigTabValue,
  storedConfigSideCollapsed,
  storedConfigTab,
  CONFIG_SIDE_COLLAPSED_STORAGE_KEY,
  CONFIG_TAB_STORAGE_KEY
} from "./configNav";
import { AssetReviewPanel, CaseReviewPanel, StarterCopySettingsPanel } from "./panels/content";
import { CpaPanel, ImageAccountPoolPanel, ImageModePanel, PromptOptimizerPanel, ProvidersPanel, SafetyReviewPanel } from "./panels/generation";
import { AccountSearchPanel, TeamAccountPanel } from "./panels/members";
import { ChangelogPanel, StatisticsPanel } from "./panels/overview";
import { AuditPanel, BackupPanel, BrandingSettingsPanel, DebugSettingsPanel, ModelRequestLogsPanel, ProxyPanel, RequestLogsPanel, SmsSettingsPanel, SmtpSettingsPanel } from "./panels/system";

function configNavLabelKey(value: ConfigTabValue) {
  return `config.nav.${value}`;
}

function configCategoryLabelKey(value: (typeof CONFIG_NAV_CATEGORIES)[number]["value"]) {
  return `config.nav.${value}`;
}

export function ConfigDashboard() {
  const queryClient = useQueryClient();
  const { language, resolvedLanguage, setLanguage, t } = useI18n();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<ConfigTabValue>(storedConfigTab);
  const [sideCollapsed, setSideCollapsed] = useState(storedConfigSideCollapsed);
  const shellRef = useRef<HTMLDivElement>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  useSyncI18nPreference(me.data?.user?.preferences?.language, Boolean(me.data?.user));
  useConfigCopyScope(shellRef);
  const languageOptions = useMemo(() => languagePreferenceOptions(t, resolvedLanguage), [resolvedLanguage, t]);
  const logout = useMutation({
    mutationFn: configApi.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config-status"] })
  });
  const saveUserPreferences = useMutation({
    mutationFn: (preferences: Partial<UserPreferences>) => api.saveUserPreferences(preferences),
    onSuccess: (data) => queryClient.setQueryData(["me"], { user: data.user }),
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.preferencesSaveFailed"), "error");
    }
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

  function toggleConfigSide() {
    setSideCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(CONFIG_SIDE_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Keep the in-memory sidebar state even when browser storage is blocked.
      }
      return next;
    });
  }

  function changeLanguage(value: string) {
    const nextLanguage = normalizeLanguagePreference(value) as LanguagePreference;
    if (nextLanguage === language) return;
    setLanguage(nextLanguage);
    if (me.data?.user) saveUserPreferences.mutate({ language: nextLanguage });
    showToast(t("settings.language.toast", { language: languageOptions.find((option) => option.value === nextLanguage)?.label ?? nextLanguage }));
  }

  const sideToggleLabel = sideCollapsed ? t("config.sidebar.expand") : t("config.sidebar.collapse");

  return (
    <Tabs.Root ref={shellRef} value={activeTab} onValueChange={changeActiveTab} className={cx("config-shell", sideCollapsed && "config-side-collapsed")}>
      <aside className="config-side">
        <div className="config-side-head">
          <div className="brand-row config-side-brand">
            <ProjectLogo className="config-side-logo" />
            <span>{t("config.center")}</span>
          </div>
          <button className="config-side-toggle" type="button" onClick={toggleConfigSide} aria-label={sideToggleLabel} title={sideToggleLabel}>
            <PanelLeft size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className="config-nav" aria-label={t("config.menu")}>
          {CONFIG_NAV_CATEGORIES.map((category) => (
            <section className="config-nav-section" key={category.value}>
              <div className="config-nav-heading">{t(configCategoryLabelKey(category.value))}</div>
              <Tabs.List className="config-nav-section-list" aria-label={t("config.menu.sectionAria", { section: t(configCategoryLabelKey(category.value)) })}>
                {configNavItemsForCategory(category.value).map(({ value, Icon }) => {
                  const label = t(configNavLabelKey(value));
                  return (
                  <Tabs.Trigger value={value} key={value} title={sideCollapsed ? label : undefined}>
                    <Icon size={16} />
                    <span className="config-nav-label">{label}</span>
                  </Tabs.Trigger>
                  );
                })}
              </Tabs.List>
            </section>
          ))}
        </nav>
        <div className="config-side-tools">
          <div className="config-language-control" title={sideCollapsed ? t("settings.language.title") : undefined}>
            <span className="config-language-icon" aria-hidden="true">
              <Languages size={16} />
            </span>
            <CustomSelect
              value={language}
              options={languageOptions}
              onChange={changeLanguage}
              className="config-language-select"
              menuClassName="config-language-menu"
              menuPlacement="top"
              menuWidth={260}
            />
          </div>
          <button className="ghost-btn config-logout-btn" onClick={() => logout.mutate()} aria-label={t("config.logout")} title={t("config.logout")}>
            <LogOut size={16} />
            <span>{t("config.logout")}</span>
          </button>
        </div>
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
        <Tabs.Content value="backup">
          <BackupPanel />
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
