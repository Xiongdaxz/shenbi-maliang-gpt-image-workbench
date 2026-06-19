export function SwitchControl({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={checked ? "switch-control checked" : "switch-control"}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  );
}

export function ConfigHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <header className="page-header compact">
      <h1>{title}</h1>
      <p>{desc}</p>
    </header>
  );
}
