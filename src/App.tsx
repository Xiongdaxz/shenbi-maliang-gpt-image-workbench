import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { SharedWorkbenchShell } from "./components/SharedWorkbenchShell";
import { WorkbenchShell } from "./components/WorkbenchShell";
import { useAppearanceMode } from "./hooks/useAppearanceMode";
import { useI18n, useSyncI18nPreference } from "./i18n";
import { useDocumentBranding } from "./lib/branding";
import { LoginPage } from "./pages/LoginPage";
import { ToastProvider } from "./ui";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const branding = useQuery({ queryKey: ["branding"], queryFn: api.branding });
  const loggedIn = Boolean(me.data?.user);
  const sharedRoute = /^\/share\/[^/]+\/?$/.test(location.pathname);
  const searchParams = new URLSearchParams(location.search);
  const authMode = searchParams.get("auth") === "register" ? "register" : searchParams.get("auth") === "login" ? "login" : null;
  const { t } = useI18n();

  useDocumentBranding(branding.data);
  useAppearanceMode({ enabled: loggedIn, clearOnDisable: true, preferredMode: me.data?.user?.appearanceMode });
  useSyncI18nPreference(me.data?.user?.preferences.language, loggedIn && !me.isLoading);

  const cleanSharedLocation = () => {
    const params = new URLSearchParams(location.search);
    params.delete("auth");
    params.delete("next");
    return `${location.pathname}${params.size > 0 ? `?${params.toString()}` : ""}`;
  };
  const safeNextPath = () => {
    const next = searchParams.get("next") ?? "";
    return ["/", "/cases", "/assets", "/images", "/prompt-templates"].includes(next) ? next : "";
  };

  if (me.isLoading) {
    return (
      <ToastProvider>
        <div className="center-screen">{t("common.loadingEllipsis")}</div>
      </ToastProvider>
    );
  }

  if (sharedRoute) {
    if (loggedIn && authMode) return <Navigate to={cleanSharedLocation()} replace />;
    if (!loggedIn && authMode) {
      return (
        <ToastProvider>
          <LoginPage
            initialMode={authMode}
            onAuthenticated={() => navigate(safeNextPath() || cleanSharedLocation(), { replace: true })}
          />
        </ToastProvider>
      );
    }
    return (
      <ToastProvider>
        {me.data?.user ? <WorkbenchShell user={me.data.user} /> : <SharedWorkbenchShell />}
      </ToastProvider>
    );
  }

  if (!me.data?.user) {
    return (
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <WorkbenchShell user={me.data.user} />
    </ToastProvider>
  );
}
