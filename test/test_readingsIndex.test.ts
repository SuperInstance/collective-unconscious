// test/test_readingsIndex.test.ts
// The Readings Index — JEPA readings as first-class citizens beside
// time and space stamps. Cross-pollinated from the elephant
// (elephant/jepa_rag.py); the corpus mirrors the elephant's own
// test boats (a fight, a storm watch, a dawn watch, The Tap) so the
// feeling queries have something unmistakable to find.

import { describe, it, expect } from "vitest";
import {
  ReadingsIndex,
  JEPA_DIAL_NAMES,
  readingsToVector,
  vectorToReadings,
  DEFAULT_WEIGHTS,
  type MomentEntry,
  type ReadingProfile,
} from "../src/readingsIndex";

// ------------------------------------------------------------------ //
// The corpus — six fleet moments, each with its own unmistakable     //
// reading. Dial order: mood, volume, earnestness, cynicism,           //
// joke_landing, panic, presence, model_vs_code, vision.               //
// ------------------------------------------------------------------ //

function corpus(): MomentEntry[] {
  return [
    {
      id: "fight",
      text: "You ran her aground and you know it!!! Say that again and see what happens! ALL HANDS — panic in the galley, somebody get the wheelhouse — MAYDAY watch, NOW!!!",
      readings: { mood: -0.6, volume: 0.85, earnestness: 0.7, cynicism: 0.2, joke_landing: 0.0, panic: 0.95, presence: 0.6, model_vs_code: 0.1, vision: 0.3 },
      ts: 1000,
      spaceId: "galley",
    },
    {
      id: "storm",
      text: "The wheelhouse window is white with spray — the squall line three miles out and closing. All hands on deck: batten the hatches, secure the gear, NOW!!! The bow digs and the whole hull groans. MAYDAY watch is up.",
      readings: { mood: -0.2, volume: 0.8, earnestness: 0.8, cynicism: 0.1, joke_landing: 0.0, panic: 0.7, presence: 0.7, model_vs_code: 0.2, vision: 0.4 },
      ts: 2000,
      spaceId: "wheelhouse",
    },
    {
      id: "dawn",
      text: "Four a.m. and the wheelhouse is warm and quiet — the dawn watch's calmest hour. The coffee's on, the sea is flat calm, and for once nobody is yelling.",
      readings: { mood: 0.8, volume: 0.1, earnestness: 0.6, cynicism: 0.1, joke_landing: 0.2, panic: 0.0, presence: 0.9, model_vs_code: 0.1, vision: 0.2 },
      ts: 3000,
      spaceId: "wheelhouse",
    },
    {
      id: "tap-night",
      text: "Trade night at The Tap. The poker table is loose tonight — somebody's joke landed and the whole bar laughed. This is a good room.",
      readings: { mood: 0.7, volume: 0.5, earnestness: 0.4, cynicism: 0.3, joke_landing: 0.9, panic: 0.0, presence: 0.8, model_vs_code: 0.3, vision: 0.5 },
      ts: 4000,
      spaceId: "the-tap",
    },
    {
      id: "galley-dinner",
      text: "Dinner in the galley: soup, bread, and nobody talking about the day. The quiet kind of tired.",
      readings: { mood: 0.4, volume: 0.15, earnestness: 0.5, cynicism: 0.0, joke_landing: 0.1, panic: 0.05, presence: 0.5, model_vs_code: 0.0, vision: 0.1 },
      ts: 5000,
      spaceId: "galley",
    },
    {
      id: "empty-wheelhouse",
      text: "The wheelhouse is empty and dark. The instruments tick over alone.",
      readings: { mood: 0.0, volume: 0.0, earnestness: 0.0, cynicism: 0.0, joke_landing: 0.0, panic: 0.0, presence: 0.0, model_vs_code: 0.9, vision: 0.0 },
      ts: 6000,
      spaceId: "wheelhouse",
    },
  ];
}

function indexed(): ReadingsIndex {
  const index = new ReadingsIndex();
  for (const m of corpus()) index.ingest(m);
  return index;
}

function ids(hits: { id: string }[]): string[] {
  return hits.map((h) => h.id);
}

describe("ReadingsIndex · ingest", () => {
  it("stores a moment with its reading vector derived in dial order", () => {
    const index = new ReadingsIndex();
    index.ingest(corpus()[0]);
    const [hit] = index.queryByText("aground");
    expect(hit.id).toBe("fight");
    expect(hit.readingVector).toHaveLength(JEPA_DIAL_NAMES.length);
    expect(hit.readings.panic).toBeCloseTo(0.95, 5);
    expect(hit.ts).toBe(1000);
    expect(hit.spaceId).toBe("galley");
  });

  it("rejects a moment without a shadow", () => {
    const index = new ReadingsIndex();
    expect(() => index.ingest({ id: "x", text: "   " })).toThrow(/needs a shadow/);
    expect(() => index.ingest({ id: "x", text: "" })).toThrow(/needs a shadow/);
  });

  it("rejects duplicate ids — every witness needs its own name", () => {
    const index = new ReadingsIndex();
    index.ingest({ id: "same", text: "first" });
    expect(() => index.ingest({ id: "same", text: "second" })).toThrow(/duplicate moment id/);
  });

  it("requires the two views of the citizen to agree", () => {
    const index = new ReadingsIndex();
    expect(() =>
      index.ingest({
        id: "liar",
        text: "claims two faces",
        readings: { mood: 0.5 },
        readingVector: [0.9, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    ).toThrow(/disagree/);
    // Agreeing views are fine — readings are the source of truth.
    index.ingest({
      id: "honest",
      text: "one face",
      readings: { mood: 0.5 },
      readingVector: [0.5, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const [hit] = index.queryBySpace("unspecified", { topK: 1 });
    expect(hit.id).toBe("honest");
  });

  it("rejects reading vectors longer than the dial bank", () => {
    const index = new ReadingsIndex();
    expect(() =>
      index.ingest({
        id: "too-many",
        text: "ten dials? no.",
        readingVector: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      }),
    ).toThrow(/9 dials/);
  });

  it("derives readings from a bare readingVector (the other view of the citizen)", () => {
    const index = new ReadingsIndex();
    index.ingest({
      id: "vector-born",
      text: "A moment born from a vector, not a dict.",
      readingVector: [0.5, 0.1, 0.2, 0.0, 0.0, 0.9, 0.4, 0.0, 0.3],
      ts: 1,
      spaceId: "lab",
    });
    const [hit] = index.queryBySpace("lab");
    expect(hit.readings.mood).toBeCloseTo(0.5, 5);
    expect(hit.readings.panic).toBeCloseTo(0.9, 5);
    expect(hit.readings.presence).toBeCloseTo(0.4, 5);
  });

  it("zero-fills partial readings — missing dials read the origin", () => {
    const index = new ReadingsIndex();
    index.ingest({ id: "partial", text: "Only the panic was recorded.", readings: { panic: 0.9 } });
    const [hit] = index.queryBySpace("unspecified");
    expect(hit.readings.panic).toBeCloseTo(0.9, 5);
    expect(hit.readings.mood).toBe(0);
    expect(hit.readings.volume).toBe(0);
    expect(hit.readingVector[5]).toBeCloseTo(0.9, 5); // panic is dial #5
  });

  it("keeps extra dials beyond the bank riding along (honesty)", () => {
    const index = new ReadingsIndex();
    index.ingest({ id: "extra", text: "A dial the bank doesn't know yet.", readings: { mood: 0.5, weird_extra: 0.7 } });
    const [hit] = index.queryBySpace("unspecified");
    expect(hit.readings.weird_extra).toBeCloseTo(0.7, 5);
    expect(hit.readingVector).toHaveLength(JEPA_DIAL_NAMES.length);
  });

  it("chains and reports spaces/summary", () => {
    const index = new ReadingsIndex();
    for (const m of corpus()) index.ingest(m);
    expect(index.size).toBe(6);
    expect(index.spaces()).toEqual(["galley", "the-tap", "wheelhouse"]);
    expect(index.summary()).toContain("6 moments");
    expect(index.summary()).toContain("9 dials");
  });
});

describe("ReadingsIndex · queryByText — the normal way", () => {
  it("finds the words", () => {
    const hits = indexed().queryByText("squall hatches groans");
    expect(hits[0].id).toBe("storm");
  });

  it("returns nothing for an empty or unmatching query", () => {
    expect(indexed().queryByText("")).toEqual([]);
    expect(indexed().queryByText("zzzqqq")).toEqual([]);
    expect(new ReadingsIndex().queryByText("anything")).toEqual([]);
  });

  it("honors topK", () => {
    expect(indexed().queryByText("the", { topK: 2 })).toHaveLength(2);
  });
});

describe("ReadingsIndex · queryByReadings — the first-class-citizen query", () => {
  it("finds the right moment by reading profile (cosine in JEPA space)", () => {
    const hits = indexed().queryByReadings({ mood: 0.8, panic: 0.0, presence: 0.9 });
    expect(hits[0].id).toBe("dawn"); // the dawn watch's feeling
    expect(hits[0].score).toBeGreaterThan(0.8);
  });

  it("a panicky profile finds the fight, not the calm rooms", () => {
    const hits = indexed().queryByReadings({ panic: 0.95, mood: -0.6, volume: 0.85 });
    expect(hits[0].id).toBe("fight");
    const top2 = ids(hits.slice(0, 2));
    expect(top2).toEqual(["fight", "storm"]);
    expect(top2).not.toContain("dawn");
    expect(top2).not.toContain("tap-night");
  });

  it("partial profiles read the origin for unspecified dials", () => {
    // Only joke_landing specified: the tap night is the only room where
    // the joke landed. All other moments read 0 on that dial.
    const hits = indexed().queryByReadings({ joke_landing: 1.0 });
    expect(hits[0].id).toBe("tap-night");
  });

  it("range constraints work — 'mood > 0.6, panic < 0.2' made literal", () => {
    const hits = indexed().queryByReadings({ mood: [0.6, 1.0], panic: [0.0, 0.2] });
    expect(hits[0].score).toBe(1.0); // fully satisfied
    const top = ids(hits.slice(0, 2));
    expect(top).toEqual(expect.arrayContaining(["dawn", "tap-night"]));
    // The fight satisfies neither gate — it must not sneak in.
    const fightRank = hits.findIndex((h) => h.id === "fight");
    expect(fightRank).toBeGreaterThanOrEqual(0);
    expect(hits[fightRank].score).toBe(0);
  });

  it("a single hard gate finds exactly the moments inside it", () => {
    const hits = indexed().queryByReadings({ panic: [0.8, 1.0] });
    expect(hits[0].id).toBe("fight");
    expect(hits[0].score).toBe(1.0);
    // Only the fight satisfies the gate; the rest score 0 honestly.
    expect(hits.filter((h) => h.score === 1.0).map((h) => h.id)).toEqual(["fight"]);
  });

  it("a calm-room constraint excludes the panicky moments from the top", () => {
    const top2 = ids(indexed().queryByReadings({ panic: [0.0, 0.1], mood: [0.5, 1.0] }, { topK: 2 }));
    expect(top2).toEqual(["dawn", "tap-night"]);
    expect(top2).not.toContain("fight");
    expect(top2).not.toContain("storm");
  });

  it("unknown dials in a profile are ignored (they are not dimensions)", () => {
    const hits = indexed().queryByReadings({ not_a_dial: 1.0 } as ReadingProfile);
    expect(hits).toEqual([]);
  });

  it("rejects mixed scalar + range profiles — no silent constraint drops", () => {
    expect(() =>
      indexed().queryByReadings({ mood: 0.5, panic: [0.0, 0.2] } as ReadingProfile),
    ).toThrow(/mixed reading profile/);
  });

  it("rejects NaN range bounds — no silently-empty gates", () => {
    expect(() =>
      indexed().queryByReadings({ panic: [Number.NaN, 0.2] } as ReadingProfile),
    ).toThrow(/invalid range bounds/);
  });
});

describe("ReadingsIndex · queryByField — the perfume query", () => {
  it("finds the moment that felt most like a given field (vector)", () => {
    // A dawn-like field: warm, quiet, present.
    const field = [0.8, 0.1, 0.6, 0.1, 0.2, 0.0, 0.9, 0.1, 0.2];
    expect(indexed().queryByField(field)[0].id).toBe("dawn");
  });

  it("finds the fight when the room feels like a fight", () => {
    const field = [-0.6, 0.85, 0.7, 0.2, 0.0, 0.95, 0.6, 0.1, 0.3];
    expect(indexed().queryByField(field)[0].id).toBe("fight");
  });

  it("accepts a readings dict as the field", () => {
    const field = { mood: 0.7, joke_landing: 0.9, panic: 0.0 };
    expect(indexed().queryByField(field)[0].id).toBe("tap-night");
  });

  it("rejects a field vector of the wrong dimension — no silent partial cosines", () => {
    expect(() => indexed().queryByField([0.8, 0.1, 0.6])).toThrow(/9 dials/);
    expect(() => indexed().queryByReadings([0.8] as unknown as ReadingProfile)).toThrow(/9 dials/);
  });
});

describe("ReadingsIndex · time and space — the stamps as dimensions", () => {
  it("queryByTime is a hard filter ranked by proximity to the window center", () => {
    const hits = indexed().queryByTime([1500, 4500]);
    const got = ids(hits);
    expect(got.sort()).toEqual(["dawn", "storm", "tap-night"]);
    expect(hits[0].id).toBe("dawn"); // ts 3000 == window center
    for (const h of hits) expect(h.ts).toBeGreaterThanOrEqual(1500);
    for (const h of hits) expect(h.ts).toBeLessThanOrEqual(4500);
  });

  it("queryByTime accepts a single instant (exact stamp)", () => {
    const hits = indexed().queryByTime(3000);
    expect(ids(hits)).toEqual(["dawn"]);
  });

  it("queryByTime accepts {start, end}", () => {
    const hits = indexed().queryByTime({ start: 0, end: 1000 });
    expect(ids(hits)).toEqual(["fight"]);
  });

  it("queryBySpace returns every moment from that room, newest first", () => {
    const hits = indexed().queryBySpace("wheelhouse");
    expect(ids(hits)).toEqual(["empty-wheelhouse", "dawn", "storm"]);
    for (const h of hits) expect(h.spaceId).toBe("wheelhouse");
  });

  it("unknown space and empty windows return nothing", () => {
    expect(indexed().queryBySpace("the-brig")).toEqual([]);
    expect(indexed().queryByTime([9000, 10000])).toEqual([]);
  });

  it("rejects non-finite window bounds and non-finite stamps", () => {
    expect(() => indexed().queryByTime([Number.NaN, 1000])).toThrow(/finite/);
    expect(() => indexed().queryByTime({ start: 0, end: Number.POSITIVE_INFINITY })).toThrow(
      /finite/,
    );
    const index = new ReadingsIndex();
    expect(() =>
      index.ingest({ id: "bad-ts", text: "no timestamp", ts: Number.NaN }),
    ).toThrow(/finite/);
  });
});

describe("ReadingsIndex · queryCombined — the captain's 'alongside'", () => {
  it("combined-with-readings beats text-only for a feeling query", () => {
    // The words describe the CALM dawn watch; the feeling is the FIGHT.
    const feelingQuery = "the wheelhouse watch at dawn, calm and quiet";
    const fightFeeling: ReadingProfile = { mood: -0.6, panic: 0.95, volume: 0.85 };

    const textOnly = indexed().queryByText(feelingQuery);
    expect(textOnly[0].id).toBe("dawn"); // words alone find the wrong room

    const combined = indexed().queryCombined({ text: feelingQuery, readings: fightFeeling });
    expect(combined[0].id).toBe("fight"); // the reading is the heaviest citizen
    expect(combined[0].id).not.toBe(textOnly[0].id);
    expect(combined[0].score).toBeGreaterThan(
      combined.find((h) => h.id === "dawn")!.score,
    );
  });

  it("default weights are the captain's proportions — readings heaviest", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ text: 0.3, readings: 0.5, time: 0.1, space: 0.1 });
  });

  it("weights renormalize over the dimensions actually present", () => {
    const index = indexed();
    const readingOnly = index.queryCombined({ readings: { panic: 0.95, mood: -0.6, volume: 0.85 } });
    expect(readingOnly[0].id).toBe("fight");
    // Pure reading query ranks on the full reading weight — same answer
    // as the first-class query.
    expect(readingOnly[0].id).toBe(index.queryByReadings({ panic: 0.95, mood: -0.6, volume: 0.85 })[0].id);
  });

  it("space is a soft dimension inside the combination", () => {
    // The fight-feeling profile, but space = the-tap: the fight still
    // ranks first on the reading weight — a hard filter would exclude it.
    const combined = indexed().queryCombined({
      readings: { panic: 0.95, mood: -0.6, volume: 0.85 },
      space: "the-tap",
    });
    expect(combined[0].id).toBe("fight");
  });

  it("time is a soft dimension inside the combination", () => {
    // The window EXCLUDES the dawn (ts 3000). A hard filter would drop
    // it entirely — and queryByTime does. Soft, the dawn's warm reading
    // still outranks the cold in-window rooms: the reading is the
    // heaviest citizen, and it can reach across the stamp.
    const hard = indexed().queryByTime([3500, 6500]);
    expect(ids(hard)).not.toContain("dawn");

    const combined = indexed().queryCombined({
      readings: { mood: 0.8, panic: 0.0, presence: 0.9 },
      time: [3500, 6500],
    });
    // The warmest room at the window center leads; the excluded dawn
    // still ranks above the cold in-window rooms.
    expect(combined[0].id).toBe("galley-dinner");
    const dawnRank = combined.findIndex((h) => h.id === "dawn");
    expect(dawnRank).toBeGreaterThanOrEqual(0);
    expect(dawnRank).toBeLessThan(3);
  });

  it("returns nothing for an empty query", () => {
    expect(indexed().queryCombined({})).toEqual([]);
  });
});

describe("ReadingsIndex · honesty — every hit carries its readings", () => {
  it("every query type returns hits with the full 9-dial reading", () => {
    const index = indexed();
    const queries: MomentEntry[][] = [
      index.queryByText("wheelhouse"),
      index.queryByReadings({ mood: 0.8, panic: 0.0, presence: 0.9 }),
      index.queryByField([0.7, 0.5, 0.4, 0.3, 0.9, 0.0, 0.8, 0.3, 0.5]),
      index.queryByTime([0, 7000]),
      index.queryBySpace("galley"),
      index.queryCombined({ text: "the", readings: { mood: 0.8 } }),
    ];
    for (const hits of queries) {
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        for (const dial of JEPA_DIAL_NAMES) {
          expect(typeof hit.readings[dial]).toBe("number");
        }
        expect(hit.readingVector).toHaveLength(JEPA_DIAL_NAMES.length);
        expect(typeof hit.ts).toBe("number");
        expect(typeof hit.spaceId).toBe("string");
        expect(typeof hit.id).toBe("string");
        expect(typeof hit.score).toBe("number");
      }
    }
  });

  it("the reading vector rides along even when the query was pure text", () => {
    const hit = indexed().queryByText("squall")[0];
    expect(hit.id).toBe("storm");
    expect(hit.readings.panic).toBeCloseTo(0.7, 5);
    expect(hit.readings.mood).toBeCloseTo(-0.2, 5);
  });

  it("hits expose warmth via the reading — mood, panic, presence are numbers, not vibes", () => {
    const dawn = indexed().queryByReadings({ mood: 0.8, panic: 0.0, presence: 0.9 })[0];
    expect(dawn.readings.mood).toBeGreaterThan(0.7);
    expect(dawn.readings.panic).toBeLessThan(0.1);
    expect(dawn.readings.presence).toBeGreaterThan(0.8);
  });
});

describe("ReadingsIndex · helpers", () => {
  it("readingsToVector maps dial order with zero defaults", () => {
    expect(readingsToVector({ mood: 1, panic: -1 })).toEqual([1, 0, 0, 0, 0, -1, 0, 0, 0]);
  });

  it("vectorToReadings inverts it", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const r = vectorToReadings(v);
    expect(r.mood).toBe(1);
    expect(r.vision).toBe(9);
    expect(readingsToVector(r)).toEqual(v);
  });
});
