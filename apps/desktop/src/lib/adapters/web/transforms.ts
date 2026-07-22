/**
 * Variable transformation and substitution for web mode.
 *
 * The implementation moved to `@structure-creator/shared` (issue #125,
 * ADR-0004) so the pure Plan module can consume it; this shim keeps
 * existing web-adapter import paths working.
 */
export {
  applyTransform,
  extractVariablesFromContent,
  substituteVariables,
  validateVariables,
} from "@structure-creator/shared";
