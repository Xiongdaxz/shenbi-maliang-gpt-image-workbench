import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { WorkbenchShell } from "./components/WorkbenchShell";
import { useAppearanceMode } from "./hooks/useAppearanceMode";
import { useDocumentBranding } from "./lib/branding";
import { LoginPage } from "./pages/LoginPage";
import { ToastProvider } from "./ui";

export default function App() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const branding = useQuery({ queryKey: ["branding"], queryFn: api.branding });
  const loggedIn = Boolean(me.data?.user);

  useDocumentBranding(branding.data);
  useAppearanceMode({ enabled: loggedIn, clearOnDisable: true, preferredMode: me.data?.user?.appearanceMode });

  if (me.isLoading) {
    return (
      <ToastProvider>
        <div className="center-screen">加载中...</div>
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
