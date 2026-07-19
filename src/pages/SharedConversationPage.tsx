import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import { ConversationView } from "../components/chat/ConversationView";
import { useChatScrollJump } from "../hooks/useChatScrollJump";
import { useI18n } from "../i18n";
import { buildChatRenderState } from "../lib/chatRender";

export function SharedConversationPage({ authenticated }: { authenticated: boolean }) {
  const { token = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    document.documentElement.classList.add("chat-page-stable-scrollbar");
    return () => document.documentElement.classList.remove("chat-page-stable-scrollbar");
  }, []);

  const registration = useQuery({
    queryKey: ["registration-status"],
    queryFn: api.registrationStatus,
    enabled: !authenticated
  });
  const conversation = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: ({ signal }) => api.sharedConversation(token, { signal }),
    enabled: Boolean(token),
    retry: false
  });
  const renderState = useMemo(
    () => buildChatRenderState(conversation.data?.messages ?? []),
    [conversation.data?.messages]
  );
  const { jumpToLoadingOrScrollEdge, messageEndRef, scrollJump } = useChatScrollJump({
    composerPreviewCount: 0,
    imageEditorOpen: false,
    loadingTitle: "",
    messageListLength: conversation.data?.messages.length ?? 0,
    renderItemCount: renderState.items.length,
    sessionId: `shared:${token}`,
    showStarter: !conversation.isSuccess
  });
  const openAuth = (mode: "login" | "register") => {
    const params = new URLSearchParams(location.search);
    params.set("auth", mode);
    navigate({ pathname: location.pathname, search: `?${params.toString()}` });
  };
  const registrationEnabled = registration.data?.enabled === true;

  return (
    <section className="chat-page has-conversation shared-conversation-page" data-shared-readonly="true">
      <header className="shared-conversation-topbar">
        <div className="shared-conversation-heading">
          <h1>{conversation.data?.share.title || t("sharedConversation.titleFallback")}</h1>
        </div>
        {!authenticated ? (
          <div className="shared-auth-actions">
            <button className="primary-btn" type="button" onClick={() => openAuth("login")}>
              {t("login.login")}
            </button>
            {registrationEnabled ? (
              <button className="secondary-btn" type="button" onClick={() => openAuth("register")}>
                {t("login.register")}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="message-area shared-message-area">
        {conversation.isLoading ? <div className="shared-conversation-state">{t("common.loadingEllipsis")}</div> : null}
        {conversation.isError ? (
          <div className="shared-conversation-state error">
            <strong>{t("sharedConversation.unavailable")}</strong>
            <span>{t("sharedConversation.unavailableDesc")}</span>
          </div>
        ) : null}
        {conversation.isSuccess && renderState.items.length === 0 ? (
          <div className="shared-conversation-state">{t("sharedConversation.empty")}</div>
        ) : null}
        {conversation.isSuccess ? (
          <ConversationView
            items={renderState.items}
            mode="shared-readonly"
            sharedToken={token}
            downloadBaseName={conversation.data?.share.title}
          />
        ) : null}
        <div ref={messageEndRef} className="message-scroll-anchor" aria-hidden="true" />
      </div>
      <ScrollJumpButton
        className="page-scroll-jump-btn"
        scrollJump={scrollJump}
        onClick={jumpToLoadingOrScrollEdge}
        hidden={!conversation.isSuccess || renderState.items.length === 0}
      />
    </section>
  );
}
