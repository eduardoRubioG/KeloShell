import { describe, expect, it } from 'vitest';

import {
  getProgressionGuidance,
  normalizeProgressionScheme,
} from './progression-guidance';

const schemes = [
  'Dynamic DP',
  'Standard DP',
  'All Set Rep Floor',
  'Top/Backoff',
  '5/5/3/AMRAP',
  'Volume Ramp',
  'Intensity Ramp',
  'Static Rep Linear',
  'Block: Volume',
  'Block: Intensity',
  'Autoregulation',
];

describe('progression guidance', () => {
  it.each(schemes)('provides complete guidance for %s', (scheme) => {
    const guidance = getProgressionGuidance(scheme, '8–12');

    expect(guidance).toEqual({
      scheme: expect.any(String),
      target: expect.any(String),
      increase: expect.any(String),
      startingLoad: expect.any(String),
    });
    expect(guidance?.target).not.toHaveLength(0);
    expect(guidance?.increase).not.toHaveLength(0);
    expect(guidance?.startingLoad).not.toHaveLength(0);
  });

  it('normalizes punctuation, spacing, and known aliases', () => {
    expect(normalizeProgressionScheme('  Block: Volume ')).toBe('block volume');
    expect(normalizeProgressionScheme('Five-Five-Three-AMRAP')).toBe(
      '5/5/3/amrap'
    );
    expect(normalizeProgressionScheme('All Set Floor')).toBe(
      'all set rep floor'
    );
  });

  it('turns a bounded range into a specific target', () => {
    expect(getProgressionGuidance('Dynamic DP', '8–12')?.target).toBe(
      'Get 12 reps on your first set.'
    );
    expect(getProgressionGuidance('Top/Backoff', '6-10')?.target).toBe(
      'Get at least 6 reps on the top set and 10 on every backoff set.'
    );
  });

  it('turns fixed and open-ended targets into safe instructions', () => {
    expect(getProgressionGuidance('Standard DP', '10')?.target).toBe(
      'Get 10 reps on every set.'
    );
    expect(getProgressionGuidance('All Set Rep Floor', '8+')?.target).toBe(
      'Keep every set at 8 reps or more.'
    );
  });

  it('falls back to the displayed target when it cannot be parsed', () => {
    expect(getProgressionGuidance('Static Rep Linear', 'AMRAP')?.target).toBe(
      'Meet the prescribed AMRAP reps on every set.'
    );
  });

  it('does not create guidance for unsupported coach text', () => {
    expect(getProgressionGuidance('Coach review', '8-12')).toBeNull();
  });
});
