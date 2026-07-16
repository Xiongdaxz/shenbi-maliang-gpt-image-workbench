import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Info, X } from "lucide-react";
import { useI18n } from "./i18n";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
};

type CustomSelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  menuPlacement?: "top" | "bottom";
  menuWidth?: number;
  menuAutoWidth?: boolean;
  menuAutoWidthPadding?: number;
};

export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  menuClassName,
  menuPlacement = "bottom",
  menuWidth,
  menuAutoWidth = false,
  menuAutoWidthPadding = 0
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const labelId = useId();
  const { t } = useI18n();

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const minWidth = Math.max(rect.width, Number(menuWidth ?? 0), 1);
      const maxWidth = Math.max(window.innerWidth - viewportPadding * 2, 1);
      let contentWidth = 0;
      if (menuAutoWidth && menuRef.current) {
        const menu = menuRef.current;
        const previousWidth = menu.style.width;
        const computedStyle = window.getComputedStyle(menu);
        const horizontalPadding = Number.parseFloat(computedStyle.paddingLeft) + Number.parseFloat(computedStyle.paddingRight);
        menu.style.width = "0px";
        contentWidth = Math.ceil(Math.max(0, menu.scrollWidth - horizontalPadding)) + menuAutoWidthPadding;
        menu.style.width = previousWidth;
      }
      const width = Math.min(Math.max(minWidth, contentWidth), maxWidth);
      const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
      setMenuStyle({ top: menuPlacement === "top" ? rect.top - 6 : rect.bottom + 6, left, width });
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const inMenu = target instanceof Element && target.closest(".custom-select-menu");
      if (!wrapRef.current?.contains(target) && !inMenu) setOpen(false);
    }
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuAutoWidth, menuAutoWidthPadding, menuPlacement, menuWidth, open, options]);

  return (
    <div className={`custom-select ${className ?? ""}`} ref={wrapRef}>
      <button
        id={labelId}
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="custom-select-value">
          {selected?.icon ? <span className="custom-select-icon" aria-hidden="true">{selected.icon}</span> : null}
          <span className={!selected ? "custom-select-label placeholder" : "custom-select-label"}>{selected?.label ?? placeholder ?? t("common.selectPlaceholder")}</span>
        </span>
        <ChevronDown size={16} className={open ? "open" : ""} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={`custom-select-menu ${menuPlacement === "top" ? "custom-select-menu-top" : ""} ${menuClassName ?? ""}`}
              role="listbox"
              aria-labelledby={labelId}
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
            >
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    type="button"
                    key={option.value}
                    role="option"
                    aria-selected={active}
                    title={option.label}
                    className={active ? "active" : ""}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="custom-select-option-main">
                      {option.icon ? <span className="custom-select-icon" aria-hidden="true">{option.icon}</span> : null}
                      <span className="custom-select-option-text">
                        <strong>{option.label}</strong>
                        {option.description ? <small>{option.description}</small> : null}
                      </span>
                    </span>
                    {active ? <Check size={16} /> : null}
                  </button>
                );
              })}
              {options.length === 0 ? <div className="custom-select-empty">{t("common.selectPlaceholder")}</div> : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmationText?: string;
  confirmationLabel?: string;
  confirmationDelaySeconds?: number;
  confirmationDelayLabel?: (seconds: number) => string;
  destructive?: boolean;
  backdropClassName?: string;
  className?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  confirmationText,
  confirmationLabel,
  confirmationDelaySeconds = 0,
  confirmationDelayLabel,
  destructive,
  backdropClassName,
  className,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [confirmationValue, setConfirmationValue] = useState("");
  const [confirmationDeadline, setConfirmationDeadline] = useState<number | null>(null);
  const [confirmationRemainingMs, setConfirmationRemainingMs] = useState(0);
  const onConfirmRef = useRef(onConfirm);
  const { t } = useI18n();
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);
  useEffect(() => {
    if (open) {
      setConfirmationValue("");
      setConfirmationDeadline(null);
      setConfirmationRemainingMs(0);
    }
  }, [open, confirmationText, title]);
  useEffect(() => {
    if (!open || confirmationDeadline === null) return;
    let completed = false;
    const updateCountdown = () => {
      const remainingMs = Math.max(0, confirmationDeadline - Date.now());
      setConfirmationRemainingMs(remainingMs);
    };
    const finishCountdown = () => {
      if (completed) return;
      completed = true;
      setConfirmationRemainingMs(0);
      setConfirmationDeadline(null);
      onConfirmRef.current();
    };
    const timer = window.setInterval(updateCountdown, 1000);
    const completionTimer = window.setTimeout(finishCountdown, Math.max(0, confirmationDeadline - Date.now()));
    updateCountdown();
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(completionTimer);
    };
  }, [confirmationDeadline, open]);
  if (!open) return null;
  const requiresConfirmation = Boolean(confirmationText);
  const confirmationMatched = !requiresConfirmation || confirmationValue.trim() === confirmationText;
  const confirmationDelayMs = Math.max(0, confirmationDelaySeconds) * 1000;
  const confirmationPending = confirmationDeadline !== null;
  const confirmationRemainingSeconds = Math.max(1, Math.ceil(confirmationRemainingMs / 1000));
  const confirmationDelayDisplay = confirmationDelayLabel?.(confirmationRemainingSeconds) ?? `${confirmationRemainingSeconds}s`;
  const handleCancel = () => {
    setConfirmationDeadline(null);
    setConfirmationRemainingMs(0);
    onCancel();
  };
  const handleCountdownCancel = () => {
    setConfirmationDeadline(null);
    setConfirmationRemainingMs(0);
  };
  const handleConfirm = () => {
    if (!confirmationMatched || confirmationPending) return;
    if (confirmationDelayMs <= 0) {
      onConfirm();
      return;
    }
    setConfirmationRemainingMs(confirmationDelayMs);
    setConfirmationDeadline(Date.now() + confirmationDelayMs);
  };
  return (
    <ModalPortal>
      <div className={["modal-backdrop", backdropClassName].filter(Boolean).join(" ")}>
        <section className={["case-modal compact-modal action-modal", className].filter(Boolean).join(" ")}>
          <header>
            <h3>{title}</h3>
            <button onClick={handleCancel} aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </header>
          {typeof description === "string" ? <p>{description}</p> : <div className="action-modal-description">{description}</div>}
          {requiresConfirmation ? (
            <label className="confirm-phrase-field">
              {confirmationLabel ?? `${t("common.confirm")} ${confirmationText}`}
              <input
                value={confirmationValue}
                onChange={(event) => setConfirmationValue(event.target.value)}
                placeholder={confirmationText}
                disabled={confirmationPending}
                autoFocus
              />
            </label>
          ) : null}
          <div className={["row-actions", confirmationPending ? "confirm-countdown-actions" : ""].filter(Boolean).join(" ")}>
            {confirmationPending ? (
              <button
                className="confirm-countdown-progress"
                type="button"
                onClick={handleCountdownCancel}
                autoFocus
              >
                <span
                  className="confirm-countdown-progress-fill"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={confirmationDelayMs}
                  aria-valuenow={confirmationDelayMs - confirmationRemainingMs}
                  style={{ animationDuration: `${confirmationDelayMs}ms` }}
                >
                  <span className="confirm-countdown-progress-fill-label" aria-hidden="true">
                    {confirmationDelayDisplay}
                  </span>
                </span>
                <span className="confirm-countdown-progress-label" aria-live="polite">
                  {confirmationDelayDisplay}
                </span>
              </button>
            ) : (
              <>
                <button className="secondary-btn" onClick={handleCancel}>
                  {cancelText ?? t("common.cancel")}
                </button>
                <button className={destructive ? "danger-btn" : "primary-btn"} onClick={handleConfirm} disabled={!confirmationMatched}>
                  {confirmText ?? t("common.confirm")}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

type PromptDialogProps = {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  description?: string;
  type?: "text" | "password";
  confirmText?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export function PromptDialog({
  open,
  title,
  label,
  defaultValue = "",
  description,
  type = "text",
  confirmText,
  onSubmit,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const { t } = useI18n();

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [defaultValue, open]);

  if (!open) return null;
  return (
    <ModalPortal>
      <div className="modal-backdrop">
        <section className="case-modal compact-modal action-modal">
          <header>
            <h3>{title}</h3>
            <button onClick={onCancel} aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </header>
          {description ? <p>{description}</p> : null}
          <label>
            {label}
            <input value={value} type={type} onChange={(event) => setValue(event.target.value)} autoFocus />
          </label>
          <div className="row-actions">
            <button className="secondary-btn" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button className="primary-btn" disabled={!value.trim()} onClick={() => onSubmit(value)}>
              {confirmText ?? t("common.confirm")}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

type ToastItem = {
  id: number;
  message: string;
  tone: "success" | "info" | "error";
};

type ToastContextValue = {
  showToast: (message: string, tone?: ToastItem["tone"]) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  function showToast(message: string, tone: ToastItem["tone"] = "success") {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((value) => [...value, { id, message, tone }].slice(-3));
    window.setTimeout(() => {
      setItems((value) => value.filter((item) => item.id !== id));
    }, 2600);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div key={item.id} className={`toast-card ${item.tone}`}>
            {item.tone === "success" ? <Check size={17} /> : <Info size={17} />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: () => undefined
    };
  }
  return context;
}
