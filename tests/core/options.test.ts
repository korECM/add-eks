import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultPaths } from '../../src/core/paths.js';
import {
  type CacheKeyStrategy,
  resolveRuntimeOptions,
} from '../../src/core/options.js';

describe('resolveRuntimeOptions', () => {
  const home = '/Users/alex';

  it('uses default paths and option values when flags are empty', () => {
    const defaults = defaultPaths(home);

    expect(resolveRuntimeOptions({}, home)).toEqual({
      helperPath: defaults.helperPath,
      cacheDir: defaults.cacheDir,
      backupDir: defaults.backupDir,
      safetyMargin: 60,
      cacheKey: 'cluster-region-profile',
    });
  });

  it('expands tilde path flag overrides against the provided home path', () => {
    expect(
      resolveRuntimeOptions(
        {
          helperPath: '~/.local/bin/add-eks-token',
          cacheDir: '~/.cache/add-eks',
          backupDir: '~/backups/add-eks',
        },
        home,
      ),
    ).toMatchObject({
      helperPath: path.join(home, '.local/bin/add-eks-token'),
      cacheDir: path.join(home, '.cache/add-eks'),
      backupDir: path.join(home, 'backups/add-eks'),
    });
  });

  it('leaves absolute and relative path flag overrides unchanged', () => {
    expect(
      resolveRuntimeOptions(
        {
          helperPath: '/opt/bin/add-eks-token',
          cacheDir: './cache',
          backupDir: '../backups',
        },
        home,
      ),
    ).toMatchObject({
      helperPath: '/opt/bin/add-eks-token',
      cacheDir: './cache',
      backupDir: '../backups',
    });
  });

  it('parses numeric safety margin flag overrides', () => {
    expect(resolveRuntimeOptions({ safetyMargin: '120' }, home).safetyMargin).toBe(
      120,
    );
    expect(resolveRuntimeOptions({ safetyMargin: 30 }, home).safetyMargin).toBe(30);
  });

  it('uses cache key flag overrides', () => {
    expect(resolveRuntimeOptions({ cacheKey: 'arn' }, home).cacheKey).toBe('arn');
  });

  it.each(['', '   ', 'abc', '1.5', '-1', '0', 'Infinity'])(
    'throws for invalid safety margin string %j',
    (safetyMargin) => {
      expect(() => resolveRuntimeOptions({ safetyMargin }, home)).toThrow(
        'safetyMargin must be a positive integer',
      );
    },
  );

  it.each([Number.NaN, Infinity, -Infinity, 1.5, -1, 0])(
    'throws for invalid safety margin number %j',
    (safetyMargin) => {
      expect(() => resolveRuntimeOptions({ safetyMargin }, home)).toThrow(
        'safetyMargin must be a positive integer',
      );
    },
  );

  it('throws for unsupported cache key flag overrides', () => {
    expect(() =>
      resolveRuntimeOptions({ cacheKey: 'region' }, home),
    ).toThrow(
      'cacheKey must be one of: cluster, cluster-profile, cluster-region-profile, arn',
    );
  });
});

describe('CacheKeyStrategy', () => {
  it('allows the supported cache key strategy literals', () => {
    const strategies: CacheKeyStrategy[] = [
      'cluster',
      'cluster-profile',
      'cluster-region-profile',
      'arn',
    ];

    expect(strategies).toEqual([
      'cluster',
      'cluster-profile',
      'cluster-region-profile',
      'arn',
    ]);
  });
});
