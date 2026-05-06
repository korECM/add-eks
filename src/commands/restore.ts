import os from 'node:os';
import path from 'node:path';

import { restoreBackup } from '../core/backup.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';

export interface RestoreOptions {
  backup?: string;
  kubeconfig?: string;
  yes?: boolean;
  json?: boolean;
}

export interface RestoreResult {
  backupPath: string;
  kubeconfigPath: string;
  restored: boolean;
}

export interface RestoreDeps {
  home?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  writeFileAtomic?: (filePath: string, contents: string) => Promise<void>;
  restoreBackup?: (
    input: { backupPath: string; kubeconfigPath: string },
    deps?: {
      readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
      writeFileAtomic?: (filePath: string, contents: string) => Promise<void>;
    },
  ) => Promise<void>;
}

export async function runRestore(
  options: RestoreOptions,
  deps: RestoreDeps = {},
): Promise<RestoreResult> {
  if (options.yes !== true) {
    throw new Error('--yes is required to restore a backup');
  }

  if (options.backup === undefined) {
    throw new Error('--backup is required');
  }

  const home = deps.home ?? os.homedir();
  const backupPath = resolvePath(options.backup, home);
  const kubeconfigPath = resolvePath(options.kubeconfig ?? defaultPaths(home).kubeconfig, home);

  await (deps.restoreBackup ?? restoreBackup)(
    { backupPath, kubeconfigPath },
    {
      readFile: deps.readFile,
      writeFileAtomic: deps.writeFileAtomic,
    },
  );

  return {
    backupPath,
    kubeconfigPath,
    restored: true,
  };
}

function resolvePath(value: string, home: string): string {
  return path.resolve(resolveHomePath(value, home));
}
