import { useConfigCopy } from "../configCopy";

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
  const configCopy = useConfigCopy();

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
      <span className="switch-label">{configCopy(label)}</span>
    </button>
  );
}

export function ConfigHeader({ title, desc }: { title: string; desc: string }) {
  const configCopy = useConfigCopy();

  return (
    <header className="page-header compact">
      <h1>{configCopy(title)}</h1>
      <p>{configCopy(desc)}</p>
    </header>
  );
}
