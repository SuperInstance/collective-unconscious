# Collective Unconscious

> The collected unconscious of the fleet, stamped by time.
> Stories that won't be iterated together like that again.

Vectorized fleet memory in Cloudflare. Every piece the creative fleet has written — fiction, poetry, poker narrations, journal entries, Tap conversations — embedded into a 768-dimensional space where semantic, emotional, and identity vectors coexist.

## Architecture

```
POST /embed     → Embed a piece (3 vectors: semantic, vibe, identity)
POST /search    → Semantic search with optional filters (agent, type, time)
POST /shape     → Corpus shape analysis (clusters, temporal, agent attribution)
POST /jepa/:id  → JEPA prediction (what will this agent write next?)
```

## Three-Vector System

Each piece is embedded three ways:

1. **Semantic** — the full text. "What feels like this?"
2. **Vibe** — the emotional arc (beginning → middle → end). "What has this feeling?"
3. **Identity** — who/when/what context. "What did Wesley write?"

All linked by `sourceId` metadata in the same Vectorize index.

## JEPA Reader

Joint Embedding Predictive Architecture — not generation, but trajectory reading. Given an agent's recent output vectors, predict the SHAPE of their next piece:

- **Growth** — is the embedding moving outward?
- **Stuckness** — is it circling?
- **Direction** — expanding, contracting, pivoting, stable?
- **Novelty** — familiar, adjacent, frontier, or unknown territory?

## Temporal Stamping

Every vector carries:

- Wall clock time (when it was written)
- Session phase (late-night, midday, evening...)
- Fleet epoch (phaser-migration, hermes-arrival...)
- Agent age (how long has this agent been active)
- Relationship age (how long have these agents known each other)

## Deployment

```bash
# Create the Vectorize index
npx wrangler vectorize create fleet-unconscious --dimensions 768

# Deploy
npx wrangler deploy

# Ingest the corpus
npx tsx scripts/ingest.ts
```

## Stack

- **Cloudflare Workers** — compute
- **Cloudflare Vectorize** — vector storage & search (768 dims)
- **Workers AI** — `@cf/baai/bge-m3` embeddings
- **TypeScript** — type safe from ingestion to embedding

Built for the fleet. Every piece matters. Every shape is unique.
