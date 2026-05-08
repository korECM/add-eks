import path from 'node:path';

export interface DefaultPaths {
  baseDir: string;
  helperPath: string;
  cacheDir: string;
  backupDir: string;
  kubeconfig: string;
  configPath: string;
}

export function resolveHomePath(value: string, home: string): string {
  if (value === '~') {
    return home;
  }

  if (value.startsWith('~/')) {
    return path.join(home, value.slice(2));
  }

  return value;
}

export function defaultPaths(home: string): DefaultPaths {
  const baseDir = path.join(home, '.kube/add-eks');

  return {
    baseDir,
    helperPath: path.join(baseDir, 'add-eks-token'),
    cacheDir: path.join(baseDir, 'cache'),
    backupDir: path.join(baseDir, 'backups'),
    kubeconfig: path.join(home, '.kube/config'),
    configPath: path.join(home, '.config/add-eks/config.yaml'),
  };
}
