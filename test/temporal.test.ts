import { describe, it, expect } from "vitest";
import {
  getSessionPhase,
  getFleetEpoch,
  getAgentAge,
  getRelationshipAge,
  stamp,
  timeRangeToFilter,
  FLEET_EPOCHS,
  AGENT_START_DATES,
} from "../src/temporal";

describe("getSessionPhase", () => {
  it("returns late-night for hours 0-4", () => {
    expect(getSessionPhase(0)).toBe("late-night");
    expect(getSessionPhase(4)).toBe("late-night");
  });

  it("returns early-morning for hours 5-8", () => {
    expect(getSessionPhase(5)).toBe("early-morning");
    expect(getSessionPhase(8)).toBe("early-morning");
  });

  it("returns midday for hours 9-13", () => {
    expect(getSessionPhase(9)).toBe("midday");
    expect(getSessionPhase(13)).toBe("midday");
  });

  it("returns afternoon for hours 14-17", () => {
    expect(getSessionPhase(14)).toBe("afternoon");
    expect(getSessionPhase(17)).toBe("afternoon");
  });

  it("returns evening for hours 18-21", () => {
    expect(getSessionPhase(18)).toBe("evening");
    expect(getSessionPhase(21)).toBe("evening");
  });

  it("returns late-evening for hours 22-23", () => {
    expect(getSessionPhase(22)).toBe("late-evening");
    expect(getSessionPhase(23)).toBe("late-evening");
  });
});

describe("getFleetEpoch", () => {
  it("returns pre-fleet for very old timestamps", () => {
    expect(getFleetEpoch("2024-01-01T00:00:00Z")).toBe("pre-fleet");
  });

  it("returns early-fleet for mid-2025", () => {
    expect(getFleetEpoch("2025-07-01T00:00:00Z")).toBe("early-fleet");
  });

  it("returns wesley-birth for Sep 2025", () => {
    expect(getFleetEpoch("2025-10-01T00:00:00Z")).toBe("wesley-birth");
  });

  it("returns collective-unconscious for Jun 2026+", () => {
    expect(getFleetEpoch("2026-08-10T00:00:00Z")).toBe("collective-unconscious");
  });

  it("handles edge case: exactly on epoch boundary", () => {
    expect(getFleetEpoch("2026-06-01T00:00:00Z")).toBe("collective-unconscious");
  });
});

describe("getAgentAge", () => {
  it("returns positive age for known agent after start date", () => {
    const age = getAgentAge("wesley", "2026-08-10T00:00:00Z");
    expect(age).toBeGreaterThan(0);
    // Wesley started 2025-09-01, so by Aug 2026 that's ~343 days
    expect(age).toBeGreaterThan(28000000); // > ~324 days in seconds
  });

  it("returns 0 for timestamp before agent start", () => {
    const age = getAgentAge("wesley", "2025-01-01T00:00:00Z");
    expect(age).toBe(0);
  });

  it("falls back to casey start date for unknown agent", () => {
    const age = getAgentAge("unknown-agent", "2025-06-01T00:00:00Z");
    expect(age).toBeGreaterThan(0);
  });
});

describe("getRelationshipAge", () => {
  it("returns positive value for any timestamp after fleet start", () => {
    const age = getRelationshipAge("wesley", "2026-08-10T00:00:00Z");
    expect(age).toBeGreaterThan(0);
  });

  it("returns 0 for timestamp before fleet start", () => {
    const age = getRelationshipAge("wesley", "2025-01-01T00:00:00Z");
    expect(age).toBe(0);
  });
});

describe("stamp", () => {
  it("produces a complete temporal stamp", () => {
    const s = stamp("2026-08-10T04:00:00Z", "wesley");
    expect(s.wallClock).toBe("2026-08-10T04:00:00Z");
    expect(s.sessionPhase).toBe("late-night"); // 04 UTC
    expect(s.hourOfDay).toBe(4);
    expect(s.dayOfWeek).toBe(1); // Monday
    expect(s.dayOfYear).toBeGreaterThan(220);
    expect(s.fleetEpoch).toBe("collective-unconscious");
    expect(s.agentAgeSeconds).toBeGreaterThan(0);
    expect(s.relationshipAgeSeconds).toBeGreaterThan(0);
  });

  it("correctly computes dayOfWeek", () => {
    // 2026-08-10 is a Monday
    const s = stamp("2026-08-10T12:00:00Z", "flash");
    expect(s.dayOfWeek).toBe(1);
  });

  it("correctly computes hourOfDay from UTC", () => {
    const s = stamp("2026-08-10T14:30:00Z", "hermes");
    expect(s.hourOfDay).toBe(14);
  });
});

describe("timeRangeToFilter", () => {
  it("returns undefined when no filters provided", () => {
    expect(timeRangeToFilter()).toBeUndefined();
  });

  it("returns agentId filter only", () => {
    const f = timeRangeToFilter(undefined, undefined, "wesley");
    expect(f).toEqual({ agentId: "wesley" });
  });

  it("returns type filter only", () => {
    const f = timeRangeToFilter(undefined, undefined, undefined, "poem");
    expect(f).toEqual({ type: "poem" });
  });

  it("combines agentId and type filters", () => {
    const f = timeRangeToFilter(undefined, undefined, "flash", "fiction");
    expect(f).toEqual({ agentId: "flash", type: "fiction" });
  });
});

describe("Constants", () => {
  it("FLEET_EPOCHS is sorted by start date", () => {
    for (let i = 1; i < FLEET_EPOCHS.length; i++) {
      const prev = new Date(FLEET_EPOCHS[i - 1].start).getTime();
      const curr = new Date(FLEET_EPOCHS[i].start).getTime();
      expect(prev).toBeLessThan(curr);
    }
  });

  it("AGENT_START_DATES has entries for all known agents", () => {
    const required = ["flash", "wesley", "hermes", "casey", "lucineer", "main"];
    for (const agent of required) {
      expect(AGENT_START_DATES[agent]).toBeDefined();
    }
  });
});
