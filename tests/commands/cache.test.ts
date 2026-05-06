import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  runCacheClear,
  runCacheList,
  runCacheStatus,
} from '../../src/commands/cache.js';
import {
  clearCacheEntries,
  listCacheEntries,
  readCacheStatus,
} from '../../src/core/cache.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-cache-'));
}

function execCredential(expirationTimestamp: string): string {
  return `${JSON.stringify({
    apiVersion: 'client.authentication.k8s.io/v1beta1',
    kind: 'ExecCredential',
    status: {
      expirationTimestamp,
      token: 'token',
    },
  })}\n`;
}

async function writeCacheFile(
  cacheDir: string,
  name: string,
  contents: string,
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, name);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

describe('cache core utilities', () => {
  it('lists valid, expired, malformed, and unknown cache entries', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    const validPath = await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-old__us-west-2__team-123-46.json',
      execCredential('2000-01-01T00:00:00Z'),
    );
    await writeCacheFile(cacheDir, 'broken.json', '{nope');
    await writeCacheFile(cacheDir, 'note.txt', 'not a cache file');

    const entries = await listCacheEntries(cacheDir);

    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'broken.json',
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      'cluster-region-profile-old__us-west-2__team-123-46.json',
      'note.txt',
    ]);
    expect(entries.find((entry) => entry.path === validPath)).toMatchObject({
      name: 'cluster-region-profile-dev__us-west-2__team-123-45.json',
      status: 'valid',
      expirationTimestamp: '2999-01-01T00:00:00Z',
      cluster: 'dev',
      region: 'us-west-2',
      profile: 'team',
    });
    expect(
      entries.find((entry) => entry.name.startsWith('cluster-region-profile-old')),
    ).toMatchObject({ status: 'expired' });
    expect(entries.find((entry) => entry.name === 'broken.json')).toMatchObject({
      status: 'malformed',
    });
    expect(entries.find((entry) => entry.name === 'note.txt')).toMatchObject({
      status: 'unknown',
    });
  });

  it('treats a missing cache directory as empty', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'missing');

    await expect(listCacheEntries(cacheDir)).resolves.toEqual([]);
    await expect(readCacheStatus(cacheDir)).resolves.toMatchObject({
      cacheDir,
      totalEntries: 0,
      totalSize: 0,
      counts: {},
      entries: [],
    });
  });

  it('summarizes cache status with counts and total size', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );
    await writeCacheFile(cacheDir, 'broken.json', '{nope');

    const status = await readCacheStatus(cacheDir);

    expect(status).toMatchObject({
      cacheDir,
      totalEntries: 2,
      counts: {
        valid: 1,
        malformed: 1,
      },
    });
    expect(status.totalSize).toBeGreaterThan(0);
    expect(status.entries).toHaveLength(2);
  });

  it('clears all json cache files while skipping non-json files', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );
    await writeCacheFile(cacheDir, 'broken.json', '{nope');
    await writeCacheFile(cacheDir, 'note.txt', 'keep me');

    const result = await clearCacheEntries(cacheDir, {});

    expect(result).toMatchObject({
      deletedCount: 2,
      skippedCount: 1,
      dryRun: false,
    });
    expect((await readdir(cacheDir)).sort()).toEqual(['note.txt']);
  });

  it('skips entries that cannot be matched reliably when filters are present', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-prod__us-west-2__team-123-46.json',
      execCredential('2999-01-01T00:00:00Z'),
    );
    await writeCacheFile(cacheDir, 'opaque-123.json', execCredential('2999-01-01T00:00:00Z'));

    const result = await clearCacheEntries(cacheDir, { cluster: 'dev' });

    expect(result).toMatchObject({
      deletedCount: 1,
      skippedCount: 2,
    });
    expect((await readdir(cacheDir)).sort()).toEqual([
      'cluster-region-profile-prod__us-west-2__team-123-46.json',
      'opaque-123.json',
    ]);
  });

  it('reports dry-run clear matches without deleting files', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );

    const result = await clearCacheEntries(cacheDir, { dryRun: true });

    expect(result).toMatchObject({
      deletedCount: 0,
      wouldDeleteCount: 1,
      dryRun: true,
    });
    expect(await readdir(cacheDir)).toHaveLength(1);
  });
});

describe('cache command handlers', () => {
  it('returns json-ish list and status results from handlers', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );

    await expect(runCacheList({ cacheDir, json: true }, { home: root })).resolves.toMatchObject({
      cacheDir,
      entries: [{ status: 'valid', cluster: 'dev', region: 'us-west-2', profile: 'team' }],
    });
    await expect(runCacheStatus({ cacheDir, json: true }, { home: root })).resolves.toMatchObject({
      cacheDir,
      counts: { valid: 1 },
      totalEntries: 1,
    });
  });

  it('requires --yes for clear unless dry-run is enabled', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );

    await expect(runCacheClear({ cacheDir }, { home: root })).rejects.toThrow(
      '--yes is required to clear cache entries',
    );

    await expect(
      runCacheClear({ cacheDir, dryRun: true }, { home: root }),
    ).resolves.toMatchObject({
      dryRun: true,
      wouldDeleteCount: 1,
    });
  });

  it('clears cache entries from the command handler after confirmation', async () => {
    const root = await tempDir();
    const cacheDir = path.join(root, 'cache');
    await writeCacheFile(
      cacheDir,
      'cluster-region-profile-dev__us-west-2__team-123-45.json',
      execCredential('2999-01-01T00:00:00Z'),
    );

    await expect(runCacheClear({ cacheDir, yes: true }, { home: root })).resolves.toMatchObject({
      deletedCount: 1,
      skippedCount: 0,
    });
    await expect(
      readFile(
        path.join(cacheDir, 'cluster-region-profile-dev__us-west-2__team-123-45.json'),
        'utf8',
      ),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
