// src/index.ts
// Collective Unconscious — Vectorized fleet memory in Cloudflare
// The collected unconscious of the creative fleet, stamped by time.
// Stories that won't be iterated together like that again.

import { embedPiece, embedText, type EmbedRequest, type AiBinding, EMBED_DIMENSIONS } from "./embed";
import { stamp, timeRangeToFilter } from "./temporal";
import { predict, describePrediction, type JEPAPrediction } from "./jepa";
import { IngestionPipeline, type IngestionEnv, type CrossModalQuery } from "./ingestion-pipeline";

export interface Env {
  VECTORIZE: VectorizeIndex;
  AI: AiBinding;
  DB?: D1Database;
  HERMES_FRAMES_URL?: string;
  HERMES_FRAMES_KEY?: string;
  TAP_API_URL?: string;
  TAP_API_KEY?: string;
  MUD_API_URL?: string;
  MUD_API_KEY?: string;
}

// In-memory CORS headers
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health check
    if (path === "/" || path === "/health") {
      return json({
        name: "collective-unconscious",
        status: "live",
        description: "The collected unconscious of the fleet, stamped by time.",
        endpoints: ["/embed", "/search", "/shape", "/jepa/:agentId", "/ingest/tap", "/ingest/hermes", "/ingest/mud", "/ingest/hourly", "/ingest/daily", "/cross-modal"],
        dimensions: EMBED_DIMENSIONS,
        timestamp: new Date().toISOString(),
      });
    }

    // POST /embed — embed a piece of content
    if (path === "/embed" && request.method === "POST") {
      try {
        const body = (await request.json()) as EmbedRequest;

        if (!body.id || !body.text || !body.agentId || !body.timestamp) {
          return json({ error: "Missing required fields: id, text, agentId, timestamp" }, 400);
        }

        // Generate temporal stamp
        const temporalStamp = stamp(body.timestamp, body.agentId);
        const stampRecord: Record<string, string | number | boolean> = { ...temporalStamp };

        // Embed the piece — generates 3 vectors (semantic, vibe, identity)
        const vectors = await embedPiece(env.AI, body, stampRecord);

        // Upsert all vectors into Vectorize
        const vectorizeIds = await env.VECTORIZE.upsert(vectors);

        return json({
          id: body.id,
          dimensions: EMBED_DIMENSIONS,
          timestamp: body.timestamp,
          vectorsStored: vectors.length,
          vectorIds: vectorizeIds,
          temporalStamp,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Embed failed", detail: message }, 500);
      }
    }

    // POST /search — semantic search over the corpus
    if (path === "/search" && request.method === "POST") {
      try {
        const body = await request.json() as {
          query: string;
          agentId?: string;
          type?: string;
          vectorType?: "semantic" | "vibe" | "identity";
          timeRange?: { start: string; end: string };
          limit?: number;
        };

        if (!body.query) {
          return json({ error: "Missing 'query' field" }, 400);
        }

        // Embed the query
        const queryVector = await embedText(env.AI, body.query);

        // Build metadata filter
        const filter = timeRangeToFilter(
          body.timeRange?.start,
          body.timeRange?.end,
          body.agentId,
          body.type
        );

        // Add vectorType filter (default: semantic)
        const metadata: Record<string, string> = {};
        metadata.vectorType = body.vectorType || "semantic";
        if (body.agentId) metadata.agentId = body.agentId;
        if (body.type) metadata.type = body.type;

        // Search Vectorize
        const results = await env.VECTORIZE.query(queryVector, {
          topK: body.limit || 10,
          filter: metadata,
          returnMetadata: "all",
        });

        // If no results with filter, retry without filter
        if ((!results.matches || results.matches.length === 0) && Object.keys(metadata).length > 0) {
          const results2 = await env.VECTORIZE.query(queryVector, {
            topK: body.limit || 10,
            returnMetadata: "all",
          });
          const matches2 = (results2.matches || []).map((match) => ({
            id: match.id,
            score: match.score,
            sourceId: match.metadata?.sourceId,
            vectorType: match.metadata?.vectorType,
            agentId: match.metadata?.agentId,
            type: match.metadata?.type,
            timestamp: match.metadata?.timestamp,
            metadata: match.metadata,
          }));
          return json({
            query: body.query,
            count: matches2.length,
            results: matches2,
            note: "Filter returned no results; showing unfiltered results.",
          });
        }

        // Format results
        const matches = (results.matches || []).map((match) => ({
          id: match.id,
          score: match.score,
          sourceId: match.metadata?.sourceId,
          vectorType: match.metadata?.vectorType,
          agentId: match.metadata?.agentId,
          type: match.metadata?.type,
          timestamp: match.metadata?.timestamp,
          metadata: match.metadata,
        }));

        return json({
          query: body.query,
          count: matches.length,
          results: matches,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Search failed", detail: message }, 500);
      }
    }

    // POST /shape — get the "shape" of the corpus
    if (path === "/shape" && request.method === "POST") {
      try {
        const body = await request.json() as {
          agentId?: string;
          timeRange?: { start: string; end: string };
        };

        // Query a sample of vectors to determine corpus shape
        // Use a zero vector to get "everything" (Vectorize will return nearest to origin)
        // Better: use multiple anchor queries to map the space
        const anchorQueries = [
          "loneliness belonging connection isolation",
          "creativity inspiration wonder discovery",
          "conflict tension struggle resolution",
          "calm peace stillness rest",
          "strange surreal impossible dreamlike",
          "memory past nostalgia loss",
          "hope future possibility becoming",
          "identity self consciousness awareness",
        ];

        const filter: Record<string, string> = { vectorType: "semantic" };
        if (body.agentId) filter.agentId = body.agentId;

        // Gather samples from each anchor
        const allSamples: VectorizeMatch[] = [];
        const seenIds = new Set<string>();

        for (const anchor of anchorQueries) {
          const anchorVec = await embedText(env.AI, anchor);
          // Try with filter first
          let results = await env.VECTORIZE.query(anchorVec, {
            topK: 15,
            filter,
            returnMetadata: "all",
          });
          // Fallback: no filter
          if (!results.matches || results.matches.length === 0) {
            results = await env.VECTORIZE.query(anchorVec, {
              topK: 15,
              returnMetadata: "all",
            });
          }
          for (const match of results.matches || []) {
            if (!seenIds.has(match.id)) {
              seenIds.add(match.id);
              allSamples.push(match);
            }
          }
        }

        // Build shape analysis
        const agentAttribution: Record<string, number> = {};
        const typeDistribution: Record<string, number> = {};
        const temporalDistribution: Record<string, number> = {};
        const phaseDistribution: Record<string, number> = {};

        for (const sample of allSamples) {
          const meta = sample.metadata || {};
          const agent = String(meta.agentId || "unknown");
          const type = String(meta.type || "unknown");
          const ts = String(meta.timestamp || "");
          const phase = String(meta.sessionPhase || "unknown");

          agentAttribution[agent] = (agentAttribution[agent] || 0) + 1;
          typeDistribution[type] = (typeDistribution[type] || 0) + 1;
          phaseDistribution[phase] = (phaseDistribution[phase] || 0) + 1;

          if (ts) {
            const day = ts.slice(0, 10); // YYYY-MM-DD
            temporalDistribution[day] = (temporalDistribution[day] || 0) + 1;
          }
        }

        // Identify clusters by grouping similar-score samples
        const clusters: {
          label: string;
          center: string;
          memberCount: number;
          avgScore: number;
          topPiece?: { id: string; agentId: string; type: string };
        }[] = [];

        // Simple clustering: group by agent + type combination
        const clusterMap: Record<string, VectorizeMatch[]> = {};
        for (const sample of allSamples) {
          const key = `${sample.metadata?.agentId || "unknown"}:${sample.metadata?.type || "unknown"}`;
          if (!clusterMap[key]) clusterMap[key] = [];
          clusterMap[key].push(sample);
        }

        for (const [key, members] of Object.entries(clusterMap)) {
          const avgScore = members.reduce((sum, m) => sum + (m.score || 0), 0) / members.length;
          const [agent, type] = key.split(":");
          clusters.push({
            label: `${agent} / ${type}`,
            center: anchorQueries[Math.floor(Math.random() * anchorQueries.length)],
            memberCount: members.length,
            avgScore,
            topPiece: members[0]
              ? {
                  id: String(members[0].metadata?.sourceId || members[0].id),
                  agentId: String(members[0].metadata?.agentId || agent),
                  type: String(members[0].metadata?.type || type),
                }
              : undefined,
          });
        }

        // Sort clusters by size
        clusters.sort((a, b) => b.memberCount - a.memberCount);

        return json({
          sampleSize: allSamples.length,
          totalClusters: clusters.length,
          clusters: clusters.slice(0, 12),
          agentAttribution,
          typeDistribution,
          temporalDistribution,
          phaseDistribution,
          analysis: {
            dominantAgent: Object.entries(agentAttribution).sort((a, b) => b[1] - a[1])[0]?.[0],
            dominantType: Object.entries(typeDistribution).sort((a, b) => b[1] - a[1])[0]?.[0],
            dominantPhase: Object.entries(phaseDistribution).sort((a, b) => b[1] - a[1])[0]?.[0],
            mostActiveDay: Object.entries(temporalDistribution).sort((a, b) => b[1] - a[1])[0]?.[0],
            span: {
              earliest: Object.keys(temporalDistribution).sort()[0],
              latest: Object.keys(temporalDistribution).sort().pop(),
            },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Shape analysis failed", detail: message }, 500);
      }
    }

    // POST /jepa/:agentId — JEPA prediction for an agent
    // Also works as POST /jepa with { agentId } in body
    if ((path.startsWith("/jepa")) && request.method === "POST") {
      try {
        const pathParts = path.split("/");
        const agentIdFromBody = pathParts[2]; // /jepa/:agentId
        const body = await request.json() as { agentId?: string; limit?: number };

        const agentId = agentIdFromBody || body.agentId;
        if (!agentId) {
          return json({ error: "Missing agentId" }, 400);
        }

        // Fetch agent's recent pieces via semantic search using a broad query
        // Get the agent's last 5 pieces by searching with identity vector type
        const identityQuery = `Agent: ${agentId}. All work by this agent.`;
        const queryVec = await embedText(env.AI, identityQuery);

        const results = await env.VECTORIZE.query(queryVec, {
          topK: body.limit || 5,
          filter: { agentId, vectorType: "semantic" },
          returnMetadata: "all",
        });

        // Fallback: no filter
        if (!results.matches || results.matches.length === 0) {
          const results2 = await env.VECTORIZE.query(queryVec, {
            topK: body.limit || 5,
            returnMetadata: "all",
          });
          const matches2 = (results2.matches || []).filter(
            (m) => m.metadata?.agentId === agentId
          );
          // Use these matches if available
          if (matches2.length >= 2) {
            const approxVectors2 = matches2.map((m) => {
              const score = m.score || 0;
              return queryVec.map((v) => v * (0.5 + score * 0.5));
            });
            const prediction2 = predict({ recentVectors: approxVectors2, agentId });
            return json({
              agentId,
              piecesAnalyzed: matches2.length,
              pieces: matches2.map((m) => ({
                id: m.metadata?.sourceId || m.id,
                type: m.metadata?.type,
                timestamp: m.metadata?.timestamp,
                score: m.score,
              })),
              prediction: {
                trajectory: prediction2.trajectory,
                regionDensity: prediction2.regionDensity,
                noveltyPrediction: prediction2.noveltyPrediction,
                description: describePrediction(prediction2),
              },
              note: "Filter did not match; results filtered client-side.",
            });
          }
        }

        // For JEPA, we need the actual vectors. Vectorize returns scores, not vectors.
        // We'll approximate trajectory using score patterns and metadata.
        // A more robust version would store vectors in KV or D1 for retrieval.
        const matches = (results.matches || []);

        if (matches.length < 2) {
          return json({
            agentId,
            prediction: null,
            error: "Not enough data for JEPA prediction. Need at least 2 pieces.",
            piecesFound: matches.length,
          });
        }

        // Since we can't retrieve raw vectors from Vectorize query,
        // we approximate using the query vector scaled by scores
        // This is a reasonable approximation since high-score matches are near the query vector
        const approxVectors = matches.map((m) => {
          const score = m.score || 0;
          return queryVec.map((v) => v * (0.5 + score * 0.5));
        });

        const prediction = predict({
          recentVectors: approxVectors,
          agentId,
        });

        const description = describePrediction(prediction);

        return json({
          agentId,
          piecesAnalyzed: matches.length,
          pieces: matches.map((m) => ({
            id: m.metadata?.sourceId || m.id,
            type: m.metadata?.type,
            timestamp: m.metadata?.timestamp,
            score: m.score,
          })),
          prediction: {
            trajectory: prediction.trajectory,
            regionDensity: prediction.regionDensity,
            noveltyPrediction: prediction.noveltyPrediction,
            description,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "JEPA prediction failed", detail: message }, 500);
      }
    }

    // ── POST /ingest/tap — Ingest a Tap session ──
    if (path === "/ingest/tap" && request.method === "POST") {
      try {
        const pipeline = new IngestionPipeline(env);
        const body = await request.json() as Parameters<typeof pipeline.ingestTapSession>[0];
        const result = await pipeline.ingestTapSession(body);
        return json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Tap ingestion failed", detail: message }, 500);
      }
    }

    // ── POST /ingest/hermes — Ingest Hermes frames ──
    if (path === "/ingest/hermes" && request.method === "POST") {
      try {
        const body = await request.json() as { frames?: unknown[] };
        const pipeline = new IngestionPipeline(env);
        const result = await pipeline.ingestHermesFrames((body.frames || []) as Parameters<typeof pipeline.ingestHermesFrames>[0]);
        return json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Hermes ingestion failed", detail: message }, 500);
      }
    }

    // ── POST /ingest/mud — Ingest MUD events ──
    if (path === "/ingest/mud" && request.method === "POST") {
      try {
        const body = await request.json() as { events?: unknown[] };
        const pipeline = new IngestionPipeline(env);
        const result = await pipeline.ingestMudEvents((body.events || []) as Parameters<typeof pipeline.ingestMudEvents>[0]);
        return json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "MUD ingestion failed", detail: message }, 500);
      }
    }

    // ── POST /ingest/hourly — Run hourly batch ingestion ──
    if (path === "/ingest/hourly" && request.method === "POST") {
      try {
        const pipeline = new IngestionPipeline(env);
        const result = await pipeline.runHourlyIngestion();
        return json({
          status: "complete",
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Hourly ingestion failed", detail: message }, 500);
      }
    }

    // ── POST /ingest/daily — Run daily maintenance ──
    if (path === "/ingest/daily" && request.method === "POST") {
      try {
        const pipeline = new IngestionPipeline(env);
        const result = await pipeline.runDailyMaintenance();
        return json({
          status: "complete",
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Daily maintenance failed", detail: message }, 500);
      }
    }

    // ── POST /cross-modal — Cross-modal search across ALL modalities ──
    if (path === "/cross-modal" && request.method === "POST") {
      try {
        const body = await request.json() as CrossModalQuery;

        if (!body.query) {
          return json({ error: "Missing 'query' field" }, 400);
        }

        const pipeline = new IngestionPipeline(env);
        const result = await pipeline.crossModalSearch({
          query: body.query,
          modalities: body.modalities,
          limit: body.limit,
          timeRange: body.timeRange,
          minScore: body.minScore,
        });

        return json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: "Cross-modal search failed", detail: message }, 500);
      }
    }

    // 404
    return json({ error: "Not found", path }, 404);
  },

  // ── Cron triggers ──
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const pipeline = new IngestionPipeline(env);

    const cron = controller.cron;

    if (cron.includes("0 * * * *")) {
      // Hourly: ingest new data from all sources
      ctx.waitUntil(
        pipeline.runHourlyIngestion().then((result) => {
          console.log("Hourly ingestion complete:", JSON.stringify(result));
        })
      );
    } else if (cron.includes("0 2 * * *")) {
      // Daily at 2 AM: rebuild cluster centers and JEPA trajectories
      ctx.waitUntil(
        pipeline.runDailyMaintenance().then((result) => {
          console.log("Daily maintenance complete:", JSON.stringify(result));
        })
      );
    }
  },
};
