import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { planPatch } from '../../src/kubeconfig/patch.js';
import { parseKubeconfig, stringifyKubeconfig } from '../../src/kubeconfig/parser.js';

const fixtureUrl = new URL('../fixtures/kubeconfig-aws-exec.yaml', import.meta.url);
const patchedFixtureUrl = new URL(
  '../fixtures/kubeconfig-add-eks-patched.yaml',
  import.meta.url
);

function loadFixture() {
  return parseKubeconfig(readFileSync(fixtureUrl, 'utf8'));
}

describe('planPatch', () => {
  it('patches one selected context', () => {
    const result = planPatch({
      config: loadFixture(),
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.changedContexts).toEqual(['prod']);
    expect(stringifyKubeconfig(result.config)).toBe(readFileSync(patchedFixtureUrl, 'utf8'));
  });

  it('preserves unrelated kubeconfig data', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
preferences:
  colors: true
current-context: prod
clusters:
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
    cluster:
      server: https://ABCDEF.gr7.ap-northeast-2.eks.amazonaws.com
      certificate-authority-data: prod-ca
      proxy-url: https://proxy.example.com
  - name: local
    cluster:
      server: https://local.example.com
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: prod-user
      namespace: apps
  - name: local
    context:
      cluster: local
      user: local-user
users:
  - name: prod-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: aws
        args:
          - eks
          - get-token
          - --cluster-name
          - prod
          - --region
          - ap-northeast-2
        interactiveMode: IfAvailable
      token: keep-me
  - name: local-user
    user:
      token: local-token
`);

    const result = planPatch({
      config,
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.config).toMatchObject({
      apiVersion: 'v1',
      kind: 'Config',
      preferences: { colors: true },
      'current-context': 'prod',
      clusters: [
        {
          name: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
          cluster: {
            server: 'https://ABCDEF.gr7.ap-northeast-2.eks.amazonaws.com',
            'certificate-authority-data': 'prod-ca',
            'proxy-url': 'https://proxy.example.com'
          }
        },
        {
          name: 'local',
          cluster: {
            server: 'https://local.example.com'
          }
        }
      ],
      contexts: [
        {
          name: 'prod',
          context: {
            cluster: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
            user: 'prod-user',
            namespace: 'apps'
          }
        },
        {
          name: 'local',
          context: {
            cluster: 'local',
            user: 'local-user'
          }
        }
      ],
      users: [
        {
          name: 'prod-user',
          user: {
            token: 'keep-me'
          }
        },
        {
          name: 'local-user',
          user: {
            token: 'local-token'
          }
        }
      ]
    });
  });

  it('sets command, args, and interactiveMode', () => {
    const result = planPatch({
      config: loadFixture(),
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    const user = result.config.users?.[0]?.user;

    expect(user?.exec).toEqual({
      apiVersion: 'client.authentication.k8s.io/v1beta1',
      command: '/opt/add-eks/helper',
      args: [
        '--cluster',
        'prod',
        '--region',
        'ap-northeast-2',
        '--cache-dir',
        '/tmp/add-eks-cache',
        '--safety-margin',
        '90',
        '--cache-key',
        'cluster-region-profile',
        '--cluster-arn',
        'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod'
      ],
      interactiveMode: 'Never'
    });
  });

  it('includes profile when provided', () => {
    const result = planPatch({
      config: loadFixture(),
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile',
      profile: 'work'
    });

    expect(result.config.users?.[0]?.user?.exec?.args).toEqual([
      '--cluster',
      'prod',
      '--region',
      'ap-northeast-2',
      '--cache-dir',
      '/tmp/add-eks-cache',
      '--safety-margin',
      '90',
      '--cache-key',
      'cluster-region-profile',
      '--profile',
      'work',
      '--cluster-arn',
      'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod'
    ]);
  });

  it('passes detected cluster ARN material for arn cache keys', () => {
    const result = planPatch({
      config: loadFixture(),
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'arn'
    });

    expect(result.config.users?.[0]?.user?.exec?.args).toEqual([
      '--cluster',
      'prod',
      '--region',
      'ap-northeast-2',
      '--cache-dir',
      '/tmp/add-eks-cache',
      '--safety-margin',
      '90',
      '--cache-key',
      'arn',
      '--cluster-arn',
      'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod'
    ]);
  });

  it('preserves detected aws exec role ARN when patching', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: arn:aws:eks:us-west-2:123456789012:cluster/stage
    cluster:
      server: https://stage.gr7.us-west-2.eks.amazonaws.com
contexts:
  - name: stage
    context:
      cluster: arn:aws:eks:us-west-2:123456789012:cluster/stage
      user: stage-user
users:
  - name: stage-user
    user:
      exec:
        command: aws
        args:
          - eks
          - get-token
          - --cluster-name
          - stage
          - --region
          - us-west-2
          - --role-arn
          - arn:aws:iam::123456789012:role/stage-reader
`);

    const result = planPatch({
      config,
      contexts: ['stage'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.config.users?.[0]?.user?.exec?.args).toEqual([
      '--cluster',
      'stage',
      '--region',
      'us-west-2',
      '--cache-dir',
      '/tmp/add-eks-cache',
      '--safety-margin',
      '90',
      '--cache-key',
      'cluster-region-profile',
      '--cluster-arn',
      'arn:aws:eks:us-west-2:123456789012:cluster/stage',
      '--role-arn',
      'arn:aws:iam::123456789012:role/stage-reader'
    ]);
  });

  it('keeps an unselected context bound to the original shared user', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
    cluster:
      server: https://prod.gr7.ap-northeast-2.eks.amazonaws.com
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/dev
    cluster:
      server: https://dev.gr7.ap-northeast-2.eks.amazonaws.com
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: shared-user
  - name: dev
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/dev
      user: shared-user
users:
  - name: shared-user
    user:
      token: original-token
`);

    const result = planPatch({
      config,
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.config.contexts).toEqual([
      {
        name: 'prod',
        context: {
          cluster: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
          user: 'shared-user:add-eks:prod'
        }
      },
      {
        name: 'dev',
        context: {
          cluster: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/dev',
          user: 'shared-user'
        }
      }
    ]);
    expect(result.config.users).toEqual([
      {
        name: 'shared-user',
        user: {
          token: 'original-token'
        }
      },
      {
        name: 'shared-user:add-eks:prod',
        user: expect.objectContaining({
          token: 'original-token',
          exec: expect.objectContaining({
            command: '/opt/add-eks/helper',
            args: expect.arrayContaining(['--cluster', 'prod', '--region', 'ap-northeast-2'])
          })
        })
      }
    ]);
  });

  it('patches two selected contexts sharing a user with different cluster and region args', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
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
      user: shared-user
  - name: stage
    context:
      cluster: arn:aws:eks:us-west-2:123456789012:cluster/stage
      user: shared-user
users:
  - name: shared-user
    user:
      token: original-token
`);

    const result = planPatch({
      config,
      contexts: ['prod', 'stage'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.config.contexts?.map((entry) => entry.context?.user)).toEqual([
      'shared-user:add-eks:prod',
      'shared-user:add-eks:stage'
    ]);
    expect(result.config.users?.find((entry) => entry.name === 'shared-user')?.user).toEqual({
      token: 'original-token'
    });
    expect(
      result.config.users?.find((entry) => entry.name === 'shared-user:add-eks:prod')?.user?.exec
        ?.args
    ).toEqual([
      '--cluster',
      'prod',
      '--region',
      'ap-northeast-2',
      '--cache-dir',
      '/tmp/add-eks-cache',
      '--safety-margin',
      '90',
      '--cache-key',
      'cluster-region-profile',
      '--cluster-arn',
      'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod'
    ]);
    expect(
      result.config.users?.find((entry) => entry.name === 'shared-user:add-eks:stage')?.user?.exec
        ?.args
    ).toEqual([
      '--cluster',
      'stage',
      '--region',
      'us-west-2',
      '--cache-dir',
      '/tmp/add-eks-cache',
      '--safety-margin',
      '90',
      '--cache-key',
      'cluster-region-profile',
      '--cluster-arn',
      'arn:aws:eks:us-west-2:123456789012:cluster/stage'
    ]);
  });

  it('does not generate a user name already referenced by an unselected dangling context', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
    cluster:
      server: https://prod.gr7.ap-northeast-2.eks.amazonaws.com
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/dev
    cluster:
      server: https://dev.gr7.ap-northeast-2.eks.amazonaws.com
  - name: local
    cluster:
      server: https://local.example.com
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: shared-user
  - name: dev
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/dev
      user: shared-user
  - name: dangling
    context:
      cluster: local
      user: shared-user:add-eks:prod
users:
  - name: shared-user
    user:
      token: original-token
`);

    const result = planPatch({
      config,
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.config.contexts?.map((entry) => entry.context?.user)).toEqual([
      'shared-user:add-eks:prod:2',
      'shared-user',
      'shared-user:add-eks:prod'
    ]);
    expect(result.config.users?.map((entry) => entry.name)).toEqual([
      'shared-user',
      'shared-user:add-eks:prod:2'
    ]);
  });

  it('dedupes duplicate selected context names before planning', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
    cluster:
      server: https://prod.gr7.ap-northeast-2.eks.amazonaws.com
  - name: arn:aws:eks:ap-northeast-2:123456789012:cluster/dev
    cluster:
      server: https://dev.gr7.ap-northeast-2.eks.amazonaws.com
contexts:
  - name: prod
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
      user: shared-user
  - name: dev
    context:
      cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/dev
      user: shared-user
users:
  - name: shared-user
    user:
      token: original-token
`);

    const result = planPatch({
      config,
      contexts: ['prod', 'prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(result.changedContexts).toEqual(['prod']);
    expect(result.config.contexts?.map((entry) => entry.context?.user)).toEqual([
      'shared-user:add-eks:prod',
      'shared-user'
    ]);
    expect(result.config.users?.map((entry) => entry.name)).toEqual([
      'shared-user',
      'shared-user:add-eks:prod'
    ]);
  });

  it('does not mutate original config', () => {
    const config = loadFixture();
    const original = structuredClone(config);

    const result = planPatch({
      config,
      contexts: ['prod'],
      helperPath: '/opt/add-eks/helper',
      cacheDir: '/tmp/add-eks-cache',
      safetyMargin: 90,
      cacheKey: 'cluster-region-profile'
    });

    expect(config).toEqual(original);
    expect(result.config).not.toBe(config);
    expect(result.config.users?.[0]).not.toBe(config.users?.[0]);
  });

  it('throws for unknown context', () => {
    expect(() =>
      planPatch({
        config: loadFixture(),
        contexts: ['missing'],
        helperPath: '/opt/add-eks/helper',
        cacheDir: '/tmp/add-eks-cache',
        safetyMargin: 90,
        cacheKey: 'cluster-region-profile'
      })
    ).toThrow("Selected context 'missing' does not exist");
  });

  it('throws for selected EKS-ish context where cluster and region cannot be determined', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: opaque-cluster
    cluster:
      server: https://example.eks.amazonaws.com
contexts:
  - name: server-only
    context:
      cluster: opaque-cluster
      user: server-user
users:
  - name: server-user
    user: {}
`);

    expect(() =>
      planPatch({
        config,
        contexts: ['server-only'],
        helperPath: '/opt/add-eks/helper',
        cacheDir: '/tmp/add-eks-cache',
        safetyMargin: 90,
        cacheKey: 'cluster-region-profile'
      })
    ).toThrow("Selected context 'server-only' is not a detectable EKS context with cluster and region");
  });
});
