import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runRestore } from '../../src/commands/restore.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-restore-'));
}

describe('runRestore', () => {
  it('copies backup contents to the requested kubeconfig path after confirmation', async () => {
    const root = await tempDir();
    const backupPath = path.join(root, 'backup.yaml');
    const kubeconfigPath = path.join(root, 'config');

    await writeFile(backupPath, 'users:\n  - name: original\n', 'utf8');
    await writeFile(kubeconfigPath, 'users:\n  - name: changed\n', 'utf8');

    const result = await runRestore({
      backup: backupPath,
      kubeconfig: kubeconfigPath,
      yes: true,
    }, { home: root });

    expect(result).toEqual({
      backupPath,
      kubeconfigPath,
      restored: true,
    });
    await expect(readFile(kubeconfigPath, 'utf8')).resolves.toBe(
      'users:\n  - name: original\n',
    );
  });

  it('requires --yes before restoring a backup', async () => {
    const root = await tempDir();
    const backupPath = path.join(root, 'backup.yaml');
    const kubeconfigPath = path.join(root, 'config');

    await expect(
      runRestore({
        backup: backupPath,
        kubeconfig: kubeconfigPath,
      }, { home: root }),
    ).rejects.toThrow('--yes is required to restore a backup');
  });
});
