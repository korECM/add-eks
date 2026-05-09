import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  formatStatsHuman,
  runStatsClear,
  runStatsShow,
} from '../../src/commands/stats.js';
import { defaultPaths } from '../../src/core/paths.js';
import { statsPathForCacheDir } from '../../src/core/stats.js';

const execFileAsync = promisify(execFile);

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-stats-command-'));
}

async function writeStats(cacheDir: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    statsPathForCacheDir(cacheDir),
    `${JSON.stringify({
      schemaVersion: 1,
      totals: {
        hits: 38,
        misses: 5,
        awsCalls: 5,
        estimatedSavedMs: 252000,
        actualAwsMsTotal: 33000,
      },
      byCluster: {
        prod: {
          hits: 20,
          misses: 2,
          estimatedSavedMs: 132000,
          lastSeen: '2026-05-09T00:00:00Z',
        },
        dev: {
          hits: 18,
          misses: 3,
          estimatedSavedMs: 120000,
          lastSeen: '2026-05-08T00:00:00Z',
        },
      },
      recent: [
        { type: 'hit', cluster: 'prod', estimatedSavedMs: 6600 },
        { type: 'hit', cluster: 'prod', estimatedSavedMs: 6600 },
        { type: 'miss', cluster: 'prod', actualAwsMs: 7000 },
      ],
    })}\n`,
    'utf8',
  );
}

describe('stats command handlers', () => {
  it('shows stats from an explicit cache directory', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeStats(cacheDir);

    await expect(runStatsShow({ cacheDir }, { home: root })).resolves.toMatchObject({
      cacheDir,
      stats: {
        totals: {
          hits: 38,
          misses: 5,
          awsCalls: 5,
          estimatedSavedMs: 252000,
          actualAwsMsTotal: 33000,
        },
      },
      summary: {
        hits: 38,
        misses: 5,
        awsCalls: 5,
        estimatedSavedMs: 252000,
        averageAwsMs: 6600,
        topCluster: 'prod',
      },
      comparisons: [],
    });
  });

  it('uses the default cache directory under the injected home', async () => {
    const root = await tempDir();
    const cacheDir = defaultPaths(root).cacheDir;
    await writeStats(cacheDir);

    await expect(runStatsShow({}, { home: root })).resolves.toMatchObject({
      cacheDir,
      summary: {
        hits: 38,
        awsCalls: 5,
      },
    });
  });

  it('formats human output with exact numbers before optional comparisons', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeStats(cacheDir);

    const output = formatStatsHuman(await runStatsShow({ cacheDir }, { home: root }));

    expect(output.split('\n').slice(0, 7)).toEqual([
      'Time saved: 4m 12s',
      'Cache hits: 38',
      'AWS token calls avoided: 38',
      'AWS token calls made: 5',
      'Average token call: 6.6s',
      'Best hit streak: 2',
      'Top cluster: prod',
    ]);
    expect(output).toContain('kubectl quietly handed you 4m 12s back.');
  });

  it('requires --yes before clearing stats', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeStats(cacheDir);

    await expect(runStatsClear({ cacheDir }, { home: root })).rejects.toThrow(
      '--yes is required to clear stats',
    );
    await expect(readFile(statsPathForCacheDir(cacheDir), 'utf8')).resolves.toContain(
      '"schemaVersion"',
    );
  });

  it('clears stats after confirmation', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeStats(cacheDir);

    await expect(runStatsClear({ cacheDir, yes: true }, { home: root })).resolves.toEqual({
      cacheDir,
      deleted: true,
    });
    await expect(readFile(statsPathForCacheDir(cacheDir), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('respects parent --cache-dir when clearing stats through the CLI', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'explicit-cache');
    await writeStats(cacheDir);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/cli.ts',
        'stats',
        '--cache-dir',
        cacheDir,
        'clear',
        '--yes',
        '--json',
      ],
      {
        env: {
          ...process.env,
          HOME: root,
        },
      },
    );

    expect(JSON.parse(stdout)).toEqual({
      cacheDir,
      deleted: true,
    });
    await expect(readFile(statsPathForCacheDir(cacheDir), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
