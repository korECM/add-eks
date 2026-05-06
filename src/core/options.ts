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
  cacheKey?: CacheKeyStrategy;
}

export interface RuntimeOptions {
  helperPath: string;
  cacheDir: string;
  backupDir: string;
  safetyMargin: number;
  cacheKey: CacheKeyStrategy;
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
    safetyMargin:
      flags.safetyMargin === undefined ? 60 : Number(flags.safetyMargin),
    cacheKey: flags.cacheKey ?? 'cluster-region-profile',
  };
}
