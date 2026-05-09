import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { name, version } from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('package smoke test', () => {
  it('exports the CLI package name', () => {
    expect(name).toBe('add-eks');
  });

  it('exports the CLI package version', () => {
    expect(version).toBe('0.1.0');
  });

  it('recognizes the stats command in CLI help', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'src/cli.ts',
      'stats',
      '--help',
    ]);

    expect(stdout).toContain('Usage: add-eks stats');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('clear');
  });
});
