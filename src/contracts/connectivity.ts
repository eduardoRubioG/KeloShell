export type ConnectivityCheckName =
  | 'configuration'
  | 'google-authentication'
  | 'sentinel-read'
  | 'marker-state'
  | 'marker-write'
  | 'marker-readback'
  | 'cleanup';

export type ConnectivityCheckStatus = 'passed' | 'failed' | 'skipped';

export interface ConnectivityCheck {
  name: ConnectivityCheckName;
  label: string;
  status: ConnectivityCheckStatus;
  durationMs: number;
  detail: string;
}

export interface ConnectivityReport {
  ok: boolean;
  target: string;
  writeMode: 'round-trip' | 'read-only';
  startedAt: string;
  durationMs: number;
  checks: ConnectivityCheck[];
}

