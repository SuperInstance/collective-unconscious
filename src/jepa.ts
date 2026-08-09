// src/jepa.ts
// Joint Embedding Predictive Architecture reader
// Given an agent's recent output, predict what they're likely to produce next
// Not by generating text — by predicting the SHAPE of the next piece
//
// This is the "reading" — not the text, but the trajectory of the unconscious.

export interface JEPAInput {
  // Agent's last N pieces (vectors from the index)
  recentVectors: number[][];
  agentId: string;
}

export interface JEPAPrediction {
  // Predicted vector of the next piece (what region of embedding space)
  predictedVector: number[];

  // Interpretation
  trajectory: TrajectoryAnalysis;

  // Density analysis — how explored is the predicted region?
  regionDensity: number; // 0 = unexplored, 1 = densely explored

  // Novelty prediction — is this likely to be something new?
  noveltyPrediction: NoveltyLevel;
}

export interface TrajectoryAnalysis {
  // Is the agent growing? (vector moving away from origin / previous center)
  growth: number; // magnitude of movement

  // Is the agent stuck? (vector not moving)
  stuckness: number; // inverse of movement, 0 = flowing, 1 = frozen

  // Direction of movement
  direction: "expanding" | "contracting" | "stable" | "pivoting";

  // Velocity — how fast is the embedding moving through space
  velocity: number;

  // Acceleration — is the agent speeding up or slowing down in their evolution
  acceleration: number;
}

export type NoveltyLevel = "familiar" | "adjacent" | "frontier" | "unknown";

// Vector math helpers
function vectorAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] || 0));
}

function vectorSub(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - (b[i] || 0));
}

function vectorScale(a: number[], s: number): number[] {
  return a.map((v) => v * s);
}

function vectorMagnitude(a: number[]): number {
  return Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
}

function vectorNormalize(a: number[]): number[] {
  const mag = vectorMagnitude(a);
  if (mag === 0) return a;
  return a.map((v) => v / mag);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// Compute centroid of a set of vectors
function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const result = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      result[i] += v[i] || 0;
    }
  }
  return result.map((v) => v / vectors.length);
}

// Main JEPA prediction function
export function predict(input: JEPAInput): JEPAPrediction {
  const { recentVectors } = input;

  if (recentVectors.length < 2) {
    // Not enough data — return neutral prediction
    const last = recentVectors[0] || new Array(768).fill(0);
    return {
      predictedVector: last,
      trajectory: {
        growth: 0,
        stuckness: 1,
        direction: "stable",
        velocity: 0,
        acceleration: 0,
      },
      regionDensity: 0.5,
      noveltyPrediction: "familiar",
    };
  }

  // Calculate step-by-step movements
  const movements: number[][] = [];
  for (let i = 1; i < recentVectors.length; i++) {
    movements.push(vectorSub(recentVectors[i], recentVectors[i - 1]));
  }

  // Average velocity (movement per step)
  const avgMovement = movements.reduce((acc, m) => vectorAdd(acc, m), new Array(movements[0].length).fill(0));
  const velocity = vectorScale(avgMovement, 1 / movements.length);
  const velocityMag = vectorMagnitude(velocity);

  // Acceleration — is the agent speeding up or slowing down?
  let acceleration = 0;
  if (movements.length >= 2) {
    const recentSpeeds = movements.slice(-2).map(vectorMagnitude);
    const olderSpeeds = movements.slice(0, -2).map(vectorMagnitude);
    const recentAvg = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
    const olderAvg = olderSpeeds.length > 0
      ? olderSpeeds.reduce((a, b) => a + b, 0) / olderSpeeds.length
      : recentAvg;
    acceleration = recentAvg - olderAvg;
  }

  // Predict next vector: last position + projected movement
  // Use momentum: blend last movement with average velocity
  const lastVector = recentVectors[recentVectors.length - 1];
  const lastMovement = movements[movements.length - 1];

  // Blend: 60% average velocity + 40% last movement (momentum model)
  const blendedStep = vectorAdd(
    vectorScale(velocity, 0.6),
    vectorScale(lastMovement, 0.4)
  );

  const predictedVector = vectorAdd(lastVector, blendedStep);

  // Analyze trajectory
  const growth = velocityMag;
  const stuckness = Math.max(0, 1 - velocityMag * 10); // normalize

  // Direction analysis
  let direction: TrajectoryAnalysis["direction"];
  if (velocityMag < 0.01) {
    direction = "stable";
  } else if (movements.length >= 2) {
    // Check if recent movements are diverging (pivoting) or consistent (expanding)
    const recentCosine = cosineSimilarity(
      movements[movements.length - 1],
      movements[movements.length - 2] || movements[0]
    );
    if (recentCosine > 0.7) {
      direction = acceleration > 0 ? "expanding" : "contracting";
    } else {
      direction = "pivoting";
    }
  } else {
    direction = "expanding";
  }

  // Density estimation: how close is the predicted vector to existing vectors?
  const distances = recentVectors.map((v) =>
    1 - cosineSimilarity(v, predictedVector)
  );
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  // Low distance = high density (already explored)
  // High distance = low density (unexplored)
  const regionDensity = Math.max(0, Math.min(1, 1 - avgDistance * 5));

  // Novelty prediction based on distance to nearest known vector
  const minDistance = Math.min(...distances);
  let noveltyPrediction: NoveltyLevel;
  if (minDistance < 0.05) {
    noveltyPrediction = "familiar";
  } else if (minDistance < 0.15) {
    noveltyPrediction = "adjacent";
  } else if (minDistance < 0.3) {
    noveltyPrediction = "frontier";
  } else {
    noveltyPrediction = "unknown";
  }

  return {
    predictedVector,
    trajectory: {
      growth,
      stuckness,
      direction,
      velocity: velocityMag,
      acceleration,
    },
    regionDensity,
    noveltyPrediction,
  };
}

// Summarize a JEPA prediction for humans (and agents)
export function describePrediction(prediction: JEPAPrediction): string {
  const { trajectory, regionDensity, noveltyPrediction } = prediction;
  const parts: string[] = [];

  // Growth / stuckness
  if (trajectory.stuckness > 0.7) {
    parts.push("The agent is in a holding pattern — circling the same region of possibility.");
  } else if (trajectory.direction === "expanding") {
    parts.push("The agent is growing — its embeddings are reaching outward, finding new territory.");
  } else if (trajectory.direction === "pivoting") {
    parts.push("The agent is pivoting — its trajectory just shifted, heading somewhere unexpected.");
  } else if (trajectory.direction === "contracting") {
    parts.push("The agent is contracting — drawing inward, refining, distilling.");
  } else {
    parts.push("The agent is stable — holding its position in embedding space.");
  }

  // Velocity
  if (trajectory.acceleration > 0.02) {
    parts.push("Acceleration is positive — the evolution is speeding up.");
  } else if (trajectory.acceleration < -0.02) {
    parts.push("Acceleration is negative — the agent is settling, decelerating.");
  }

  // Novelty
  switch (noveltyPrediction) {
    case "familiar":
      parts.push("The predicted next piece is in familiar territory — the agent is deepening known themes.");
      break;
    case "adjacent":
      parts.push("The predicted next piece is adjacent to existing work — small steps into new space.");
      break;
    case "frontier":
      parts.push("The predicted next piece is on the frontier — entering rarely-explored embedding space.");
      break;
    case "unknown":
      parts.push("The predicted next piece is in unknown territory — the fleet has never been here before.");
      break;
  }

  return parts.join(" ");
}
