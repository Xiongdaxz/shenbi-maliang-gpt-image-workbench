import { Cable, Check, Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { DEFAULT_LOGO_URL } from "../lib/branding";
import { copyTextToClipboard } from "../lib/clipboard";
import { useToast } from "../ui";

type InstallKind = "install";

export function AiClientInstallDialog({
  logoUrl = DEFAULT_LOGO_URL,
  open,
  onClose
}: {
  logoUrl?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [copiedKind, setCopiedKind] = useState<InstallKind | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const publicBaseUrl = window.location.origin.replace(/\/+$/, "");
  const installLinks = useQuery({
    queryKey: ["ai-client-install-links", publicBaseUrl],
    queryFn: api.aiClientInstallLinks,
    enabled: open,
    staleTime: 60_000
  });
  const installOption = installLinks.data?.install ?? null;
  const installAddressText = installOption?.instruction
    ?? t(installLinks.isError ? "aiClientInstall.addressUnavailable" : "aiClientInstall.loadingAddress");

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  useEffect(() => () => {
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
  }, []);

  if (!open) return null;

  const copyInstallInstruction = async (kind: InstallKind) => {
    if (!installOption) {
      showToast(t("aiClientInstall.addressUnavailable"), "error");
      return;
    }
    const copied = await copyTextToClipboard(installOption.instruction);
    if (!copied) {
      showToast(t("aiClientInstall.copyFailed"), "error");
      return;
    }
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    setCopiedKind(kind);
    showToast(t("aiClientInstall.copySuccess"), "success");
    copiedTimerRef.current = window.setTimeout(() => setCopiedKind(null), 1800);
  };

  const actionLabel = (kind: InstallKind) => copiedKind === kind
    ? t("aiClientInstall.copied")
    : t("aiClientInstall.copyForAi");

  return (
    <div className="modal-backdrop modal-backdrop-top ai-client-install-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ai-client-install-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-client-install-title">
        <header className="ai-client-install-header">
          <h3 id="ai-client-install-title">
            <span className="ai-client-install-title-icon" aria-hidden="true"><Cable size={19} /></span>
            <span>{t("aiClientInstall.title")}</span>
          </h3>
          <button ref={closeButtonRef} className="ai-client-install-close" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>

        <div className="ai-client-install-list">
          <article className="ai-client-install-card is-install">
            <span className="ai-client-install-icon" aria-hidden="true"><img src={logoUrl} alt="" /></span>
            <div className="ai-client-install-card-copy">
              <h4>{t("aiClientInstall.installTitle")}</h4>
              <p className={installLinks.isError ? "is-error" : undefined} title={installAddressText}>{installAddressText}</p>
            </div>
          </article>
        </div>

        <div className="ai-client-install-actions">
          <button type="button" disabled={!installOption} onClick={() => void copyInstallInstruction("install")}>
            {copiedKind === "install" ? <Check size={16} /> : <Copy size={16} />}
            {actionLabel("install")}
          </button>
          {installOption ? (
            <a href={installOption.href} target="_blank" rel="noreferrer">
              {t("aiClientInstall.viewPage")}
              <ExternalLink size={15} />
            </a>
          ) : (
            <button
              className="is-secondary"
              type="button"
              disabled={installLinks.isFetching}
              onClick={() => void installLinks.refetch()}
            >
              <RefreshCw size={15} />
              {installLinks.isFetching ? t("common.loading") : t("aiClientInstall.retry")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
