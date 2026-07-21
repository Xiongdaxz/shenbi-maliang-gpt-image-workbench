import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, RefreshCw, Trophy, X } from "lucide-react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { publicAssetPath } from "../lib/publicAssets";
import type { InspirationContributor } from "../types";
import { ModalPortal } from "../ui";

type PodiumRank = 1 | 2 | 3;

const PODIUM_RANKS = [1, 2, 3] as const satisfies readonly PodiumRank[];
const PODIUM_ART: Record<PodiumRank, string> = {
  1: publicAssetPath("/image/leaderboard/podium-gold.webp?v=2"),
  2: publicAssetPath("/image/leaderboard/podium-silver.webp?v=2"),
  3: publicAssetPath("/image/leaderboard/podium-bronze.webp?v=2")
};
const LEADERBOARD_HEADING_ART = publicAssetPath("/image/leaderboard/heading-maliang.webp?v=1");

function ContributorAvatar({ contributor, className = "" }: { contributor: InspirationContributor; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = Array.from(contributor.username.trim() || "U")[0]?.toLocaleUpperCase() ?? "U";

  useEffect(() => {
    setImageFailed(false);
  }, [contributor.avatarUrl]);

  return (
    <span className={`inspiration-leaderboard-avatar ${className}`.trim()} aria-hidden="true">
      {contributor.avatarUrl && !imageFailed ? (
        <img src={contributor.avatarUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}

function PodiumCard({ contributor, rank }: { contributor: InspirationContributor; rank: PodiumRank }) {
  const { t, formatNumber } = useI18n();
  return (
    <article className={`inspiration-leaderboard-podium-card rank-${rank}`} role="listitem">
      <img
        className="inspiration-leaderboard-podium-art"
        src={PODIUM_ART[rank]}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
      />
      <span className="inspiration-leaderboard-rank-badge" aria-label={t("inspirationLeaderboard.rank", { rank })}>
        {rank === 1 ? <Crown size={15} strokeWidth={2.2} /> : <span>{rank}</span>}
      </span>
      <ContributorAvatar contributor={contributor} className="is-podium" />
      <strong className="inspiration-leaderboard-name" title={contributor.username}>
        {contributor.username}
      </strong>
      <span className="inspiration-leaderboard-podium-count">
        <strong>{formatNumber(contributor.contributionCount)}</strong>
        <small>{t("inspirationLeaderboard.unit")}</small>
      </span>
    </article>
  );
}

function LeaderboardSkeleton({ label }: { label: string }) {
  return (
    <div className="inspiration-leaderboard-content inspiration-leaderboard-skeleton" role="status" aria-label={label}>
      <div className="inspiration-leaderboard-podium" aria-hidden="true">
        {PODIUM_RANKS.map((rank) => (
          <article className={`inspiration-leaderboard-podium-card inspiration-leaderboard-skeleton-podium-card rank-${rank}`} key={rank}>
            <span className="inspiration-leaderboard-rank-badge inspiration-leaderboard-skeleton-shape" />
            <span className="inspiration-leaderboard-avatar is-podium inspiration-leaderboard-skeleton-shape" />
            <span className="inspiration-leaderboard-name inspiration-leaderboard-skeleton-shape" />
            <span className="inspiration-leaderboard-podium-count">
              <span className="inspiration-leaderboard-skeleton-shape" />
            </span>
          </article>
        ))}
      </div>
      <div className="inspiration-leaderboard-list" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <article className="inspiration-leaderboard-row inspiration-leaderboard-skeleton-row" key={item}>
            <span className="inspiration-leaderboard-row-rank">
              <span className="inspiration-leaderboard-skeleton-shape" />
            </span>
            <span className="inspiration-leaderboard-avatar inspiration-leaderboard-skeleton-shape" />
            <span className="inspiration-leaderboard-name inspiration-leaderboard-skeleton-shape" />
            <span className="inspiration-leaderboard-row-count">
              <span className="inspiration-leaderboard-skeleton-shape" />
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}

export function InspirationLeaderboardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, formatNumber } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const contributorsQuery = useQuery({
    queryKey: ["case-contributors"],
    queryFn: () => api.caseContributors(),
    enabled: open
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const contributors = contributorsQuery.data?.contributors ?? [];
  const podium = contributors.slice(0, 3);
  const remaining = contributors.slice(3, 6);

  return (
    <ModalPortal>
      <div
        className="modal-backdrop inspiration-leaderboard-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          className="inspiration-leaderboard-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <header className="inspiration-leaderboard-header">
            <div className="inspiration-leaderboard-heading-icon" aria-hidden="true">
              <img src={LEADERBOARD_HEADING_ART} alt="" decoding="async" draggable={false} />
            </div>
            <div>
              <h3 id={titleId}>{t("inspirationLeaderboard.title")}</h3>
              <p id={descriptionId}>{t("inspirationLeaderboard.desc")}</p>
            </div>
            <button
              ref={closeButtonRef}
              className="icon-btn inspiration-leaderboard-close"
              type="button"
              onClick={onClose}
              aria-label={t("inspirationLeaderboard.close")}
            >
              <X size={18} />
            </button>
          </header>

          {contributorsQuery.isLoading ? (
            <LeaderboardSkeleton label={t("inspirationLeaderboard.loading")} />
          ) : contributorsQuery.isError ? (
            <div className="inspiration-leaderboard-state" role="alert">
              <Trophy size={30} aria-hidden="true" />
              <strong>{t("inspirationLeaderboard.loadFailed")}</strong>
              <button className="secondary-btn" type="button" onClick={() => contributorsQuery.refetch()}>
                <RefreshCw size={15} />
                {t("inspirationLeaderboard.retry")}
              </button>
            </div>
          ) : contributors.length === 0 ? (
            <div className="inspiration-leaderboard-state">
              <Trophy size={30} aria-hidden="true" />
              <strong>{t("inspirationLeaderboard.empty")}</strong>
              <span>{t("inspirationLeaderboard.emptyDesc")}</span>
            </div>
          ) : (
            <div className="inspiration-leaderboard-content">
              <div className="inspiration-leaderboard-podium" role="list" aria-label={t("inspirationLeaderboard.topThree")}>
                {PODIUM_RANKS.map((rank) => {
                  const contributor = podium[rank - 1];
                  return contributor ? <PodiumCard key={contributor.userId} contributor={contributor} rank={rank} /> : null;
                })}
              </div>
              {remaining.length > 0 ? (
                <div className="inspiration-leaderboard-list" role="list" aria-label={t("inspirationLeaderboard.otherRanks")}>
                  {remaining.map((contributor, index) => {
                    const rank = index + 4;
                    return (
                      <article className="inspiration-leaderboard-row" key={contributor.userId} role="listitem">
                        <span className="inspiration-leaderboard-row-rank" aria-label={t("inspirationLeaderboard.rank", { rank })}>
                          {rank}
                        </span>
                        <ContributorAvatar contributor={contributor} />
                        <strong className="inspiration-leaderboard-name" title={contributor.username}>
                          {contributor.username}
                        </strong>
                        <span className="inspiration-leaderboard-row-count">
                          <strong>{formatNumber(contributor.contributionCount)}</strong>
                          <small>{t("inspirationLeaderboard.unit")}</small>
                        </span>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </ModalPortal>
  );
}
