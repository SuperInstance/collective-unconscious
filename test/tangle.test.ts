import { describe, it, expect } from 'vitest';
import { computeTangleProjections, TWELVE_FRAMEWORKS, getTangle } from '../src/tangle';

describe('The Quilt Tangle (𝕋)', () => {
  it('has 12 deep-math frameworks', () => {
    expect(TWELVE_FRAMEWORKS).toHaveLength(12);
    const categories = TWELVE_FRAMEWORKS.map(f => f.primitive);
    expect(categories).toContain('JEPA');
    expect(categories).toContain('Graph');
  });

  it('computes 12 projections of 𝕋', () => {
    const states = [
      { name: 's1', e_coords: [0.5], m_coords: [0.5], gamma: 0.5, eta: 0.5, conservation: true },
      { name: 's2', e_coords: [0.7], m_coords: [0.3], gamma: 0.7, eta: 0.3, conservation: true },
      { name: 's3', e_coords: [0.3], m_coords: [0.7], gamma: 0.3, eta: 0.7, conservation: true },
    ];
    const result = computeTangleProjections(states);
    expect(result.projections.category).toBe(9);
    expect(result.projections.domain).toBe(9);
    expect(result.conservation).toBeCloseTo(1.0, 5);
    expect(result.holonomy).toBe(0);
  });

  it('universal invariant is γ+η', () => {
    const states = [
      { name: 's1', e_coords: [0.5], m_coords: [0.5], gamma: 0.5, eta: 0.5, conservation: true },
    ];
    const result = computeTangleProjections(states);
    expect(result.universal).toBeCloseTo(1.0, 5);
  });
});
