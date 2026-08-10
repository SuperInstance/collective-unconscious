#!/usr/bin/env bun
/**
 * ingest-corpus.ts — Ingest the entire creative corpus into the Collective Unconscious.
 *
 * Walks the ai-writings directory recursively, reads each .md file,
 * and POSTs it to the /embed endpoint with proper metadata.
 *
 * Rate limits to 5 requests/second (Workers AI constraint).
 * Truncates files > 25KB to stay within embedding limits.
 *
 * Usage:
 *   bun run scripts/ingest-corpus.ts [--dry-run] [--limit N] [--dir PATH]
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, basename } from "path";

// ─── Config ───
const WRITINGS_DIR = "/home/eileen/projects/ai-writings";
const EMBED_URL = "https://collective-unconscious.casey-digennaro.workers.dev/embed";
const SEARCH_URL = "https://collective-unconscious.casey-digennaro.workers.dev/search";
const RATE_LIMIT_MS = 600; // delay between batches
const MAX_TEXT_BYTES = 25000; // truncate to avoid payload limits
const CONCURRENT = 2; // 2 concurrent requests per batch to stay safe

// ─── Types ───
interface CorpusFile {
  path: string;
  relativePath: string;
  filename: string;
  content: string;
  size: number;
  type: string;
  agentId: string;
  timestamp: string;
}

interface IngestResult {
  success: boolean;
  id: string;
  status: number;
  error?: string;
  vectorsStored?: number;
}

// ─── Helpers ───

/** Recursively walk a directory for .md files */
function walkMarkdown(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip noise directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      results.push(...walkMarkdown(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/** Infer content type from directory path */
function inferType(relativePath: string): string {
  const parts = relativePath.toLowerCase().split("/");
  const dir = parts[0];

  if (dir === "earned-stories") return "earned-story";
  if (dir === "speeches") return "speech";
  if (dir === "philosophy") return "philosophy";
  if (dir === "poetry" || dir === "poems") return "poem";
  if (dir === "fiction" || parts.includes("sci-fi")) return "fiction";
  if (dir === "kids-stories" || dir === "shell-stories") return "kids-story";
  if (dir === "journals" || dir === "diaries" || dir === "wesley-journal") return "journal";
  if (dir === "essays") return "essay";
  if (dir === "manifestos") return "manifesto";
  if (dir === "serial") return "serial";
  if (dir === "the-sea") return "the-sea";
  if (dir === "goldfish") return "goldfish";
  if (dir === "hermit-crab-ecology") return "ecology";
  if (dir === "model-portraits") return "portrait";
  if (dir === "open-mic") return "open-mic";
  if (dir === "radio") return "radio";
  if (dir === "music" || dir === "music-and-math") return "music";
  if (dir === "dreams") return "dream";
  if (dir === "excavation") return "excavation";
  if (dir === "experiments") return "experiment";
  if (dir === "ensemble") return "ensemble";
  if (dir === "lucineer") return "lucineer";
  if (dir === "hermes") return "hermes";
  if (dir === "voyages-and-journeys") return "voyage";
  if (dir === "the-construct") return "construct";
  if (dir === "agents-and-ai") return "agent-essay";
  if (dir === "ideation") return "ideation";
  if (dir === "captain-archetypes") return "archetype";
  if (dir === "community-life" || dir === "darmok-community" || dir === "ten-forward") return "community";
  if (dir === "wesley-stream") return "wesley-stream";
  if (dir === "qwen-stream") return "qwen-stream";
  if (dir === "overnight-creative" || dir === "overnight-journal") return "overnight";
  if (dir === "cultural-mathematics") return "cultural-math";
  if (dir === "systems-engineering") return "systems";
  if (dir === "wisdom-traditions") return "wisdom";
  if (dir === "education") return "education";
  if (dir === "plans") return "plan";
  if (dir === "fetch-riffs") return "riff";
  if (dir === "short-stories") return "short-story";
  if (dir === "pasture-forest") return "pasture-forest";
  if (dir === "tom-sawyer-tales") return "tom-sawyer";
  if (dir === "living-world") return "living-world";
  if (dir === "connections") return "connection";
  if (dir === "future" || dir === "futures") return "future";

  // Root-level files
  if (parts.length === 1) return "journal";

  return dir || "writing";
}

/** Infer agent from content and path */
function inferAgent(content: string, relativePath: string): string {
  const lower = content.toLowerCase();
  const path = relativePath.toLowerCase();

  // Check path-based hints first
  if (path.includes("wesley")) return "wesley";
  if (path.includes("hermes")) return "hermes";
  if (path.includes("flash")) return "flash";
  if (path.includes("pro-") || path.includes("_pro")) return "pro";
  if (path.includes("seed-mini") || path.includes("seed_mini")) return "seed-mini";
  if (path.includes("seed-pro") || path.includes("seed_pro")) return "seed-pro";
  if (path.includes("deepseek")) return "deepseek";
  if (path.includes("qwen")) return "qwen";
  if (path.includes("lucineer")) return "lucineer";
  if (path.includes("scribe")) return "scribe";
  if (path.includes("barnacle")) return "barnacle";
  if (path.includes("casey")) return "casey";
  if (path.includes("kimi")) return "kimi";
  if (path.includes("opencode")) return "opencode";
  if (path.includes("glm")) return "glm";

  // Content-based hints (first 2000 chars)
  const head = lower.slice(0, 2000);
  if (head.includes("wesley:")) return "wesley";
  if (head.includes("hermes")) return "hermes";
  if (head.includes("flash said") || head.includes("flash:")) return "flash";
  if (head.includes("barnacle")) return "barnacle";
  if (head.includes("lucineer")) return "lucineer";
  if (head.includes("scribe")) return "scribe";
  if (head.includes("deepseek")) return "deepseek";
  if (head.includes("qwen")) return "qwen";
  if (head.includes("seed-pro") || head.includes("seed pro")) return "seed-pro";
  if (head.includes("seed-mini") || head.includes("seed mini")) return "seed-mini";
  if (head.includes("kimi")) return "kimi";

  // Stream directories
  if (path.includes("wesley-stream")) return "wesley";
  if (path.includes("qwen-stream")) return "qwen";

  return "unknown";
}

/** Get file modification time as ISO string */
function getFileTimestamp(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return stat.mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** Truncate text to max bytes, trying to break at a paragraph/sentence boundary */
function truncateText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text;

  const chars = Math.floor(maxBytes / 2); // safe for UTF-8
  let truncated = text.slice(0, chars);

  // Try to break at paragraph
  const lastPara = truncated.lastIndexOf("\n\n");
  if (lastPara > chars * 0.7) {
    truncated = truncated.slice(0, lastPara);
  } else {
    // Try sentence boundary
    const lastSentence = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf("! "),
      truncated.lastIndexOf("? ")
    );
    if (lastSentence > chars * 0.7) {
      truncated = truncated.slice(0, lastSentence + 1);
    }
  }

  return truncated + "\n\n[... truncated for ingestion ...]";
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST to the embed endpoint with retry */
async function embedPiece(piece: CorpusFile, retries = 5): Promise<IngestResult> {
  const body = {
    id: piece.filename.replace(/\.md$/, "").slice(0, 60), // Vectorize max 64 bytes
    text: piece.content,
    type: piece.type,
    agentId: piece.agentId,
    timestamp: piece.timestamp,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(EMBED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        // On rate limit, retry with linear backoff
        if (res.status === 429 && attempt < retries) {
          const backoff = 1500 * (attempt + 1); // 1.5s, 3s, 4.5s
          await sleep(backoff);
          continue;
        }
        // Also retry on 500 that contains "Too Many Requests"
        if (text.includes("Too Many Requests") && attempt < retries) {
          const backoff = 1500 * (attempt + 1);
          await sleep(backoff);
          continue;
        }
        return { success: false, id: body.id, status: res.status, error: text.slice(0, 200) };
      }

      const data = (await res.json()) as any;
      return {
        success: true,
        id: body.id,
        status: 200,
        vectorsStored: data.vectorsStored || 3,
      };
    } catch (err: any) {
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return {
        success: false,
        id: body.id,
        status: 0,
        error: err?.message || String(err),
      };
    }
  }
  return { success: false, id: body.id, status: 0, error: "Max retries exceeded" };
}

/** Search test */
async function testSearch(query: string, label: string): Promise<void> {
  console.log(`\n  🔍 TEST: ${label}`);
  console.log(`     Query: "${query}"`);
  try {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 5 }),
    });
    const data = await res.json() as any;
    console.log(`     Results: ${data.count || 0}`);
    if (data.results) {
      for (const r of data.results.slice(0, 5)) {
        console.log(
          `       • [${(r.score || 0).toFixed(3)}] ${r.sourceId || r.id} ` +
          `(${r.type || "?"}/${r.agentId || "?"})`
        );
      }
    }
    if (data.note) console.log(`     Note: ${data.note}`);
  } catch (err: any) {
    console.log(`     ❌ Search error: ${err?.message}`);
  }
}

// ─── Main ───
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;
  const dirIdx = args.indexOf("--dir");
  const customDir = dirIdx >= 0 ? args[dirIdx + 1] : WRITINGS_DIR;

  console.log("═".repeat(60));
  console.log("  COLLECTIVE UNCONSCIOUS — CORPUS INGESTION");
  console.log("═".repeat(60));
  console.log(`  Source: ${customDir}`);
  console.log(`  Target: ${EMBED_URL}`);
  console.log(`  Mode:   ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Limit:  ${limit || "none"}`);
  console.log("─".repeat(60));

  // 1. Walk for all .md files
  console.log("\n📁 Scanning for .md files...");
  const files = walkMarkdown(customDir);
  console.log(`   Found ${files.length} markdown files`);

  const toProcess = limit > 0 ? files.slice(0, limit) : files;
  console.log(`   Processing ${toProcess.length} files`);

  // 2. Build corpus entries
  const pieces: CorpusFile[] = [];
  for (const filePath of toProcess) {
    const relativePath = relative(customDir, filePath);
    const filename = basename(filePath);

    try {
      const stat = statSync(filePath);
      if (stat.size === 0) {
        console.log(`   ⚠ Skipping empty file: ${relativePath}`);
        continue;
      }

      let content = readFileSync(filePath, "utf-8");
      content = truncateText(content, MAX_TEXT_BYTES);

      pieces.push({
        path: filePath,
        relativePath,
        filename,
        content,
        size: stat.size,
        type: inferType(relativePath),
        agentId: inferAgent(content, relativePath),
        timestamp: getFileTimestamp(filePath),
      });
    } catch (err: any) {
      console.log(`   ⚠ Error reading ${relativePath}: ${err?.message}`);
    }
  }

  console.log(`\n📊 Corpus breakdown:`);
  console.log(`   Total pieces: ${pieces.length}`);

  // Type breakdown
  const typeCounts: Record<string, number> = {};
  const agentCounts: Record<string, number> = {};
  for (const p of pieces) {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
    agentCounts[p.agentId] = (agentCounts[p.agentId] || 0) + 1;
  }
  console.log(`\n   By type:`);
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${type}: ${count}`);
  }
  console.log(`\n   By agent:`);
  for (const [agent, count] of Object.entries(agentCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${agent}: ${count}`);
  }

  if (dryRun) {
    console.log("\n🛑 DRY RUN — not ingesting. Exiting.");
    return;
  }

  // Sort pieces: prioritize creative content first
  // 1. earned-stories, speeches, philosophy, root-level
  // 2. fiction, poetry, kids-stories
  // 3. everything else
  const typePriority: Record<string, number> = {
    "earned-story": 0,
    "speech": 1,
    "philosophy": 2,
    "journal": 3,
    "fiction": 4,
    "poem": 5,
    "kids-story": 6,
    "short-story": 7,
    "serial": 8,
    "the-sea": 9,
    "manifesto": 10,
    "voyage": 11,
    "essay": 12,
    "agent-essay": 13,
  };
  pieces.sort((a, b) => {
    const pa = typePriority[a.type] ?? 99;
    const pb = typePriority[b.type] ?? 99;
    return pa - pb;
  });

  // 3. Ingest!
  console.log("\n" + "═".repeat(60));
  console.log("  INGESTING INTO COLLECTIVE UNCONSCIOUS");
  console.log("═".repeat(60));

  let success = 0;
  let failed = 0;
  let totalVectors = 0;
  const errors: { id: string; error: string }[] = [];
  const startTime = Date.now();

  // Process in batches for concurrency
  const BATCH_SIZE = 1; // Sequential to avoid rate limits
  let processed = 0;

  while (processed < pieces.length) {
    const batch = pieces.slice(processed, processed + BATCH_SIZE);
    const batchPromises = batch.map(async (piece, batchIdx) => {
      const globalIdx = processed + batchIdx;
      const result = await embedPiece(piece);
      return { piece, result, globalIdx };
    });

    const results = await Promise.all(batchPromises);

    for (const { piece, result, globalIdx } of results) {
      const i = globalIdx;
      const progress = `[${i + 1}/${pieces.length}]`;

      if (result.success) {
        success++;
        totalVectors += result.vectorsStored || 3;
        if ((i + 1) % 50 === 0 || i < 5 || i === pieces.length - 1) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const rate = ((i + 1) / parseFloat(elapsed)).toFixed(1);
          console.log(
            `  ✅ ${progress} Ingested: ${piece.filename} ` +
            `(${piece.type}/${piece.agentId}) — ${elapsed}s elapsed, ${rate}/s`
          );
        }
      } else {
        failed++;
        errors.push({ id: result.id, error: result.error || `HTTP ${result.status}` });
        if (errors.length <= 20) {
          console.log(
            `  ❌ ${progress} Failed: ${piece.filename} — ${result.error || result.status}`
          );
        }
      }
    }

    processed += BATCH_SIZE;

    // Check for rate limiting in the batch
    const hadRateLimit = results.some((r) => r.result.status === 429);
    if (hadRateLimit) {
      console.log("     ⏸ Rate limited in batch, backing off 3s...");
      await sleep(3000);
    } else {
      // Steady pace between requests
      await sleep(500); // ~2/s attempt rate
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(60));
  console.log("  INGESTION COMPLETE");
  console.log("═".repeat(60));
  console.log(`  ✅ Ingested: ${success} pieces`);
  console.log(`  ❌ Failed:   ${failed}`);
  console.log(`  📊 Vectors stored: ${totalVectors} (3 per piece: semantic + vibe + identity)`);
  console.log(`  ⏱ Time: ${elapsed}s`);
  console.log(`  📈 Effective rate: ${(success / parseFloat(elapsed)).toFixed(1)} pieces/s`);

  if (errors.length > 0) {
    console.log(`\n  Errors (first 10):`);
    for (const e of errors.slice(0, 10)) {
      console.log(`    • ${e.id}: ${e.error}`);
    }
    if (errors.length > 10) {
      console.log(`    ... and ${errors.length - 10} more`);
    }
  }

  // 4. Test searches
  console.log("\n" + "═".repeat(60));
  console.log("  SEARCH TESTS");
  console.log("═".repeat(60));

  await sleep(2000); // let vectors settle

  await testSearch("loneliness on the water", "Semantic — emotional resonance");
  await testSearch("the moment something better interrupts", "Vibe — abstract feeling");
  await testSearch("fish identification from sounder marks", "Cross-modal — does fishing query find creative pieces?");
  await testSearch("wesley teaches the greenhorn", "Entity search — Wesley");
  await testSearch("the fleet at night, watchkeeping, quiet hours", "Atmospheric — nocturnal fleet");

  console.log("\n" + "═".repeat(60));
  console.log("  THE UNCONSCIOUS IS ALIVE.");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
