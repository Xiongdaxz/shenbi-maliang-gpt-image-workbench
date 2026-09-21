export function providerSecretInput(
  raw: Record<string, unknown>,
  key: string,
  existingValue: string | null | undefined
) {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return existingValue ?? "";
  const incoming = String(raw[key] ?? "");
  return incoming.includes("****") ? existingValue ?? "" : incoming;
}
