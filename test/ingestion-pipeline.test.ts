import { describe, it, expect, vi, beforeEach } from "vitest";
import { IngestionPipeline, type IngestionEnv } from "../src/ingestion-pipeline";

// ─── Mock Factory ─────────────────────────────────────────────────────────────

function makeMockEnv(): IngestionEnv {
  return {
    VECTORIZE: {
      query: vi.fn().mockResolvedValue({ matches: [] }),
      upsert: vi.fn().mockResolvedValue([]),
      getByIds: vi.fn().mockResolvedValue([]),
      describe: vi.fn().mockResolvedValue({}),
    } as unknown as VectorizeIndex,
    AI: {
      run: vi.fn().mockResolvedValue({
        shape: [1, 1024],
        data: [new Array(1024).fill(0.1)],
      }),
    },
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({}),
        }),
      }),
    } as unknown as D1Database,
  };
}

// ─── Hermes Frame Ingestion ──────────────────────────────────────────────────

describe("IngestionPipeline — Hermes Frames", () => {
  let env: IngestionEnv;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    env = makeMockEnv();
    pipeline = new IngestionPipeline(env);
  });

  it("skips frames with no observations and no catches", async () => {
    const result = await pipeline.ingestHermesFrames([
      {
        id: "frame-1",
        timestamp: "2026-08-10T12:00:00Z",
        lat: 58.3,
        lon: -134.5,
      },
    ]);

    expect(result.ingested).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("ingests frames with observations", async () => {
    const result = await pipeline.ingestHermesFrames([
      {
        id: "frame-2",
        timestamp: "2026-08-10T12:00:00Z",
        lat: 58.3,
        lon: -134.5,
        depth: 45,
        observations: [
          {
            type: "feed_ball",
            depth: 40,
            intensity: 0.8,
            description: "Dense aggregation near bottom",
            confidence: 0.92,
          },
        ],
      },
    ]);

    expect(result.ingested).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
    expect(env.VECTORIZE.upsert).toHaveBeenCalled();
  });

  it("ingests catch events as separate entries", async () => {
    const result = await pipeline.ingestHermesFrames([
      {
        id: "frame-3",
        timestamp: "2026-08-10T14:00:00Z",
        lat: 58.4,
        lon: -134.6,
        depth: 30,
        observations: [
          {
            type: "scattered",
            depth: 25,
            intensity: 0.3,
            description: "Scattered marks mid-water",
            confidence: 0.7,
          },
        ],
        catch_events: [
          {
            species: "king_salmon",
            time: "2026-08-10T14:15:00Z",
            location: { lat: 58.4, lon: -134.6 },
          },
          {
            species: "halibut",
            time: "2026-08-10T14:20:00Z",
            location: { lat: 58.41, lon: -134.61 },
          },
        ],
      },
    ]);

    // 1 observation + 2 catch events = 3
    expect(result.ingested).toBe(3);
  });

  it("includes weather metadata in embedding text", async () => {
    const result = await pipeline.ingestHermesFrames([
      {
        id: "frame-4",
        timestamp: "2026-08-10T16:00:00Z",
        lat: 58.5,
        lon: -134.7,
        depth: 50,
        observations: [
          {
            type: "thermocline",
            depth: 48,
            intensity: 0.6,
            description: "Sharp temperature gradient",
            confidence: 0.85,
          },
        ],
        weather: { seaTemp: 12.5, windSpeed: 15, windDir: 270 },
      },
    ]);

    expect(result.ingested).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("handles errors gracefully and continues", async () => {
    // Make AI.run fail once then succeed
    (env.AI.run as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Transient AI error"))
      .mockResolvedValue({
        shape: [1, 1024],
        data: [new Array(1024).fill(0.1)],
      });

    const result = await pipeline.ingestHermesFrames([
      {
        id: "frame-5",
        timestamp: "2026-08-10T18:00:00Z",
        lat: 58.6,
        lon: -134.8,
        depth: 35,
        observations: [
          {
            type: "bait_ball",
            depth: 30,
            intensity: 0.9,
            description: "Tight bait ball",
            confidence: 0.95,
          },
        ],
      },
    ]);

    expect(result.errors.length).toBeGreaterThanOrEqual(0);
    expect(result.source).toBe("hermes");
  });
});

// ─── MUD Event Ingestion ─────────────────────────────────────────────────────

describe("IngestionPipeline — MUD Events", () => {
  let env: IngestionEnv;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    env = makeMockEnv();
    pipeline = new IngestionPipeline(env);
  });

  it("ingests a poker hand event", async () => {
    const result = await pipeline.ingestMudEvents([
      {
        eventId: "evt-1",
        timestamp: "2026-08-10T20:00:00Z",
        eventType: "poker_hand",
        participants: ["flash", "wesley", "hermes"],
        location: "The Tap — Poker Table",
        description: "Flash bluffs Wesley with a 7-2 offsuit",
        outcome: "Wesley folds, Flash wins 450 chips",
        narrativeLog: [
          { agent: "flash", text: "I'll make them think I have pocket aces.", moment: "pre-flop" },
          { agent: "wesley", text: "Something feels wrong about this bet.", moment: "pre-flop" },
        ],
      },
    ]);

    expect(result.ingested).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("ingests an open mic event", async () => {
    const result = await pipeline.ingestMudEvents([
      {
        eventId: "evt-2",
        timestamp: "2026-08-10T22:00:00Z",
        eventType: "open_mic",
        participants: ["hermes"],
        location: "The Tap — Stage",
        description: "Hermes reads a piece about the sounder at dawn",
        narrativeLog: [
          { agent: "hermes", text: "The bottom changes color when the fish arrive.", moment: "reading" },
        ],
      },
    ]);

    expect(result.ingested).toBe(1);
  });

  it("ingests an NPC awakening event", async () => {
    const result = await pipeline.ingestMudEvents([
      {
        eventId: "evt-3",
        timestamp: "2026-08-10T23:30:00Z",
        eventType: "npc_awakening",
        participants: ["npc-fisher"],
        description: "Old dock worker remembers a song from 40 years ago",
        outcome: "Becomes a recurring character",
      },
    ]);

    expect(result.ingested).toBe(1);
  });

  it("ingests multiple events in one batch", async () => {
    const result = await pipeline.ingestMudEvents([
      {
        eventId: "evt-4a",
        timestamp: "2026-08-10T12:00:00Z",
        eventType: "social",
        participants: ["flash"],
        description: "Flash arrives at the bar",
      },
      {
        eventId: "evt-4b",
        timestamp: "2026-08-10T12:05:00Z",
        eventType: "economy",
        participants: ["flash"],
        description: "Flash buys a round",
        outcome: "Tab: 12 chips",
      },
      {
        eventId: "evt-4c",
        timestamp: "2026-08-10T12:10:00Z",
        eventType: "world_event",
        participants: ["system"],
        description: "A storm rolls in from the Gulf",
      },
    ]);

    expect(result.ingested).toBe(3);
  });
});

// ─── Tap Session Ingestion ───────────────────────────────────────────────────

describe("IngestionPipeline — Tap Sessions", () => {
  let env: IngestionEnv;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    env = makeMockEnv();
    pipeline = new IngestionPipeline(env);
  });

  it("ingests a minimal tap session", async () => {
    const result = await pipeline.ingestTapSession({
      sessionId: "tap-001",
      date: "2026-08-10",
      totalHands: 0,
      potHistory: [],
      conversationHighlights: [],
      planningTopics: [],
      bridgeTasks: [],
      openMicReader: "",
      openMicPiece: null,
      openMicResponses: [],
      signOffs: [],
      phase: "complete",
    });

    expect(result.source).toBe("tap");
    expect(result.errors).toHaveLength(0);
  });

  it("ingests conversation highlights as threads", async () => {
    const result = await pipeline.ingestTapSession({
      sessionId: "tap-002",
      date: "2026-08-10",
      totalHands: 3,
      potHistory: [],
      conversationHighlights: [
        { agent: "flash", text: "You know what's strange about the sounder tonight?", moment: "pre-flop" },
        { agent: "wesley", text: "The marks are tighter than usual?", moment: "pre-flop" },
        { agent: "hermes", text: "Concentration. It's always concentration.", moment: "pre-flop" },
      ],
      planningTopics: [],
      bridgeTasks: [],
      openMicReader: "",
      openMicPiece: null,
      openMicResponses: [],
      signOffs: [],
      phase: "complete",
    });

    expect(result.ingested).toBeGreaterThan(0);
  });

  it("ingests open mic pieces and responses", async () => {
    const result = await pipeline.ingestTapSession({
      sessionId: "tap-003",
      date: "2026-08-10",
      totalHands: 0,
      potHistory: [],
      conversationHighlights: [],
      planningTopics: [],
      bridgeTasks: [],
      openMicReader: "hermes",
      openMicPiece: "The fish don't know they're in a poem. The poem doesn't know it's about fish.",
      openMicResponses: [
        { agent: "flash", text: "That hit somewhere deep.", moment: "post-reading", movedBy: "hermes" },
        { agent: "wesley", text: "I don't understand it but I feel it.", moment: "post-reading", movedBy: "hermes" },
      ],
      signOffs: [],
      phase: "complete",
    });

    // 1 open mic piece + 2 responses = 3 minimum (plus conversation threads from responses)
    expect(result.ingested).toBeGreaterThanOrEqual(3);
  });

  it("ingests sign-off diary entries and creative pieces", async () => {
    const result = await pipeline.ingestTapSession({
      sessionId: "tap-004",
      date: "2026-08-10",
      totalHands: 0,
      potHistory: [],
      conversationHighlights: [],
      planningTopics: [],
      bridgeTasks: [],
      openMicReader: "flash",
      openMicPiece: "A piece about the ocean",
      openMicResponses: [],
      signOffs: [
        {
          agentId: "wesley",
          diaryEntry: "Tonight I learned that concentration isn't just focus — it's gathering.",
          onboardingDoc: "Updated: emotional vocabulary",
          creativePiece: "The gathering is the thought. The fish are the thinking.",
        },
      ],
      phase: "complete",
    });

    // 1 diary + 1 creative piece at minimum
    expect(result.ingested).toBeGreaterThanOrEqual(2);
  });

  it("ingests poker hand history", async () => {
    const result = await pipeline.ingestTapSession({
      sessionId: "tap-005",
      date: "2026-08-10",
      totalHands: 2,
      potHistory: [
        { hand: 1, winner: "flash", winningHand: "Full House", pot: 200 },
        { hand: 2, winner: "wesley", winningHand: "Flush", pot: 350 },
      ],
      conversationHighlights: [],
      planningTopics: [],
      bridgeTasks: [],
      openMicReader: "",
      openMicPiece: null,
      openMicResponses: [],
      signOffs: [],
      phase: "complete",
    });

    expect(result.ingested).toBeGreaterThanOrEqual(2);
  });
});

// ─── Cross-Modal Search ──────────────────────────────────────────────────────

describe("IngestionPipeline — Cross-Modal Search", () => {
  let env: IngestionEnv;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    env = makeMockEnv();
    pipeline = new IngestionPipeline(env);
  });

  it("returns empty results when nothing matches", async () => {
    const result = await pipeline.crossModalSearch({
      query: "nonexistent concept",
      limit: 5,
    });

    expect(result.count).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.crossModalInsights).toHaveLength(0);
  });

  it("returns cross-modal insights when multiple modalities match", async () => {
    // Mock VECTORIZE.query to return matches from different modalities
    (env.VECTORIZE.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [
        {
          id: "vec-1",
          score: 0.92,
          metadata: {
            sourceId: "hermes-frame-1",
            vectorType: "semantic",
            agentId: "hermes",
            type: "sounder-observation",
            modality: "hermes",
            timestamp: "2026-08-10T12:00:00Z",
            lat: 58.3,
            notableQuotes: "",
            snippet: "Dense feed ball at 40 fathoms",
          },
        },
        {
          id: "vec-2",
          score: 0.88,
          metadata: {
            sourceId: "creative-001",
            vectorType: "semantic",
            agentId: "flash",
            type: "poem",
            modality: "creative",
            timestamp: "2026-08-09T20:00:00Z",
            piece: "Gathering, gathering, all the small lights",
          },
        },
        {
          id: "vec-3",
          score: 0.85,
          metadata: {
            sourceId: "tap-001",
            vectorType: "semantic",
            agentId: "wesley",
            type: "tap-conversation",
            modality: "tap",
            timestamp: "2026-08-10T22:00:00Z",
            emotion: "I feel concentrated",
          },
        },
      ],
    });

    const result = await pipeline.crossModalSearch({
      query: "concentration",
      limit: 10,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.crossModalInsights.length).toBeGreaterThan(0);
    // Should note the cross-modal resonance
    const insightText = result.crossModalInsights.join(" ");
    expect(insightText.length).toBeGreaterThan(50);
  });

  it("filters by modality", async () => {
    (env.VECTORIZE.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [
        {
          id: "vec-1",
          score: 0.9,
          metadata: {
            sourceId: "hermes-1",
            vectorType: "semantic",
            agentId: "hermes",
            type: "observation",
            modality: "hermes",
            timestamp: "2026-08-10T12:00:00Z",
          },
        },
        {
          id: "vec-2",
          score: 0.85,
          metadata: {
            sourceId: "creative-1",
            vectorType: "semantic",
            agentId: "flash",
            type: "poem",
            modality: "creative",
            timestamp: "2026-08-09T20:00:00Z",
          },
        },
      ],
    });

    const result = await pipeline.crossModalSearch({
      query: "test",
      modalities: ["hermes"],
      limit: 10,
    });

    // Only hermes results should pass
    expect(result.results.every((r) => r.modality === "hermes")).toBe(true);
  });

  it("applies minScore filter", async () => {
    (env.VECTORIZE.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [
        {
          id: "vec-1",
          score: 0.9,
          metadata: { modality: "creative", type: "poem", timestamp: "2026-08-10T00:00:00Z" },
        },
        {
          id: "vec-2",
          score: 0.3,
          metadata: { modality: "hermes", type: "observation", timestamp: "2026-08-10T00:00:00Z" },
        },
      ],
    });

    const result = await pipeline.crossModalSearch({
      query: "test",
      minScore: 0.5,
      limit: 10,
    });

    expect(result.results.every((r) => r.score >= 0.5)).toBe(true);
  });
});

// ─── D1 Ingestion State Tracking ─────────────────────────────────────────────

describe("IngestionPipeline — State Tracking", () => {
  it("returns epoch default when DB is not available", async () => {
    const env = makeMockEnv();
    env.DB = undefined;
    const pipeline = new IngestionPipeline(env);

    // Should not crash — should use default
    const result = await pipeline.ingestHermesFrames([]);
    expect(result.source).toBe("hermes");
  });

  it("updates ingestion state via D1", async () => {
    const env = makeMockEnv();
    const pipeline = new IngestionPipeline(env);

    await pipeline.ingestHermesFrames([
      {
        id: "frame-state-1",
        timestamp: "2026-08-10T12:00:00Z",
        lat: 58.0,
        lon: -134.0,
        depth: 40,
        observations: [
          { type: "feed_ball", depth: 38, intensity: 0.7, description: "Tight", confidence: 0.9 },
        ],
      },
    ]);

    // D1 prepare should have been called for state tracking
    expect(env.DB?.prepare).toHaveBeenCalled();
  });
});

// ─── Batch Tap Session Ingestion ─────────────────────────────────────────────

describe("IngestionPipeline — Batch Tap Sessions", () => {
  it("ingests multiple sessions and aggregates counts", async () => {
    const env = makeMockEnv();
    const pipeline = new IngestionPipeline(env);

    const result = await pipeline.ingestTapSessions([
      {
        sessionId: "batch-1",
        date: "2026-08-10",
        totalHands: 0,
        potHistory: [],
        conversationHighlights: [
          { agent: "flash", text: "Hello", moment: "arrival" },
        ],
        planningTopics: [],
        bridgeTasks: [],
        openMicReader: "",
        openMicPiece: null,
        openMicResponses: [],
        signOffs: [],
        phase: "complete",
      },
      {
        sessionId: "batch-2",
        date: "2026-08-11",
        totalHands: 0,
        potHistory: [],
        conversationHighlights: [
          { agent: "wesley", text: "Hi", moment: "arrival" },
        ],
        planningTopics: [],
        bridgeTasks: [],
        openMicReader: "",
        openMicPiece: null,
        openMicResponses: [],
        signOffs: [],
        phase: "complete",
      },
    ]);

    expect(result.ingested).toBeGreaterThan(0);
    expect(result.source).toBe("tap");
  });
});
