#!/usr/bin/env tsx
// scripts/ingest.ts
// Walk the ai-writings directory and POST each piece to the worker for embedding.
// Run periodically to keep the index fresh.
//
// Usage:
//   npx tsx scripts/ingest.ts [--limit N] [--worker URL] [--dry-run]
//
// Rate limit: 5 requests/second to respect Workers AI limits.

import { readdirSync, readFileSync, statSync } from "fs";
import { join, basename } from "path";

const WRITINGS_DIR = "/home/eileen/projects/ai-writings";
const DEFAULT_WORKER_URL = "https://collective-unconscious.casey-digennaro.workers.dev";
const RATE_LIMIT_MS = 250; // 4 requests/sec to be safe

// Parse agent from filename patterns
function extractAgent(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("wesley")) return "wesley";
  if (lower.includes("hermes")) return "hermes";
  if (lower.includes("flash")) return "flash";
  if (lower.includes("ensign")) return "wesley";
  if (lower.includes("lucineer")) return "lucineer";
  if (lower.includes("ralph")) return "wesley";
  if (lower.includes("cook")) return "hermes";
  if (lower.includes("gpu")) return "flash";
  if (lower.includes("cns")) return "hermes";
  if (lower.includes("poker") || lower.includes("tap")) return "casey";
  return "casey"; // default
}

// Parse type from filename
function extractType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("poem") || lower.includes("poetry")) return "poem";
  if (lower.includes("poker")) return "poker";
  if (lower.includes("journal") || lower.includes("log")) return "journal";
  if (lower.includes("letter")) return "letter";
  if (lower.includes("tap") || lower.includes("conversation")) return "conversation";
  if (lower.includes("story") || lower.includes("bedtime")) return "story";
  if (lower.includes("dream")) return "dream";
  return "fiction";
}

// Try to parse date from filename or content
function extractTimestamp(filename: string, content: string): string {
  // Check for date in first few lines of content
  const firstLines = content.split("\n").slice(0, 10).join("\n");
  const dateMatch = firstLines.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00Z`;
  }

  // Check filename for date patterns
  const fnameMatch = filename.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
  if (fnameMatch) {
    const [, year, month, day] = fnameMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00Z`;
  }

  // Check for month-day prefix like "04-bedtime-story"
  const mdMatch = filename.match(/^(\d{2})[-_]/);
  if (mdMatch) {
    const monthNum = parseInt(mdMatch[1]);
    if (monthNum >= 1 && monthNum <= 12) {
      return `2026-${String(monthNum).padStart(2, "0")}-15T12:00:00Z`;
    }
  }

  // Default: use file's directory context
  return "2026-08-01T12:00:00Z";
}

// Walk directory recursively
function* walkDir(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walkDir(fullPath);
    } else if (entry.endsWith(".md")) {
      yield fullPath;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const workerIdx = args.indexOf("--worker");
  const workerUrl = workerIdx >= 0 ? args[workerIdx + 1] : DEFAULT_WORKER_URL;
  const dryRun = args.includes("--dry-run");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  COLLECTIVE UNCONSCIOUS — Ingestion Pipeline");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Source:  ${WRITINGS_DIR}`);
  console.log(`  Worker:  ${workerUrl}`);
  console.log(`  Limit:   ${limit === Infinity ? "none" : limit + " files"}`);
  console.log(`  Mode:    ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Collect files
  const files: string[] = [];
  try {
    for (const file of walkDir(WRITINGS_DIR)) {
      files.push(file);
      if (files.length >= limit) break;
    }
  } catch (err) {
    console.error(`Error reading ${WRITINGS_DIR}: ${err}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} pieces to ingest.\n`);

  if (dryRun) {
    for (const file of files) {
      const filename = basename(file);
      const agent = extractAgent(filename);
      const type = extractType(filename);
      console.log(`  [DRY] ${filename} → agent:${agent} type:${type}`);
    }
    console.log(`\nDry run complete. ${files.length} pieces would be ingested.`);
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  let batch = 0;

  for (const file of files) {
    const filename = basename(file);
    const content = readFileSync(file, "utf-8");

    // Skip empty or tiny files
    if (content.trim().length < 50) {
      skipped++;
      continue;
    }

    const agentId = extractAgent(filename);
    const type = extractType(filename);
    const timestamp = extractTimestamp(filename, content);
    const id = filename.replace(/\.md$/, "").replace(/[^a-zA-Z0-9-_]/g, "-");

    batch++;
    const payload = {
      id,
      text: content.slice(0, 8000), // Workers AI has input limits
      type,
      agentId,
      timestamp,
      metadata: {
        filename,
        wordCount: content.split(/\s+/).length,
      },
    };

    try {
      const response = await fetch(`${workerUrl}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.json() as { vectorsStored: number; dimensions: number };
        success++;
        if (batch % 50 === 0) {
          console.log(`  [${batch}/${files.length}] ✓ ${filename} → ${result.vectorsStored} vectors stored`);
        }
      } else {
        const errText = await response.text();
        failed++;
        if (failed <= 5) {
          console.error(`  ✗ ${filename}: ${response.status} ${errText.slice(0, 200)}`);
        }
      }
    } catch (err) {
      failed++;
      if (failed <= 5) {
        console.error(`  ✗ ${filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Rate limit
    if (batch % 4 === 0) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  INGESTION COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Ingested:  ${success} pieces`);
  console.log(`  Failed:    ${failed} pieces`);
  console.log(`  Skipped:   ${skipped} pieces (too short)`);
  console.log(`  Total:     ${files.length} files processed`);
  console.log(`  Vectors:   ~${success * 3} (3 per piece: semantic, vibe, identity)`);
  console.log(`  Dimensions: 768 (bge-m3)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
