// src/embed.ts
// Embedding pipeline — for each piece in the corpus, embed three things:
// 1. The full text (semantic content)
// 2. A "vibe summary" (the 16-dimensional feeling extracted from the text)
// 3. An "identity snapshot" (who wrote it, when, in what context)
//
// All three stored as separate vectors in the same index with metadata linking to the source.

export interface EmbedRequest {
  id: string;
  text: string;
  type: string; // "fiction", "poem", "journal", "poker", "conversation", etc.
  agentId: string;
  timestamp: string; // ISO 8601
  metadata?: Record<string, string | number | boolean>;
}

export interface EmbedResult {
  id: string;
  dimensions: number;
  timestamp: string;
  vectorsStored: number;
}

export const EMBED_MODEL = "@cf/baai/bge-m3";
export const EMBED_DIMENSIONS = 1024;

// Type for Cloudflare Workers AI binding
export interface AiBinding {
  run(model: string, input: { text: string }): Promise<{
    shape?: number[];
    data?: number[] | number[][];
  }>;
}

// The three vector types — all live in the same index, distinguished by metadata
export type VectorType = "semantic" | "vibe" | "identity";

// Temporal stamp as a flat record for metadata
type TemporalStampLike = Record<string, string | number | boolean>;

export interface VectorRecord {
  id: string;
  values: number[];
  namespace: string;
  metadata: Record<string, VectorizeVectorMetadata> & {
    sourceId: string;
    vectorType: VectorType;
    agentId: string;
    type: string;
    timestamp: string;
  };
}

// Extract a "vibe summary" from text — a condensed emotional fingerprint
// We create a synthetic text that represents the emotional shape of the piece
export function extractVibeSummary(text: string): string {
  // Take key emotional phrases and structural markers
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const firstLines = lines.slice(0, 3).join(" ");
  const lastLines = lines.slice(-3).join(" ");
  const middleIndex = Math.floor(lines.length / 2);
  const middleLine = lines[middleIndex] || "";

  // The vibe summary is the emotional arc: beginning -> middle -> end
  // This captures the shape of the piece in embedding space
  return `Beginning: ${firstLines}\nMiddle: ${middleLine}\nEnd: ${lastLines}`;
}

// Extract an "identity snapshot" — who wrote it, when, in what context
export function extractIdentitySnapshot(
  agentId: string,
  type: string,
  timestamp: string,
  text: string
): string {
  // Create a text representation of the identity context
  // This helps search for "what did Wesley write?" by embedding the identity
  const wordCount = text.split(/\s+/).length;
  const avgWordLength =
    text.split(/\s+/).reduce((sum, w) => sum + w.length, 0) / Math.max(1, wordCount);
  const questionCount = (text.match(/\?/g) || []).length;
  const exclamationCount = (text.match(/!/g) || []).length;

  return `Agent: ${agentId}. Type: ${type}. Written: ${timestamp}. ` +
    `Words: ${wordCount}. Avg word length: ${avgWordLength.toFixed(1)}. ` +
    `Questions: ${questionCount}. Exclamations: ${exclamationCount}. ` +
    `Opening: ${text.slice(0, 200)}`;
}

// Embed text using Workers AI
export async function embedText(
  ai: AiBinding,
  text: string
): Promise<number[]> {
  const result = await ai.run(EMBED_MODEL, { text });
  // bge-m3 returns shape [1, 768]
  if (result.shape && result.data) {
    const data = result.data as number[] | number[][];
    return Array.isArray(data[0]) ? (data[0] as number[]) : (data as number[]);
  }
  throw new Error("Unexpected embedding response shape");
}

// Generate all three vector types for a piece
export async function embedPiece(
  ai: AiBinding,
  piece: EmbedRequest,
  temporalStamp: TemporalStampLike
): Promise<VectorRecord[]> {
  const vectors: VectorRecord[] = [];

  // 1. Semantic embedding — the full text
  const semanticVector = await embedText(ai, piece.text);
  vectors.push({
    id: `${piece.id}:semantic`,
    values: semanticVector,
    namespace: "default",
    metadata: {
      sourceId: piece.id,
      vectorType: "semantic",
      agentId: piece.agentId,
      type: piece.type,
      timestamp: piece.timestamp,
      ...temporalStamp,
      ...piece.metadata,
    },
  });

  // 2. Vibe embedding — the emotional fingerprint
  const vibeText = extractVibeSummary(piece.text);
  const vibeVector = await embedText(ai, vibeText);
  vectors.push({
    id: `${piece.id}:vibe`,
    values: vibeVector,
    namespace: "default",
    metadata: {
      sourceId: piece.id,
      vectorType: "vibe",
      agentId: piece.agentId,
      type: piece.type,
      timestamp: piece.timestamp,
      ...temporalStamp,
      ...piece.metadata,
    },
  });

  // 3. Identity embedding — who/when/what context
  const identityText = extractIdentitySnapshot(
    piece.agentId,
    piece.type,
    piece.timestamp,
    piece.text
  );
  const identityVector = await embedText(ai, identityText);
  vectors.push({
    id: `${piece.id}:identity`,
    values: identityVector,
    namespace: "default",
    metadata: {
      sourceId: piece.id,
      vectorType: "identity",
      agentId: piece.agentId,
      type: piece.type,
      timestamp: piece.timestamp,
      ...temporalStamp,
      ...piece.metadata,
    },
  });

  return vectors;
}
