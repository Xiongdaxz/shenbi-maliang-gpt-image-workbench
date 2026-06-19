import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, configApi } from "../api";
import { ProjectLogo } from "../components/ProjectLogo";
import { useDocumentBranding } from "../lib/branding";
import { ToastProvider } from "../ui";
import { ConfigDashboard } from "./ConfigDashboard";

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
