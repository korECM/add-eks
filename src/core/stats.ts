import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATS_FILE_NAME = '.add-eks-stats.json';

export interface StatsTotals {
  hits: number;
  misses: number;
  awsCalls: number;
  estimatedSavedMs: number;
  actualAwsMsTotal: number;
}

export interface ClusterStats {
  hits: number;
  misses: number;
  estimatedSavedMs: number;
  lastSeen?: string;
}

export interface RecentStatsEntry {
  type?: string;
  at?: string;
  estimatedSavedMs?: number;
  actualAwsMs?: number;
  cluster?: string;
}

export interface Stats {
  schemaVersion: 1;
  totals: StatsTotals;
  byCluster: Record<string, ClusterStats>;
  recent: RecentStatsEntry[];
}

export interface StatsSummary extends StatsTotals {
  averageAwsMs: number;
  topCluster?: string;
}

export interface ClearStatsResult {
  deleted: boolean;
}

export function statsPathForCacheDir(cacheDir: string): string {
  return path.join(cacheDir, STATS_FILE_NAME);
}

export async function readStats(cacheDir: string): Promise<Stats> {
  const statsPath = statsPathForCacheDir(cacheDir);

  let contents: string;
  try {
    contents = await readFile(statsPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return emptyStats();
    }

    throw error;
  }

  try {
    return normalizeStats(JSON.parse(contents));
  } catch {
    await moveBrokenStatsAside(statsPath);
    const freshStats = emptyStats();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(statsPath, `${JSON.stringify(freshStats, null, 2)}\n`, 'utf8');
    return freshStats;
  }
}

export function summarizeStats(stats: Stats): StatsSummary {
  const totals = normalizeTotals(stats.totals);
  const topCluster = topClusterByUsefulActivity(stats.byCluster);

  return {
    ...totals,
    averageAwsMs:
      totals.awsCalls > 0 ? totals.actualAwsMsTotal / totals.awsCalls : 0,
    ...(topCluster === undefined ? {} : { topCluster }),
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round((Math.max(0, ms) / 1000) * 10) / 10;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds - hours * 3600 - minutes * 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || (hours > 0 && seconds > 0)) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${formatSeconds(seconds)}s`);
  }

  return parts.join(' ');
}

export async function clearStats(cacheDir: string): Promise<ClearStatsResult> {
  try {
    await unlink(statsPathForCacheDir(cacheDir));
    return { deleted: true };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { deleted: false };
    }

    throw error;
  }
}

export function emptyStats(): Stats {
  return {
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
  };
}

function normalizeStats(value: unknown): Stats {
  if (!isRecord(value)) {
    throw new Error('Stats must be an object');
  }

  return {
    schemaVersion: 1,
    totals: normalizeTotals(value.totals),
    byCluster: normalizeByCluster(value.byCluster),
    recent: Array.isArray(value.recent)
      ? value.recent.filter(isRecord).map(normalizeRecentEntry)
      : [],
  };
}

function normalizeTotals(value: unknown): StatsTotals {
  const record = isRecord(value) ? value : {};

  return {
    hits: numberOrZero(record.hits),
    misses: numberOrZero(record.misses),
    awsCalls: numberOrZero(record.awsCalls),
    estimatedSavedMs: numberOrZero(record.estimatedSavedMs),
    actualAwsMsTotal: numberOrZero(record.actualAwsMsTotal),
  };
}

function normalizeByCluster(value: unknown): Record<string, ClusterStats> {
  if (!isRecord(value)) {
    return {};
  }

  const byCluster: Record<string, ClusterStats> = {};
  for (const [cluster, rawStats] of Object.entries(value)) {
    const clusterRecord = isRecord(rawStats) ? rawStats : {};
    byCluster[cluster] = {
      hits: numberOrZero(clusterRecord.hits),
      misses: numberOrZero(clusterRecord.misses),
      estimatedSavedMs: numberOrZero(clusterRecord.estimatedSavedMs),
      ...(typeof clusterRecord.lastSeen === 'string'
        ? { lastSeen: clusterRecord.lastSeen }
        : {}),
    };
  }

  return byCluster;
}

function normalizeRecentEntry(value: Record<string, unknown>): RecentStatsEntry {
  return {
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
    ...(typeof value.at === 'string' ? { at: value.at } : {}),
    ...(Number.isFinite(value.estimatedSavedMs)
      ? { estimatedSavedMs: Number(value.estimatedSavedMs) }
      : {}),
    ...(Number.isFinite(value.actualAwsMs)
      ? { actualAwsMs: Number(value.actualAwsMs) }
      : {}),
    ...(typeof value.cluster === 'string' ? { cluster: value.cluster } : {}),
  };
}

function topClusterByUsefulActivity(
  byCluster: Record<string, ClusterStats>,
): string | undefined {
  let bestCluster: string | undefined;
  let bestSavedMs = -1;

  for (const [cluster, stats] of Object.entries(byCluster)) {
    if (stats.estimatedSavedMs > bestSavedMs) {
      bestCluster = cluster;
      bestSavedMs = stats.estimatedSavedMs;
    }
  }

  return bestCluster;
}

async function moveBrokenStatsAside(statsPath: string): Promise<void> {
  const brokenPath = `${statsPath}.broken.${Date.now()}`;

  try {
    await rename(statsPath, brokenPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

function formatSeconds(seconds: number): string {
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }

  return seconds.toFixed(1).replace(/\.0$/, '');
}

function numberOrZero(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
