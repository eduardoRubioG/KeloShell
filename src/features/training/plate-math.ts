export const PLATE_DENOMINATIONS = [45, 35, 25, 10, 5, 2.5] as const;
export type PlateDenom = (typeof PLATE_DENOMINATIONS)[number];

export const PLATE_COLORS: Record<number, string> = {
  45: '#4C8DFF',
  35: '#F4A640',
  25: '#34D27B',
  10: '#C8C8CC',
  5: '#9B7EF0',
  2.5: '#E05555',
};

export type EquipmentMode = 'barbell' | 'machine' | 'single-peg';

export interface PlateEntry {
  denom: number;
  count: number;
}

export interface PlateLoadResult {
  mode: EquipmentMode;
  sides: number;
  barLb: number;
  perSideTarget: number;
  plates: PlateEntry[];
  perSideWeight: number;
  totalWeight: number;
  exact: boolean;
  deltaLb: number;
}

export function computePlateLoad(
  targetLb: number,
  mode: EquipmentMode,
  availableDenoms: number[],
  barLb = 45,
): PlateLoadResult {
  const sides = mode === 'single-peg' ? 1 : 2;
  const baseWeight = mode === 'barbell' ? barLb : 0;
  const perSideTarget = (targetLb - baseWeight) / sides;

  const sorted = [...availableDenoms].sort((a, b) => b - a);
  const plates: PlateEntry[] = [];
  let remaining = perSideTarget > 0 ? perSideTarget : 0;

  for (const denom of sorted) {
    if (denom > remaining + 0.001) continue;
    const count = Math.floor(remaining / denom + 0.001);
    if (count > 0) {
      plates.push({ denom, count });
      remaining -= denom * count;
      remaining = Math.round(remaining * 100) / 100;
      if (remaining < 0.01) break;
    }
  }

  const perSideWeight = plates.reduce((sum, p) => sum + p.denom * p.count, 0);
  const totalWeight = Math.round((baseWeight + perSideWeight * sides) * 100) / 100;
  const deltaLb = Math.round((targetLb - totalWeight) * 100) / 100;

  return {
    mode,
    sides,
    barLb,
    perSideTarget,
    plates,
    perSideWeight,
    totalWeight,
    exact: Math.abs(deltaLb) < 0.01,
    deltaLb,
  };
}
