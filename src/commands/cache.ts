import os from 'node:os';
import path from 'node:path';

import {
  clearCacheEntries,
  listCacheEntries,
  readCacheStatus,
} from '../core/cache.js';
import type {
  CacheEntry,
  CacheEntryFilter,
  CacheStatus,
  ClearCacheResult,
} from '../core/cache.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';
import { readStats, summarizeStats } from '../core/stats.js';

export interface CacheCommandOptions {
  cacheDir?: string;
  json?: boolean;
  cluster?: string;
  region?: string;
  profile?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export interface CacheCommandDeps {
  home?: string;
}

export interface CacheListResult {
  cacheDir: string;
  entries: CacheEntry[];
}

export interface CacheStatsPointer {
  hits: number;
  estimatedSavedMs: number;
}

export interface CacheStatusResult extends CacheStatus {
  stats?: CacheStatsPointer;
}

export async function runCacheList(
  options: CacheCommandOptions,
  deps: CacheCommandDeps = {},
): Promise<CacheListResult> {
  const cacheDir = resolveCacheDir(options, deps);
  const entries = filterEntries(await listCacheEntries(cacheDir), options);

  return {
    cacheDir,
    entries,
  };
}

export async function runCacheStatus(
  options: CacheCommandOptions,
  deps: CacheCommandDeps = {},
): Promise<CacheStatusResult> {
  const cacheDir = resolveCacheDir(options, deps);
  const stats = await readCacheStatsPointer(cacheDir);

  if (!hasFilters(options)) {
    return addStatsPointer(await readCacheStatus(cacheDir), stats);
  }

  const entries = filterEntries(await listCacheEntries(cacheDir), options);
  const counts: CacheStatus['counts'] = {};

  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  return addStatsPointer({
    cacheDir,
    totalEntries: entries.length,
    totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
    counts,
    entries,
  }, stats);
}

export async function runCacheClear(
  options: CacheCommandOptions,
  deps: CacheCommandDeps = {},
): Promise<ClearCacheResult> {
  if (options.yes !== true && options.dryRun !== true) {
    throw new Error('--yes is required to clear cache entries');
  }

  const cacheDir = resolveCacheDir(options, deps);

  return clearCacheEntries(cacheDir, {
    cluster: options.cluster,
    region: options.region,
    profile: options.profile,
    dryRun: options.dryRun,
  } satisfies CacheEntryFilter);
}

function resolveCacheDir(options: CacheCommandOptions, deps: CacheCommandDeps): string {
  const home = deps.home ?? os.homedir();
  const cacheDir = options.cacheDir ?? defaultPaths(home).cacheDir;

  return path.resolve(resolveHomePath(cacheDir, home));
}

function filterEntries(entries: CacheEntry[], options: CacheCommandOptions): CacheEntry[] {
  if (!hasFilters(options)) {
    return entries;
  }

  return entries.filter((entry) => {
    if (options.cluster !== undefined && entry.cluster !== safeName(options.cluster)) {
      return false;
    }
    if (options.region !== undefined && entry.region !== safeName(options.region)) {
      return false;
    }
    if (options.profile !== undefined && entry.profile !== safeName(options.profile)) {
      return false;
    }

    return true;
  });
}

function hasFilters(options: CacheCommandOptions): boolean {
  return (
    options.cluster !== undefined ||
    options.region !== undefined ||
    options.profile !== undefined
  );
}

async function readCacheStatsPointer(cacheDir: string): Promise<CacheStatsPointer | undefined> {
  const summary = summarizeStats(await readStats(cacheDir));

  if (summary.hits === 0 && summary.estimatedSavedMs === 0) {
    return undefined;
  }

  return {
    hits: summary.hits,
    estimatedSavedMs: summary.estimatedSavedMs,
  };
}

function addStatsPointer(
  status: CacheStatus,
  stats: CacheStatsPointer | undefined,
): CacheStatusResult {
  return stats === undefined
    ? status
    : {
        ...status,
        stats,
      };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
