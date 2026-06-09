import { configDb, getAll, getOne, run } from "./db";
import { now } from "./utils";

export const GLOBAL_SWITCH_TYPES = [
  "self_registration",
  "asset_review",
  "case_review",
  "starter_copy_generation",
  "prompt_safety_review",
  "smtp_service",
  "sms_service",
  "proxy_service",
  "cpa_sync",
  "debug_image_edit_mask"
] as const;

export type GlobalSwitchType = (typeof GLOBAL_SWITCH_TYPES)[number];

type GlobalSwitchRow = {
  type: string;
  enabled: number;
  updated_at: string;
};

export const DEFAULT_GLOBAL_SWITCH_ENABLED: Record<GlobalSwitchType, boolean> = {
  self_registration: true,
  asset_review: true,
  case_review: true,
  starter_copy_generation: true,
  prompt_safety_review: false,
  smtp_service: false,
  sms_service: false,
  proxy_service: false,
  cpa_sync: false,
  debug_image_edit_mask: false
};

function normalizeGlobalSwitchType(value: string): GlobalSwitchType | null {
  return (GLOBAL_SWITCH_TYPES as readonly string[]).includes(value) ? (value as GlobalSwitchType) : null;
}

function publicGlobalSwitch(row: GlobalSwitchRow | null, type: GlobalSwitchType) {
  return {
    type,
    enabled: row ? Boolean(row.enabled) : DEFAULT_GLOBAL_SWITCH_ENABLED[type],
    updatedAt: row?.updated_at ?? ""
  };
}

export function globalSwitchEnabled(type: GlobalSwitchType) {
  const row = getOne<GlobalSwitchRow>(
    configDb,
    "select type, enabled, updated_at from global_switch_settings where type = ? limit 1",
    type
  );
  return publicGlobalSwitch(row, type).enabled;
}

export function globalSwitch(type: GlobalSwitchType) {
  const row = getOne<GlobalSwitchRow>(
    configDb,
    "select type, enabled, updated_at from global_switch_settings where type = ? limit 1",
    type
  );
  return publicGlobalSwitch(row, type);
}

export function globalSwitches() {
  const rows = getAll<GlobalSwitchRow>(
    configDb,
    "select type, enabled, updated_at from global_switch_settings"
  );
  const rowByType = new Map(rows.map((row) => [row.type, row]));
  return GLOBAL_SWITCH_TYPES.map((type) => publicGlobalSwitch(rowByType.get(type) ?? null, type));
}

export function saveGlobalSwitch(type: string, enabled: boolean) {
  const normalizedType = normalizeGlobalSwitchType(type);
  if (!normalizedType) throw new Error("未知全局开关");
  const timestamp = now();
  run(
    configDb,
    `insert into global_switch_settings (type, enabled, updated_at)
     values (?, ?, ?)
     on conflict(type) do update set
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    normalizedType,
    enabled ? 1 : 0,
    timestamp
  );
  return { type: normalizedType, enabled, updatedAt: timestamp };
}
