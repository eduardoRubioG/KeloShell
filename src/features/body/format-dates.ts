export function formatDate(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatMonth(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export function formatDay(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { day: 'numeric' });
}

function localDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatWeight(value: number): string {
  return value.toFixed(1);
}
