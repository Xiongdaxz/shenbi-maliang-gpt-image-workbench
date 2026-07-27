export type LanguageModelSelection = {
  providerId: string;
  model: string;
};

function languageModelSelectionKey(selection: LanguageModelSelection) {
  return JSON.stringify([selection.providerId.trim(), selection.model.trim()]);
}

export function recoverableLanguageModelAssignmentsPayload<TAssignment extends LanguageModelSelection>(
  globalDefault: LanguageModelSelection,
  resolvedGlobalDefault: LanguageModelSelection,
  assignments: TAssignment[],
  enabledSelections: LanguageModelSelection[]
) {
  const enabledSelectionKeys = new Set(enabledSelections.map(languageModelSelectionKey));
  const isEnabledSelection = (selection: LanguageModelSelection) => Boolean(
    selection.providerId.trim()
    && selection.model.trim()
    && enabledSelectionKeys.has(languageModelSelectionKey(selection))
  );
  const hasCompleteSelection = (selection: LanguageModelSelection) => Boolean(
    selection.providerId.trim() && selection.model.trim()
  );
  const nextGlobalDefault = hasCompleteSelection(globalDefault)
    ? globalDefault
    : isEnabledSelection(resolvedGlobalDefault)
      ? resolvedGlobalDefault
      : null;
  if (!nextGlobalDefault) return null;
  return {
    globalDefault: {
      providerId: nextGlobalDefault.providerId.trim(),
      model: nextGlobalDefault.model.trim()
    },
    assignments: assignments
      .filter(hasCompleteSelection)
      .map((assignment) => ({
        ...assignment,
        providerId: assignment.providerId.trim(),
        model: assignment.model.trim()
      }))
  };
}
