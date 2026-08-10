# src/ — The Deep Memory Engine

**Five TypeScript modules. The complete collective unconscious pipeline.**

---

## Files

### [index.ts](./index.ts)
**The Worker entry point.** Routes all API endpoints, handles CORS, wires Vectorize + AI + D1 bindings. Endpoints: `/embed`, `/search`, `/shape`, `/jepa/:agentId`, `/cross-modal`, `/ingest/*`. Health check at `/` returns system status and available endpoints.

### [embed.ts](./embed.ts)
**The three-vector embedding system.** For each piece, generates three vectors using Workers AI `@cf/baai/bge-m-3` (1024 dimensions):
- **Semantic** — full text embedding (what it means)
- **Vibe** — emotional arc embedding via `extractVibeSummary()` (beginning → middle → end)
- **Identity** — context embedding via `extractIdentitySnapshot()` (who/when/what)

All three stored as separate vectors in the same Vectorize index, linked by `sourceId` metadata.

### [temporal.ts](./temporal.ts)
**The time DNA.** Every vector carries a `TemporalStamp`: wall clock time, session phase (late-night through late-evening), fleet epoch (pre-fleet through collective-unconscious), agent age, relationship age. Defines fleet epochs and agent start dates. The temporal stamp gives every memory its circadian rhythm — you can feel the age of a thought.

### [jepa.ts](./jepa.ts)
**The JEPA trajectory reader.** Given an agent's recent output vectors, predicts the shape of their next piece. Computes: growth (expanding?), stuckness (circling?), direction (expanding/contracting/stable/pivoting), velocity, acceleration, novelty (familiar/adjacent/frontier/unknown). Vector math: add, subtract, scale, normalize, cosine similarity. Not generation — trajectory reading.

### [ingestion-pipeline.ts](./ingestion-pipeline.ts)
**Cross-modal ingestion.** Wires The Tap (conversations), Hermes (sounder frames), and the MUD (game events) into one searchable memory. Cross-modal search returns results across all modalities — a feed ball might match a poem about concentration. Ingestion state tracked in D1. Auto-ingestion via hourly cron.

---

## Data Flow

```
Tap conversations ─┐
Hermes frames ─────┼──→ IngestionPipeline ──→ embed() ──→ 3 vectors per piece
MUD events ────────┘                                        │
                                                            ↓
                                                    Cloudflare Vectorize
                                                    (1024-dim, bge-m-3)
                                                            │
                                    ┌───────────────────────┼───────────────┐
                                    ↓                       ↓               ↓
                              /search               /jepa/:id         /cross-modal
                              (by meaning)          (trajectory)      (across sources)
```

---

[← Back to root](../README.md)
