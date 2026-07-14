import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configApi } from "../../api";
import type { GlobalSwitchType } from "../../types";
import { useToast } from "../../ui";
import { useConfigCopy } from "../configCopy";

export function GlobalSwitchRow({
  type,
  title,
  desc,
  defaultEnabled,
  invalidateQueryKeys
}: {
  type: GlobalSwitchType;
  title: string;
  desc: string;
  defaultEnabled: boolean;
  invalidateQueryKeys?: string[];
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const switches = useQuery({ queryKey: ["config-global-switches"], queryFn: configApi.globalSwitches });
  const setting = switches.data?.switches.find((item) => item.type === type);
  const enabled = setting?.enabled ?? defaultEnabled;
  const save = useMutation({
    mutationFn: (nextEnabled: boolean) => configApi.saveGlobalSwitch(type, nextEnabled),
    onSuccess: (data) => {
      showToast(data.switch.enabled ? `${title}已开启` : `${title}已关闭`);
      queryClient.invalidateQueries({ queryKey: ["config-global-switches"] });
      for (const key of invalidateQueryKeys ?? []) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "开关保存失败", "error")
  });
  return (
    <div className="switch-row global-switch-row">
      <div className="switch-row-copy">
        <span>{title}</span>
        <small>{desc}</small>
      </div>
      <SwitchControl
        checked={enabled}
        disabled={switches.isLoading || save.isPending}
        label={enabled ? "已开启" : "已关闭"}
        onChange={(nextEnabled) => save.mutate(nextEnabled)}
      />
    </div>
  );
}

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
