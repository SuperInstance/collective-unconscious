#!/usr/bin/env tsx
// scripts/momentsToJson.ts
// THE ELEPHANT SEAM — the two-sided bridge, TS side.
//
// Reads moments JSON produced by the elephant (elephant/jepa_rag.py:
// moment_from_text / moment_from_room / moments_from_markdown) and
// ingests them into the ReadingsIndex — the fleet's shared memory,
// where every moment's JEPA READING VECTOR is a first-class citizen
// beside its time and space stamps.
//
// The contract is documented in docs/moments-json-contract.md (and
// mirrored in the elephant repo: docs/collective-unconscious-bridge.md).
//
// Usage:
//   npx tsx scripts/momentsToJson.ts --in moments.json
//   npx tsx scripts/momentsToJson.ts --in moments.json --out enriched.json
//   npx tsx scripts/momentsToJson.ts --in moments.json --query "the fight"
//   npx tsx scripts/momentsToJson.ts --in moments.json --feeling mood:0.8 --feeling panic:0.1
//   npx tsx scripts/momentsToJson.ts --in moments.json --field 0.8,0.1,0.6,0.1,0.2,0,0.9,0,0.4
//   npx tsx scripts/momentsToJson.ts --in moments.json --space wheelhouse --topk 5
//
// An elephant moments file is one of:
//   [ {text, readings, ts, space_id, meta}, ... ]
//   { "moments": [ ...same... ] }
//   { "moments": { "<id>": { ...same... }, ... } }

import { readFileSync, writeFileSync } from "fs";
import { ReadingsIndex, JEPA_DIAL_NAMES } from "../src/readingsIndex";

// ------------------------------------------------------------------ //
// CLI                                                                //
// ------------------------------------------------------------------ //

interface CliArgs {
  in: string | null;
  out: string | null;
  query: string | null;
  feelings: string[];
  field: number[] | null;
  space: string | null;
  topK: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    in: null,
    out: null,
    query: null,
    feelings: [],
    field: null,
    space: null,
    topK: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i];
    if (a === "--in") args.in = next();
    else if (a === "--out") args.out = next();
    else if (a === "--query") args.query = next();
    else if (a === "--feeling") args.feelings.push(next());
    else if (a === "--field") {
      args.field = next().split(",").map(Number);
    } else if (a === "--space") args.space = next();
    else if (a === "--topk") args.topK = Number(next());
    else if (a === "--help" || a === "-h") {
      console.log(`momentsToJson.ts — the elephant seam

Read elephant moments JSON and ingest it into the ReadingsIndex.

Usage:
  npx tsx scripts/momentsToJson.ts --in moments.json [options]

Options:
  --in <path>       elephant moments JSON (array, {moments: [...]}, or
                    {moments: {id: moment}})
  --out <path>      write the enriched corpus (each moment with its
                    dial-order readingVector) to <path>
  --query <text>    demo: queryByText
  --feeling d:v     demo: queryByReadings, repeatable (dial:value or
                    dial:lo-hi, e.g. panic:0.9 mood:-0.6)
  --field v,v,...   demo: queryByField (dial-order vector, 9 values)
  --space <id>      demo: queryBySpace
  --topk <n>        top-k for demo queries (default 5)`);
      process.exit(0);
    } else if (a.startsWith("-")) {
      console.error(`unknown option: ${a}`);
      process.exit(1);
    } else if (!args.in) {
      args.in = a;
    }
  }
  return args;
}

// ------------------------------------------------------------------ //
// Contract mapping — elephant snake_case → TS camelCase              //
// ------------------------------------------------------------------ //

export interface ElephantMoment {
  text?: unknown;
  readings?: Record<string, number>;
  ts?: unknown;
  space_id?: unknown;
  meta?: Record<string, unknown>;
  id?: unknown;
  [key: string]: unknown;
}

/** One elephant moment → a ReadingsIndex MomentEntry. The readings are
 * COMPUTED by the elephant's dial bank; the TS side only stores and
 * retrieves them — it never guesses a feeling from words. */
export function fromElephantMoment(m: ElephantMoment, fallbackId: string) {
  const text = String(m.text ?? "").trim();
  if (!text) {
    throw new Error(`moment ${fallbackId}: the elephant's shadow (text) is empty`);
  }
  const meta = (m.meta ?? {}) as Record<string, unknown>;
  const id = m.id !== undefined && m.id !== null && String(m.id).trim() !== ""
    ? String(m.id)
    : String(meta.source ?? "") + (meta.chunk !== undefined ? `-${meta.chunk}` : "");
  return {
    id: id || fallbackId,
    text,
    readings: (m.readings ?? {}) as Record<string, number>,
    ts: m.ts !== undefined && m.ts !== null ? Number(m.ts) : 0,
    spaceId: m.space_id !== undefined && m.space_id !== null
      ? String(m.space_id)
      : "unspecified",
    meta,
  };
}

/** Accepts an elephant moments file: an array, {moments: [...]}, or
 * {moments: {id: moment}}. Returns {id, moment} pairs. */
export function loadElephantMoments(raw: unknown): Array<[string, ElephantMoment]> {
  if (Array.isArray(raw)) {
    return raw.map((m, i) => [`moment-${i}`, m as ElephantMoment]);
  }
  if (raw && typeof raw === "object") {
    const moments = (raw as { moments?: unknown }).moments;
    if (Array.isArray(moments)) {
      return moments.map((m, i) => [`moment-${i}`, m as ElephantMoment]);
    }
    if (moments && typeof moments === "object") {
      return Object.entries(moments as Record<string, ElephantMoment>);
    }
  }
  throw new Error(
    "unrecognized moments file: expected an array, {moments: [...]}, or {moments: {id: moment}}",
  );
}

// ------------------------------------------------------------------ //
// Main                                                               //
// ------------------------------------------------------------------ //

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in) {
    console.error("missing --in <path> (or pass the path positionally); --help for usage");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(args.in, "utf8"));
  const pairs = loadElephantMoments(raw);
  const index = new ReadingsIndex();

  let warned = 0;
  for (const [fallbackId, m] of pairs) {
    if (!m.readings || Object.keys(m.readings).length === 0) {
      warned++;
      if (warned <= 3) {
        console.warn(
          `warn: moment ${fallbackId} carries NO readings — the elephant's dial ` +
            `bank did not read it. It ingests as a zero vector (the origin).`,
        );
      }
    }
    index.ingest(fromElephantMoment(m, fallbackId));
  }

  console.log(index.summary());
  console.log(`  ingested ${index.size} moments`);

  if (args.out) {
    const enriched = {
      contract: "collective-unconscious/moments-json v1",
      dials: JEPA_DIAL_NAMES,
      ingested: index.size,
      spaces: index.spaces(),
      moments: index.moments().map((m) => ({
        id: m.id,
        text: m.text,
        readings: m.readings,
        readingVector: m.readingVector,
        ts: m.ts,
        spaceId: m.spaceId,
        meta: m.meta,
      })),
    };
    writeFileSync(args.out, JSON.stringify(enriched, null, 2) + "\n");
    console.log(`  wrote enriched corpus -> ${args.out}`);
  }

  const topK = args.topK;

  if (args.query) {
    console.log(`\nqueryByText("${args.query}") top ${topK}:`);
    for (const hit of index.queryByText(args.query, { topK })) {
      console.log(`  [${hit.score.toFixed(3)}] ${hit.id} @ ${hit.spaceId} ts ${hit.ts}`);
    }
  }

  if (args.feelings.length > 0) {
    const profile: Record<string, number | readonly [number, number]> = {};
    for (const f of args.feelings) {
      const [dial, v] = f.split(":");
      if (!dial || v === undefined) {
        console.error(`bad --feeling "${f}" — expected dial:value or dial:lo-hi`);
        process.exit(1);
      }
      if (v.includes("-")) {
        const [lo, hi] = v.split("-").map(Number);
        profile[dial] = [lo, hi];
      } else {
        profile[dial] = Number(v);
      }
    }
    console.log(`\nqueryByReadings(${JSON.stringify(profile)}) top ${topK}:`);
    for (const hit of index.queryByReadings(profile, { topK })) {
      console.log(
        `  [${hit.score.toFixed(3)}] ${hit.id} @ ${hit.spaceId} ts ${hit.ts}  ` +
          `mood ${hit.readings.mood?.toFixed(2)}  panic ${hit.readings.panic?.toFixed(2)}`,
      );
    }
  }

  if (args.field) {
    console.log(`\nqueryByField([${args.field.join(", ")}]) top ${topK}:`);
    for (const hit of index.queryByField(args.field, { topK })) {
      console.log(`  [${hit.score.toFixed(3)}] ${hit.id} @ ${hit.spaceId} ts ${hit.ts}`);
    }
  }

  if (args.space) {
    console.log(`\nqueryBySpace("${args.space}"):`);
    for (const hit of index.queryBySpace(args.space, { topK })) {
      console.log(`  [${hit.score.toFixed(3)}] ${hit.id} ts ${hit.ts}`);
    }
  }
}

main();
