import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildTimeComparisons,
  clearStats,
  formatDuration,
  readStats,
  summarizeStats,
  statsPathForCacheDir,
} from '../../src/core/stats.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-stats-'));
}

describe('stats core utilities', () => {
  it('returns the stats path inside the cache directory', () => {
    expect(statsPathForCacheDir('/tmp/add-eks-cache')).toBe(
      path.join('/tmp/add-eks-cache', '.add-eks-stats.json'),
    );
  });

  it('treats missing stats as empty', async () => {
    const cacheDir = await tempDir();

    await expect(readStats(cacheDir)).resolves.toMatchObject({
      schemaVersion: 1,
      totals: {
        hits: 0,
        misses: 0,
        awsCalls: 0,
        estimatedSavedMs: 0,
        actualAwsMsTotal: 0,
      },
      byCluster: {},
      recent: [],
    });
  });

  it('summarizes exact totals and average aws duration', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      statsPathForCacheDir(cacheDir),
      JSON.stringify({
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
            hits: 30,
            misses: 1,
            estimatedSavedMs: 66000,
            lastSeen: '2026-05-08T00:00:00Z',
          },
        },
        recent: [{ type: 'hit', at: '2026-05-09T00:00:00Z', estimatedSavedMs: 6600 }],
      }),
      'utf8',
    );

    expect(summarizeStats(await readStats(cacheDir))).toMatchObject({
      hits: 38,
      misses: 5,
      awsCalls: 5,
      estimatedSavedMs: 252000,
      averageAwsMs: 6600,
      topCluster: 'prod',
    });
  });

  it('moves malformed stats aside and starts fresh', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    const statsPath = statsPathForCacheDir(cacheDir);
    await writeFile(statsPath, '{broken', 'utf8');

    const stats = await readStats(cacheDir);

    expect(stats.totals.hits).toBe(0);
    await expect(readFile(statsPath, 'utf8')).resolves.toContain('"schemaVersion"');
    const entries = await readdir(cacheDir);
    expect(entries).toContain('.add-eks-stats.json.broken');
  });

  it('bounds malformed stats sidecars across repeated reads', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    const statsPath = statsPathForCacheDir(cacheDir);

    for (let index = 0; index < 3; index += 1) {
      await writeFile(statsPath, `{broken-${index}`, 'utf8');
      await readStats(cacheDir);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const brokenEntries = (await readdir(cacheDir)).filter((entry) =>
      entry.startsWith('.add-eks-stats.json.broken'),
    );
    expect(brokenEntries).toEqual(['.add-eks-stats.json.broken']);
  });

  it('formats compact durations', () => {
    expect(formatDuration(252000)).toBe('4m 12s');
    expect(formatDuration(6600)).toBe('6.6s');
    expect(formatDuration(3_726_000)).toBe('1h 2m 6s');
  });

  it('carries rounded seconds across minute and hour boundaries', () => {
    expect(formatDuration(59_999)).toBe('1m');
    expect(formatDuration(3_599_999)).toBe('1h');
    expect(formatDuration(3_659_999)).toBe('1h 1m');
  });

  it('builds deterministic small saved-time comparisons', () => {
    expect(buildTimeComparisons(252_000)).toEqual([
      { label: 'Instant ramen timers', value: '1.4' },
      { label: 'Songs', value: '1.2' },
      { label: 'Loading spinners', value: '5.6' },
    ]);
  });

  it('builds deterministic medium saved-time comparisons', () => {
    expect(buildTimeComparisons(1_800_000)).toEqual([
      { label: 'PR reviews', value: '2' },
      { label: 'Power naps', value: '1.5' },
      { label: 'Docs lines read', value: '500' },
    ]);
  });

  it('builds deterministic large saved-time comparisons', () => {
    expect(buildTimeComparisons(57_600_000)).toEqual([
      { label: 'Workdays', value: '2' },
      { label: 'Technical book pages', value: '640' },
      { label: 'Side-project evenings', value: '5.3' },
    ]);
  });

  it('clears stats when present', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    const statsPath = statsPathForCacheDir(cacheDir);
    await writeFile(statsPath, '{"schemaVersion":1}', 'utf8');

    await expect(clearStats(cacheDir)).resolves.toEqual({ deleted: true });
    await expect(readFile(statsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports when there is no stats file to clear', async () => {
    const cacheDir = await tempDir();

    await expect(clearStats(cacheDir)).resolves.toEqual({ deleted: false });
  });
});
