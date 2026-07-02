import { describe, expect, it } from 'vitest';
import { computePlateLoad, PLATE_DENOMINATIONS } from './plate-math';

const ALL = [...PLATE_DENOMINATIONS];

describe('computePlateLoad', () => {
  it('barbell exact — 185 lb → 1×45 + 1×25 per side', () => {
    const r = computePlateLoad(185, 'barbell', ALL);
    expect(r.perSideTarget).toBe(70);
    expect(r.plates).toEqual([
      { denom: 45, count: 1 },
      { denom: 25, count: 1 },
    ]);
    expect(r.totalWeight).toBe(185);
    expect(r.exact).toBe(true);
    expect(r.deltaLb).toBe(0);
    expect(r.sides).toBe(2);
    expect(r.barLb).toBe(45);
  });

  it('single-peg exact — 185 lb → 4×45 + 1×5', () => {
    const r = computePlateLoad(185, 'single-peg', ALL);
    expect(r.sides).toBe(1);
    expect(r.plates).toEqual([
      { denom: 45, count: 4 },
      { denom: 5, count: 1 },
    ]);
    expect(r.totalWeight).toBe(185);
    expect(r.exact).toBe(true);
  });

  it('machine exact — 180 lb → 2×45 per side, no bar', () => {
    const r = computePlateLoad(180, 'machine', ALL);
    expect(r.sides).toBe(2);
    expect(r.perSideTarget).toBe(90);
    expect(r.plates).toEqual([{ denom: 45, count: 2 }]);
    expect(r.totalWeight).toBe(180);
    expect(r.exact).toBe(true);
  });

  it('35 lb toggled off — uses alternative combination with smaller plates', () => {
    const without35 = ALL.filter((d) => d !== 35);
    // (160-45)/2 = 57.5 per side → 1×45 + 1×10 + 1×2.5 fills the gap
    const r = computePlateLoad(160, 'barbell', without35);
    expect(r.plates).toEqual([
      { denom: 45, count: 1 },
      { denom: 10, count: 1 },
      { denom: 2.5, count: 1 },
    ]);
    expect(r.exact).toBe(true);
    expect(r.totalWeight).toBe(160);
  });

  it('non-exact target — reports correct deltaLb', () => {
    // (156-45)/2 = 55.5 → 1×45+1×10=55 per side → total=45+55*2=155
    const r = computePlateLoad(156, 'barbell', ALL);
    expect(r.exact).toBe(false);
    expect(r.totalWeight).toBe(155);
    expect(r.deltaLb).toBe(1);
  });

  it('target below bar — 0 plates, totalWeight is bar only', () => {
    const r = computePlateLoad(35, 'barbell', ALL);
    expect(r.plates).toHaveLength(0);
    expect(r.perSideWeight).toBe(0);
    expect(r.totalWeight).toBe(45);
    expect(r.exact).toBe(false);
    expect(r.deltaLb).toBe(-10);
  });

  it('2.5 lb plates work for odd targets', () => {
    // (50-45)/2 = 2.5 → 1×2.5 per side → total=45+5=50
    const r = computePlateLoad(50, 'barbell', ALL);
    expect(r.plates).toEqual([{ denom: 2.5, count: 1 }]);
    expect(r.totalWeight).toBe(50);
    expect(r.exact).toBe(true);
  });

  it('single-peg with no available plates — 0 plates, deltaLb=target', () => {
    const r = computePlateLoad(100, 'single-peg', []);
    expect(r.plates).toHaveLength(0);
    expect(r.totalWeight).toBe(0);
    expect(r.deltaLb).toBe(100);
  });
});
