import { describe, expect, it } from 'vitest';

import {
  runConnectivityTest,
  type ConnectivityGateway,
} from './connectivity';

class FakeGateway implements ConnectivityGateway {
  calls: string[] = [];
  cells = new Map<string, string>([
    ['A1', 'KELOSHELL_CONNECTIVITY_V1'],
    ['B1', ''],
  ]);
  failOn?: string;
  readbackOverride?: string;
  private markerReadCount = 0;

  async authenticate(): Promise<void> {
    this.record('authenticate');
  }

  async readValue(_sheetName: string, cell: string): Promise<string> {
    this.record(`read:${cell}`);
    if (cell === 'B1') {
      this.markerReadCount += 1;
    }
    if (
      cell === 'B1' &&
      this.markerReadCount === 2 &&
      this.readbackOverride !== undefined
    ) {
      const value = this.readbackOverride;
      this.readbackOverride = undefined;
      return value;
    }
    return this.cells.get(cell) ?? '';
  }

  async writeValue(
    _sheetName: string,
    cell: string,
    value: string
  ): Promise<void> {
    this.record(`write:${cell}`);
    this.cells.set(cell, value);
  }

  async clearValue(_sheetName: string, cell: string): Promise<void> {
    this.record(`clear:${cell}`);
    this.cells.set(cell, '');
  }

  private record(call: string): void {
    this.calls.push(call);
    if (this.failOn === call) {
      throw new Error('Unsafe upstream detail');
    }
  }
}

const config = {
  target: 'replica',
  sheetName: '_PWA_CONNECTIVITY',
  sentinel: 'KELOSHELL_CONNECTIVITY_V1',
  allowWrite: true,
};

describe('runConnectivityTest', () => {
  it('writes, confirms, and removes a unique marker', async () => {
    const gateway = new FakeGateway();

    const report = await runConnectivityTest(config, gateway, {
      createMarker: () => 'fixed-id',
    });

    expect(report.ok).toBe(true);
    expect(gateway.cells.get('B1')).toBe('');
    expect(gateway.calls).toEqual([
      'authenticate',
      'read:A1',
      'read:B1',
      'write:B1',
      'read:B1',
      'clear:B1',
      'read:B1',
    ]);
    expect(report.checks.map((check) => check.name)).toEqual([
      'configuration',
      'google-authentication',
      'sentinel-read',
      'marker-state',
      'marker-write',
      'marker-readback',
      'cleanup',
    ]);
  });

  it('fails closed when the sentinel does not match', async () => {
    const gateway = new FakeGateway();
    gateway.cells.set('A1', 'WRONG_SENTINEL');

    const report = await runConnectivityTest(config, gateway);

    expect(report.ok).toBe(false);
    expect(gateway.calls).toEqual(['authenticate', 'read:A1']);
    expect(report.checks.at(-1)?.detail).toBe(
      'The connectivity sentinel did not match.'
    );
  });

  it('does not overwrite a nonblank reserved marker cell', async () => {
    const gateway = new FakeGateway();
    gateway.cells.set('B1', 'someone-else-is-testing');

    const report = await runConnectivityTest(config, gateway);

    expect(report.ok).toBe(false);
    expect(gateway.cells.get('B1')).toBe('someone-else-is-testing');
    expect(gateway.calls).not.toContain('write:B1');
    expect(gateway.calls).not.toContain('clear:B1');
  });

  it('cleans up after a read-back failure', async () => {
    const gateway = new FakeGateway();
    gateway.readbackOverride = '';

    const report = await runConnectivityTest(config, gateway, {
      createMarker: () => 'fixed-id',
    });

    expect(report.ok).toBe(false);
    expect(gateway.calls).toContain('clear:B1');
    expect(gateway.cells.get('B1')).toBe('');
  });

  it('reports cleanup failure without exposing the upstream error', async () => {
    const gateway = new FakeGateway();
    gateway.failOn = 'clear:B1';

    const report = await runConnectivityTest(config, gateway);

    expect(report.ok).toBe(false);
    expect(report.checks.at(-1)).toMatchObject({
      name: 'cleanup',
      status: 'failed',
      detail: 'The temporary marker could not be removed. Check the replica.',
    });
    expect(JSON.stringify(report)).not.toContain('Unsafe upstream detail');
  });

  it('performs only reads when write testing is disabled', async () => {
    const gateway = new FakeGateway();

    const report = await runConnectivityTest(
      { ...config, allowWrite: false },
      gateway
    );

    expect(report.ok).toBe(true);
    expect(report.writeMode).toBe('read-only');
    expect(report.checks.filter((check) => check.status === 'skipped')).toHaveLength(
      3
    );
    expect(gateway.calls).toEqual(['authenticate', 'read:A1', 'read:B1']);
  });
});
