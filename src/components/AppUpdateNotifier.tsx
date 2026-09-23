import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText, Sparkles, X } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_PULL_DURATION_MS,
  APP_UPDATE_RETRACT_DURATION_MS,
  consumeCompletedAppUpdate,
  markAppUpdateRefreshPending,
  shouldPresentAppUpdate,
  type AppUpdateReminderStage
} from "../lib/appUpdateReminder";
import { APP_VERSION } from "../lib/appVersion";
import { cx } from "../lib/cx";
import { publicAssetPath } from "../lib/publicAssets";
import { displayVersion } from "../lib/semver";
import type { ChangelogEntry } from "../types";
import { ModalPortal, useToast } from "../ui";
import { MarkdownView } from "./MarkdownView";

const MASCOT_SPRITE_URL = publicAssetPath("image/app-update/maliang-update-sprite.webp");
const MASCOT_IDLE_FRAME_URL = publicAssetPath("image/app-update/maliang-update-idle-01.webp");
const BRUSH_LOGO_URL = publicAssetPath("image/logo-small.webp");

function UpdateChangelogDialog({
  open,
  clientVersion,
  serverVersion,
  entries,
  hasMore,
  onClose,
  onRefresh
}: {
  open: boolean;
  clientVersion: string;
  serverVersion: string;
  entries: ChangelogEntry[];
  hasMore: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])"
    ) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <ModalPortal>
      <div
        className="app-update-dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          ref={dialogRef}
          className="app-update-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={trapFocus}
        >
          <header className="app-update-dialog-hero">
            <div>
              <span className="app-update-eyebrow">
                <img className="app-update-title-brush" src={BRUSH_LOGO_URL} alt="" aria-hidden="true" />
                {t("appUpdate.dialogEyebrow")}
              </span>
              <h2 id={titleId}>{t("appUpdate.dialogTitle")}</h2>
              <p>
                <span dir="ltr">{displayVersion(clientVersion)}</span>
                <span aria-hidden="true"> → </span>
                <span dir="ltr">{displayVersion(serverVersion)}</span>
              </p>
            </div>
            <button ref={closeButtonRef} type="button" className="app-update-dialog-close" onClick={onClose} aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </header>

          <div className="app-update-dialog-content">
            {entries.length > 0 ? entries.map((entry) => (
              <article className="app-update-log-entry" key={entry.id}>
                <header>
                  <strong dir="ltr">{displayVersion(entry.version)}</strong>
                  <time>{entry.date || "-"}</time>
                </header>
                <MarkdownView markdown={entry.content} />
              </article>
            )) : (
              <div className="app-update-log-empty">
                <ScrollText size={24} />
                <strong>{t("appUpdate.changelogPending")}</strong>
                <span>{t("appUpdate.changelogPendingHint")}</span>
              </div>
            )}
            {hasMore ? <p className="app-update-log-more">{t("appUpdate.moreInSettings")}</p> : null}
          </div>

          <footer className="app-update-dialog-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>{t("appUpdate.later")}</button>
            <button type="button" className="primary-btn" onClick={onRefresh}>
              <RefreshCw size={16} />
              {t("appUpdate.refreshAction")}
            </button>
          </footer>
        </section>
      </div>
    </ModalPortal>
  );
}

export function AppUpdateNotifier() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [stage, setStage] = useState<AppUpdateReminderStage>("hidden");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [celebratingVersion, setCelebratingVersion] = useState("");
  const update = useQuery({
    queryKey: ["app-update", APP_VERSION],
    queryFn: ({ signal }) => api.appUpdate(APP_VERSION, { signal }),
    staleTime: 30_000,
    refetchInterval: APP_UPDATE_CHECK_INTERVAL_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always"
  });

  const serverVersion = update.data?.serverVersion ?? "";
  const mascotSpriteUrl = serverVersion
    ? `${MASCOT_SPRITE_URL}?v=${encodeURIComponent(serverVersion)}`
    : MASCOT_SPRITE_URL;
  const mascotIdleFrameUrl = serverVersion
    ? `${MASCOT_IDLE_FRAME_URL}?v=${encodeURIComponent(serverVersion)}`
    : MASCOT_IDLE_FRAME_URL;
  const entries = update.data?.entries ?? [];
  const releaseDate = entries[0]?.date ?? "";
  const updateCount = entries.length;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const completedVersion = consumeCompletedAppUpdate(window.sessionStorage, APP_VERSION);
    if (!completedVersion) return;
    setCelebratingVersion(completedVersion);
    showToast(t("appUpdate.updatedToast", { version: displayVersion(completedVersion) }));
    const timer = window.setTimeout(() => setCelebratingVersion(""), 1600);
    return () => window.clearTimeout(timer);
  }, [showToast, t]);

  useEffect(() => {
    if (typeof window === "undefined" || !update.data) return;
    const shouldPresent = shouldPresentAppUpdate(
      update.data.updateAvailable,
      update.data.serverVersion
    );
    if (!shouldPresent) {
      setStage("hidden");
      return;
    }
    let cancelled = false;
    const revealMascot = () => {
      if (cancelled) return;
      setStage((current) => current === "hidden" ? "mascot" : current);
    };
    const images = [mascotSpriteUrl, mascotIdleFrameUrl].map((url) => {
      const image = new Image();
      image.src = url;
      return image;
    });
    let remaining = images.filter((image) => !image.complete).length;
    if (remaining === 0) revealMascot();
    const settleImage = () => {
      remaining -= 1;
      if (remaining <= 0) revealMascot();
    };
    images.forEach((image) => {
      if (image.complete) return;
      image.addEventListener("load", settleImage, { once: true });
      image.addEventListener("error", settleImage, { once: true });
    });
    return () => {
      cancelled = true;
      images.forEach((image) => {
        image.removeEventListener("load", settleImage);
        image.removeEventListener("error", settleImage);
      });
    };
  }, [mascotIdleFrameUrl, mascotSpriteUrl, update.data?.serverVersion, update.data?.updateAvailable]);

  useEffect(() => {
    if (stage !== "pulling" && stage !== "retracting") return;
    const timer = window.setTimeout(
      () => setStage(stage === "pulling" ? "card" : "mascot"),
      stage === "pulling" ? APP_UPDATE_PULL_DURATION_MS : APP_UPDATE_RETRACT_DURATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [stage]);

  const visible = stage !== "hidden" && Boolean(update.data?.updateAvailable && serverVersion);
  const summary = useMemo(() => {
    if (updateCount === 0) return t("appUpdate.summaryFallback");
    if (update.data?.hasMore) return t("appUpdate.summaryMore", { count: updateCount });
    return t("appUpdate.summary", { count: updateCount });
  }, [t, update.data?.hasMore, updateCount]);

  const revealCard = useCallback(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setStage(reduceMotion ? "card" : "pulling");
  }, []);
  const collapse = useCallback(() => {
    setDialogOpen(false);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setStage(reduceMotion ? "mascot" : "retracting");
  }, []);
  const refresh = useCallback(() => {
    markAppUpdateRefreshPending(window.sessionStorage, serverVersion);
    window.location.reload();
  }, [serverVersion]);

  if (!visible && !celebratingVersion) return null;

  return (
    <>
      {celebratingVersion ? (
        <div className="app-update-success-bloom" aria-hidden="true">
          <span />
          <span />
          <span />
          <Sparkles size={22} />
        </div>
      ) : null}
      {visible ? <aside className={cx("app-update-reminder", `is-${stage}`)} aria-label={t("appUpdate.regionLabel")} aria-live="polite">
        <section className="app-update-card" aria-hidden={stage !== "card"}>
          <button className="app-update-card-close" type="button" tabIndex={stage === "card" ? 0 : -1} onClick={collapse} aria-label={t("appUpdate.collapse")}>
            <X size={15} />
          </button>
          <span className="app-update-eyebrow">
            <img className="app-update-title-brush" src={BRUSH_LOGO_URL} alt="" aria-hidden="true" />
            {t("appUpdate.cardEyebrow")}
          </span>
          <h3>{t("appUpdate.cardTitle")}</h3>
          <p className="app-update-version-line" dir="ltr">
            {displayVersion(APP_VERSION)} <span>→</span> {displayVersion(serverVersion)}
          </p>
          <p className="app-update-summary">{summary}</p>
          {releaseDate ? <time className="app-update-date">{releaseDate}</time> : null}
          <div className="app-update-card-actions">
            <button type="button" className="secondary-btn" tabIndex={stage === "card" ? 0 : -1} onClick={() => setDialogOpen(true)}>{t("appUpdate.viewChanges")}</button>
            <button type="button" className="primary-btn" tabIndex={stage === "card" ? 0 : -1} onClick={refresh}>
              <RefreshCw size={15} />
              {t("appUpdate.refreshShort")}
            </button>
          </div>
        </section>

        <button
          className="app-update-mascot-trigger"
          type="button"
          onClick={stage === "mascot" ? revealCard : stage === "card" ? () => setDialogOpen(true) : undefined}
          disabled={stage === "pulling" || stage === "retracting"}
          aria-label={stage === "mascot" ? t("appUpdate.mascotAction") : t("appUpdate.viewChanges")}
          aria-expanded={stage !== "mascot"}
        >
          <span className="app-update-mascot-glow" aria-hidden="true" />
          <span className="app-update-mascot-idle" style={{ backgroundImage: `url(${mascotIdleFrameUrl})` }} aria-hidden="true" />
          <span className="app-update-mascot-sprite" style={{ backgroundImage: `url(${mascotSpriteUrl})` }} aria-hidden="true" />
          {stage === "mascot" ? <span className="app-update-mascot-bubble">{t("appUpdate.mascotBubble")}</span> : null}
        </button>
      </aside> : null}

      <UpdateChangelogDialog
        open={visible && dialogOpen}
        clientVersion={APP_VERSION}
        serverVersion={serverVersion}
        entries={entries}
        hasMore={Boolean(update.data?.hasMore)}
        onClose={collapse}
        onRefresh={refresh}
      />
    </>
  );
}
