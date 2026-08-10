import { describe, it, expect } from "vitest";
import {
  extractVibeSummary,
  extractIdentitySnapshot,
  EMBED_MODEL,
  EMBED_DIMENSIONS,
  type EmbedRequest,
} from "../src/embed";

describe("extractVibeSummary", () => {
  it("extracts beginning, middle, and end of text", () => {
    const text = "Line one.\nLine two.\nLine three.\nLine four.\nLine five.";
    const result = extractVibeSummary(text);
    expect(result).toContain("Beginning:");
    expect(result).toContain("Middle:");
    expect(result).toContain("End:");
    expect(result).toContain("Line one.");
    expect(result).toContain("Line five.");
  });

  it("handles single-line text", () => {
    const text = "Only one line.";
    const result = extractVibeSummary(text);
    expect(result).toContain("Beginning:");
    expect(result).toContain("Only one line.");
  });

  it("handles empty text gracefully", () => {
    const text = "";
    const result = extractVibeSummary(text);
    // Should not crash, should produce some structure
    expect(result).toContain("Beginning:");
  });

  it("handles two-line text", () => {
    const text = "First line.\nSecond line.";
    const result = extractVibeSummary(text);
    expect(result).toContain("Beginning:");
    expect(result).toContain("First line.");
    expect(result).toContain("Second line.");
  });

  it("captures the middle line for longer texts", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `Line ${i + 1}`);
    const text = lines.join("\n");
    const result = extractVibeSummary(text);
    // Middle of 9 lines is index 4 = "Line 5"
    expect(result).toContain("Line 5");
  });

  it("skips empty lines when extracting", () => {
    const text = "Real line one.\n\n\nReal line two.";
    const result = extractVibeSummary(text);
    expect(result).not.toContain("Beginning: \n");
  });
});

describe("extractIdentitySnapshot", () => {
  it("includes agent ID and type", () => {
    const result = extractIdentitySnapshot("wesley", "journal", "2026-08-10T03:00:00Z", "Some text here.");
    expect(result).toContain("Agent: wesley");
    expect(result).toContain("Type: journal");
    expect(result).toContain("Written: 2026-08-10T03:00:00Z");
  });

  it("computes word count correctly", () => {
    const result = extractIdentitySnapshot("flash", "fiction", "2026-08-10T03:00:00Z", "one two three four five");
    expect(result).toContain("Words: 5");
  });

  it("computes average word length", () => {
    const result = extractIdentitySnapshot("flash", "fiction", "2026-08-10T03:00:00Z", "hi there");
    // "hi" = 2, "there" = 5, avg = 3.5
    expect(result).toContain("Avg word length: 3.5");
  });

  it("counts questions and exclamations", () => {
    const result = extractIdentitySnapshot("flash", "fiction", "2026-08-10T03:00:00Z", "What? Why?! No! Yes.");
    // "What? Why?! No! Yes." has 2 ? and 2 !
    expect(result).toContain("Questions: 2");
    expect(result).toContain("Exclamations: 2");
  });

  it("includes opening 200 characters", () => {
    const longText = "A".repeat(300);
    const result = extractIdentitySnapshot("flash", "fiction", "2026-08-10T03:00:00Z", longText);
    expect(result).toContain("Opening: " + "A".repeat(200));
    // Should NOT include the full 300 chars
    expect(result).not.toContain("A".repeat(201) + "Opening");
  });

  it("handles empty text", () => {
    const result = extractIdentitySnapshot("wesley", "journal", "2026-08-10T03:00:00Z", "");
    expect(result).toContain("Agent: wesley");
    // Empty string splits to [""] = 1 word
    expect(result).toContain("Words: 1");
  });
});

describe("Constants", () => {
  it("EMBED_MODEL is bge-m3", () => {
    expect(EMBED_MODEL).toBe("@cf/baai/bge-m3");
  });

  it("EMBED_DIMENSIONS is 1024", () => {
    expect(EMBED_DIMENSIONS).toBe(1024);
  });
});
