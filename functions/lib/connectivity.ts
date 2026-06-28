import type {
  ConnectivityCheck,
  ConnectivityCheckName,
  ConnectivityReport,
} from '../../src/contracts/connectivity';

export interface ConnectivityGateway {
  authenticate(): Promise<void>;
  readValue(sheetName: string, cell: string): Promise<string>;
  writeValue(sheetName: string, cell: string, value: string): Promise<void>;
  clearValue(sheetName: string, cell: string): Promise<void>;
}

export interface ConnectivityConfig {
  target: string;
  sheetName: string;
  sentinel: string;
  allowWrite: boolean;
}

class CheckFailed extends Error {}

export async function runConnectivityTest(
  config: ConnectivityConfig,
  gateway: ConnectivityGateway,
  options: {
    now?: () => number;
    createMarker?: () => string;
  } = {}
): Promise<ConnectivityReport> {
  const now = options.now ?? Date.now;
  const createMarker = options.createMarker ?? (() => crypto.randomUUID());
  const startedAtMs = now();
  const checks: ConnectivityCheck[] = [];
  let markerMayExist = false;

  const runCheck = async <T>(
    name: ConnectivityCheckName,
    label: string,
    detail: string,
    action: () => Promise<T>
  ): Promise<T> => {
    const checkStartedAt = now();
    try {
      const result = await action();
      checks.push({
        name,
        label,
        status: 'passed',
        durationMs: now() - checkStartedAt,
        detail,
      });
      return result;
    } catch {
      checks.push({
        name,
        label,
        status: 'failed',
        durationMs: now() - checkStartedAt,
        detail: failureDetail(name),
      });
      throw new CheckFailed(label);
    }
  };

  checks.push({
    name: 'configuration',
    label: 'Configuration loaded',
    status: 'passed',
    durationMs: 0,
    detail: `Target is ${config.target}.`,
  });

  try {
    await runCheck(
      'google-authentication',
      'Google authenticated',
      'The service account received a short-lived access token.',
      () => gateway.authenticate()
    );

    const sentinel = await runCheck(
      'sentinel-read',
      'Replica reached',
      'The connectivity sentinel matched.',
      () => gateway.readValue(config.sheetName, 'A1')
    );
    if (sentinel !== config.sentinel) {
      checks[checks.length - 1] = {
        ...checks[checks.length - 1],
        status: 'failed',
        detail: 'The connectivity sentinel did not match.',
      };
      throw new CheckFailed('Replica reached');
    }

    const markerState = await runCheck(
      'marker-state',
      'Marker cell available',
      'The reserved marker cell was blank.',
      () => gateway.readValue(config.sheetName, 'B1')
    );
    if (markerState !== '') {
      checks[checks.length - 1] = {
        ...checks[checks.length - 1],
        status: 'failed',
        detail: 'The reserved marker cell is not blank.',
      };
      throw new CheckFailed('Marker cell available');
    }

    if (!config.allowWrite) {
      for (const [name, label] of [
        ['marker-write', 'Write test disabled'],
        ['marker-readback', 'Read-back skipped'],
        ['cleanup', 'Cleanup not required'],
      ] as const) {
        checks.push({
          name,
          label,
          status: 'skipped',
          durationMs: 0,
          detail: 'This target is configured as read-only.',
        });
      }
    } else {
      const marker = `keloshell:${createMarker()}`;
      markerMayExist = true;
      await runCheck(
        'marker-write',
        'Marker written',
        'A temporary marker was written to the replica.',
        () => gateway.writeValue(config.sheetName, 'B1', marker)
      );
      const readback = await runCheck(
        'marker-readback',
        'Write confirmed',
        'The temporary marker was read back unchanged.',
        () => gateway.readValue(config.sheetName, 'B1')
      );
      if (readback !== marker) {
        checks[checks.length - 1] = {
          ...checks[checks.length - 1],
          status: 'failed',
          detail: 'The marker read-back did not match.',
        };
        throw new CheckFailed('Write confirmed');
      }
    }
  } catch (error) {
    if (!(error instanceof CheckFailed)) {
      checks.push({
        name: 'configuration',
        label: 'Unexpected diagnostic failure',
        status: 'failed',
        durationMs: 0,
        detail: 'The diagnostic stopped unexpectedly.',
      });
    }
  } finally {
    if (markerMayExist) {
      try {
        await runCheck(
          'cleanup',
          'Replica restored',
          'The temporary marker was removed.',
          async () => {
            await gateway.clearValue(config.sheetName, 'B1');
            const value = await gateway.readValue(config.sheetName, 'B1');
            if (value !== '') {
              throw new Error('Marker remained after cleanup.');
            }
          }
        );
      } catch {
        // runCheck has already recorded a safe failure.
      }
    }
  }

  const durationMs = now() - startedAtMs;
  return {
    ok: checks.every((check) => check.status !== 'failed'),
    target: config.target,
    writeMode: config.allowWrite ? 'round-trip' : 'read-only',
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs,
    checks,
  };
}

function failureDetail(name: ConnectivityCheckName): string {
  const details: Record<ConnectivityCheckName, string> = {
    configuration: 'Required connectivity configuration is missing.',
    'google-authentication': 'The service account could not authenticate.',
    'sentinel-read': 'The configured spreadsheet or sentinel could not be read.',
    'marker-state': 'The reserved marker cell could not be checked.',
    'marker-write': 'The temporary marker could not be written.',
    'marker-readback': 'The temporary marker could not be read back.',
    cleanup: 'The temporary marker could not be removed. Check the replica.',
  };
  return details[name];
}
