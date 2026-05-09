import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import {
  completeCandidates,
  generateCompletionScript,
  parseCompletionArgs,
} from '../../src/commands/completion.js';

const execFileAsync = promisify(execFile);

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function kubeconfigFixture(): string {
  return `
apiVersion: v1
kind: Config
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
  - name: dev
    context:
      cluster: dev-cluster
      user: dev-user
  - name: local
    context:
      cluster: local
      user: local-user
users:
  - name: prod-user
    user:
      exec:
        command: aws
        args:
          - eks
          - get-token
          - --cluster-name
          - prod
          - --region
          - ap-northeast-2
  - name: dev-user
    user:
      exec:
        command: aws
        args:
          - --profile
          - dev
          - eks
          - get-token
          - --cluster-name=dev
          - --region=us-west-2
  - name: local-user
    user:
      token: local
`;
}

describe('generateCompletionScript', () => {
  it('emits bash hooks for core commands, flags, and dynamic candidates', () => {
    const script = generateCompletionScript('bash', { binaryName: 'add-eks' });

    expect(script).toContain('__complete profiles');
    expect(script).toContain('__complete contexts');
    expect(script).toContain('__complete eks-contexts');
    expect(script).toContain('__complete regions');
    expect(script).toContain('__complete clusters');
    expect(script).toContain('--profile');
    expect(script).toContain('--context');
    expect(script).toContain('cache list status clear');
    expect(script).toContain('stats clear');
    expect(script).toContain('doctor');
    expect(script).toContain('completion');
  });

  it('scopes stats --yes completion to stats clear only', () => {
    const bash = generateCompletionScript('bash', { binaryName: 'add-eks' });
    const zsh = generateCompletionScript('zsh', { binaryName: 'add-eks' });
    const fish = generateCompletionScript('fish', { binaryName: 'add-eks' });

    expect(bash).toContain('stats clear');
    expect(bash).toContain('compgen -W "clear --cache-dir --json"');
    expect(bash).toContain('compgen -W "--cache-dir --yes --json"');
    expect(zsh).toContain('stats_commands=(clear)');
    expect(zsh).toContain('compadd -- $stats_commands --cache-dir --json');
    expect(zsh).toContain('compadd -- --cache-dir --yes --json');
    expect(fish).toContain('__fish_seen_subcommand_from stats');
    expect(fish).toContain(
      'complete -c add-eks -f -n "__fish_seen_subcommand_from stats; and not __fish_seen_subcommand_from clear" -l json',
    );
    expect(fish).toContain(
      'complete -c add-eks -f -n "__fish_seen_subcommand_from stats; and __fish_seen_subcommand_from clear" -l yes',
    );
  });

  it('filters bash dynamic candidates line by line without word splitting candidates', () => {
    const script = generateCompletionScript('bash', { binaryName: 'add-eks' });

    expect(script).toContain('while IFS= read -r candidate; do');
    expect(script).toContain('COMPREPLY+=("$candidate")');
    expect(script).not.toContain('compgen -W "$(');
  });

  it('supports zsh and fish scripts', () => {
    expect(generateCompletionScript('zsh', { binaryName: 'add-eks' })).toContain('#compdef add-eks');
    expect(generateCompletionScript('fish', { binaryName: 'add-eks' })).toContain('complete -c add-eks');
  });

  it('registers zsh completion without invoking the completion function on source', () => {
    const script = generateCompletionScript('zsh', { binaryName: 'add-eks' });

    expect(script).toContain('compdef _add_eks add-eks');
    expect(script.trim()).not.toMatch(/_add_eks "\$@"$/);
  });

  it('can be sourced by zsh without running compadd outside completion', async () => {
    if (!(await hasCommand('zsh'))) {
      return;
    }

    const root = await mkdtemp(path.join(os.tmpdir(), 'add-eks-zsh-completion-'));
    const scriptPath = path.join(root, 'completion.zsh');
    await writeFile(scriptPath, generateCompletionScript('zsh', { binaryName: 'add-eks' }));

    await execFileAsync('zsh', [
      '-fc',
      `autoload -Uz compinit && compinit -D && source ${shellQuote(scriptPath)}`,
    ]);
  });

  it('uses zsh line splitting for newline-delimited dynamic candidates', () => {
    const script = generateCompletionScript('zsh', { binaryName: 'add-eks' });

    expect(script).toContain('${(f)"$(add-eks __complete profiles "$words[@]")"}');
    expect(script).toContain('${(f)"$(add-eks __complete eks-contexts "$words[@]")"}');
    expect(script).toContain('${(f)"$(add-eks __complete contexts "$words[@]")"}');
    expect(script).toContain('${(f)"$(add-eks __complete regions "$words[@]")"}');
    expect(script).toContain('${(f)"$(add-eks __complete clusters "$words[@]")"}');
  });
});

describe('completion candidates', () => {
  it('returns AWS profiles from injected discovery', async () => {
    await expect(
      completeCandidates('profiles', {}, { discoverProfiles: async () => ['default', 'prod'] }),
    ).resolves.toEqual(['default', 'prod']);
  });

  it('returns kube contexts and detected EKS contexts from kubeconfig', async () => {
    const deps = {
      readKubeconfig: async () => kubeconfigFixture(),
    };

    await expect(completeCandidates('contexts', {}, deps)).resolves.toEqual([
      'dev',
      'local',
      'prod',
    ]);
    await expect(completeCandidates('eks-contexts', {}, deps)).resolves.toEqual([
      'dev',
      'prod',
    ]);
  });

  it('returns common regions plus regions detected from kubeconfig', async () => {
    const regions = await completeCandidates(
      'regions',
      {},
      { readKubeconfig: async () => kubeconfigFixture() },
    );

    expect(regions.slice(0, 2)).toEqual(['ap-northeast-2', 'us-west-2']);
    expect(regions).toContain('us-east-1');
    expect(regions).toContain('eu-central-1');
  });

  it('returns common regions when kubeconfig is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'add-eks-completion-'));
    const missingHome = path.join(root, 'missing-home');

    const regions = await completeCandidates('regions', {}, { home: missingHome });

    expect(regions).toContain('us-east-1');
    expect(regions).toContain('ap-northeast-2');
    expect(regions).toContain('eu-central-1');
  });

  it('returns AWS clusters only when profile and region are available', async () => {
    const listClusters = vi.fn(async () => ['prod', 'stage']);

    await expect(
      completeCandidates(
        'clusters',
        { profile: 'prod', region: 'ap-northeast-2' },
        { listClusters },
      ),
    ).resolves.toEqual(['prod', 'stage']);
    expect(listClusters).toHaveBeenCalledWith({
      profile: 'prod',
      region: 'ap-northeast-2',
    });

    await expect(completeCandidates('clusters', { profile: 'prod' }, { listClusters })).resolves.toEqual(
      [],
    );
  });

  it('swallows candidate discovery failures for safe shell completion', async () => {
    await expect(
      completeCandidates('clusters', {
        profile: 'prod',
        region: 'ap-northeast-2',
      }, {
        listClusters: async () => {
          throw new Error('no credentials');
        },
      }),
    ).resolves.toEqual([]);

    await expect(
      completeCandidates('contexts', {}, {
        readKubeconfig: async () => {
          throw new Error('unreadable');
        },
      }),
    ).resolves.toEqual([]);
  });

  it('parses hidden completion flags used by shell scripts', () => {
    expect(
      parseCompletionArgs([
        '--profile',
        'prod',
        '--region=ap-northeast-2',
        '--kubeconfig',
        '/tmp/config',
      ]),
    ).toEqual({
      profile: 'prod',
      region: 'ap-northeast-2',
      kubeconfig: '/tmp/config',
    });
  });

  it('preserves inline completion flag values containing equals signs', () => {
    expect(
      parseCompletionArgs([
        '--profile=prod=blue',
        '--region=ap-northeast-2',
        '--kubeconfig=/tmp/a=b/config',
      ]),
    ).toEqual({
      profile: 'prod=blue',
      region: 'ap-northeast-2',
      kubeconfig: '/tmp/a=b/config',
    });
  });
});
