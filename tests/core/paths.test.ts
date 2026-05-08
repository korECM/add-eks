import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultPaths, resolveHomePath } from '../../src/core/paths.js';

describe('resolveHomePath', () => {
  const home = '/Users/alex';

  it('expands bare tilde to the provided home path', () => {
    expect(resolveHomePath('~', home)).toBe(home);
  });

  it('expands tilde-prefixed paths using the provided home path', () => {
    expect(resolveHomePath('~/.kube/add-eks', home)).toBe(
      path.join(home, '.kube/add-eks'),
    );
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolveHomePath('/var/tmp/add-eks', home)).toBe('/var/tmp/add-eks');
  });

  it('leaves relative non-tilde paths unchanged', () => {
    expect(resolveHomePath('./cache', home)).toBe('./cache');
  });

  it('does not expand user-specific tilde paths', () => {
    expect(resolveHomePath('~other/.kube', home)).toBe('~other/.kube');
  });
});

describe('defaultPaths', () => {
  it('returns add-eks paths rooted under the provided home path', () => {
    const home = '/Users/alex';

    expect(defaultPaths(home)).toEqual({
      baseDir: path.join(home, '.kube/add-eks'),
      helperPath: path.join(home, '.kube/add-eks/add-eks-token'),
      cacheDir: path.join(home, '.kube/add-eks/cache'),
      backupDir: path.join(home, '.kube/add-eks/backups'),
      kubeconfig: path.join(home, '.kube/config'),
      configPath: path.join(home, '.config/add-eks/config.yaml'),
    });
  });
});
