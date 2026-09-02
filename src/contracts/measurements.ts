export interface MeasurementField {
  id: string;
  label: string;
}

export type MeasurementCheckInStatus = 'empty' | 'partial' | 'complete';

export interface MeasurementCheckInEntry {
  date: string;
  label: string;
  status: MeasurementCheckInStatus;
  values: Record<string, string | null>;
  revision: string;
}

export interface MeasurementsResponse {
  tabAvailable: boolean;
  unitLabel: string | null;
  fields: MeasurementField[];
  checkIns: MeasurementCheckInEntry[];
}

export interface MeasurementCheckInSaveRequest {
  date: string;
  revision: string;
  values: Record<string, number>;
}
