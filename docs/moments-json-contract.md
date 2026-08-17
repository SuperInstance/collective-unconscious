# The Moments JSON Contract — the elephant ↔ collective-unconscious bridge

*2026-08-17 · the shared-memory seam*

The elephant (Python) **computes** readings; the collective-unconscious
(TypeScript) **stores and retrieves** them. The bridge between the two
repos is one JSON document: an array of **moments**, produced by the
elephant and consumed by this repo's seam script
(`scripts/momentsToJson.ts`).

## The contract

A moments file is one of:

```json
[ { "text": "...", "readings": { ... }, "ts": 1724000000.0, "space_id": "wheelhouse", "meta": { ... } }, ... ]
```

```json
{ "moments": [ { ... }, ... ] }
```

```json
{ "moments": { "<id>": { ... }, ... } }
```

Each moment is exactly the elephant's moment dict — snake_case and all:

| field      | type                       | what it is                                              | source in the elephant |
|------------|----------------------------|---------------------------------------------------------|------------------------|
| `text`     | string                     | the shadow — the witness words                          | `moment_from_text` / `moment_from_room` / `moments_from_markdown` |
| `readings` | dict of dial → float       | the JEPA reading — what the room FELT (the 9 dials)     | the dial bank's `readings(room)` |
| `ts`       | number (epoch seconds)     | the time stamp — when it happened                       | `moment_from_*` `ts` param |
| `space_id` | string                     | the space stamp — which room it happened in             | `moment_from_*` `space_id` param |
| `meta`     | dict (optional)            | anything else worth riding along                        | `moment_from_*` `meta` param |
| `id`       | string (optional)          | a name; derived from `meta.source` + `meta.chunk` when absent | — |

### The 9 dials — the vector layout

`readings` keys come from the elephant's `DEFAULT_DIALS`, in this exact
order (it is the vector layout both sides store and query in):

```
mood, volume, earnestness, cynicism, joke_landing, panic, presence, model_vs_code, vision
```

Missing dials read `0.0` (the vector's origin, like `RoomField.vector()`).
`readings` may be partial; the TS side zero-fills. Extra dials beyond
the bank are preserved and ride along on every hit.

### Example — produced by the elephant

```python
from elephant.jepa_rag import moment_from_text

moment = moment_from_text(
    "The wheelhouse window is white with spray — the squall line "
    "three miles out and closing. All hands on deck!",
    space_id="wheelhouse",
    ts=1724000000.0,
    meta={"source": "fleet-night", "chunk": 1},
)
```

```json
{
  "text": "The wheelhouse window is white with spray — the squall line three miles out and closing. All hands on deck!",
  "readings": {
    "mood": 0.0,
    "volume": 0.0105,
    "earnestness": 0.5,
    "cynicism": 0.0,
    "joke_landing": 0.0,
    "panic": 0.05,
    "presence": 0.0925,
    "model_vs_code": 0.0,
    "vision": 0.5
  },
  "ts": 1724000000.0,
  "space_id": "wheelhouse",
  "meta": { "source": "fleet-night", "chunk": 1 }
}
```

## Consuming it — the seam

```bash
# Ingest the elephant's moments into the ReadingsIndex
npx tsx scripts/momentsToJson.ts --in moments.json

# …with demo queries (text, reading profile, field, space)
npx tsx scripts/momentsToJson.ts --in moments.json \
  --query "squall hatches" \
  --feeling mood:0.8 --feeling panic:0.0 \
  --field 0.8,0.1,0.6,0.1,0.2,0,0.9,0,0.4 \
  --space wheelhouse

# …or write the enriched corpus (each moment + its dial-order
# readingVector) for the worker to upsert
npx tsx scripts/momentsToJson.ts --in moments.json --out enriched.json
```

## Honesty rules on the TS side

- The TS side **never computes readings from text** — it only stores and
  retrieves what the elephant computed. A moment without `readings`
  ingests as a zero vector with a loud warning (the origin is honest,
  but it is not a reading).
- Every retrieved hit carries its `readings` and dial-order
  `readingVector` — the citizen rides along on every hit.
- `readings` is the source of truth; a conflicting `readingVector`
  (beyond the seam — the index also accepts raw vectors) is rejected,
  not silently resolved. Reading vectors are exactly 9-dimensional.
- Duplicate ids are rejected: a shared memory cannot hold two witnesses
  under one name.

*Computed by the elephant, stored by the collective. The bridge is the
JSON; the feelings are first-class citizens on both sides.*
