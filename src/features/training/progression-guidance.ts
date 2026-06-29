export interface ProgressionGuidance {
  scheme: string;
  target: string;
  increase: string;
  startingLoad: string;
}

interface RepTarget {
  label: string;
  floor: number | null;
  maximum: number | null;
}

type GuidanceBuilder = (target: RepTarget) => ProgressionGuidance;

const guidanceByScheme: Record<string, GuidanceBuilder> = {
  'dynamic dp': (target) => ({
    scheme: 'Dynamic DP',
    target: target.maximum
      ? `Get ${target.maximum} reps on your first set.`
      : `Take your first set to the top of the prescribed ${target.label} target.`,
    increase: 'Add weight when your first set reaches the top of the rep range.',
    startingLoad: 'Use the estimated rep max (ERM) for the top of the rep range.',
  }),
  'standard dp': (target) => ({
    scheme: 'Standard DP',
    target: target.maximum
      ? `Get ${target.maximum} reps on every set.`
      : `Take every set to the top of the prescribed ${target.label} target.`,
    increase: 'Add weight when every set reaches the top of the rep range.',
    startingLoad: 'Use the estimated rep max (ERM) for the top of the rep range.',
  }),
  'all set rep floor': (target) => ({
    scheme: 'All Set Rep Floor',
    target: target.floor
      ? `Keep every set at ${target.floor} reps or more.`
      : `Keep every set at or above the prescribed ${target.label} floor.`,
    increase: 'Add weight when every set stays at or above the rep floor.',
    startingLoad: 'Use the estimated rep max (ERM) for the top of the rep range.',
  }),
  'top/backoff': (target) => ({
    scheme: 'Top/Backoff',
    target:
      target.floor && target.maximum
        ? `Get at least ${target.floor} reps on the top set and ${target.maximum} on every backoff set.`
        : `Keep the top set at the ${target.label} floor and every backoff set at the top of its range.`,
    increase:
      'Add weight to the top set when it reaches the floor; add weight to backoff sets when they reach the range maximum.',
    startingLoad:
      'Top set: ERM for the rep floor. Backoff sets: ERM for the top of the rep range.',
  }),
  '5/5/3/amrap': () => ({
    scheme: '5/5/3/AMRAP',
    target: 'Complete 5, 5, and 3 reps, then get at least 3 reps on the AMRAP set.',
    increase:
      'When the AMRAP reaches 3+ reps, increase the 1RM in the RM calculator by 5 lb / 2.5 kg.',
    startingLoad: 'Set 1: 10RM. Set 2: 8RM. Set 3: 5RM. Set 4: 3RM.',
  }),
  'volume ramp': (target) => ({
    scheme: 'Volume Ramp',
    target: `Complete every set at the prescribed ${target.label} reps across the full ramp phase.`,
    increase: 'Add weight after every set in the full ramp phase meets its prescribed reps.',
    startingLoad: 'Use the estimated rep max (ERM) for the top of the rep range.',
  }),
  'intensity ramp': (target) => ({
    scheme: 'Intensity Ramp',
    target: `Complete every set at the prescribed ${target.label} reps across the full ramp phase.`,
    increase: 'Add weight after every set in the full ramp phase meets its prescribed reps.',
    startingLoad: 'Use a load based on an ERM 1–2 reps above the prescribed reps.',
  }),
  'static rep linear': (target) => ({
    scheme: 'Static Rep Linear',
    target: target.floor
      ? `Get at least ${target.floor} reps on every set.`
      : `Meet the prescribed ${target.label} reps on every set.`,
    increase: 'Add weight when every set meets the prescribed reps.',
    startingLoad: 'Use a load based on an ERM 2 reps above the prescribed reps.',
  }),
  'block volume': (target) => ({
    scheme: 'Block: Volume',
    target: target.floor
      ? `Get at least ${target.floor} reps on every set in the block.`
      : `Meet the prescribed ${target.label} reps on every set in the block.`,
    increase: 'Move up next block when all sets meet the prescribed reps.',
    startingLoad: 'Use a load based on an ERM 2 reps above the prescribed reps.',
  }),
  'block intensity': (target) => ({
    scheme: 'Block: Intensity',
    target: target.floor
      ? `Get at least ${target.floor} reps on every set.`
      : `Meet the prescribed ${target.label} reps on every set.`,
    increase: 'Add weight when every set meets the prescribed reps.',
    startingLoad: 'Use a load based on an ERM 2 reps above the prescribed reps.',
  }),
  autoregulation: (target) => ({
    scheme: 'Autoregulation',
    target: `Complete the prescribed ${target.label} work for the current block.`,
    increase: 'Review and progress the load at each block transition.',
    startingLoad: 'Use a load based on an ERM 2 reps above the prescribed reps.',
  }),
};

const aliases: Record<string, string> = {
  'all set floor': 'all set rep floor',
  'five five three amrap': '5/5/3/amrap',
};

export function normalizeProgressionScheme(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
  return aliases[normalized] ?? normalized;
}

export function getProgressionGuidance(
  progression: string,
  repTarget: string
): ProgressionGuidance | null {
  const builder = guidanceByScheme[normalizeProgressionScheme(progression)];
  return builder ? builder(parseRepTarget(repTarget)) : null;
}

function parseRepTarget(value: string): RepTarget {
  const label = value.trim() || 'prescribed';
  const normalized = label.replace(/[–—]/g, '-');
  const bounded = /^(\d+)\s*-\s*(\d+)$/.exec(normalized);
  if (bounded) {
    return {
      label,
      floor: Number(bounded[1]),
      maximum: Number(bounded[2]),
    };
  }
  const fixed = /^(\d+)\s*(\+)?$/.exec(normalized);
  if (fixed) {
    return {
      label,
      floor: Number(fixed[1]),
      maximum: fixed[2] ? null : Number(fixed[1]),
    };
  }
  return { label, floor: null, maximum: null };
}
