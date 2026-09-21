import { describe, expect, test } from "bun:test";
import { providerSecretInput } from "./providerConfigInput";

describe("provider config secret input", () => {
  test("preserves stored secrets when fields are omitted or masked", () => {
    expect(providerSecretInput({}, "apiKeyValue", "stored-key")).toBe("stored-key");
    expect(providerSecretInput({ apiKeyValue: "sk-****key" }, "apiKeyValue", "stored-key")).toBe("stored-key");
  });

  test("accepts explicit replacement and clearing", () => {
    expect(providerSecretInput({ apiKeyValue: "new-key" }, "apiKeyValue", "stored-key")).toBe("new-key");
    expect(providerSecretInput({ apiKeyValue: "" }, "apiKeyValue", "stored-key")).toBe("");
  });
});
