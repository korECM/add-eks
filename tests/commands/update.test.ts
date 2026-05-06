import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runUpdate } from '../../src/commands/update.js';
import { parseKubeconfig } from '../../src/kubeconfig/parser.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-update-'));
}

function fixture(): string {
  return `
apiVersion: v1
kind: Config
current-context: prod
clusters:
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
    cluster:
      server: https://prod.gr7.ap-northeast-2.eks.amazonaws.com
  - name: arn:aws:eks:us-west-2:123456789012:cluster/stage
    cluster:
      server: https://stage.gr7.us-west-2.eks.amazonaws.com
  - name: local
    cluster:
      server: https://local.example.com
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: prod-user
  - name: stage
    context:
      cluster: arn:aws:eks:us-west-2:123456789012:cluster/stage
      user: stage-user
  - name: local
    context:
      cluster: local
      user: local-user
users:
  - name: prod-user
    user:
      token: prod-token
  - name: stage-user
    user:
      token: stage-token
  - name: local-user
    user:
      token: local-token
`;
}

async function writeFixture(root: string): Promise<string> {
  const kubeconfig = path.join(root, 'config');
  await writeFile(kubeconfig, fixture(), 'utf8');
  return kubeconfig;
}

describe('runUpdate', () => {
  it('patches one selected context with a profile after confirmation', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const installHelper = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const result = await runUpdate(
      {
        kubeconfig,
        context: ['prod'],
        profile: 'prod',
        helperPath: path.join(root, 'bin', 'add-eks-token'),
        cacheDir: path.join(root, 'cache'),
        backupDir: path.join(root, 'backups'),
        yes: true,
      },
      { home: root, installHelper },
    );

    const config = parseKubeconfig(await readFile(kubeconfig, 'utf8'));

    expect(result.changedContexts).toEqual(['prod']);
    expect(installHelper).toHaveBeenCalledOnce();
    expect(config.users?.find((entry) => entry.name === 'prod-user')?.user?.exec).toMatchObject({
      command: path.join(root, 'bin', 'add-eks-token'),
      args: expect.arrayContaining(['--profile', 'prod']),
      interactiveMode: 'Never',
    });
    expect(config.users?.find((entry) => entry.name === 'stage-user')?.user?.exec).toBeUndefined();
  });

  it('patches all detected EKS contexts', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);

    const result = await runUpdate(
      {
        kubeconfig,
        all: true,
        profile: 'prod',
        helperPath: path.join(root, 'helper'),
        cacheDir: path.join(root, 'cache'),
        backupDir: path.join(root, 'backups'),
        yes: true,
      },
      { home: root, installHelper: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    );

    const config = parseKubeconfig(await readFile(kubeconfig, 'utf8'));

    expect(result.changedContexts).toEqual(['prod', 'stage']);
    expect(config.users?.find((entry) => entry.name === 'prod-user')?.user?.exec).toBeDefined();
    expect(config.users?.find((entry) => entry.name === 'stage-user')?.user?.exec).toBeDefined();
    expect(config.users?.find((entry) => entry.name === 'local-user')?.user?.exec).toBeUndefined();
  });

  it('creates a backup by default before writing', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const backupDir = path.join(root, 'backups');
    const original = await readFile(kubeconfig, 'utf8');

    const result = await runUpdate(
      {
        kubeconfig,
        context: ['prod'],
        helperPath: path.join(root, 'helper'),
        cacheDir: path.join(root, 'cache'),
        backupDir,
        yes: true,
      },
      { home: root, installHelper: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    );

    expect(result.backupPath).toBeDefined();
    const entries = await readdir(backupDir);
    const backupFile = entries.find((entry) => entry.endsWith('.yaml'));
    expect(backupFile).toBeDefined();
    await expect(readFile(path.join(backupDir, backupFile ?? ''), 'utf8')).resolves.toBe(original);
  });

  it('does not install helper or write kubeconfig when backup fails', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const calls: string[] = [];
    const backupError = new Error('backup failed');
    const createBackup = vi.fn(async () => {
      calls.push('backup');
      throw backupError;
    });
    const installHelper = vi.fn(async () => {
      calls.push('install');
    });
    const writeFileAtomic = vi.fn(async () => {
      calls.push('write');
    });

    await expect(
      runUpdate(
        {
          kubeconfig,
          context: ['prod'],
          helperPath: path.join(root, 'helper'),
          cacheDir: path.join(root, 'cache'),
          backupDir: path.join(root, 'backups'),
          yes: true,
        },
        { home: root, createBackup, installHelper, writeFileAtomic },
      ),
    ).rejects.toThrow(backupError);

    expect(calls).toEqual(['backup']);
    expect(installHelper).not.toHaveBeenCalled();
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });

  it('skips backup when requested', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const backupDir = path.join(root, 'backups');

    const result = await runUpdate(
      {
        kubeconfig,
        context: ['prod'],
        helperPath: path.join(root, 'helper'),
        cacheDir: path.join(root, 'cache'),
        backupDir,
        backup: false,
        yes: true,
      },
      { home: root, installHelper: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    );

    expect(result.backupPath).toBeUndefined();
    await expect(stat(backupDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports dry-run changes without writing, installing, or backing up', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const original = await readFile(kubeconfig, 'utf8');
    const installHelper = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const result = await runUpdate(
      {
        kubeconfig,
        all: true,
        profile: 'prod',
        helperPath: path.join(root, 'helper'),
        cacheDir: path.join(root, 'cache'),
        backupDir: path.join(root, 'backups'),
        dryRun: true,
      },
      { home: root, installHelper },
    );

    expect(result).toMatchObject({
      dryRun: true,
      changedContexts: ['prod', 'stage'],
      installedHelper: false,
      wroteKubeconfig: false,
    });
    expect(installHelper).not.toHaveBeenCalled();
    await expect(readFile(kubeconfig, 'utf8')).resolves.toBe(original);
    await expect(stat(path.join(root, 'backups'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires --yes for writes', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);

    await expect(
      runUpdate(
        {
          kubeconfig,
          context: ['prod'],
          helperPath: path.join(root, 'helper'),
          cacheDir: path.join(root, 'cache'),
        },
        { home: root, installHelper: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
      ),
    ).rejects.toThrow('--yes is required for non-interactive updates');
  });

  it('throws clearly for unknown contexts', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);

    await expect(
      runUpdate(
        {
          kubeconfig,
          context: ['missing'],
          dryRun: true,
        },
        { home: root },
      ),
    ).rejects.toThrow("Unknown context 'missing'");
  });
});
