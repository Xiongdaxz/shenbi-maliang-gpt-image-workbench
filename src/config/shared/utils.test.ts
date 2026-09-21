import { describe, expect, test } from "bun:test";
import { emptyProvider } from "./utils";

describe("provider channel defaults", () => {
  test("uses Responses-first automatic routing for new CPA providers without changing other channel defaults", () => {
    expect(emptyProvider("cpa").routeMode).toBe("auto");
    expect(emptyProvider("api").routeMode).toBe("auto");
    expect(emptyProvider("chatgpt_web").routeMode).toBe("images_api");
  });
});
