import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, configApi } from "../api";
import { ProjectLogo } from "../components/ProjectLogo";
import { useI18n } from "../i18n";
import { useDocumentBranding } from "../lib/branding";
import { ToastProvider } from "../ui";
import { ConfigDashboard } from "./ConfigDashboard";

export default function ConfigApp() {
  const { t } = useI18n();
  const status = useQuery({ queryKey: ["config-status"], queryFn: configApi.status });
  const branding = useQuery({ queryKey: ["branding"], queryFn: api.branding });

  useDocumentBranding(branding.data);

  if (status.isLoading) {
    return <div className="center-screen">{t("config.loading")}</div>;
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
  const { t } = useI18n();
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
            <h1>{mode === "setup" ? t("config.auth.setupTitle") : t("config.auth.loginTitle")}</h1>
            <p>{mode === "setup" ? t("config.auth.setupDesc") : t("config.auth.loginDesc")}</p>
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
            {t("config.auth.password")}
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoFocus
            />
          </label>
          {mutation.error ? <div className="form-error">{mutation.error.message}</div> : null}
          <button className="primary-btn" disabled={mutation.isPending}>
            {mode === "setup" ? t("config.auth.createPassword") : t("config.auth.enter")}
          </button>
        </form>
      </section>
    </main>
  );
}
