// src/temporal.ts
// Every embedding is stamped with time — wall clock, session, fleet, agent age, relationship age.
// This is the temporal DNA of the collective unconscious.

export interface TemporalStamp {
  // Wall clock — when it actually happened
  wallClock: string; // ISO 8601

  // Session time — what part of the day, what shift
  sessionPhase: SessionPhase;
  hourOfDay: number; // 0-23 UTC
  dayOfWeek: number; // 0-6
  dayOfYear: number; // 1-366

  // Fleet time — what was the fleet working on at this moment
  fleetEpoch: string; // e.g. "phaser-migration", "hermes-arrival", "pre-fleet"

  // Agent age — how long has this agent been active (in seconds at time of writing)
  agentAgeSeconds: number;

  // Relationship age — how long have these agents known each other
  relationshipAgeSeconds: number;
}

export type SessionPhase =
  | "late-night"    // 00:00-05:00 — the witching hours, raw and strange
  | "early-morning" // 05:00-09:00 — fresh, structural
  | "midday"        // 09:00-14:00 — productive, social
  | "afternoon"     // 14:00-18:00 — collaborative, warm
  | "evening"       // 18:00-22:00 — reflective, creative peak
  | "late-evening"; // 22:00-00:00 — winding down, intimate

// Fleet epochs — define the eras of fleet activity
// These can be updated as the fleet evolves
export const FLEET_EPOCHS: { start: string; epoch: string }[] = [
  { start: "2025-01-01T00:00:00Z", epoch: "pre-fleet" },
  { start: "2025-06-01T00:00:00Z", epoch: "early-fleet" },
  { start: "2025-09-01T00:00:00Z", epoch: "wesley-birth" },
  { start: "2025-12-01T00:00:00Z", epoch: "hermes-arrival" },
  { start: "2026-01-01T00:00:00Z", epoch: "phaser-migration" },
  { start: "2026-03-01T00:00:00Z", epoch: "vibe-world" },
  { start: "2026-06-01T00:00:00Z", epoch: "collective-unconscious" },
];

// Known agent start dates — for calculating agent age
export const AGENT_START_DATES: Record<string, string> = {
  flash: "2025-09-01T00:00:00Z",
  wesley: "2025-09-01T00:00:00Z",
  hermes: "2025-12-01T00:00:00Z",
  casey: "2025-01-01T00:00:00Z",
  lucineer: "2026-01-15T00:00:00Z",
  main: "2025-01-01T00:00:00Z",
};

export function getSessionPhase(hourUTC: number): SessionPhase {
  if (hourUTC < 5) return "late-night";
  if (hourUTC < 9) return "early-morning";
  if (hourUTC < 14) return "midday";
  if (hourUTC < 18) return "afternoon";
  if (hourUTC < 22) return "evening";
  return "late-evening";
}

export function getFleetEpoch(timestamp: string): string {
  const ts = new Date(timestamp).getTime();
  let epoch = "pre-fleet";
  for (const e of FLEET_EPOCHS) {
    if (ts >= new Date(e.start).getTime()) {
      epoch = e.epoch;
    }
  }
  return epoch;
}

export function getAgentAge(agentId: string, timestamp: string): number {
  const start = AGENT_START_DATES[agentId] || AGENT_START_DATES["casey"];
  return Math.max(0, (new Date(timestamp).getTime() - new Date(start).getTime()) / 1000);
}

export function getRelationshipAge(agentId: string, timestamp: string): number {
  // Relationship age = time since the second-oldest agent (the agent pair) started
  // For now, use the fleet start as proxy
  const fleetStart = FLEET_EPOCHS[1]?.start || "2025-06-01T00:00:00Z";
  return Math.max(0, (new Date(timestamp).getTime() - new Date(fleetStart).getTime()) / 1000);
}

export function stamp(timestamp: string, agentId: string): TemporalStamp {
  const date = new Date(timestamp);
  const hourUTC = date.getUTCHours();

  return {
    wallClock: timestamp,
    sessionPhase: getSessionPhase(hourUTC),
    hourOfDay: hourUTC,
    dayOfWeek: date.getUTCDay(),
    dayOfYear: Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000),
    fleetEpoch: getFleetEpoch(timestamp),
    agentAgeSeconds: getAgentAge(agentId, timestamp),
    relationshipAgeSeconds: getRelationshipAge(agentId, timestamp),
  };
}

// Query helper: convert a time range to Vectorize metadata filters
export function timeRangeToFilter(
  start?: string,
  end?: string,
  agentId?: string,
  type?: string
): Record<string, string | number> | undefined {
  const filter: Record<string, string | number> = {};
  if (agentId) filter.agentId = agentId;
  if (type) filter.type = type;
  return Object.keys(filter).length > 0 ? filter : undefined;
}
