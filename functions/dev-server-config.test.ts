import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
}

describe('development server configuration', () => {
  it('runs Cloudflare Pages Functions from the standard local launch tasks', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as PackageManifest;

    expect(manifest.scripts?.['dev-task']).toContain('wrangler pages dev');
    expect(manifest.scripts?.['start-remote']).toContain('wrangler pages dev');
    expect(manifest.scripts?.['dev:ui']).toBe('vite');
    expect(manifest.scripts?.['dev:host']).toBe('vite --host');
  });
});
