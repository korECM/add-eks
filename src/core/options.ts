import { defaultPaths, resolveHomePath } from './paths.js';

export type CacheKeyStrategy =
  | 'cluster'
  | 'cluster-profile'
  | 'cluster-region-profile'
  | 'arn';

export interface RuntimeOptionFlags {
  helperPath?: string;
  cacheDir?: string;
  backupDir?: string;
  safetyMargin?: number | string;
  cacheKey?: string;
}

export interface RuntimeOptions {
  helperPath: string;
  cacheDir: string;
  backupDir: string;
  safetyMargin: number;
  cacheKey: CacheKeyStrategy;
}

const cacheKeyStrategies = [
  'cluster',
  'cluster-profile',
  'cluster-region-profile',
  'arn',
] as const satisfies readonly CacheKeyStrategy[];

function isCacheKeyStrategy(value: string): value is CacheKeyStrategy {
  return (cacheKeyStrategies as readonly string[]).includes(value);
}

function parseSafetyMargin(value: number | string | undefined): number {
  if (value === undefined) {
    return 60;
  }

  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('safetyMargin must be a positive integer');
  }

  const safetyMargin = Number(value);

  if (
    !Number.isFinite(safetyMargin) ||
    !Number.isInteger(safetyMargin) ||
    safetyMargin <= 0
  ) {
    throw new Error('safetyMargin must be a positive integer');
  }

  return safetyMargin;
}

function parseCacheKey(value: string | undefined): CacheKeyStrategy {
  if (value === undefined) {
    return 'cluster-region-profile';
  }

  if (isCacheKeyStrategy(value)) {
    return value;
  }

  throw new Error(`cacheKey must be one of: ${cacheKeyStrategies.join(', ')}`);
}

export function resolveRuntimeOptions(
  flags: RuntimeOptionFlags,
  home: string,
): RuntimeOptions {
  const paths = defaultPaths(home);

  return {
    helperPath: resolveHomePath(flags.helperPath ?? paths.helperPath, home),
    cacheDir: resolveHomePath(flags.cacheDir ?? paths.cacheDir, home),
    backupDir: resolveHomePath(flags.backupDir ?? paths.backupDir, home),
    safetyMargin: parseSafetyMargin(flags.safetyMargin),
    cacheKey: parseCacheKey(flags.cacheKey),
  };
}
