import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runRevert } from '../../src/commands/revert.js';
import { parseKubeconfig } from '../../src/kubeconfig/parser.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-revert-'));
}

function patchedFixture(): string {
  return `
apiVersion: v1
kind: Config
current-context: prod
clusters:
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
    cluster:
      server: https://prod.gr7.ap-northeast-2.eks.amazonaws.com
  - name: local
    cluster:
      server: https://local.example.com
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: prod-user
  - name: local
    context:
      cluster: local
      user: local-user
users:
  - name: prod-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: /tmp/add-eks-token
        args:
          - --cluster
          - prod
          - --region
          - ap-northeast-2
          - --cache-dir
          - /tmp/add-eks-cache
          - --safety-margin
          - "90"
          - --cache-key
          - cluster-region-profile
          - --profile
          - work
          - --role-arn
          - arn:aws:iam::123456789012:role/prod-reader
        interactiveMode: Never
  - name: local-user
    user:
      exec:
        command: aws
        args:
          - eks
          - get-token
          - --cluster-name
          - local
          - --region
          - us-west-2
`;
}

async function writeFixture(root: string, contents = patchedFixture()): Promise<string> {
  const kubeconfig = path.join(root, 'config');
  await writeFile(kubeconfig, contents, 'utf8');
  return kubeconfig;
}

describe('runRevert', () => {
  it('reverts a patched context to aws eks get-token with profile and role preserved', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);

    const result = await runRevert({
      kubeconfig,
      context: ['prod'],
      backupDir: path.join(root, 'backups'),
      yes: true,
    }, { home: root });

    const config = parseKubeconfig(await readFile(kubeconfig, 'utf8'));

    expect(result).toMatchObject({
      changedContexts: ['prod'],
      dryRun: false,
      wroteKubeconfig: true,
    });
    expect(config.users?.find((entry) => entry.name === 'prod-user')?.user?.exec).toEqual({
      apiVersion: 'client.authentication.k8s.io/v1',
      command: 'aws',
      args: [
        'eks',
        'get-token',
        '--cluster-name',
        'prod',
        '--region',
        'ap-northeast-2',
        '--profile',
        'work',
        '--role-arn',
        'arn:aws:iam::123456789012:role/prod-reader',
      ],
      interactiveMode: 'Never',
    });
  });

  it('throws clearly for unknown contexts', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);

    await expect(
      runRevert({
        kubeconfig,
        context: ['missing'],
        dryRun: true,
      }, { home: root }),
    ).rejects.toThrow("Unknown context 'missing'");
  });

  it('throws clearly for selected contexts that were not patched by add-eks', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);

    await expect(
      runRevert({
        kubeconfig,
        context: ['local'],
        dryRun: true,
      }, { home: root }),
    ).rejects.toThrow("Selected context 'local' is not an add-eks patched context");
  });

  it('reports dry-run changes without writing or backing up', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const original = await readFile(kubeconfig, 'utf8');

    const result = await runRevert({
      kubeconfig,
      context: ['prod'],
      backupDir: path.join(root, 'backups'),
      dryRun: true,
    }, { home: root });

    expect(result).toMatchObject({
      changedContexts: ['prod'],
      dryRun: true,
      wroteKubeconfig: false,
    });
    await expect(readFile(kubeconfig, 'utf8')).resolves.toBe(original);
    await expect(stat(path.join(root, 'backups'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates a backup by default before writing', async () => {
    const root = await tempDir();
    const kubeconfig = await writeFixture(root);
    const backupDir = path.join(root, 'backups');
    const original = await readFile(kubeconfig, 'utf8');

    const result = await runRevert({
      kubeconfig,
      context: ['prod'],
      backupDir,
      yes: true,
    }, { home: root });

    expect(result.backupPath).toBeDefined();
    const entries = await readdir(backupDir);
    const backupFile = entries.find((entry) => entry.endsWith('.yaml'));
    expect(backupFile).toBeDefined();
    await expect(readFile(path.join(backupDir, backupFile ?? ''), 'utf8')).resolves.toBe(original);
  });
});
