/**
 * Plugin System Public API
 *
 * Re-exports plugin runtime functionality for use by other modules.
 */

export {
  PluginRuntime,
  getPluginRuntime,
  resetPluginRuntime,
  processTreeContent,
  type ProcessorContext,
} from "./runtime";
