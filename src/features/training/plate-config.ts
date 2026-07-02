import { PLATE_DENOMINATIONS } from './plate-math';

const STORAGE_KEY = 'keloshell.plate-config.v1';
const validDenoms = new Set<number>(PLATE_DENOMINATIONS);

function defaultPlates(): number[] {
  return [...PLATE_DENOMINATIONS];
}

export function loadAvailablePlates(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPlates();
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((v) => typeof v === 'number' && validDenoms.has(v))
    ) {
      return parsed as number[];
    }
    return defaultPlates();
  } catch {
    return defaultPlates();
  }
}

export function saveAvailablePlates(denoms: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(denoms));
  } catch {
    // quota exceeded — ignore
  }
}
