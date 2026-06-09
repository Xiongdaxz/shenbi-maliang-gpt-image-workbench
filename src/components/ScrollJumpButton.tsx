import { ArrowDown, ArrowUp } from "lucide-react";
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
  const label = loading ? "查看正在加载的回复" : scrollJump.target === "top" ? "一键到顶" : "一键到底";

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
