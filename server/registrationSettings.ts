import { globalSwitch, globalSwitchEnabled, saveGlobalSwitch } from "./globalSwitches";

export const REGISTRATION_DISABLED_MESSAGE = "当前暂未开放注册，请联系管理员";

export function registrationSettings() {
  const setting = globalSwitch("self_registration");
  return {
    enabled: setting.enabled,
    updatedAt: setting.updatedAt
  };
}

export function saveRegistrationSettings(input: Record<string, unknown>) {
  const setting = saveGlobalSwitch("self_registration", Boolean(input.enabled));
  return {
    enabled: setting.enabled,
    updatedAt: setting.updatedAt
  };
}

export function selfRegistrationEnabled() {
  return globalSwitchEnabled("self_registration");
}
