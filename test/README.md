# test/ — Sea Trials for the Deep Memory

**Three test files. Embedding, temporal stamping, and JEPA prediction.**

---

## Files

### [embed.test.ts](./embed.test.ts)
Tests the three-vector embedding system: `extractVibeSummary()` emotional arc extraction (beginning, middle, end), `extractIdentitySnapshot()` context encoding, `embedText()` Workers AI integration with mocked binding, `embedPiece()` full three-vector generation and Vectorize upsert.

### [temporal.test.ts](./temporal.test.ts)
Tests temporal stamping: `getSessionPhase()` hour-to-phase mapping (late-night through late-evening), `stamp()` full temporal DNA generation, fleet epoch resolution (pre-fleet through collective-unconscious), agent age calculation, relationship age tracking.

### [jepa.test.ts](./jepa.test.ts)
Tests the JEPA trajectory reader: `predict()` given recent vectors produces correct trajectory analysis (growth, stuckness, direction, velocity, acceleration), novelty classification (familiar, adjacent, frontier, unknown), vector math invariants (cosine similarity bounds, normalization correctness), region density estimation.

---

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

---

[← Back to root](../README.md)
