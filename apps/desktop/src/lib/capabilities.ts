/**
 * Capability registry (see CONTEXT.md): the per-Target support matrix and the
 * two declared forms of failing loudly — refusing the operation with a typed
 * CapabilityError, or completing with an explicit warning where partial
 * results are meaningful (post-create hooks).
 *
 * Adapters and UI gating both consult this module; it is the one answer to
 * "what does this Target refuse to do?".
 */

import { getPlatform, type Platform } from "./platform";

export type Capability =
  | "watch"
  | "team-libraries"
  | "plugins"
  | "undo"
  | "hooks"
  | "self-update";

const MESSAGES: Record<Capability, string> = {
  watch:
    "Watch mode is not supported in the web browser. Please use the desktop app.",
  "team-libraries":
    "Team libraries are not supported in the web browser. Please use the desktop app.",
  plugins:
    "Plugins are not supported in the web browser. Please use the desktop app.",
  undo: "Undo is not supported in the web browser. Please use the desktop app.",
  hooks: "Post-create hooks are not supported in web mode",
  "self-update": "Updates are only available in the desktop app",
};

const SUPPORT: Record<Platform, Record<Capability, boolean>> = {
  tauri: {
    watch: true,
    "team-libraries": true,
    plugins: true,
    undo: true,
    hooks: true,
    "self-update": true,
  },
  web: {
    watch: false,
    "team-libraries": false,
    plugins: false,
    undo: false,
    hooks: false,
    "self-update": false,
  },
};

export class CapabilityError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super(MESSAGES[capability]);
    this.name = "CapabilityError";
    this.capability = capability;
  }
}

/** Does the active Target support this Capability? */
export const supports = (capability: Capability): boolean =>
  SUPPORT[getPlatform()][capability];

/** Refusal form: throw a typed CapabilityError when the Capability is missing. */
export const requireCapability = (capability: Capability): void => {
  if (!supports(capability)) {
    throw new CapabilityError(capability);
  }
};

/** The user-facing refusal message for a Capability. */
export const capabilityMessage = (capability: Capability): string =>
  MESSAGES[capability];

/** Degrade form: a warning log entry for a skipped Capability. */
export const capabilityWarning = (
  capability: Capability,
  details?: string
): { log_type: "warning"; message: string; details?: string } => ({
  log_type: "warning",
  message: MESSAGES[capability],
  details,
});
