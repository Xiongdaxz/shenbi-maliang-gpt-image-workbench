import { ArrowDown, ArrowUp } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import type { ScrollJumpState } from "../hooks/useScrollJump";

type ScrollJumpButtonProps = {
  className?: string;
  hidden?: boolean;
  loading?: boolean;
  onClick: () => void;
  scrollJump: ScrollJumpState;
};

export function ScrollJumpButton({ className, hidden = false, loading = false, onClick, scrollJump }: ScrollJumpButtonProps) {
  const { t } = useI18n();
  const label = loading
    ? t("scrollJump.loading")
    : scrollJump.target === "top"
      ? t("scrollJump.top")
      : t("scrollJump.bottom");

  return (
    <button
      type="button"
      className={cx(
        "scroll-jump-btn",
        loading && "scroll-jump-loading",
        className,
        (!scrollJump.canScroll || !scrollJump.settled || hidden) && "scroll-jump-hidden"
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {loading ? (
        <span className="scroll-jump-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : scrollJump.target === "top" ? (
        <ArrowUp size={20} />
      ) : (
        <ArrowDown size={20} />
      )}
    </button>
  );
}
