/** The Daily Bodyweight changed (or vanished) since the client loaded it. */
export class BodyweightConflictError extends Error {
  constructor(message = 'The bodyweight data changed since it was loaded.') {
    super(message);
    this.name = 'BodyweightConflictError';
  }
}

/** The Measurement Check-In changed (or vanished) since the client loaded it. */
export class MeasurementCheckInConflictError extends Error {
  constructor(message = 'The measurement check-in changed since it was loaded.') {
    super(message);
    this.name = 'MeasurementCheckInConflictError';
  }
}
