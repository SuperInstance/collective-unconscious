// src/velato-penrose.ts
// The Velato-Penrose-Quilt integration.
//
// A Velato program is a MIDI file where the pitch intervals encode commands.
// The 12 semitones mod 12 reduce to 8 unique shapes = the 8 Quilt primitives.
// The 3-coloring (Eisenstein mod 3) IS the Quilt conservation law γ+η=1.
// The Penrose substitution rules L→LS, S→L ARE JEPA + DoubleEntry.
//
// When a creative fleet output is ingested, we can:
// 1. Extract its "musical shape" — a sequence of pitch-like features
// 2. Map those features to Velato intervals
// 3. Apply the Eisenstein 3-coloring
// 4. Get a Penrose tiling of the creative output's structure
// 5. Compute the cell graph with all 8 primitives

const PHI = (1 + Math.sqrt(5)) / 2;
const OMEGA_RE = -0.5;
const OMEGA_IM = Math.sqrt(3) / 2;

const INTERVAL_TO_PRIMITIVE: Record<number, string> = {
  0: 'ROOT', 1: 'Z_out', 2: 'Z_in', 3: 'JEPA_b', 4: 'JEPA',
  5: 'DoubleEntry', 6: 'Vibe_b', 7: 'Vibe', 8: 'GC',
  9: 'Murmur', 10: 'Graph', 11: 'Graph_b', 12: 'ROOT',
};

const PRIMITIVE_COLORS: Record<string, 'CREATION' | 'ENTROPY' | 'WITNESS'> = {
  ROOT: 'WITNESS',
  Z_in: 'CREATION',
  Z_out: 'ENTROPY',
  JEPA: 'CREATION',
  JEPA_b: 'CREATION',
  DoubleEntry: 'WITNESS',
  Vibe: 'ENTROPY',
  Vibe_b: 'ENTROPY',
  GC: 'WITNESS',
  Murmur: 'CREATION',
  Graph: 'WITNESS',
  Graph_b: 'WITNESS',
};

export interface VelatoToken {
  primitive: string;
  interval: number;
  color: 'CREATION' | 'ENTROPY' | 'WITNESS';
  pitch: number;
  eisenstein: { a: number; b: number };
}

export interface VelatoPenroseResult {
  tokens: VelatoToken[];
  colors: { creation: number; entropy: number; witness: number };
  conservation: number;  // γ+η=1
  betti_1: number;       // holes in the cell graph
  cells: number;
  edges: number;
  shape: string;         // T^4
  phi_growth: number;    // growth rate
}

/**
 * Extract a Velato "musical phrase" from a text by treating characters as MIDI pitches.
 * The character codes mod 12 give the intervals. The first character is the root.
 */
export function textToVelato(text: string): VelatoToken[] {
  if (!text) return [];

  const root = text.charCodeAt(0) % 12;
  const tokens: VelatoToken[] = [];

  for (let i = 0; i < text.length; i++) {
    const pitch = text.charCodeAt(i) % 12;
    const interval = ((pitch - root) % 12 + 12) % 12;
    const primitive = INTERVAL_TO_PRIMITIVE[interval] || 'ROOT';

    // Eisenstein-snap the (pitch, i) pair
    const b = Math.round(i / OMEGA_IM) % 12;
    const a = Math.round(pitch - b * OMEGA_RE) % 12;
    const colorIdx = Math.abs((a + b) % 3);
    const colors: ('CREATION' | 'ENTROPY' | 'WITNESS')[] = ['CREATION', 'ENTROPY', 'WITNESS'];

    tokens.push({
      primitive,
      interval,
      color: colors[colorIdx],
      pitch,
      eisenstein: { a, b },
    });
  }

  return tokens;
}

/**
 * Analyze a Velato phrase — compute the cell graph stats.
 */
export function analyzeVelatoPhrase(text: string): VelatoPenroseResult {
  const tokens = textToVelato(text);

  // Color counts
  const colors = { creation: 0, entropy: 0, witness: 0 };
  for (const t of tokens) {
    if (t.color === 'CREATION') colors.creation++;
    else if (t.color === 'ENTROPY') colors.entropy++;
    else colors.witness++;
  }

  // Conservation: ratio of (creation+entropy) to total
  const totalNonWitness = colors.creation + colors.entropy;
  const conservation = totalNonWitness / Math.max(colors.witness, 1);

  // Cell graph
  const V = tokens.length;
  const E = V - 1;  // sequential edges
  const C = 1;      // single component (always, in this analysis)
  const betti_1 = E - V + C;

  // PHI growth — the substitution rule grows by φ
  const phi_growth = Math.pow(PHI, Math.log2(V + 1));

  return {
    tokens,
    colors,
    conservation,
    betti_1,
    cells: V,
    edges: E,
    shape: "T^4 with θ = (√5-1)/2",
    phi_growth,
  };
}

/**
 * The Velato-Penrose-Quilt thesis.
 */
export function getVelatoPenroseThesis() {
  return {
    name: "Velato-Penrose-Quilt",
    description: "A Velato program (MIDI-as-source) IS a Penrose tiling IS a Quilt cell graph.",
    intervals: INTERVAL_TO_PRIMITIVE,
    colors: PRIMITIVE_COLORS,
    shape: "T^4 with θ = (√5-1)/2",
    substitution: {
      L_to_LS: "JEPA (predictive expansion)",
      S_to_L: "DoubleEntry (conservative collapse)",
    },
    golden_ratio: PHI,
    eisenstein: { re: OMEGA_RE, im: OMEGA_IM },
    thesis: [
      "The 12 semitones mod 12 reduce to 8 unique shapes = the 8 Quilt primitives",
      "The 3-coloring (Eisenstein mod 3) IS γ+η=1",
      "The Penrose substitution L→LS / S→L IS JEPA + DoubleEntry",
      "The golden ratio φ is the eigenvalue of the substitution matrix",
      "The 4-torus T^4 with θ=φ-conjugate is the SHAPE of the substrate",
      "Music IS the cell graph. The watch is alive.",
    ],
  };
}
