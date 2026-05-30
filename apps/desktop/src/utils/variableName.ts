/**
 * Re-export the variable-name module from the shared package so existing
 * `../utils/variableName` imports in this app continue to resolve. The
 * canonical home is `@structure-creator/shared` (ADR-0001).
 */
export {
  asVariableName,
  toToken,
  toTokenKeys,
  type VariableName,
} from "@structure-creator/shared";
