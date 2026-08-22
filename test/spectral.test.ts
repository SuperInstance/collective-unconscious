import { describe, it, expect } from 'vitest';
import {
  computeSpectralInvariants,
  FOURTEEN_THEOREMS,
  EIGHT_PRIMITIVES,
  eisensteinSnap,
  getShape,
  SPECTRAL_DIMENSIONS,
} from '../src/spectral';

describe('Spectral Triple (A, H, D)', () => {
  it('computes 14 invariants for a small corpus', () => {
    const vectors = [
      Array.from({ length: 16 }, (_, i) => Math.sin(i * 0.3)),
      Array.from({ length: 16 }, (_, i) => Math.cos(i * 0.3)),
      Array.from({ length: 16 }, (_, i) => Math.sin(i * 0.3 + 1)),
      Array.from({ length: 16 }, (_, i) => Math.cos(i * 0.3 + 1)),
    ];
    const result = computeSpectralInvariants(vectors);
    expect(result.invariants).toHaveLength(14);
    expect(result.spectralAction).toBeGreaterThan(0);
    expect(result.conservation).toBeGreaterThan(0);
    expect(result.conservation).toBeLessThanOrEqual(1);
  });

  it('returns zero for empty corpus', () => {
    const result = computeSpectralInvariants([]);
    expect(result.spectralAction).toBe(0);
    expect(result.invariants).toHaveLength(0);
  });

  it('has 14 theorems with {T3, T5} as minimal generators', () => {
    expect(FOURTEEN_THEOREMS).toHaveLength(14);
    const primitives = FOURTEEN_THEOREMS.filter(t => t.depends_on.length === 0);
    expect(primitives.map(t => t.id)).toEqual([3, 5]);
  });

  it('has 8 Quilt primitives as generators of A', () => {
    expect(EIGHT_PRIMITIVES).toHaveLength(8);
    expect(EIGHT_PRIMITIVES.map(p => p.id)).toContain('Z_in');
    expect(EIGHT_PRIMITIVES.map(p => p.id)).toContain('DoubleEntry');
  });

  it('Eisenstein-snap maps to one of 3 colors', () => {
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        const snap = eisensteinSnap(x, y);
        expect(['CREATION', 'ENTROPY', 'WITNESS']).toContain(snap.color);
      }
    }
  });

  it('SHAPE is T^4 with golden ratio conjugate', () => {
    const shape = getShape();
    expect(shape.name).toContain('T^4');
    expect(shape.theta).toBeCloseTo(0.6180339887, 5);
    expect(shape.betti).toEqual({ 0: 1, 1: 4, 2: 6, 3: 4, 4: 1 });
    expect(shape.euler).toBe(0);
  });

  it('spectral dimensions are correct', () => {
    expect(SPECTRAL_DIMENSIONS.A).toBe(8);
    expect(SPECTRAL_DIMENSIONS.H).toBe(1024);
    expect(SPECTRAL_DIMENSIONS.EMBED).toBe(1024);
  });
});
