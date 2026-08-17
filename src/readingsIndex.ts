// src/readingsIndex.ts
// The Readings Index — the fleet's shared memory, searchable BY FEELING.
//
// Maturation, cross-pollinated from the elephant (elephant/jepa_rag.py):
// every ingested event (a Hermes frame, a MUD event, a Tap session, a
// speech) carries its ROOM'S READING VECTOR as first-class metadata —
// beside its time and space stamps — so the collective memory can be
// retrieved by FEELING, not just by text.
//
// The cross-pollination is two-sided: the elephant (Python) COMPUTES
// readings with its dial bank; the collective-unconscious (TypeScript)
// STORES and RETRIEVES them. The bridge is the JSON contract in
// docs/moments-json-contract.md; the seam script is
// scripts/momentsToJson.ts.
//
// The math is deliberately small + honest: plain arrays and one cosine
// loop. No learned embeddings, no vector database — a few dozen moments,
// nine dials of meaning.

/**
 * The JEPA dials — the retrieval dimensions. Order matters: it is the
 * vector layout every moment is stored and queried in. Must match the
 * elephant's `JEPA_DIAL_NAMES` (elephant/dials/__init__.py → the order
 * of DEFAULT_DIALS).
 */
export const JEPA_DIAL_NAMES = [
  "mood",
  "volume",
  "earnestness",
  "cynicism",
  "joke_landing",
  "panic",
  "presence",
  "model_vs_code",
  "vision",
] as const;

export type DialName = (typeof JEPA_DIAL_NAMES)[number];

/**
 * Default combined-query weights: readings are the heaviest citizen,
 * text next, time and space stamps alongside (the captain's "beside").
 * Mirrors the elephant's DEFAULT_WEIGHTS exactly.
 */
export const DEFAULT_WEIGHTS = { text: 0.3, readings: 0.5, time: 0.1, space: 0.1 };

export type CombinedWeights = Partial<typeof DEFAULT_WEIGHTS>;

/** A moment as ingested. `readings` and `readingVector` are two views
 * of the same citizen: the readings dict is authoritative when both
 * are given (and they must agree); if only one is given the other is
 * derived. Missing dials read 0.0 — the vector's origin, exactly like
 * RoomField.vector(). Reading vectors are exactly 9-dimensional;
 * extra dims belong in `readings`, not the vector. */
export interface MomentEntry {
  /** Unique id — the seam script derives it from the elephant moment
   * (`id`, or `meta.source` + chunk, or a running index). */
  id: string;
  /** The shadow: the witness words. Must be non-empty. */
  text: string;
  /** Per-dial readings — may be partial; extra dials ride along. */
  readings?: Record<string, number>;
  /** Dial-order vector — derived from `readings` if absent. */
  readingVector?: number[];
  /** Time stamp (epoch seconds — the elephant's float ts). */
  ts?: number;
  /** Space stamp — which room. Defaults to "unspecified". */
  spaceId?: string;
  /** Anything else worth riding along. */
  meta?: Record<string, unknown>;
}

/** A retrieved moment: the shadow WITH its terrain context. The reading
 * vector rides along on every hit — it is a first-class citizen, not
 * metadata. */
export interface MomentHit extends MomentEntry {
  readings: Record<string, number>;
  readingVector: number[];
  ts: number;
  spaceId: string;
  /** Retrieval score of the query that produced this hit. */
  score: number;
  index: number;
}

/** A reading query: dial → target value, or dial → [lo, hi] range
 * constraints ("mood > 0.6, panic < 0.2" made literal). */
export type ReadingProfile = Record<string, number | readonly [number, number]>;

/** Time window: [start, end], {start, end}, or a single instant. */
export type TimeWindow = [number, number] | { start: number; end: number } | number;

export interface QueryOptions {
  topK?: number;
}

export interface CombinedParts {
  text?: string;
  readings?: ReadingProfile | number[];
  /** "time" and "ts" are the same stamp. */
  time?: TimeWindow;
  ts?: TimeWindow;
  space?: string;
}

interface StoredMoment {
  id: string;
  text: string;
  readings: Record<string, number>;
  readingVector: number[];
  ts: number;
  spaceId: string;
  meta: Record<string, unknown>;
}

// ------------------------------------------------------------------ //
// Small honest primitives                                            //
// ------------------------------------------------------------------ //

function tokenize(text: string): string[] {
  return (text || "").toLowerCase().match(/\w+/g) ?? [];
}

/** Cosine similarity between two equal-length vectors; 0 on zero norm. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** Readings dict → dial-order vector. Unknown dials are dropped (they
 * are not retrieval dimensions); missing known dials read 0.0. */
export function readingsToVector(
  readings: Record<string, number>,
  names: readonly string[] = JEPA_DIAL_NAMES,
): number[] {
  return names.map((n) => readings[n] ?? 0);
}

/** Dial-order vector → readings dict, keyed by dial name. */
export function vectorToReadings(
  vector: number[],
  names: readonly string[] = JEPA_DIAL_NAMES,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < names.length; i++) out[names[i]] = vector[i] ?? 0;
  return out;
}

// ------------------------------------------------------------------ //
// The memory                                                         //
// ------------------------------------------------------------------ //

export class ReadingsIndex {
  private _stored: StoredMoment[] = [];
  private _dirty = true;

  // Index structures (built lazily by index())
  private _unit: number[][] = [];
  private _vectors: number[][] = [];
  private _tf: number[][] = [];
  private _vocab: string[] = [];
  private _vocabIndex = new Map<string, number>();
  private _ts: number[] = [];
  private _spaces: string[] = [];

  // ---------------------------------------------------------------- //
  // Ingest                                                           //
  // ---------------------------------------------------------------- //

  /** Store one moment: {id, text, readings?, readingVector?, ts?,
   * spaceId?, meta?}. The shadow must not be empty; a moment without a
   * witness is not a moment. Ids must be unique — a shared memory
   * cannot hold two witnesses under one name. */
  ingest(entry: MomentEntry): this {
    const text = String(entry.text ?? "");
    if (!text.trim()) {
      throw new Error("a moment needs a shadow — text must be non-empty");
    }
    const id = String(entry.id ?? `moment-${this._stored.length}`);
    if (this._stored.some((m) => m.id === id)) {
      throw new Error(`duplicate moment id "${id}" — every witness needs its own name`);
    }
    const readings = { ...(entry.readings ?? {}) };
    let vector: number[] | undefined;
    if (entry.readingVector !== undefined) {
      vector = [...entry.readingVector];
      if (vector.length > JEPA_DIAL_NAMES.length) {
        throw new Error(
          `reading vectors have ${JEPA_DIAL_NAMES.length} dials — ` +
            `got ${vector.length}; extra dims belong in \`readings\`, not the vector`,
        );
      }
      // Pad a short vector with zeros (the origin) so the layout holds.
      vector = [...vector, ...new Array(JEPA_DIAL_NAMES.length - vector.length).fill(0)];
    }
    if (Object.keys(readings).length > 0) {
      // The readings dict is authoritative. If a vector was also given
      // it must agree — a citizen cannot hold two contradictory faces.
      const derived = readingsToVector(readings);
      if (vector !== undefined) {
        for (let j = 0; j < JEPA_DIAL_NAMES.length; j++) {
          if (Math.abs(derived[j] - vector[j]) > 1e-9) {
            throw new Error(
              `moment "${id}": readings and readingVector disagree on ` +
                `${JEPA_DIAL_NAMES[j]} (${derived[j]} vs ${vector[j]})`,
            );
          }
        }
      }
      vector = derived;
    } else if (vector !== undefined) {
      // A bare vector still deserves its named citizens.
      for (let i = 0; i < JEPA_DIAL_NAMES.length; i++) {
        readings[JEPA_DIAL_NAMES[i]] = vector[i] ?? 0;
      }
    } else {
      vector = new Array(JEPA_DIAL_NAMES.length).fill(0);
    }
    const ts = Number(entry.ts ?? 0);
    if (!Number.isFinite(ts)) {
      throw new Error(`moment "${id}": ts must be a finite number — got ${entry.ts}`);
    }
    this._stored.push({
      id,
      text,
      readings,
      readingVector: vector,
      ts,
      spaceId: String(entry.spaceId ?? "unspecified"),
      meta: { ...(entry.meta ?? {}) },
    });
    this._dirty = true;
    return this;
  }

  get size(): number {
    return this._stored.length;
  }

  /** The stored moments, as ingested (the shadows + their readings). */
  moments(): MomentEntry[] {
    return this._stored.map((m) => ({
      id: m.id,
      text: m.text,
      readings: { ...m.readings },
      readingVector: [...m.readingVector],
      ts: m.ts,
      spaceId: m.spaceId,
      meta: { ...m.meta },
    }));
  }

  spaces(): string[] {
    return [...new Set(this._stored.map((m) => m.spaceId))].sort();
  }

  summary(): string {
    this._ensureIndexed();
    return (
      `ReadingsIndex(${this.size} moments, ${JEPA_DIAL_NAMES.length} dials, ` +
      `${this._vocab.length} tokens, spaces=[${this.spaces().join(", ")}])`
    );
  }

  // ---------------------------------------------------------------- //
  // Query: text — the normal way                                     //
  // ---------------------------------------------------------------- //

  /** Lexical retrieval: bag-of-words cosine against the shadows. The
   * normal RAG way — what the words say. For what the room FELT, use
   * queryByReadings; the feeling is the first-class citizen here. */
  queryByText(q: string, opts: QueryOptions = {}): MomentHit[] {
    this._ensureIndexed();
    if (this._stored.length === 0 || !(q ?? "").trim()) return [];
    const scores = this._textScores(String(q));
    // A moment with zero lexical overlap is not a hit — no shared words
    // means no evidence, so it does not rank.
    const gated = scores.map((s) => (s > 0 ? s : -Infinity));
    return this._ranked(gated, opts.topK ?? 5);
  }

  // ---------------------------------------------------------------- //
  // Query: readings — the first-class-citizen query                  //
  // ---------------------------------------------------------------- //

  /**
   * EXACT READING QUERY — rank by closeness in JEPA space.
   *
   * Two profiles are accepted:
   * - a plain dict of dial → target (number): ranked by cosine
   *   similarity in reading space (the raw cosine — negative means
   *   anti-aligned, and that is honest). Unspecified dials read 0.0.
   * - a dict of dial → [lo, hi] RANGE constraints: ranked by the
   *   fraction of constraints the moment satisfies — the captain's
   *   "mood > 0.6, panic < 0.2" made literal.
   */
  queryByReadings(profile: ReadingProfile, opts: QueryOptions = {}): MomentHit[] {
    this._ensureIndexed();
    if (this._stored.length === 0) return [];
    const values = Object.values(profile);
    const hasRanges = values.some((v) => Array.isArray(v));
    const hasScalars = values.some((v) => typeof v === "number");
    if (hasRanges && hasScalars) {
      throw new Error(
        "mixed reading profile — use all scalars (cosine) or all ranges " +
          "(constraints), not both",
      );
    }
    if (hasRanges) {
      const scores = this._constraintScores(
        profile as Record<string, readonly [number, number]>,
      );
      if (scores.length === 0) return [];
      return this._ranked(scores, opts.topK ?? 5);
    }
    const q = this._coerceVector(profile);
    const qn = norm(q);
    if (qn < 1e-12) return [];
    const unitQ = q.map((v) => v / qn);
    const scores = this._unit.map((u) => cosine(u, unitQ));
    return this._ranked(scores, opts.topK ?? 5);
  }

  // ---------------------------------------------------------------- //
  // Query: field — the perfume query                                 //
  // ---------------------------------------------------------------- //

  /** NEAR-FIELD query — the moment that felt most like this one.
   * Nearest neighbors in JEPA space to a field (a dial-order vector or
   * a readings dict): "find the moment that felt most like right now" —
   * the perfume that takes you to grandma's shop. */
  queryByField(field: number[] | Record<string, number>, opts: QueryOptions = {}): MomentHit[] {
    return this.queryByReadings(field as ReadingProfile, opts);
  }

  // ---------------------------------------------------------------- //
  // Query: time and space — the stamps as dimensions                 //
  // ---------------------------------------------------------------- //

  /** TIME query — the stamp as a retrieval dimension. Hard filter;
   * within the window, ranked by proximity to the window's center.
   * topK omitted → every moment in the window. */
  queryByTime(window: TimeWindow, opts: QueryOptions = {}): MomentHit[] {
    this._ensureIndexed();
    const { start, end } = ReadingsIndex._parseWindow(window);
    const center = (start + end) / 2;
    const span = Math.max(end - start, 1e-9);
    const scores = this._ts.map((t) => {
      if (t < start || t > end) return -Infinity;
      return 1 - Math.min(Math.abs(t - center) / (span / 2), 1);
    });
    return this._ranked(scores, opts.topK);
  }

  /** SPACE query — which room? The stamp as a dimension. Every moment
   * from that space, ranked newest-first (recency 1.0 → 0.0).
   * topK omitted → all of them: "what did the wheelhouse feel like
   * last week?" starts here. */
  queryBySpace(spaceId: string, opts: QueryOptions = {}): MomentHit[] {
    this._ensureIndexed();
    const idx = this._stored
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.spaceId === spaceId)
      .map(({ i }) => i);
    if (idx.length === 0) return [];
    const ts = idx.map((i) => this._ts[i]);
    const tmin = Math.min(...ts);
    const tmax = Math.max(...ts);
    const span = Math.max(tmax - tmin, 1e-9);
    const scores = this._ts.map((_, i) =>
      idx.includes(i) ? (this._ts[i] - tmin) / span : -Infinity,
    );
    return this._ranked(scores, opts.topK);
  }

  // ---------------------------------------------------------------- //
  // Query: combined — the captain's "alongside" made concrete        //
  // ---------------------------------------------------------------- //

  /** The full RAG query — text, readings, time, space alongside.
   *
   * `parts` keys: "text" (str), "readings" (dict / vector), "time" or
   * "ts" (window), "space" (space_id). `weights` keys: "text",
   * "readings", "time", "space"; defaults 0.3 / 0.5 / 0.1 / 0.1 — the
   * reading is the heaviest citizen.
   *
   * Weights renormalize over the dimensions actually present, so a
   * pure feeling query ranks on the full reading weight. Space and
   * time are SOFT here: a wrong-space moment scores 0 on that
   * dimension but can still rank on the others (use queryBySpace /
   * queryByTime for hard filters). Every dimension's score is clipped
   * to [0, 1] so the weights mean what they say. */
  queryCombined(
    parts: CombinedParts,
    weights?: CombinedWeights,
    opts: QueryOptions = {},
  ): MomentHit[] {
    this._ensureIndexed();
    const present: Array<["text" | "readings" | "time" | "space", unknown]> = [];
    if (parts.text !== undefined) present.push(["text", parts.text]);
    if (parts.readings !== undefined) present.push(["readings", parts.readings]);
    const time = parts.time ?? parts.ts;
    if (time !== undefined) present.push(["time", time]);
    if (parts.space !== undefined) present.push(["space", parts.space]);
    if (present.length === 0 || this._stored.length === 0) return [];

    const w = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) };
    let total = 0;
    for (const [dim] of present) total += w[dim] ?? 0;
    if (total <= 0) return [];
    const wnorm: Record<string, number> = {};
    for (const [dim] of present) wnorm[dim] = (w[dim] ?? 0) / total;

    const scores = new Array(this._stored.length).fill(0);
    for (const [dim, v] of present) {
      let s: number[];
      if (dim === "text") s = this._textScores(String(v));
      else if (dim === "readings") s = this._readingScoresClipped(this._coerceVector(v as ReadingProfile | number[]));
      else if (dim === "time") s = this._timeScores(v as TimeWindow);
      else s = this._spaces.map((sp) => (sp === String(v) ? 1 : 0));
      for (let i = 0; i < scores.length; i++) scores[i] += wnorm[dim] * s[i];
    }
    return this._ranked(scores, opts.topK ?? 5);
  }

  // ---------------------------------------------------------------- //
  // Internals                                                        //
  // ---------------------------------------------------------------- //

  index(): this {
    const n = this._stored.length;
    this._vectors = new Array(n);
    this._unit = new Array(n);
    this._ts = new Array(n);
    this._spaces = new Array(n);
    for (let i = 0; i < n; i++) {
      const m = this._stored[i];
      const v = m.readingVector;
      this._vectors[i] = v;
      const nrm = norm(v);
      this._unit[i] = nrm > 1e-12 ? v.map((x) => x / nrm) : new Array(v.length).fill(0);
      this._ts[i] = m.ts;
      this._spaces[i] = m.spaceId;
    }

    // Bag-of-words TF matrix — the lexical retrieval dimension.
    const vocab = new Map<string, number>();
    const rows: Array<Record<string, number>> = [];
    for (const m of this._stored) {
      const counts: Record<string, number> = {};
      for (const t of tokenize(m.text)) counts[t] = (counts[t] ?? 0) + 1;
      for (const t of Object.keys(counts)) if (!vocab.has(t)) vocab.set(t, vocab.size);
      rows.push(counts);
    }
    this._vocab = new Array(vocab.size).fill("");
    for (const [t, j] of vocab) this._vocab[j] = t;
    this._vocabIndex = vocab;
    this._tf = rows.map((counts) => {
      const row = new Array(vocab.size).fill(0);
      for (const [t, c] of Object.entries(counts)) row[vocab.get(t)!] = c;
      return row;
    });

    this._dirty = false;
    return this;
  }

  private _ensureIndexed(): void {
    if (this._dirty) this.index();
  }

  private _coerceVector(x: ReadingProfile | number[]): number[] {
    if (Array.isArray(x)) {
      if (x.length !== JEPA_DIAL_NAMES.length) {
        throw new Error(
          `reading vectors have ${JEPA_DIAL_NAMES.length} dials — got ${x.length}; ` +
            `pass a readings dict for partial profiles`,
        );
      }
      return [...x];
    }
    return readingsToVector(x as Record<string, number>);
  }

  private _textScores(q: string): number[] {
    const qv = new Array(this._vocab.length).fill(0);
    for (const t of tokenize(q)) {
      const j = this._vocabIndex.get(t);
      if (j !== undefined) qv[j] += 1;
    }
    const qn = norm(qv);
    if (qn < 1e-12) return new Array(this._stored.length).fill(0);
    const unitQ = qv.map((v) => v / qn);
    // Unit vectors: the cosine of two unit vectors is their dot product.
    // (Normalizing the row and then taking a dot is NOT a double
    // normalization — it is exactly the cosine.)
    return this._tf.map((row) => {
      const rn = norm(row);
      if (rn < 1e-12) return 0;
      let dot = 0;
      for (let j = 0; j < row.length; j++) dot += (row[j] / rn) * unitQ[j];
      return Math.min(1, Math.max(0, dot));
    });
  }

  private _readingScoresClipped(q: number[]): number[] {
    const raw = this._unit.map((u) => cosine(u, q));
    return raw.map((s) => Math.min(1, Math.max(0, s)));
  }

  private _timeScores(window: TimeWindow): number[] {
    const { start, end } = ReadingsIndex._parseWindow(window);
    const center = (start + end) / 2;
    const span = Math.max(end - start, 1e-9);
    return this._ts.map((t) => {
      if (t < start || t > end) return 0;
      return 1 - Math.min(Math.abs(t - center) / (span / 2), 1);
    });
  }

  private _constraintScores(
    profile: Record<string, readonly [number, number]>,
  ): number[] {
    const idx = new Map<string, number>();
    JEPA_DIAL_NAMES.forEach((name, j) => idx.set(name, j));
    const gates: Array<[number, number, number]> = [];
    for (const [name, bounds] of Object.entries(profile)) {
      const j = idx.get(name);
      if (j === undefined || !Array.isArray(bounds) || bounds.length !== 2) continue;
      const lo = Number(bounds[0]);
      const hi = Number(bounds[1]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        throw new Error(`invalid range bounds for dial "${name}": [${lo}, ${hi}]`);
      }
      gates.push([j, lo, hi]);
    }
    if (gates.length === 0) return [];
    return this._vectors.map((v) => {
      const satisfied = gates.filter(([j, lo, hi]) => {
        const val = v[j] ?? 0;
        return lo <= val && val <= hi;
      }).length;
      return satisfied / gates.length;
    });
  }

  private static _parseWindow(window: TimeWindow): { start: number; end: number } {
    let start: number;
    let end: number;
    if (typeof window === "number") {
      start = window;
      end = window;
    } else if (Array.isArray(window)) {
      start = Number(window[0]);
      end = Number(window[1]);
    } else {
      start = Number(window.start);
      end = Number(window.end);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`time window bounds must be finite numbers — got [${start}, ${end}]`);
    }
    return { start, end };
  }

  private _ranked(scores: number[], topK: number | undefined): MomentHit[] {
    const order = scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        return a.i - b.i; // stable tie-break: insertion order
      });
    const hits: MomentHit[] = [];
    for (const { s, i } of order) {
      if (s === -Infinity) break;
      hits.push(this._hit(i, s));
      if (topK !== undefined && hits.length >= topK) break;
    }
    return hits;
  }

  private _hit(i: number, score: number): MomentHit {
    const m = this._stored[i];
    // The reading vector is the citizen — carry the full canonical
    // vector, zero-filled to the dial bank, with any extra dials the
    // moment carried beyond the bank.
    const readings: Record<string, number> = { ...m.readings };
    JEPA_DIAL_NAMES.forEach((name, j) => {
      readings[name] = m.readingVector[j] ?? 0;
    });
    return {
      id: m.id,
      text: m.text,
      readings,
      readingVector: [...m.readingVector],
      ts: m.ts,
      spaceId: m.spaceId,
      meta: { ...m.meta },
      score,
      index: i,
    };
  }
}
