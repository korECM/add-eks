import os from 'node:os';
import path from 'node:path';

import {
  clearStats,
  formatDuration,
  readStats,
  summarizeStats,
} from '../core/stats.js';
import type { ClearStatsResult, Stats, StatsSummary } from '../core/stats.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';

export interface StatsCommandOptions {
  cacheDir?: string;
  json?: boolean;
  yes?: boolean;
}

export interface StatsCommandDeps {
  home?: string;
}

export interface StatsComparison {
  label: string;
  value: string;
}

export interface StatsShowResult {
  cacheDir: string;
  stats: Stats;
  summary: StatsSummary;
  comparisons: StatsComparison[];
}

export interface StatsClearResult extends ClearStatsResult {
  cacheDir: string;
}

export async function runStatsShow(
  options: StatsCommandOptions,
  deps: StatsCommandDeps = {},
): Promise<StatsShowResult> {
  const cacheDir = resolveCacheDir(options, deps);
  const stats = await readStats(cacheDir);

  return {
    cacheDir,
    stats,
    summary: summarizeStats(stats),
    comparisons: [],
  };
}

export async function runStatsClear(
  options: StatsCommandOptions,
  deps: StatsCommandDeps = {},
): Promise<StatsClearResult> {
  if (options.yes !== true) {
    throw new Error('--yes is required to clear stats');
  }

  const cacheDir = resolveCacheDir(options, deps);
  const result = await clearStats(cacheDir);

  return {
    cacheDir,
    ...result,
  };
}

export function formatStatsHuman(result: StatsShowResult): string {
  const lines = [
    `Time saved: ${formatDuration(result.summary.estimatedSavedMs)}`,
    `Cache hits: ${result.summary.hits}`,
    `AWS token calls avoided: ${result.summary.hits}`,
    `AWS token calls made: ${result.summary.awsCalls}`,
    `Average token call: ${formatDuration(result.summary.averageAwsMs)}`,
  ];

  const bestHitStreak = bestHitStreakFromRecent(result.stats.recent);
  if (bestHitStreak > 0) {
    lines.push(`Best hit streak: ${bestHitStreak}`);
  }

  if (result.summary.topCluster !== undefined) {
    lines.push(`Top cluster: ${result.summary.topCluster}`);
  }

  if (result.comparisons.length > 0) {
    lines.push('', 'In other units:');
    for (const comparison of result.comparisons) {
      lines.push(`${comparison.label}: ${comparison.value}`);
    }
  }

  lines.push('', `kubectl quietly handed you ${formatDuration(result.summary.estimatedSavedMs)} back.`);

  return `${lines.join('\n')}\n`;
}

function resolveCacheDir(options: StatsCommandOptions, deps: StatsCommandDeps): string {
  const home = deps.home ?? os.homedir();
  const cacheDir = options.cacheDir ?? defaultPaths(home).cacheDir;

  return path.resolve(resolveHomePath(cacheDir, home));
}

function bestHitStreakFromRecent(recent: Stats['recent']): number {
  let best = 0;
  let current = 0;

  for (const entry of recent) {
    if (entry.type === 'hit') {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return best;
}
