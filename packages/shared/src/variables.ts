/**
 * Variable-map completion — the edge step every caller of `expand` runs first
 * (ADR-0004).
 *
 * A Variable map is *complete* when every Built-in Variable has a value and
 * every key is a Variable token (`%NAME%`). Completion is pure: the caller
 * supplies the wall-clock time, so the golden-vector contract can pin it at a
 * fixed instant and `expand` stays deterministic.
 *
 * Input keys are clean Variable names (ADR-0001); this is the web Target's
 * outbound edge, so it tokenizes them on the way out.
 */

import { toTokenKeys } from "./variableName";

/**
 * Complete a Variable map: inject the Built-in Variables, then let
 * user-supplied Variables override them.
 *
 * `%PROJECT_NAME%` is injected only when a project name is supplied; the
 * user's own `%PROJECT_NAME%` still wins over it.
 */
export const completeVariableMap = (
  variables: Record<string, string>,
  projectName: string | undefined,
  now: Date
): Record<string, string> => {
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");

  const completed: Record<string, string> = {
    "%DATE%": `${year}-${month}-${day}`,
    "%YEAR%": year,
    "%MONTH%": month,
    "%DAY%": day,
  };

  if (projectName) {
    completed["%PROJECT_NAME%"] = projectName;
  }

  // User-provided Variables override Built-in Variables.
  for (const [key, value] of Object.entries(toTokenKeys(variables))) {
    completed[key] = value;
  }

  return completed;
};
