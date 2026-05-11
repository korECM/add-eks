import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runInteractive, runInteractiveEntrypoint } from '../../src/commands/interactive.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-interactive-'));
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
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: prod-user
  - name: stage
    context:
      cluster: arn:aws:eks:us-west-2:123456789012:cluster/stage
      user: stage-user
users:
  - name: prod-user
    user:
      token: prod-token
  - name: stage-user
    user:
      token: stage-token
`;
}

describe('runInteractive', () => {
  it('collects choices and calls runUpdate for selected contexts after confirmation', async () => {
    const root = await tempDir();
    const kubeconfig = path.join(root, 'config');
    await writeFile(kubeconfig, fixture(), 'utf8');

    const runUpdate = vi.fn(async () => ({
      kubeconfigPath: kubeconfig,
      changedContexts: ['prod'],
      dryRun: false,
      installedHelper: true,
      wroteKubeconfig: true,
    }));
    const prompts = {
      select: vi
        .fn()
        .mockResolvedValueOnce('prod'),
      checkbox: vi.fn().mockResolvedValueOnce(['prod']),
      input: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(true),
    };

    await runInteractive(
      { kubeconfig },
      {
        home: root,
        prompts,
        discoverProfiles: async () => ['default', 'prod'],
        runUpdate,
      },
    );

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        kubeconfig,
        context: ['prod'],
        profile: 'prod',
        yes: true,
      }),
    );
  });

  it('uses dry-run when the user does not confirm applying changes', async () => {
    const root = await tempDir();
    const kubeconfig = path.join(root, 'config');
    await writeFile(kubeconfig, fixture(), 'utf8');

    const runUpdate = vi.fn(async () => ({
      kubeconfigPath: kubeconfig,
      changedContexts: ['stage'],
      dryRun: true,
      installedHelper: false,
      wroteKubeconfig: false,
    }));
    const prompts = {
      select: vi
        .fn()
        .mockResolvedValueOnce('default'),
      checkbox: vi.fn().mockResolvedValueOnce(['stage']),
      input: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(false),
    };

    await runInteractive(
      { kubeconfig },
      {
        home: root,
        prompts,
        discoverProfiles: async () => ['default'],
        runUpdate,
      },
    );

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        kubeconfig,
        context: ['stage'],
        profile: 'default',
        dryRun: true,
      }),
    );
  });

  it('offers all detected EKS contexts without asking for region first', async () => {
    const root = await tempDir();
    const kubeconfig = path.join(root, 'config');
    await writeFile(kubeconfig, fixture(), 'utf8');

    const prompts = {
      select: vi
        .fn()
        .mockResolvedValueOnce('prod'),
      checkbox: vi.fn().mockResolvedValueOnce(['prod', 'stage']),
      input: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(false),
    };

    await runInteractive(
      { kubeconfig },
      {
        home: root,
        prompts,
        discoverProfiles: async () => ['prod'],
        runUpdate: vi.fn(async () => ({
          kubeconfigPath: kubeconfig,
          changedContexts: ['prod'],
          dryRun: true,
          installedHelper: false,
          wroteKubeconfig: false,
        })),
      },
    );

    expect(prompts.select).toHaveBeenCalledTimes(1);
    expect(prompts.checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Which EKS contexts'),
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'prod' }),
          expect.objectContaining({ value: 'stage' }),
        ]),
      }),
    );
    expect(prompts.input).not.toHaveBeenCalled();
  });

  it('explains why interactive prompts ask for AWS identity and contexts', async () => {
    const root = await tempDir();
    const kubeconfig = path.join(root, 'config');
    await writeFile(kubeconfig, fixture(), 'utf8');

    const prompts = {
      select: vi
        .fn()
        .mockResolvedValueOnce('prod'),
      checkbox: vi.fn().mockResolvedValueOnce(['prod']),
      input: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(false),
    };

    await runInteractive(
      { kubeconfig },
      {
        home: root,
        prompts,
        discoverProfiles: async () => ['prod'],
        runUpdate: vi.fn(async () => ({
          kubeconfigPath: kubeconfig,
          changedContexts: ['prod'],
          dryRun: true,
          installedHelper: false,
          wroteKubeconfig: false,
        })),
      },
    );

    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('kubectl token refresh'),
      }),
    );
    expect(prompts.checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('patch for cached tokens'),
      }),
    );
    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Plan:'),
      }),
    );
    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Patch contexts: prod'),
      }),
    );
    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('AWS identity: profile prod'),
      }),
    );
  });

  it('can use current shell AWS credentials instead of a named profile', async () => {
    const root = await tempDir();
    const kubeconfig = path.join(root, 'config');
    await writeFile(kubeconfig, fixture(), 'utf8');

    const runUpdate = vi.fn(async () => ({
      kubeconfigPath: kubeconfig,
      changedContexts: ['prod'],
      dryRun: true,
      installedHelper: false,
      wroteKubeconfig: false,
    }));
    const prompts = {
      select: vi.fn().mockResolvedValueOnce('__current__'),
      checkbox: vi.fn().mockResolvedValueOnce(['prod']),
      input: vi.fn(),
      confirm: vi.fn().mockResolvedValueOnce(false),
    };

    await runInteractive(
      { kubeconfig },
      {
        home: root,
        prompts,
        discoverProfiles: async () => ['prod'],
        runUpdate,
      },
    );

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: undefined,
      }),
    );
  });
});

describe('runInteractiveEntrypoint', () => {
  it('does not run interactive mode when stdin or stdout is not a TTY', async () => {
    const stderrWrite = vi.fn();
    const runInteractiveCommand = vi.fn();

    const exitCode = await runInteractiveEntrypoint({
      stdin: { isTTY: false },
      stdout: { isTTY: true },
      stderr: { write: stderrWrite },
      runInteractive: runInteractiveCommand,
      writeResult: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(runInteractiveCommand).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('Interactive mode requires a TTY'),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('add-eks update --help'),
    );
  });

  it('reports prompt cancellation without surfacing the raw Inquirer error', async () => {
    const stderrWrite = vi.fn();
    const rawError = new Error('User force closed the prompt with 0 null');
    rawError.name = 'ExitPromptError';

    const exitCode = await runInteractiveEntrypoint({
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { write: stderrWrite },
      runInteractive: vi.fn(async () => {
        throw rawError;
      }),
      writeResult: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'Interactive setup canceled; no changes were made.\n',
    );
    expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringContaining('ExitPromptError'));
  });
});
