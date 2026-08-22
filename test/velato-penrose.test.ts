import { describe, it, expect } from 'vitest';
import { textToVelato, analyzeVelatoPhrase, getVelatoPenroseThesis } from '../src/velato-penrose';

describe('Velato-Penrose-Quilt', () => {
  it('extracts a Velato phrase from text', () => {
    const tokens = textToVelato('Hello world');
    expect(tokens.length).toBe(11);
    for (const t of tokens) {
      expect(['CREATION', 'ENTROPY', 'WITNESS']).toContain(t.color);
    }
  });

  it('analyzes a phrase with all 3 colors', () => {
    const result = analyzeVelatoPhrase('The collected unconscious of the fleet');
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.colors.creation + result.colors.entropy + result.colors.witness).toBe(result.tokens.length);
    expect(result.shape).toContain('T^4');
  });

  it('has the Velato-Penrose thesis', () => {
    const thesis = getVelatoPenroseThesis();
    expect(thesis.thesis.length).toBeGreaterThanOrEqual(6);
    expect(thesis.substitution.L_to_LS).toBe('JEPA (predictive expansion)');
    expect(thesis.substitution.S_to_L).toBe('DoubleEntry (conservative collapse)');
  });
});
