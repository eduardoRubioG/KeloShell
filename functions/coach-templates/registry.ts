import type { UserId } from '../lib/users';
import { coachPartnerTraining } from './coach-partner/training';
import { coachPartnerTracking } from './coach-partner/tracking';
import type { CoachTemplate } from './types';

const COACH_PARTNER_TEMPLATE: CoachTemplate = {
  training: coachPartnerTraining,
  tracking: coachPartnerTracking,
};

/**
 * Every Subscriber currently resolves to the Coach Partner's template. Operator
 * scripts that work from a spreadsheet ID alone omit the Subscriber.
 */
export function resolveCoachTemplate(_userId?: UserId): CoachTemplate {
  return COACH_PARTNER_TEMPLATE;
}
