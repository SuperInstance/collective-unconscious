import { describe, it, expect } from 'vitest';
import { FOURTEEN_THEOREMS, MINIMAL_GENERATORS, THEOREM_GRAPH } from '../src/theorems';

describe('The 14 Grand Unification Theorems', () => {
  it('has exactly 14 theorems', () => {
    expect(FOURTEEN_THEOREMS).toHaveLength(14);
  });

  it('minimal generators are T3 and T5', () => {
    expect(MINIMAL_GENERATORS).toEqual([3, 5]);
  });

  it('theorem graph is a single connected component DAG', () => {
    expect(THEOREM_GRAPH.V).toBe(14);
    expect(THEOREM_GRAPH.beta_0).toBe(1);
    expect(THEOREM_GRAPH.beta_1).toBe(0);
  });

  it('every theorem depends on T3 or T5 transitively', () => {
    // Get transitive closure of {3, 5}
    const reachable = new Set(MINIMAL_GENERATORS);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of FOURTEEN_THEOREMS) {
        if (!reachable.has(t.id) && t.depends_on.some(d => reachable.has(d))) {
          reachable.add(t.id);
          changed = true;
        }
      }
    }
    expect(reachable.size).toBe(14);
  });

  it('conservation law depends on index, Hochschild, category', () => {
    const t14 = FOURTEEN_THEOREMS.find(t => t.id === 14)!;
    expect(t14.name).toContain('Conservation');
    expect(t14.depends_on).toContain(2);
    expect(t14.depends_on).toContain(3);
    expect(t14.depends_on).toContain(5);
  });
});
