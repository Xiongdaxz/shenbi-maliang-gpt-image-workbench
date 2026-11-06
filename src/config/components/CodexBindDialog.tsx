import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, KeyRound, LoaderCircle, ShieldCheck, SquareTerminal, X } from "lucide-react";
import { configApi } from "../../api";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { ProviderConfig } from "../../types";
import { CustomSelect, useToast } from "../../ui";
import type { CodexOAuthSessionResult } from "../../types/codexOAuth";
import "../../styles/codex-binding.css";

export const CODEX_SESSION_STORAGE_KEY = "maliang.config.codex-oauth.session";
const pendingStates = new Set(["waiting", "exchanging", "saving", "save_failed"]);

export function CodexBindDialog({ open, sessionId, targetAccountId, providers, onClose, onSessionChange }: {
  open: boolean; sessionId: string; targetAccountId: string; providers: ProviderConfig[];
  onClose: () => void; onSessionChange: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [callbackUrl, setCallbackUrl] = useState("");
  const [channelId, setChannelId] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [inlineError, setInlineError] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const acknowledged = useRef("");
  const creatingRef = useRef(false);
  const sessionQuery = useQuery({
    queryKey: ["config-codex-oauth", sessionId], queryFn: () => configApi.codexOAuthSession(sessionId),
    enabled: Boolean(sessionId), retry: false,
    refetchInterval: query => pendingStates.has(query.state.data?.session.status || "") ? 2000 : false,
    refetchIntervalInBackground: false
  });
  const session = sessionQuery.data?.session;
  function accept(result: CodexOAuthSessionResult) {
    queryClient.setQueryData(["config-codex-oauth", result.session.id], result);
  }
  const create = useMutation({ mutationFn: () => configApi.createCodexOAuthSession(targetAccountId),
    onSuccess: result => { accept(result); onSessionChange(result.session.id); },
    onSettled: () => { creatingRef.current = false; }
  });
  const submit = useMutation({ mutationFn: () => configApi.submitCodexOAuthCallback(sessionId, callbackUrl),
    onSuccess: result => { accept(result); setInlineError(""); }, onError: error => setInlineError(error.message) });
  const cancel = useMutation({ mutationFn: () => configApi.cancelCodexOAuthSession(sessionId), onSuccess: accept });
  const attach = useMutation({ mutationFn: () => configApi.attachCodexOAuthChannel(sessionId, channelId),
    onSuccess: () => { showToast("账号已加入生成渠道号池"); invalidateAccounts(); } });
  function invalidateAccounts() {
    for (const key of ["config-image-accounts", "config-providers", "providers"]) void queryClient.invalidateQueries({ queryKey: [key] });
  }
  useEffect(() => {
    if (!open || sessionId || create.isError || creatingRef.current) return;
    creatingRef.current = true; create.mutate();
  }, [open, sessionId, create.isError]);
  useEffect(() => {
    if (session?.status === "succeeded" && acknowledged.current !== session.id) {
      acknowledged.current = session.id; setCallbackUrl(""); invalidateAccounts();
      void queryClient.invalidateQueries({ queryKey: ["config-codex-oauth", session.id] });
      showToast(session.message);
    }
  }, [session?.status, session?.id]);
  useEffect(() => {
    const tick = () => setSeconds(session ? Math.max(0, Math.ceil((Date.parse(session.expiresAt) - Date.now()) / 1000)) : 0);
    tick(); if (!open) return;
    const timer = window.setInterval(tick, 1000); return () => clearInterval(timer);
  }, [session?.expiresAt, open]);
  function restart() {
    onSessionChange(""); setCallbackUrl(""); setChannelId(""); setInlineError("");
    submit.reset(); cancel.reset(); attach.reset(); create.reset();
  }
  const busy = submit.isPending || session?.status === "exchanging" || session?.status === "saving";
  const waiting = session?.status === "waiting";
  const success = session?.status === "succeeded";
  const failed = session && !pendingStates.has(session.status) && !success;
  const error = inlineError || create.error?.message || cancel.error?.message || sessionQuery.error?.message || attach.error?.message;
  const options = providers.filter(provider => provider.channel === "chatgpt_web" && provider.quotaMode !== "official_only");

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-backdrop codex-bind-backdrop" />
      <Dialog.Content ref={setPortalContainer} className="codex-bind-modal" aria-describedby="codex-bind-description">
        <header className="codex-bind-header">
          <span className="codex-bind-logo"><SquareTerminal size={21} /></span>
          <div><Dialog.Title>绑定 ChatGPT</Dialog.Title><p>使用 ChatGPT 账号登录</p></div>
          <Dialog.Close className="secondary-btn codex-bind-close" aria-label="关闭绑定弹窗"><X size={18} /></Dialog.Close>
        </header>
        <Dialog.Description id="codex-bind-description" className="codex-bind-description">完成授权后，自动保存账号与登录凭据。</Dialog.Description>
        {!session && !error ? <div className="codex-bind-loading" role="status"><LoaderCircle size={19} className="spin-icon" />正在准备授权…</div> : null}
        {session && pendingStates.has(session.status) ? <div className="codex-bind-steps">
          <section className="codex-bind-step"><span className="codex-bind-step-number">1</span><div>
            <h3>打开授权页并完成登录</h3>
            <div className="codex-bind-link"><code>{session.authUrl || "授权链接已使用"}</code><button type="button" className="secondary-btn" aria-label="复制授权链接" disabled={!waiting} onClick={() => void copyTextToClipboard(session.authUrl).then(() => showToast("授权链接已复制")).catch(() => showToast("复制失败，请手动复制链接", "error"))}><Copy size={15} /></button></div>
            <a className={`primary-btn codex-bind-open${!waiting ? " is-disabled" : ""}`} href={waiting ? session.authUrl : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!waiting}>打开授权页<ExternalLink size={14} /></a>
            {!session.autoCallback ? <p className="codex-bind-hint">本机回调端口暂不可用，完成登录后请提交回调地址。</p> : null}
          </div></section>
          <section className="codex-bind-step"><span className="codex-bind-step-number">2</span><div>
            <h3>提交回调 URL <small>自动返回时无需填写</small></h3>
            <p className="codex-bind-hint">若登录后未自动返回，请复制浏览器地址栏中的完整回调地址。远程访问时也可使用此方式。</p>
            <form className="codex-bind-callback" onSubmit={event => { event.preventDefault(); setInlineError(""); if (!callbackUrl.trim()) { setInlineError("请输入完整的回调 URL"); return; } submit.mutate(); }}>
              <input aria-label="完整回调 URL" autoComplete="off" spellCheck={false} value={callbackUrl} disabled={!waiting || busy} placeholder={`${session.redirectUri}?code=…&state=…`} onChange={event => { setCallbackUrl(event.target.value); setInlineError(""); }} />
              <button className="secondary-btn" type="submit" disabled={!waiting || busy}>{submit.isPending ? "提交中…" : "提交回调"}</button>
            </form>
          </div></section>
          {session.status === "save_failed" ? <div className="codex-bind-retry"><p role="alert">{session.message}</p><button type="button" className="secondary-btn" onClick={() => submit.mutate()} disabled={submit.isPending}>重试保存</button></div> : null}
        </div> : null}
        {success ? <div className="codex-bind-success" role="status">
          <span className="codex-bind-success-icon"><Check size={27} /></span><h3>{session.result?.updated ? "账号授权已更新" : "账号已绑定"}</h3>
          <p>账号与登录凭据已保存到生图账号池</p>
          <div className="codex-bind-identity"><strong>{sessionQuery.data?.account?.email || "ChatGPT 账号"}</strong><span><ShieldCheck size={14} />ChatGPT OAuth · 自动续期</span></div>
          <p className="codex-bind-capability">图片调用能力以账号权限和实际生成结果为准。</p>
          {options.length ? <div className="codex-bind-channel"><label>加入生成渠道（可选）</label><div>
            <CustomSelect portalContainer={portalContainer} ariaLabel="选择生成渠道" value={channelId} options={[{value:"",label:"选择渠道"},...options.map(provider=>({value:provider.id,label:provider.name}))]} onChange={value => { setChannelId(value); attach.reset(); }} />
            <button type="button" className="secondary-btn" disabled={!channelId || attach.isPending || attach.isSuccess} onClick={() => attach.mutate()}>{attach.isSuccess ? "已加入" : "加入号池"}</button>
          </div></div> : <p className="codex-bind-hint">可在「生成渠道」选择此账号使用 Codex 额度。</p>}
          <div className="row-actions"><button type="button" className="secondary-btn" onClick={restart}>继续绑定</button><button type="button" className="primary-btn" onClick={onClose}>完成</button></div>
        </div> : null}
        {failed ? <div className="codex-bind-terminal" role="status"><KeyRound size={27} /><h3>{session.message}</h3><button type="button" className="primary-btn" onClick={restart}>重新发起</button></div> : null}
        {error ? <div className="codex-bind-error" role="alert">{error}{!session || sessionQuery.isError ? <button type="button" className="secondary-btn" onClick={restart}>重新发起</button> : null}</div> : null}
        {session && pendingStates.has(session.status) ? <footer className="codex-bind-footer"><div aria-live="polite">{busy ? <LoaderCircle className="spin-icon" size={14} /> : <span className="codex-bind-dot" />}{busy ? (session.status === "saving" ? "正在保存账号" : "正在校验授权") : session.message}{waiting ? <time>· {Math.floor(seconds / 60).toString().padStart(2,"0")}:{(seconds % 60).toString().padStart(2,"0")}</time> : null}<button type="button" disabled={busy || cancel.isPending} onClick={() => cancel.mutate()}>结束授权</button></div><p>关闭弹窗后，可从账号管理继续本次授权。</p></footer> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
