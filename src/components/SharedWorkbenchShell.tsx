import { useState } from "react";
import { FolderOpen, Images, Lightbulb, Menu, MessageCircle, MessageCirclePlus, PanelLeft, Search, Sparkles, X } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { SharedConversationPage } from "../pages/SharedConversationPage";
import { ProjectLogo } from "./ProjectLogo";

const guestNavigation = [
  { path: "/cases", labelKey: "sidebar.inspiration", icon: Lightbulb },
  { path: "/assets", labelKey: "sidebar.assets", icon: FolderOpen },
  { path: "/images", labelKey: "sidebar.images", icon: Images },
  { path: "/prompt-templates", labelKey: "sidebar.promptCreation", icon: Sparkles }
] as const;

export function SharedWorkbenchShell() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedToggleVisible, setCollapsedToggleVisible] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const openLogin = (next = "") => {
    const params = new URLSearchParams(location.search);
    params.set("auth", "login");
    if (next) params.set("next", next);
    else params.delete("next");
    navigate({ pathname: location.pathname, search: `?${params.toString()}` });
    setMobileMenuOpen(false);
  };

  return (
    <div className={cx("app-shell", "shared-guest-shell", sidebarCollapsed && "sidebar-collapsed", "sidebar-motion-expanded")}>
      <button className="mobile-menu-btn" type="button" onClick={() => setMobileMenuOpen(true)} aria-label={t("sidebar.openMenu")}>
        <Menu size={20} />
      </button>
      <aside
        className={cx("sidebar", mobileMenuOpen && "open", collapsedToggleVisible && "collapsed-toggle-visible")}
        onMouseEnter={() => {
          if (sidebarCollapsed) setCollapsedToggleVisible(true);
        }}
        onMouseMove={() => {
          if (sidebarCollapsed && !collapsedToggleVisible) setCollapsedToggleVisible(true);
        }}
        onMouseLeave={() => setCollapsedToggleVisible(false)}
      >
        <div className="sidebar-main-scroll">
          <div className="sidebar-fixed">
            <div className="sidebar-head">
              <div className="brand-row">
                <button className="sidebar-logo-button" type="button" aria-label={t("sidebar.scrollTop")}>
                  <ProjectLogo className="sidebar-logo" />
                </button>
              </div>
              <div className="sidebar-head-actions">
                {!sidebarCollapsed ? (
                  <button className="sidebar-head-search is-share-disabled" type="button" aria-label={t("sidebar.globalSearch")} disabled aria-disabled="true">
                    <Search size={18} />
                  </button>
                ) : null}
                <button
                  className="sidebar-toggle"
                  type="button"
                  onClick={() => {
                    setSidebarCollapsed((value) => !value);
                    setCollapsedToggleVisible(false);
                  }}
                  aria-label={sidebarCollapsed ? t("sidebar.openSidebar") : t("sidebar.closeSidebar")}
                  data-sidebar-tip={sidebarCollapsed ? t("sidebar.openSidebar") : undefined}
                >
                  <PanelLeft size={18} aria-hidden="true" />
                </button>
                <button className="icon-btn mobile-only" type="button" onClick={() => setMobileMenuOpen(false)} aria-label={t("sidebar.closeMenu")}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <nav className="main-nav-actions">
              <button className="nav-item is-share-disabled" type="button" disabled aria-disabled="true">
                <MessageCirclePlus size={18} />
                <span>{t("sidebar.newConversation")}</span>
              </button>
              {sidebarCollapsed ? (
                <button className="nav-item is-share-disabled" type="button" aria-label={t("sidebar.globalSearch")} disabled aria-disabled="true">
                  <Search size={18} />
                  <span>{t("sidebar.globalSearch")}</span>
                </button>
              ) : null}
            </nav>
          </div>
          <div className="sidebar-scroll">
            <nav className="main-nav">
              {guestNavigation.map((item) => {
                const Icon = item.icon;
                return (
                  <button className="nav-item is-share-disabled" type="button" key={item.path} disabled aria-disabled="true">
                    <Icon size={18} />
                    <span>{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </nav>
            <section className="recent-section session-group shared-guest-history">
              <div className="session-group-title shared-guest-history-title">
                <h2>{t("sidebar.recent")}</h2>
              </div>
              <div className="shared-guest-history-empty">
                <MessageCircle size={18} />
                <span>{t("sharedConversation.loginForHistory")}</span>
              </div>
            </section>
          </div>
        </div>
        <div className="user-footer shared-guest-login-footer">
          <button className="user-footer-panel shared-guest-login-button" type="button" onClick={() => openLogin()}>
            <span>{t("login.login")}</span>
          </button>
        </div>
      </aside>
      {mobileMenuOpen ? <div className="scrim" onClick={() => setMobileMenuOpen(false)} /> : null}
      <main className="content">
        <Routes>
          <Route path="/share/:token" element={<SharedConversationPage authenticated={false} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
