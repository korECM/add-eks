import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export type CacheEntryStatus =
  | 'valid'
  | 'expired'
  | 'unreadable'
  | 'malformed'
  | 'unknown';

export interface CacheEntry {
  path: string;
  name: string;
  size: number;
  mtime: string;
  mtimeMs: number;
  status: CacheEntryStatus;
  expirationTimestamp?: string;
  cluster?: string;
  region?: string;
  profile?: string;
}

export interface CacheEntryFilter {
  cluster?: string;
  region?: string;
  profile?: string;
  dryRun?: boolean;
}

export interface CacheStatus {
  cacheDir: string;
  totalEntries: number;
  totalSize: number;
  counts: Partial<Record<CacheEntryStatus, number>>;
  entries: CacheEntry[];
}

export interface ClearCacheResult {
  cacheDir: string;
  dryRun: boolean;
  deletedCount: number;
  skippedCount: number;
  wouldDeleteCount: number;
  deleted: CacheEntry[];
  skipped: CacheSkippedEntry[];
}

export interface CacheSkippedEntry {
  entry: CacheEntry;
  reason: 'non-cache-file' | 'filter-not-matched' | 'filter-unknown' | 'delete-failed';
  message?: string;
}

interface CacheMetadata {
  cluster?: string;
  region?: string;
  profile?: string;
}

export async function listCacheEntries(cacheDir: string): Promise<CacheEntry[]> {
  let names: string[];

  try {
    names = await readdir(cacheDir);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const entries = await Promise.all(
    names.map((name) => readCacheEntry(path.join(cacheDir, name), name)),
  );

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readCacheStatus(cacheDir: string): Promise<CacheStatus> {
  const entries = await listCacheEntries(cacheDir);
  const counts: Partial<Record<CacheEntryStatus, number>> = {};

  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  return {
    cacheDir,
    totalEntries: entries.length,
    totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
    counts,
    entries,
  };
}

export async function clearCacheEntries(
  cacheDir: string,
  filter: CacheEntryFilter,
): Promise<ClearCacheResult> {
  const entries = await listCacheEntries(cacheDir);
  const dryRun = filter.dryRun === true;
  const deleted: CacheEntry[] = [];
  const skipped: CacheSkippedEntry[] = [];
  let wouldDeleteCount = 0;

  for (const entry of entries) {
    const decision = shouldDelete(entry, filter);

    if (!decision.delete) {
      skipped.push({ entry, reason: decision.reason });
      continue;
    }

    if (dryRun) {
      wouldDeleteCount += 1;
      continue;
    }

    try {
      await unlink(entry.path);
      deleted.push(entry);
    } catch (error) {
      skipped.push({
        entry,
        reason: 'delete-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    cacheDir,
    dryRun,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
    wouldDeleteCount,
    deleted,
    skipped,
  };
}

async function readCacheEntry(filePath: string, name: string): Promise<CacheEntry> {
  const metadata = metadataFromName(name);

  try {
    const fileStat = await stat(filePath);
    const baseEntry = {
      path: filePath,
      name,
      size: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
      mtimeMs: fileStat.mtimeMs,
      ...metadata,
    };

    if (!name.endsWith('.json')) {
      return {
        ...baseEntry,
        status: 'unknown',
      };
    }

    let contents: string;
    try {
      contents = await readFile(filePath, 'utf8');
    } catch {
      return {
        ...baseEntry,
        status: 'unreadable',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      return {
        ...baseEntry,
        status: 'malformed',
      };
    }

    const expirationTimestamp = getExpirationTimestamp(parsed);
    if (expirationTimestamp === undefined) {
      return {
        ...baseEntry,
        status: 'unknown',
      };
    }

    const expiration = parseTimestamp(expirationTimestamp);
    if (expiration === undefined) {
      return {
        ...baseEntry,
        status: 'unknown',
      };
    }

    return {
      ...baseEntry,
      expirationTimestamp,
      status: expiration.getTime() > Date.now() ? 'valid' : 'expired',
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        path: filePath,
        name,
        size: 0,
        mtime: new Date(0).toISOString(),
        mtimeMs: 0,
        status: 'unreadable',
        ...metadata,
      };
    }

    throw error;
  }
}

function shouldDelete(
  entry: CacheEntry,
  filter: CacheEntryFilter,
): { delete: true } | { delete: false; reason: CacheSkippedEntry['reason'] } {
  if (!entry.name.endsWith('.json')) {
    return { delete: false, reason: 'non-cache-file' };
  }

  const hasFilter =
    filter.cluster !== undefined ||
    filter.region !== undefined ||
    filter.profile !== undefined;

  if (!hasFilter) {
    return { delete: true };
  }

  if (
    (filter.cluster !== undefined && entry.cluster === undefined) ||
    (filter.region !== undefined && entry.region === undefined) ||
    (filter.profile !== undefined && entry.profile === undefined)
  ) {
    return { delete: false, reason: 'filter-unknown' };
  }

  if (
    (filter.cluster !== undefined && safeName(filter.cluster) !== entry.cluster) ||
    (filter.region !== undefined && safeName(filter.region) !== entry.region) ||
    (filter.profile !== undefined && safeName(filter.profile) !== entry.profile)
  ) {
    return { delete: false, reason: 'filter-not-matched' };
  }

  return { delete: true };
}

function getExpirationTimestamp(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = value.status;
  if (!isRecord(status)) {
    return undefined;
  }

  return typeof status.expirationTimestamp === 'string'
    ? status.expirationTimestamp
    : undefined;
}

function parseTimestamp(value: string): Date | undefined {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?Z$/.exec(
    value,
  );

  if (match?.groups === undefined) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const expected = {
    year: date.getUTCFullYear().toString().padStart(4, '0'),
    month: (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    day: date.getUTCDate().toString().padStart(2, '0'),
    hour: date.getUTCHours().toString().padStart(2, '0'),
    minute: date.getUTCMinutes().toString().padStart(2, '0'),
    second: date.getUTCSeconds().toString().padStart(2, '0'),
  };

  for (const [key, part] of Object.entries(expected)) {
    if (match.groups[key] !== part) {
      return undefined;
    }
  }

  return date;
}

function metadataFromName(name: string): CacheMetadata {
  const stem = name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
  const hashless = stem.replace(/-\d+-\d+$/, '');

  if (hashless.startsWith('cluster-region-profile-')) {
    const value = hashless.slice('cluster-region-profile-'.length);
    const parts = value.split('__');
    if (parts.length === 3) {
      return {
        cluster: parts[0],
        region: parts[1],
        profile: parts[2],
      };
    }
  }

  if (hashless.startsWith('cluster-profile-')) {
    const value = hashless.slice('cluster-profile-'.length);
    const parts = value.split('__');
    if (parts.length === 2) {
      return {
        cluster: parts[0],
        profile: parts[1],
      };
    }
  }

  if (hashless.startsWith('cluster-')) {
    return {
      cluster: hashless.slice('cluster-'.length),
    };
  }

  return {};
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
