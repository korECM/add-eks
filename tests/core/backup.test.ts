import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBackup, restoreBackup } from '../../src/core/backup.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-backup-'));
}

describe('createBackup', () => {
  it('creates a timestamped kubeconfig backup and metadata in a new directory', async () => {
    const root = await tempDir();
    const kubeconfigPath = path.join(root, 'config');
    const backupDir = path.join(root, 'nested', 'backups');
    const contents = 'apiVersion: v1\nclusters:\n- name: dev\n';
    const now = new Date('2026-05-06T14:30:12.345Z');

    await writeFile(kubeconfigPath, contents, 'utf8');

    const result = await createBackup({
      kubeconfigPath,
      backupDir,
      operation: 'patch',
      contexts: ['dev', 'prod'],
      helperPath: '/opt/add-eks-token',
      now,
    });

    expect(result).toEqual({
      backupPath: path.join(backupDir, 'config.20260506-143012.yaml'),
      metadataPath: path.join(
        backupDir,
        'config.20260506-143012.yaml.metadata.json',
      ),
    });
    const backupDirStats = await stat(backupDir);
    expect(backupDirStats.isDirectory()).toBe(true);
    await expect(readFile(result.backupPath, 'utf8')).resolves.toBe(contents);
    await expect(readFile(result.metadataPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          createdAt: now.toISOString(),
          kubeconfig: kubeconfigPath,
          operation: 'patch',
          contexts: ['dev', 'prod'],
          helperPath: '/opt/add-eks-token',
        },
        null,
        2,
      )}\n`,
    );
  });

  it('preserves non-default kubeconfig basenames and restores backup contents', async () => {
    const root = await tempDir();
    const kubeconfigPath = path.join(root, 'team.prod.kubeconfig');
    const backupDir = path.join(root, 'backups');
    const originalContents = 'users:\n- name: original\n';
    const changedContents = 'users:\n- name: changed\n';

    await writeFile(kubeconfigPath, originalContents, 'utf8');

    const result = await createBackup({
      kubeconfigPath,
      backupDir,
      operation: 'replace',
      contexts: ['team-prod'],
      helperPath: '/usr/local/bin/add-eks-token',
      now: new Date('2026-12-01T01:02:03.999Z'),
    });

    expect(path.basename(result.backupPath)).toBe(
      'team.prod.20261201-010203.kubeconfig',
    );

    await writeFile(kubeconfigPath, changedContents, 'utf8');
    await restoreBackup({ backupPath: result.backupPath, kubeconfigPath });

    await expect(readFile(kubeconfigPath, 'utf8')).resolves.toBe(originalContents);
  });

  it('uses deterministic suffixes for same-second backup collisions', async () => {
    const root = await tempDir();
    const kubeconfigPath = path.join(root, 'config');
    const backupDir = path.join(root, 'backups');
    const originalContents = 'clusters:\n- name: original\n';
    const changedContents = 'clusters:\n- name: changed\n';
    const now = new Date('2026-05-06T14:30:12.999Z');

    await writeFile(kubeconfigPath, originalContents, 'utf8');
    const first = await createBackup({
      kubeconfigPath,
      backupDir,
      operation: 'patch',
      contexts: ['original'],
      helperPath: '/opt/add-eks-token',
      now,
    });

    await writeFile(kubeconfigPath, changedContents, 'utf8');
    const second = await createBackup({
      kubeconfigPath,
      backupDir,
      operation: 'patch',
      contexts: ['changed'],
      helperPath: '/opt/add-eks-token',
      now,
    });

    expect(second.backupPath).toBe(
      path.join(backupDir, 'config.20260506-143012.1.yaml'),
    );
    expect(first.backupPath).not.toBe(second.backupPath);
    expect(first.metadataPath).not.toBe(second.metadataPath);
    await expect(readFile(first.backupPath, 'utf8')).resolves.toBe(
      originalContents,
    );
    await expect(readFile(second.backupPath, 'utf8')).resolves.toBe(
      changedContents,
    );
  });
});
