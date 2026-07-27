import { describe, expect, test } from "bun:test";
import { recoverableLanguageModelAssignmentsPayload } from "./languageModelAssignments";

describe("recoverable language model assignment payload", () => {
  const enabledSelections = [
    { providerId: "provider-a", model: "model-a" },
    { providerId: "provider-b", model: "manual-model" }
  ];

  test("keeps enabled global and explicit scene selections", () => {
    expect(recoverableLanguageModelAssignmentsPayload(
      enabledSelections[0],
      enabledSelections[1],
      [
        { usageKey: "prompt.optimize", ...enabledSelections[1] },
        { usageKey: "title.chat", providerId: "", model: "" }
      ],
      enabledSelections
    )).toEqual({
      globalDefault: enabledSelections[0],
      assignments: [{ usageKey: "prompt.optimize", ...enabledSelections[1] }]
    });
  });

  test("preserves invalid global and scene selections until they are explicitly replaced", () => {
    expect(recoverableLanguageModelAssignmentsPayload(
      { providerId: "deleted-provider", model: "deleted-model" },
      enabledSelections[0],
      [
        { usageKey: "prompt.optimize", providerId: "deleted-provider", model: "deleted-model" },
        { usageKey: "title.chat", ...enabledSelections[1] }
      ],
      enabledSelections
    )).toEqual({
      globalDefault: { providerId: "deleted-provider", model: "deleted-model" },
      assignments: [
        { usageKey: "prompt.optimize", providerId: "deleted-provider", model: "deleted-model" },
        { usageKey: "title.chat", ...enabledSelections[1] }
      ]
    });
  });

  test("keeps an invalid global selection even when no fallback is available", () => {
    expect(recoverableLanguageModelAssignmentsPayload(
      { providerId: "deleted-provider", model: "deleted-model" },
      { providerId: "", model: "" },
      [],
      enabledSelections
    )).toEqual({
      globalDefault: { providerId: "deleted-provider", model: "deleted-model" },
      assignments: []
    });
  });
});
