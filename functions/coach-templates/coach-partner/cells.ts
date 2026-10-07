/** Cell-level helpers shared by the Coach Partner adapter's parsers. */

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function serialDateToUtc(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000);
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function cellText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function displayCell(value: unknown): string | null {
  return isBlank(value) ? null : cellText(value);
}

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || cellText(value) === '';
}

export function isPositiveDecimal(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0;
}

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
