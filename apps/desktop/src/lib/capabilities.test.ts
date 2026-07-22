import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./platform", () => ({
  getPlatform: vi.fn(),
}));

import { getPlatform } from "./platform";
import {
  supports,
  requireCapability,
  capabilityMessage,
  capabilityWarning,
  CapabilityError,
  type Capability,
} from "./capabilities";

const mockGetPlatform = vi.mocked(getPlatform);

const ALL: Capability[] = [
  "watch",
  "team-libraries",
  "plugins",
  "undo",
  "hooks",
  "self-update",
];

describe("capability matrix", () => {
  it("the native Target supports every Capability", () => {
    mockGetPlatform.mockReturnValue("tauri");
    for (const cap of ALL) {
      expect(supports(cap), cap).toBe(true);
    }
  });

  it("the web Target refuses exactly these Capabilities", () => {
    mockGetPlatform.mockReturnValue("web");
    const refused = ALL.filter((cap) => !supports(cap));
    expect(refused).toEqual(ALL);
  });
});

describe("requireCapability", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("web");
  });

  it("throws a CapabilityError naming the Capability", () => {
    try {
      requireCapability("team-libraries");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError);
      expect((e as CapabilityError).capability).toBe("team-libraries");
      expect((e as CapabilityError).name).toBe("CapabilityError");
      expect((e as CapabilityError).message).toContain("Team libraries");
    }
  });

  it("passes silently on a supporting Target", () => {
    mockGetPlatform.mockReturnValue("tauri");
    expect(() => requireCapability("team-libraries")).not.toThrow();
  });
});

describe("messages and warnings", () => {
  it("every Capability has a user-facing message", () => {
    for (const cap of ALL) {
      expect(capabilityMessage(cap)).toBeTruthy();
    }
  });

  it("capabilityWarning shapes a backend-style warning log", () => {
    expect(capabilityWarning("hooks", "2 hook(s) skipped")).toEqual({
      log_type: "warning",
      message: "Post-create hooks are not supported in web mode",
      details: "2 hook(s) skipped",
    });
  });
});
