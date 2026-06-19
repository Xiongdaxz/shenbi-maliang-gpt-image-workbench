import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, PanelLeft } from "lucide-react";
import { configApi } from "../api";
import { ProjectLogo } from "../components/ProjectLogo";
import { cx } from "../lib/cx";
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

export function ConfigDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ConfigTabValue>(storedConfigTab);
  const [sideCollapsed, setSideCollapsed] = useState(storedConfigSideCollapsed);
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

  const sideToggleLabel = sideCollapsed ? "展开配置菜单" : "收起配置菜单";

  return (
    <Tabs.Root value={activeTab} onValueChange={changeActiveTab} className={cx("config-shell", sideCollapsed && "config-side-collapsed")}>
      <aside className="config-side">
        <div className="config-side-head">
          <div className="brand-row config-side-brand">
            <ProjectLogo className="config-side-logo" />
            <span>配置中心</span>
          </div>
          <button className="config-side-toggle" type="button" onClick={toggleConfigSide} aria-label={sideToggleLabel} title={sideToggleLabel}>
            <PanelLeft size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className="config-nav" aria-label="配置菜单">
          {CONFIG_NAV_CATEGORIES.map((category) => (
            <section className="config-nav-section" key={category.value}>
              <div className="config-nav-heading">{category.label}</div>
              <Tabs.List className="config-nav-section-list" aria-label={`${category.label}配置菜单`}>
                {configNavItemsForCategory(category.value).map(({ value, label, Icon }) => (
                  <Tabs.Trigger value={value} key={value} title={sideCollapsed ? label : undefined}>
                    <Icon size={16} />
                    <span className="config-nav-label">{label}</span>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </section>
          ))}
        </nav>
        <button className="ghost-btn" onClick={() => logout.mutate()} title={sideCollapsed ? "退出配置入口" : undefined}>
          <LogOut size={16} />
          <span>退出配置入口</span>
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
