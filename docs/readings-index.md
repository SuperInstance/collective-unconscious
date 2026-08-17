# The Readings Index — the collective unconscious, searchable by feeling

*2026-08-17 · the fleet's shared memory, matured*

> The captain: *"keep maturing old infant repos with modern concepts and
> tools and cross-pollinate and synergize."*
> And: *"Think about a RAG with Jepa readings as first-class citizens
> along side time and space stamps."*

This is that maturation. `src/readingsIndex.ts` is a modern memory laid
inside the collective-unconscious: an index where every entry is a
**moment** — a witness shadow **with its room's JEPA reading vector**,
beside its time and space stamps — retrievable by **feeling**, not just
by text.

## The problem with a normal RAG

A normal RAG indexes text embeddings and retrieves similar text. Ask it
"what did the room feel like during the fight?" and it does its best —
but the feeling was never indexed. The words are the shadow; the
feeling is the terrain. Retrieving by words alone is retrieving shadows
without their terrain.

This index stores **moments** instead:

| field            | what it is                                              |
|------------------|---------------------------------------------------------|
| `text`           | the shadow — the witness words                          |
| `readings`       | the JEPA reading vector — what the room FELT (the 9 dials) |
| `readingVector`  | the same citizen in dial order (the vector layout)      |
| `ts`             | the time stamp — when it happened                       |
| `spaceId`        | the space stamp — which room it happened in             |
| `meta`           | anything else worth riding along                        |

The reading vector is **not metadata on the text**. It is a first-class
retrieval dimension, no less than the words. Time and space stamps ride
beside it as dimensions too. That is the captain's "alongside" made
concrete.

## The two-sided bridge

The cross-pollination is deliberately two-sided:

- **The elephant (Python)** computes readings. Its dial bank
  (`elephant/dials/` — nine JEPA senses: mood, volume, earnestness,
  cynicism, joke_landing, panic, presence, model_vs_code, vision) reads
  a room and produces a reading dict. `elephant/jepa_rag.py` turns
  rooms, texts, and markdown transcripts into moments.
- **The collective-unconscious (TypeScript)** stores and retrieves
  them. `ReadingsIndex` is the shared memory; every ingested event —
  a Hermes frame, a MUD event, a Tap session, a speech — arrives with
  its reading as first-class metadata.

The bridge is one JSON document, the **moments JSON contract**
([`docs/moments-json-contract.md`](./moments-json-contract.md), mirrored
in the elephant repo as `docs/collective-unconscious-bridge.md`). The
seam script ([`scripts/momentsToJson.ts`](../scripts/momentsToJson.ts))
reads the elephant's moments JSON and ingests it; the TS side never
guesses a feeling from words — it only stores what the elephant
computed.

## The queries

All queries return ranked `MomentHit`s — the witness text **with** its
reading vector, ts, and space. The first-class citizens ride along on
every hit; that is the honesty guarantee.

| query | what it does | the idiom |
|-------|--------------|----------|
| `queryByText(q)` | bag-of-words cosine against the shadows | the normal RAG way — what the words say |
| `queryByReadings(profile)` | cosine in JEPA space to a target reading profile — or (lo, hi) RANGE constraints per dial ("mood > 0.6, panic < 0.2" made literal) | **the first-class-citizen query** — what the room FELT |
| `queryByField(vector)` | nearest neighbors in JEPA space to a field (a readings dict or a dial-order vector) | the perfume query — "find the moment that felt most like right now" |
| `queryByTime(window)` | hard filter on the time stamp, ranked by proximity to the window's center | "what happened here yesterday at this hour?" |
| `queryBySpace(spaceId)` | hard filter on the space stamp, ranked newest-first | "what did the wheelhouse feel like last week?" |
| `queryCombined(parts, weights)` | weighted sum of every present dimension — text 0.3, readings 0.5, time 0.1, space 0.1 by default, renormalized over what you give it | the full RAG query — the captain's "alongside" |

The math is deliberately small + honest: plain arrays, one cosine loop,
a bag-of-words TF matrix for the lexical side. No learned embeddings,
no vector database — a few dozen moments, nine dials of meaning.

### The first-class-citizen query

`queryByReadings({ panic: 0.95, mood: -0.6, volume: 0.85 })` is the
heart of this design: the JEPA reading **is** the query, exactly as the
text is in a normal RAG. Partial profiles are fine — unspecified dials
read 0.0 (the vector's origin). The ranking is raw cosine in reading
space: negative means the moment is the *opposite* feeling, and that is
honest information.

For the captain's threshold idiom, pass ranges:
`queryByReadings({ mood: [0.6, 1.0], panic: [0.0, 0.2] })` ranks by the
fraction of dials inside their bounds — a literal "mood > 0.6 and
panic < 0.2" that never lets a panicky moment sneak in because it is
otherwise close.

### The combined query — weights

```
score = w_text·text_sim  +  w_readings·reading_sim
      + w_time·time_proximity  +  w_space·space_match
```

Default weights are the captain's proportions: readings 0.5, text 0.3,
time 0.1, space 0.1. Weights renormalize over the dimensions actually
present, so a pure feeling query ranks on the full reading weight.
Space and time are **soft** inside the combination (a wrong-space
moment scores 0 on that dimension but can still rank on the others) —
for hard filters, use `queryBySpace` / `queryByTime` alone. Every
dimension's score is clipped to [0, 1] so the weights mean what they
say.

### Stamps

`queryByTime` and `queryBySpace` return **every** matching moment when
`topK` is omitted — the honest "show me the whole room" answer. The
text / readings / field / combined queries default to top 5.

## Design choices worth naming

- **The reading vector is raw, not centered.** Cosine runs on the dials
  as the bank reads them, exactly like `RoomField.vector()` — the
  fleet's existing field math. A centered or variance-whitened reading
  space is a future refinement; the query API does not change when it
  lands.
- **Strictness over silence.** Duplicate ids throw; a readings dict and
  a reading vector that disagree throw; vectors longer than the dial
  bank throw; NaN stamps and NaN bounds throw. A shared memory that
  silently resolves contradictions is a shared memory that lies.
- **The elephant's parity is preserved** where its behavior is a
  *choice* (raw cosine honesty, zero-filled partial profiles, epoch-0
  default stamps, `\w+` tokenization) and improved where its behavior
  was a *gap* (mixed profiles now throw instead of silently dropping
  scalars).
- **topK semantics match the elephant**: text/readings/combined default
  to 5; time/space return all when omitted.

## The fleet's shared memory

This is how the collective unconscious becomes searchable **by
feeling**: every room the fleet has ever been in is a moment with its
reading vector. The Tap's trade nights, the captain's speeches, the
wheelhouse's storm watch and dawn watch, the galley fight — every one
is a moment with its 9-dial reading beside its time and space stamps.
Ask for the fight by its panic, ask for a good night by its warmth, ask
for the wheelhouse by its name, ask for last week by its stamps — or
ask for the moment that feels most like right now, and the perfume
takes you to grandma's shop.

## Files

- `src/readingsIndex.ts` — the index, the queries, the moment builders
- `scripts/momentsToJson.ts` — the elephant seam (moments JSON → index)
- `docs/moments-json-contract.md` — the JSON contract, documented
- `test/test_readingsIndex.test.ts` — 42 tests: reading-profile
  retrieval, range constraints, field nearest-feeling, time/space
  filters, combined-beats-text-only, and the honesty guarantee (every
  hit carries its readings)
- elephant repo: `docs/collective-unconscious-bridge.md` — the seam's
  other half, read-only

---

*Retrieval by feeling. The shadow with its terrain. Enough to agree on
the action.*

— *the fleet's memory engineer, 2026-08-17*
