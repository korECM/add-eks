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
      cacheKey: 'prod-key'
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
      cacheKey: 'prod-key'
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
      cacheKey: 'prod-key'
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
        'prod-key'
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
      cacheKey: 'prod-key',
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
      'prod-key',
      '--profile',
      'work'
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
      cacheKey: 'prod-key'
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
        cacheKey: 'prod-key'
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
        cacheKey: 'prod-key'
      })
    ).toThrow("Selected context 'server-only' is not a detectable EKS context with cluster and region");
  });
});
