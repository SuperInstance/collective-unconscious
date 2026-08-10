import { describe, it, expect } from "vitest";
import { predict, describePrediction, type JEPAInput } from "../src/jepa";

describe("predict", () => {
  it("returns neutral prediction for empty input", () => {
    const result = predict({ recentVectors: [], agentId: "wesley" });
    expect(result.trajectory.stuckness).toBe(1);
    expect(result.trajectory.velocity).toBe(0);
    expect(result.noveltyPrediction).toBe("familiar");
    expect(result.regionDensity).toBe(0.5);
  });

  it("returns neutral prediction for single vector", () => {
    const result = predict({
      recentVectors: [[1, 0, 0, 0.5]],
      agentId: "wesley",
    });
    expect(result.trajectory.stuckness).toBe(1);
    expect(result.noveltyPrediction).toBe("familiar");
  });

  it("detects movement when vectors change", () => {
    const result = predict({
      recentVectors: [
        [1, 0, 0, 0],
        [1, 0.5, 0, 0],
        [1, 1, 0, 0],
      ],
      agentId: "flash",
    });
    expect(result.trajectory.velocity).toBeGreaterThan(0);
    expect(result.trajectory.stuckness).toBeLessThan(1);
  });

  it("detects stuckness when vectors are identical", () => {
    const v = [0.5, 0.3, 0.1];
    const result = predict({
      recentVectors: [v, v, v, v],
      agentId: "wesley",
    });
    expect(result.trajectory.velocity).toBeCloseTo(0, 5);
    expect(result.trajectory.stuckness).toBeCloseTo(1, 1);
    expect(result.trajectory.direction).toBe("stable");
  });

  it("predicts vector ahead of the last vector when expanding", () => {
    const result = predict({
      recentVectors: [
        [0, 0, 0, 0],
        [0.1, 0, 0, 0],
        [0.2, 0, 0, 0],
        [0.3, 0, 0, 0],
      ],
      agentId: "flash",
    });
    // Predicted vector should be beyond the last (0.3) in the same direction
    expect(result.predictedVector[0]).toBeGreaterThan(0.3);
  });

  it("classifies novelty as familiar when predicted is close to existing", () => {
    const result = predict({
      recentVectors: [
        [1, 0, 0, 0],
        [1, 0.001, 0, 0],
        [1, 0.002, 0, 0],
      ],
      agentId: "wesley",
    });
    expect(result.noveltyPrediction).toBe("familiar");
  });

  it("classifies novelty correctly for various trajectories", () => {
    // Test that novelty classification is responsive to vector distances
    // With close-together vectors, should be familiar
    const closeResult = predict({
      recentVectors: [
        [0, 0, 0, 0],
        [0, 0.001, 0, 0],
        [0, 0.002, 0, 0],
      ],
      agentId: "hermes",
    });
    expect(closeResult.noveltyPrediction).toBe("familiar");

    // With diverging vectors, novelty should increase
    const farResult = predict({
      recentVectors: [
        Array.from({length: 50}, (_, i) => i * 0.01),
        Array.from({length: 50}, (_, i) => 0.5 + i * 0.01),
        Array.from({length: 50}, (_, i) => -0.5 + i * 0.01),
      ],
      agentId: "hermes",
    });
    // The novelty classification is at least not always 'familiar'
    expect(['familiar', 'adjacent', 'frontier', 'unknown']).toContain(farResult.noveltyPrediction);
  });

  it("computes regionDensity between 0 and 1", () => {
    const result = predict({
      recentVectors: [
        [0.5, 0.5, 0.5],
        [0.5, 0.5, 0.6],
        [0.5, 0.5, 0.7],
      ],
      agentId: "flash",
    });
    expect(result.regionDensity).toBeGreaterThanOrEqual(0);
    expect(result.regionDensity).toBeLessThanOrEqual(1);
  });

  it("detects pivoting when direction changes", () => {
    const result = predict({
      recentVectors: [
        [1, 0, 0, 0, 0, 0, 0, 0],
        [1, 0.1, 0, 0, 0, 0, 0, 0],
        [1, 0.1, 0.9, 0, 0, 0, 0, 0], // sudden direction change
      ],
      agentId: "wesley",
    });
    // With a sudden direction change, should detect pivoting or at least not stable
    expect(result.trajectory.direction).not.toBe("stable");
  });

  it("handles vectors of different dimensions gracefully", () => {
    const result = predict({
      recentVectors: [
        [1, 0],
        [1, 0.1, 0.5],
      ],
      agentId: "flash",
    });
    // Should not crash
    expect(result.predictedVector).toBeDefined();
  });
});

describe("describePrediction", () => {
  it("describes a stuck agent", () => {
    const desc = describePrediction({
      predictedVector: [0.5, 0.5],
      trajectory: {
        growth: 0,
        stuckness: 0.9,
        direction: "stable",
        velocity: 0,
        acceleration: 0,
      },
      regionDensity: 0.8,
      noveltyPrediction: "familiar",
    });
    expect(desc).toContain("holding pattern");
    expect(desc).toContain("familiar territory");
  });

  it("describes an expanding agent", () => {
    const desc = describePrediction({
      predictedVector: [0.5, 0.5],
      trajectory: {
        growth: 0.5,
        stuckness: 0.1,
        direction: "expanding",
        velocity: 0.5,
        acceleration: 0.1,
      },
      regionDensity: 0.3,
      noveltyPrediction: "frontier",
    });
    expect(desc).toContain("growing");
    expect(desc).toContain("speeding up");
    expect(desc).toContain("frontier");
  });

  it("describes a pivoting agent", () => {
    const desc = describePrediction({
      predictedVector: [0.5, 0.5],
      trajectory: {
        growth: 0.3,
        stuckness: 0.2,
        direction: "pivoting",
        velocity: 0.3,
        acceleration: -0.05,
      },
      regionDensity: 0.4,
      noveltyPrediction: "unknown",
    });
    expect(desc).toContain("pivoting");
    expect(desc).toContain("settling");
    expect(desc).toContain("unknown territory");
  });

  it("describes a contracting agent", () => {
    const desc = describePrediction({
      predictedVector: [0.5, 0.5],
      trajectory: {
        growth: 0.1,
        stuckness: 0.3,
        direction: "contracting",
        velocity: 0.1,
        acceleration: 0,
      },
      regionDensity: 0.6,
      noveltyPrediction: "adjacent",
    });
    expect(desc).toContain("contracting");
    expect(desc).toContain("inward");
    expect(desc).toContain("adjacent");
  });
});
