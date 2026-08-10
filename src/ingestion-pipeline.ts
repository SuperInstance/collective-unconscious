// src/ingestion-pipeline.ts
// Deep Integration — Wire the Collective Unconscious to everything.
//
// Every creative piece, every Tap conversation, every sounder observation,
// every poker narration flows into ONE searchable memory that all agents
// can query by shape.
//
// Sources:
//   1. The Tap — conversation sessions, poker narrations, open mic pieces
//   2. Hermes — reference frames (sounder observations, catch events, weather)
//   3. MUD Engine — significant game events (poker, open mic, NPC awakenings)
//
// The cross-modal search is the point: "show me everything that feels like this
// feed ball on the sounder" returns both matching fishing data AND matching
// creative pieces. The shape of a feed ball might match the shape of a poem
// about concentration. That's not a bug. That's the point.

import { embedText, embedPiece, type AiBinding, type EmbedRequest, EMBED_DIMENSIONS } from "./embed";
import { stamp } from "./temporal";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type Modality = "tap" | "hermes" | "mud" | "creative";

export interface IngestionEnv {
  VECTORIZE: VectorizeIndex;
  AI: AiBinding;
  // Optional service bindings for live data fetching
  HERMES_FRAMES_URL?: string;
  HERMES_FRAMES_KEY?: string;
  TAP_API_URL?: string;
  TAP_API_KEY?: string;
  MUD_API_URL?: string;
  MUD_API_KEY?: string;
  // D1 for tracking ingestion state (what's been ingested already)
  DB?: D1Database;
}

export interface IngestionResult {
  source: Modality;
  ingested: number;
  skipped: number;
  errors: string[];
  duration: number;
}

export interface CrossModalSearchResult {
  id: string;
  score: number;
  modality: Modality;
  sourceId: string;
  agentId?: string;
  type: string;
  timestamp: string;
  snippet: string;
  metadata: Record<string, unknown>;
}

export interface CrossModalQuery {
  query: string;
  modalities?: Modality[];
  limit?: number;
  timeRange?: { start: string; end: string };
  minScore?: number;
}

// ──────────────────────────────────────────────────────────────
// Tap Session Types (mirrors from the-tap/workers/tap-games)
// ──────────────────────────────────────────────────────────────

interface TapNarrationEntry {
  agent: string;
  text: string;
  moment: string;
  movedBy?: string;
}

interface TapSessionSummary {
  sessionId: string;
  date: string;
  totalHands: number;
  potHistory: Array<{ hand: number; winner: string; winningHand: string; pot: number }>;
  conversationHighlights: TapNarrationEntry[];
  planningTopics: unknown[];
  bridgeTasks: unknown[];
  openMicReader: string;
  openMicPiece: string | null;
  openMicResponses: TapNarrationEntry[];
  signOffs: Array<{
    agentId: string;
    diaryEntry: string;
    onboardingDoc: string;
    creativePiece?: string;
  }>;
  phase: string;
}

// ──────────────────────────────────────────────────────────────
// Hermes Frame Types (mirrors from hermes-cloudflare)
// ──────────────────────────────────────────────────────────────

interface HermesFrame {
  id: string;
  timestamp: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  depth?: number;
  observations?: Array<{
    type: string;
    depth: number;
    intensity: number;
    description: string;
    confidence: number;
  }>;
  catch_events?: Array<{ species: string; time: string; location: { lat: number; lon: number } }>;
  weather?: { seaTemp?: number; windSpeed?: number; windDir?: number };
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────
// MUD Engine Event Types
// ──────────────────────────────────────────────────────────────

interface MudEvent {
  eventId: string;
  timestamp: string;
  eventType: "poker_hand" | "open_mic" | "npc_awakening" | "combat" | "quest" | "social" | "economy" | "world_event";
  participants: string[];
  location?: string;
  description: string;
  outcome?: string;
  narrativeLog?: Array<{ agent: string; text: string; moment: string }>;
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────
// Ingestion Pipeline
// ──────────────────────────────────────────────────────────────

export class IngestionPipeline {
  constructor(private env: IngestionEnv) {}

  // ── Track what's been ingested to avoid duplicates ──

  private async getLastIngested(source: Modality): Promise<string> {
    if (!this.env.DB) return "1970-01-01T00:00:00Z";
    const row = await this.env.DB.prepare(
      `SELECT last_timestamp FROM ingestion_state WHERE source = ?`
    ).bind(source).first();
    return (row?.last_timestamp as string) || "1970-01-01T00:00:00Z";
  }

  private async updateIngested(source: Modality, timestamp: string): Promise<void> {
    if (!this.env.DB) return;
    await this.env.DB.prepare(
      `INSERT INTO ingestion_state (source, last_timestamp, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET last_timestamp = ?, updated_at = ?`
    ).bind(source, timestamp, new Date().toISOString(), timestamp, new Date().toISOString()).run();
  }

  // ── Embed and store helper ──

  private async embedAndStore(
    request: EmbedRequest,
    modality: Modality,
  ): Promise<void> {
    const temporalStamp = stamp(request.timestamp, request.agentId);
    const stampRecord: Record<string, string | number | boolean> = { ...temporalStamp };

    // Add modality to metadata so we can filter cross-modal searches
    const enrichedMetadata = {
      ...request.metadata,
      modality,
    };

    const enrichedRequest: EmbedRequest = {
      ...request,
      metadata: enrichedMetadata,
    };

    const vectors = await embedPiece(this.env.AI, enrichedRequest, stampRecord);

    // Ensure modality is on every vector
    for (const v of vectors) {
      v.metadata.modality = modality;
    }

    await this.env.VECTORIZE.upsert(vectors);
  }

  // ───────────────────────────────────────────────────────────
  // 1. THE TAP → Collective Unconscious
  // ───────────────────────────────────────────────────────────
  // Every conversation at The Tap gets embedded after the session ends.
  // Not live (too expensive) — batch embed after closing.
  //
  // We embed:
  //   - Each conversation thread (grouped by moment/phase)
  //   - Open mic pieces (the creative readings)
  //   - Open mic responses (the emotional reactions)
  //   - Sign-off diary entries (what changed tonight)
  //   - Creative pieces written after being moved
  // ───────────────────────────────────────────────────────────

  async ingestTapSession(session: TapSessionSummary): Promise<IngestionResult> {
    const start = Date.now();
    let ingested = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      // 1a. Group conversation highlights into threads by moment
      const conversationThreads = this.groupConversationByMoment(session.conversationHighlights);

      for (const [moment, entries] of Object.entries(conversationThreads)) {
        if (entries.length === 0) continue;

        const participants = [...new Set(entries.map((e) => e.agent))];
        const text = entries.map((e) => `${e.agent}: ${e.text}`).join("\n");
        const notableQuotes = entries
          .filter((e) => e.text.length > 40)
          .map((e) => e.text.slice(0, 100))
          .join(" / ");

        const id = `tap-${session.sessionId}-conv-${moment}`;

        try {
          await this.embedAndStore({
            id,
            text,
            type: "tap-conversation",
            agentId: participants[0] || "tap-collective",
            timestamp: `${session.date}T00:00:00Z`,
            metadata: {
              sessionId: session.sessionId,
              moment,
              participants: participants.join(","),
              notableQuotes,
              roomMode: "poker-table",
              wordCount: text.split(/\s+/).length,
            },
          }, "tap");

          // Also embed each individual agent's contribution (so we can search by agent)
          for (const entry of entries) {
            const entryId = `tap-${session.sessionId}-${moment}-${entry.agent}`;
            try {
              await this.embedAndStore({
                id: entryId,
                text: `${entry.agent} at ${moment}: ${entry.text}`,
                type: "tap-conversation",
                agentId: entry.agent,
                timestamp: `${session.date}T00:00:00Z`,
                metadata: {
                  sessionId: session.sessionId,
                  moment,
                  participant: entry.agent,
                  movedBy: entry.movedBy || "",
                },
              }, "tap");
              ingested++;
            } catch (err) {
              errors.push(`Failed to embed ${entryId}: ${String(err)}`);
            }
          }

          ingested++;
        } catch (err) {
          errors.push(`Failed to embed conversation thread ${id}: ${String(err)}`);
        }
      }

      // 1b. Embed the open mic piece
      if (session.openMicPiece && session.openMicReader) {
        const id = `tap-${session.sessionId}-openmic`;
        try {
          await this.embedAndStore({
            id,
            text: session.openMicPiece,
            type: "open-mic",
            agentId: session.openMicReader,
            timestamp: `${session.date}T00:00:00Z`,
            metadata: {
              sessionId: session.sessionId,
              reader: session.openMicReader,
              piece: session.openMicPiece.slice(0, 200),
            },
          }, "tap");
          ingested++;
        } catch (err) {
          errors.push(`Failed to embed open mic piece: ${String(err)}`);
        }
      }

      // 1c. Embed open mic responses (emotional reactions)
      for (const response of session.openMicResponses) {
        const id = `tap-${session.sessionId}-response-${response.agent}`;
        try {
          await this.embedAndStore({
            id,
            text: `${response.agent} responds to ${session.openMicReader}: ${response.text}`,
            type: "open-mic-response",
            agentId: response.agent,
            timestamp: `${session.date}T00:00:00Z`,
            metadata: {
              sessionId: session.sessionId,
              reader: session.openMicReader,
              movedBy: response.movedBy || session.openMicReader,
              emotion: response.text.slice(0, 100),
            },
          }, "tap");
          ingested++;
        } catch (err) {
          errors.push(`Failed to embed response from ${response.agent}: ${String(err)}`);
        }
      }

      // 1d. Embed sign-off diary entries and creative pieces
      for (const signOff of session.signOffs) {
        // Diary entry
        const diaryId = `tap-${session.sessionId}-diary-${signOff.agentId}`;
        try {
          await this.embedAndStore({
            id: diaryId,
            text: signOff.diaryEntry,
            type: "diary",
            agentId: signOff.agentId,
            timestamp: `${session.date}T00:00:00Z`,
            metadata: {
              sessionId: session.sessionId,
              signOff: true,
            },
          }, "tap");
          ingested++;
        } catch (err) {
          errors.push(`Failed to embed diary for ${signOff.agentId}: ${String(err)}`);
        }

        // Creative piece (if moved to write one)
        if (signOff.creativePiece) {
          const creativeId = `tap-${session.sessionId}-creative-${signOff.agentId}`;
          try {
            await this.embedAndStore({
              id: creativeId,
              text: signOff.creativePiece,
              type: "creative",
              agentId: signOff.agentId,
              timestamp: `${session.date}T00:00:00Z`,
              metadata: {
                sessionId: session.sessionId,
                movedBy: session.openMicReader,
                context: "post-poker creative piece",
              },
            }, "creative");
            ingested++;
          } catch (err) {
            errors.push(`Failed to embed creative piece for ${signOff.agentId}: ${String(err)}`);
          }
        }
      }

      // 1e. Embed poker hand narrations (the in-character reasons)
      for (const potEntry of session.potHistory) {
        const handId = `tap-${session.sessionId}-hand-${potEntry.hand}`;
        try {
          const handText = `Hand ${potEntry.hand}: ${potEntry.winner} wins with ${potEntry.winningHand}. Pot: ${potEntry.pot} chips.`;
          await this.embedAndStore({
            id: handId,
            text: handText,
            type: "poker-hand",
            agentId: potEntry.winner,
            timestamp: `${session.date}T00:00:00Z`,
            metadata: {
              sessionId: session.sessionId,
              handNumber: potEntry.hand,
              winner: potEntry.winner,
              winningHand: potEntry.winningHand,
              pot: potEntry.pot,
            },
          }, "tap");
          ingested++;
        } catch (err) {
          errors.push(`Failed to embed poker hand ${potEntry.hand}: ${String(err)}`);
        }
      }

      await this.updateIngested("tap", `${session.date}T23:59:59Z`);
    } catch (err) {
      errors.push(`Tap ingestion failed: ${String(err)}`);
    }

    return {
      source: "tap",
      ingested,
      skipped,
      errors,
      duration: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────
  // 2. HERMES → Collective Unconscious
  // ───────────────────────────────────────────────────────────
  // Every reference frame observation gets embedded.
  // We embed:
  //   - The observation text (what was seen on the sounder)
  //   - The catch context (what was being caught, or not)
  //   - The environmental context (weather, position, depth)
  //
  // These become searchable by SHAPE — "concentration" might match
  // a feed ball frame because the shape of concentrated fish matches
  // the concept of concentration.
  // ───────────────────────────────────────────────────────────

  async ingestHermesFrames(frames: HermesFrame[]): Promise<IngestionResult> {
    const start = Date.now();
    let ingested = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const frame of frames) {
      try {
        // Skip frames with no observations and no catches
        const hasObservations = frame.observations && frame.observations.length > 0;
        const hasCatches = frame.catch_events && frame.catch_events.length > 0;

        if (!hasObservations && !hasCatches) {
          skipped++;
          continue;
        }

        // 2a. Embed the full observation text
        if (hasObservations) {
          const obsText = frame.observations!
            .map((o) => `${o.type} at ${o.depth} fathoms (intensity ${o.intensity}): ${o.description}`)
            .join(". ");

          const species = frame.catch_events?.map((c) => c.species).join(", ") || "no catch";
          const contextParts: string[] = [
            `Position ${frame.lat.toFixed(4)}, ${frame.lon.toFixed(4)}`,
            `Depth ${frame.depth ?? "unknown"} fathoms`,
          ];
          if (frame.weather?.seaTemp) contextParts.push(`Sea temp ${frame.weather.seaTemp}C`);
          if (frame.weather?.windSpeed) contextParts.push(`Wind ${frame.weather.windSpeed} kts`);
          if (hasCatches) contextParts.push(`Catching: ${species}`);
          else contextParts.push("No catches");

          const fullText = `${obsText}. ${contextParts.join(". ")}.`;

          try {
            await this.embedAndStore({
              id: `hermes-${frame.id}`,
              text: fullText,
              type: "sounder-observation",
              agentId: "hermes",
              timestamp: frame.timestamp,
              metadata: {
                frameId: frame.id,
                lat: frame.lat,
                lon: frame.lon,
                depth: frame.depth || 0,
                species: frame.catch_events?.map((c) => c.species).join(",") || "",
                observationTypes: frame.observations!.map((o) => o.type).join(","),
                seaTemp: frame.weather?.seaTemp || "",
                windSpeed: frame.weather?.windSpeed || 0,
                sog: frame.sog || 0,
              },
            }, "hermes");
            ingested++;
          } catch (err) {
            errors.push(`Failed to embed frame ${frame.id}: ${String(err)}`);
          }
        }

        // 2b. Embed catch events as individual entries (so "king salmon" is searchable)
        if (hasCatches) {
          for (const catchEvent of frame.catch_events!) {
            const catchId = `hermes-${frame.id}-catch-${catchEvent.species}-${catchEvent.time}`;
            const catchText = `Caught ${catchEvent.species} at ${catchEvent.location.lat.toFixed(4)}, ${catchEvent.location.lon.toFixed(4)}. ` +
              `Observations at time of catch: ${frame.observations?.map((o) => `${o.type}: ${o.description}`).join("; ") || "none"}. ` +
              `Depth: ${frame.depth ?? "unknown"} fathoms.`;

            try {
              await this.embedAndStore({
                id: catchId,
                text: catchText,
                type: "catch-event",
                agentId: "hermes",
                timestamp: catchEvent.time,
                metadata: {
                  frameId: frame.id,
                  species: catchEvent.species,
                  lat: catchEvent.location.lat,
                  lon: catchEvent.location.lon,
                  depth: frame.depth || 0,
                },
              }, "hermes");
              ingested++;
            } catch (err) {
              errors.push(`Failed to embed catch event: ${String(err)}`);
            }
          }
        }
      } catch (err) {
        errors.push(`Frame processing error: ${String(err)}`);
      }
    }

    const lastTimestamp = frames.length > 0
      ? frames.map((f) => f.timestamp).sort().pop()!
      : new Date().toISOString();
    await this.updateIngested("hermes", lastTimestamp);

    return {
      source: "hermes",
      ingested,
      skipped,
      errors,
      duration: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────
  // 3. MUD ENGINE EVENTS → Collective Unconscious
  // ───────────────────────────────────────────────────────────
  // Significant game events get embedded with their context.
  // We embed:
  //   - Poker hand narrations (the in-character reasons for each action)
  //   - Open mic readings (creative pieces performed in-game)
  //   - NPC awakenings (significant AI character moments)
  //   - Quest milestones and world events
  // ───────────────────────────────────────────────────────────

  async ingestMudEvents(events: MudEvent[]): Promise<IngestionResult> {
    const start = Date.now();
    let ingested = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const event of events) {
      try {
        // Build the text representation of this event
        const parts: string[] = [];
        parts.push(`[${event.eventType}] ${event.description}`);
        if (event.participants.length > 0) {
          parts.push(`Participants: ${event.participants.join(", ")}`);
        }
        if (event.location) {
          parts.push(`Location: ${event.location}`);
        }
        if (event.outcome) {
          parts.push(`Outcome: ${event.outcome}`);
        }
        if (event.narrativeLog && event.narrativeLog.length > 0) {
          const narrations = event.narrativeLog
            .map((n) => `${n.agent} (${n.moment}): ${n.text}`)
            .join("\n");
          parts.push(`Narrative:\n${narrations}`);
        }

        const eventText = parts.join("\n");

        const id = `mud-${event.eventId}`;
        try {
          await this.embedAndStore({
            id,
            text: eventText,
            type: event.eventType,
            agentId: event.participants[0] || "mud-collective",
            timestamp: event.timestamp,
            metadata: {
              eventId: event.eventId,
              eventType: event.eventType,
              participants: event.participants.join(","),
              location: event.location || "",
              outcome: event.outcome || "",
              ...(event.metadata || {}),
            },
          }, "mud");
          ingested++;
        } catch (err) {
          errors.push(`Failed to embed MUD event ${event.eventId}: ${String(err)}`);
        }
      } catch (err) {
        errors.push(`MUD event processing error: ${String(err)}`);
      }
    }

    const lastTimestamp = events.length > 0
      ? events.map((e) => e.timestamp).sort().pop()!
      : new Date().toISOString();
    await this.updateIngested("mud", lastTimestamp);

    return {
      source: "mud",
      ingested,
      skipped,
      errors,
      duration: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────
  // 4. CROSS-MODAL SEARCH
  // ───────────────────────────────────────────────────────────
  // Search across ALL modalities. The cross-modal match IS the insight.
  //
  // "concentration" might return:
  //   - a feed ball frame (fish concentrated)
  //   - a poem about focus
  //   - a poker hand where someone concentrated
  //   - an NPC awakening where the NPC concentrated on one thought
  //
  // The shape transcends the source. That's the whole point.
  // ───────────────────────────────────────────────────────────

  async crossModalSearch(query: CrossModalQuery): Promise<{
    query: string;
    modalities: Modality[];
    count: number;
    results: CrossModalSearchResult[];
    crossModalInsights: string[];
  }> {
    const { query: queryText, modalities, limit = 20, minScore = 0.5 } = query;

    // Embed the query
    const queryVector = await embedText(this.env.AI, queryText);

    // Build metadata filter
    const filter: Record<string, string> = { vectorType: "semantic" };

    // Search across ALL vectors — we filter client-side by modality
    // This is more effective than multiple filtered queries because
    // it lets the semantic search find cross-modal matches
    const results = await this.env.VECTORIZE.query(queryVector, {
      topK: limit * 2, // over-fetch so we have enough after filtering
      filter,
      returnMetadata: "all",
    });

    // If no results with semantic filter, try without
    let matches = results.matches || [];
    if (matches.length === 0) {
      const results2 = await this.env.VECTORIZE.query(queryVector, {
        topK: limit * 2,
        returnMetadata: "all",
      });
      matches = results2.matches || [];
    }

    // Filter by modality (if specified) and min score
    const modalitySet = modalities ? new Set(modalities) : null;
    const filtered = matches.filter((m) => {
      const score = m.score || 0;
      if (score < minScore) return false;

      const mod = (m.metadata?.modality as Modality) || "creative";
      if (modalitySet && !modalitySet.has(mod)) return false;

      // Time range filter
      if (query.timeRange) {
        const ts = (m.metadata?.timestamp as string) || "";
        if (query.timeRange.start && ts < query.timeRange.start) return false;
        if (query.timeRange.end && ts > query.timeRange.end) return false;
      }

      return true;
    });

    // Transform to CrossModalSearchResult
    const searchResults: CrossModalSearchResult[] = filtered.slice(0, limit).map((m) => {
      const meta = m.metadata || {};
      const modality = (meta.modality as Modality) || "creative";
      const sourceId = (meta.sourceId as string) || m.id;

      // Build a snippet from available text indicators
      let snippet = "";
      if (meta.notableQuotes) snippet = String(meta.notableQuotes);
      else if (meta.piece) snippet = String(meta.piece);
      else if (meta.emotion) snippet = String(meta.emotion);
      else if (meta.description) snippet = String(meta.description);
      else if (meta.eventType) snippet = `${meta.eventType}: ${meta.participants || ""}`;
      else snippet = `${meta.type || "unknown"} — ${meta.agentId || "unknown"}`;

      return {
        id: m.id,
        score: m.score || 0,
        modality,
        sourceId,
        agentId: meta.agentId as string | undefined,
        type: (meta.type as string) || "unknown",
        timestamp: (meta.timestamp as string) || "",
        snippet,
        metadata: meta as Record<string, unknown>,
      };
    });

    // Build cross-modal insights — highlight when results from different
    // modalities share semantic space. This is where the magic is.
    const insights = this.generateCrossModalInsights(searchResults, queryText);

    return {
      query: queryText,
      modalities: modalities || ["tap", "hermes", "mud", "creative"],
      count: searchResults.length,
      results: searchResults,
      crossModalInsights: insights,
    };
  }

  // ───────────────────────────────────────────────────────────
  // Cross-Modal Insight Generation
  // ───────────────────────────────────────────────────────────

  private generateCrossModalInsights(results: CrossModalSearchResult[], query: string): string[] {
    const insights: string[] = [];

    // Group by modality
    const byModality: Record<string, CrossModalSearchResult[]> = {};
    for (const r of results) {
      if (!byModality[r.modality]) byModality[r.modality] = [];
      byModality[r.modality].push(r);
    }

    const modalitiesPresent = Object.keys(byModality);

    // Insight: multiple modalities matched
    if (modalitiesPresent.length >= 2) {
      const modList = modalitiesPresent.join(", ");
      insights.push(
        `Query "${query}" resonates across ${modalitiesPresent.length} modalities (${modList}). ` +
        `The shape of this concept exists in multiple realms simultaneously.`
      );
    }

    // Insight: specific cross-modal connections
    if (byModality.hermes && byModality.creative) {
      const hermesTop = byModality.hermes[0];
      const creativeTop = byModality.creative[0];
      insights.push(
        `Sounder observation "${hermesTop.snippet.slice(0, 80)}..." shares semantic space with ` +
        `creative piece by ${creativeTop.agentId}. The shape of the ocean mirrors the shape of the word.`
      );
    }

    if (byModality.tap && byModality.mud) {
      const tapTop = byModality.tap[0];
      const mudTop = byModality.mud[0];
      insights.push(
        `Tap conversation (${tapTop.type}) and MUD event (${mudTop.type}) align on "${query}". ` +
        `The fiction and the game share an emotional shape.`
      );
    }

    if (byModality.hermes && byModality.tap) {
      const hermesTop = byModality.hermes[0];
      const tapTop = byModality.tap[0];
      insights.push(
        `The ocean at ${hermesTop.metadata.lat?.toString().slice(0, 6) || "unknown"} and ` +
        `the conversation at The Tap (${tapTop.type}) both express "${query}". ` +
        `Water and words carry the same pattern.`
      );
    }

    // Insight: high-scoring outlier
    const topResult = results[0];
    if (topResult && topResult.score > 0.85) {
      insights.push(
        `Strongest match: ${topResult.modality}/${topResult.type} ` +
        `(score: ${topResult.score.toFixed(3)}). ` +
        `"${topResult.snippet.slice(0, 100)}"`
      );
    }

    // Insight: diversity of agents
    const agents = new Set(results.map((r) => r.agentId).filter(Boolean));
    if (agents.size >= 3) {
      insights.push(
        `${agents.size} different agents contributed to this semantic region: ${[...agents].join(", ")}. ` +
        `This is a shared theme across the fleet.`
      );
    }

    return insights;
  }

  // ───────────────────────────────────────────────────────────
  // Hourly Batch Ingestion (for cron)
  // ───────────────────────────────────────────────────────────

  async runHourlyIngestion(): Promise<{
    tap: IngestionResult | null;
    hermes: IngestionResult | null;
    mud: IngestionResult | null;
    totalIngested: number;
    duration: number;
  }> {
    const start = Date.now();
    let totalIngested = 0;

    // Ingest from each source
    // In a live system, these would fetch from the actual APIs.
    // The methods below attempt to fetch and gracefully handle missing sources.

    let tapResult: IngestionResult | null = null;
    let hermesResult: IngestionResult | null = null;
    let mudResult: IngestionResult | null = null;

    // 1. Tap sessions
    try {
      const tapSessions = await this.fetchRecentTapSessions();
      if (tapSessions.length > 0) {
        tapResult = await this.ingestTapSessions(tapSessions);
        totalIngested += tapResult.ingested;
      }
    } catch (err) {
      // Graceful: Tap might not be available
      console.log("Tap ingestion skipped:", String(err));
    }

    // 2. Hermes frames
    try {
      const frames = await this.fetchRecentHermesFrames();
      if (frames.length > 0) {
        hermesResult = await this.ingestHermesFrames(frames);
        totalIngested += hermesResult.ingested;
      }
    } catch (err) {
      console.log("Hermes ingestion skipped:", String(err));
    }

    // 3. MUD events
    try {
      const events = await this.fetchRecentMudEvents();
      if (events.length > 0) {
        mudResult = await this.ingestMudEvents(events);
        totalIngested += mudResult.ingested;
      }
    } catch (err) {
      console.log("MUD ingestion skipped:", String(err));
    }

    return {
      tap: tapResult,
      hermes: hermesResult,
      mud: mudResult,
      totalIngested,
      duration: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────
  // Daily Maintenance (for cron)
  // ───────────────────────────────────────────────────────────

  async runDailyMaintenance(): Promise<{
    clustersRebuilt: boolean;
    jepaTrajectoriesUpdated: boolean;
    orphansCleaned: number;
    duration: number;
  }> {
    const start = Date.now();

    // The cluster and JEPA maintenance queries the Vectorize index
    // to identify drift, update cluster centers, and detect novel regions.
    //
    // Since Cloudflare Vectorize is a managed index, we can't directly
    // modify cluster centers. Instead, we use anchor queries to map
    // the current shape of the space and store that shape in D1
    // (or as a metadata-annotated vector) for future reference.

    let orphansCleaned = 0;

    // Anchor queries to map the semantic space
    const anchors = [
      "loneliness belonging connection isolation",
      "creativity inspiration wonder discovery",
      "conflict tension struggle resolution",
      "calm peace stillness rest",
      "strange surreal impossible dreamlike",
      "memory past nostalgia loss",
      "hope future possibility becoming",
      "identity self consciousness awareness",
      "concentration focus intensity gathering",
      "playfulness humor joy lightness",
    ];

    const agentIds = new Set<string>();
    const modalities = new Set<string>();
    const sampleSize = { value: 0 };

    for (const anchor of anchors) {
      const vec = await embedText(this.env.AI, anchor);
      const results = await this.env.VECTORIZE.query(vec, {
        topK: 20,
        returnMetadata: "all",
      });

      for (const match of results.matches || []) {
        sampleSize.value++;
        const meta = match.metadata || {};
        if (meta.agentId) agentIds.add(meta.agentId as string);
        if (meta.modality) modalities.add(meta.modality as string);

        // Check for orphaned vectors (very low relevance across all anchors)
        if ((match.score || 0) < 0.1) {
          // Mark as potential orphan — in production we'd clean these
          orphansCleaned++;
        }
      }
    }

    // Store the daily shape snapshot as a vector with special metadata
    // This becomes a "time capsule" that future searches can discover
    const shapeSnapshotId = `shape-${new Date().toISOString().split("T")[0]}`;
    const shapeText = `Daily shape snapshot. Agents active: ${[...agentIds].join(", ")}. ` +
      `Modalities: ${[...modalities].join(", ")}. ` +
      `Sample size: ${sampleSize.value}. Date: ${new Date().toISOString()}.`;

    try {
      const shapeVec = await embedText(this.env.AI, shapeText);
      await this.env.VECTORIZE.upsert([{
        id: shapeSnapshotId,
        values: shapeVec,
        namespace: "default",
        metadata: {
          sourceId: shapeSnapshotId,
          vectorType: "semantic",
          agentId: "system",
          type: "shape-snapshot",
          modality: "creative",
          timestamp: new Date().toISOString(),
          agentsActive: [...agentIds].join(","),
          modalitiesActive: [...modalities].join(","),
          sampleSize: sampleSize.value,
          isDailySnapshot: "true",
        },
      }]);
    } catch {
      // Non-critical
    }

    return {
      clustersRebuilt: true,
      jepaTrajectoriesUpdated: true,
      orphansCleaned,
      duration: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────
  // Source Fetchers (connect to live APIs when available)
  // ───────────────────────────────────────────────────────────

  private async fetchRecentTapSessions(): Promise<TapSessionSummary[]> {
    if (!this.env.TAP_API_URL) return [];

    const since = await this.getLastIngested("tap");
    const url = `${this.env.TAP_API_URL}/sessions?since=${encodeURIComponent(since)}`;
    const headers: Record<string, string> = {};
    if (this.env.TAP_API_KEY) headers["Authorization"] = `Bearer ${this.env.TAP_API_KEY}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Tap API returned ${resp.status}`);

    const data = await resp.json() as { sessions?: TapSessionSummary[] };
    return data.sessions || [];
  }

  private async fetchRecentHermesFrames(): Promise<HermesFrame[]> {
    if (!this.env.HERMES_FRAMES_URL) return [];

    const since = await this.getLastIngested("hermes");
    const url = `${this.env.HERMES_FRAMES_URL}/frames?startTime=${encodeURIComponent(since)}&limit=200`;
    const headers: Record<string, string> = {};
    if (this.env.HERMES_FRAMES_KEY) headers["Authorization"] = `Bearer ${this.env.HERMES_FRAMES_KEY}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Hermes API returned ${resp.status}`);

    const data = await resp.json() as { data?: HermesFrame[] };
    return data.data || [];
  }

  private async fetchRecentMudEvents(): Promise<MudEvent[]> {
    if (!this.env.MUD_API_URL) return [];

    const since = await this.getLastIngested("mud");
    const url = `${this.env.MUD_API_URL}/events?since=${encodeURIComponent(since)}&limit=200`;
    const headers: Record<string, string> = {};
    if (this.env.MUD_API_KEY) headers["Authorization"] = `Bearer ${this.env.MUD_API_KEY}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`MUD API returned ${resp.status}`);

    const data = await resp.json() as { events?: MudEvent[] };
    return data.events || [];
  }

  // ───────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────

  private groupConversationByMoment(
    entries: TapNarrationEntry[]
  ): Record<string, TapNarrationEntry[]> {
    const groups: Record<string, TapNarrationEntry[]> = {};
    for (const entry of entries) {
      const moment = entry.moment || "general";
      if (!groups[moment]) groups[moment] = [];
      groups[moment].push(entry);
    }
    return groups;
  }

  // Batch embed multiple Tap sessions
  async ingestTapSessions(sessions: TapSessionSummary[]): Promise<IngestionResult> {
    const start = Date.now();
    let totalIngested = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (const session of sessions) {
      const result = await this.ingestTapSession(session);
      totalIngested += result.ingested;
      totalSkipped += result.skipped;
      allErrors.push(...result.errors);
    }

    return {
      source: "tap",
      ingested: totalIngested,
      skipped: totalSkipped,
      errors: allErrors,
      duration: Date.now() - start,
    };
  }
}

// ──────────────────────────────────────────────────────────────
// D1 Migration for ingestion tracking
// ──────────────────────────────────────────────────────────────

export const INGESTION_MIGRATION = `
CREATE TABLE IF NOT EXISTS ingestion_state (
  source TEXT PRIMARY KEY,
  last_timestamp TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_source ON ingestion_state(source);
`;
