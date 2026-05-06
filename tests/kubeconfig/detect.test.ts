import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findEksContexts } from '../../src/kubeconfig/detect.js';
import { parseKubeconfig } from '../../src/kubeconfig/parser.js';

describe('findEksContexts', () => {
  it('detects an EKS context using aws eks get-token', () => {
    const source = readFileSync(
      new URL('../fixtures/kubeconfig-aws-exec.yaml', import.meta.url),
      'utf8'
    );

    const [detected] = findEksContexts(parseKubeconfig(source));

    expect(detected).toMatchObject({
      contextName: 'prod',
      clusterName: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
      userName: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
      cluster: 'prod',
      region: 'ap-northeast-2',
      source: 'aws-exec'
    });
  });

  it('detects aws exec when command is a path and args use equals syntax', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: local-name
    cluster:
      server: https://example.com
contexts:
  - name: staging
    context:
      cluster: local-name
      user: staging-user
users:
  - name: staging-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: /opt/homebrew/bin/aws
        args:
          - eks
          - get-token
          - --cluster-name=staging
          - --region=us-west-2
        interactiveMode: Never
`);

    expect(findEksContexts(config)).toEqual([
      expect.objectContaining({
        contextName: 'staging',
        clusterName: 'local-name',
        userName: 'staging-user',
        cluster: 'staging',
        region: 'us-west-2',
        source: 'aws-exec'
      })
    ]);
  });

  it('detects aws exec with global options before eks get-token', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: global-option-cluster
    cluster:
      server: https://example.com
contexts:
  - name: global-option
    context:
      cluster: global-option-cluster
      user: global-option-user
users:
  - name: global-option-user
    user:
      exec:
        command: aws
        args:
          - --region
          - us-west-2
          - eks
          - get-token
          - --cluster-name
          - staging
`);

    expect(findEksContexts(config)).toEqual([
      expect.objectContaining({
        contextName: 'global-option',
        cluster: 'staging',
        region: 'us-west-2',
        source: 'aws-exec'
      })
    ]);
  });

  it('detects GovCloud EKS cluster ARNs', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: arn:aws-us-gov:eks:us-gov-west-1:123456789012:cluster/gov-prod
    cluster:
      server: https://example.com
contexts:
  - name: gov
    context:
      cluster: arn:aws-us-gov:eks:us-gov-west-1:123456789012:cluster/gov-prod
      user: gov-user
users:
  - name: gov-user
    user: {}
`);

    expect(findEksContexts(config)).toEqual([
      expect.objectContaining({
        contextName: 'gov',
        cluster: 'gov-prod',
        region: 'us-gov-west-1',
        source: 'arn'
      })
    ]);
  });

  it('rejects invalid EKS-looking ARNs', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: arn:aws:eks:us-west-2:123456789012:cluster/prod/extra
    cluster:
      server: https://example.com
contexts:
  - name: invalid-arn
    context:
      cluster: arn:aws:eks:us-west-2:123456789012:cluster/prod/extra
      user: invalid-arn-user
users:
  - name: invalid-arn-user
    user: {}
`);

    expect(findEksContexts(config)).toEqual([]);
  });

  it.each([
    ['arn:aws-cn:eks:us-west-2:123456789012:cluster/prod'],
    ['arn:aws-us-gov:eks:ap-northeast-2:123456789012:cluster/prod']
  ])('rejects partition and region mismatched ARNs: %s', (clusterArn) => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: ${clusterArn}
    cluster:
      server: https://example.com
contexts:
  - name: partition-mismatch
    context:
      cluster: ${clusterArn}
      user: partition-mismatch-user
users:
  - name: partition-mismatch-user
    user: {}
`);

    expect(findEksContexts(config)).toEqual([]);
  });

  it('ignores malformed flag values that point at another flag', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: malformed-flags-cluster
    cluster:
      server: https://example.com
contexts:
  - name: malformed-flags
    context:
      cluster: malformed-flags-cluster
      user: malformed-flags-user
users:
  - name: malformed-flags-user
    user:
      exec:
        command: aws
        args:
          - eks
          - get-token
          - --cluster-name
          - --region
          - us-west-2
`);

    const [detected] = findEksContexts(config);

    expect(detected).toMatchObject({
      contextName: 'malformed-flags',
      region: 'us-west-2',
      source: 'aws-exec'
    });
    expect(detected?.cluster).toBeUndefined();
  });

  it('rejects aws exec when a value-taking global option has no value', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: invalid-global-option-cluster
    cluster:
      server: https://example.com
contexts:
  - name: invalid-global-option
    context:
      cluster: invalid-global-option-cluster
      user: invalid-global-option-user
users:
  - name: invalid-global-option-user
    user:
      exec:
        command: aws
        args:
          - --region
          - --debug
          - eks
          - get-token
          - --cluster-name
          - staging
`);

    expect(findEksContexts(config)).toEqual([]);
  });

  it('detects aws exec with a supported no-value global option before eks get-token', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: no-value-global-cluster
    cluster:
      server: https://example.com
contexts:
  - name: no-value-global
    context:
      cluster: no-value-global-cluster
      user: no-value-global-user
users:
  - name: no-value-global-user
    user:
      exec:
        command: aws
        args:
          - --debug
          - eks
          - get-token
          - --cluster-name
          - prod
          - --region
          - ap-northeast-2
`);

    expect(findEksContexts(config)).toEqual([
      expect.objectContaining({
        contextName: 'no-value-global',
        cluster: 'prod',
        region: 'ap-northeast-2',
        source: 'aws-exec'
      })
    ]);
  });

  it('rejects aws exec with an unknown global option before eks get-token', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: unknown-global-cluster
    cluster:
      server: https://example.com
contexts:
  - name: unknown-global
    context:
      cluster: unknown-global-cluster
      user: unknown-global-user
users:
  - name: unknown-global-user
    user:
      exec:
        command: aws
        args:
          - --bogus
          - eks
          - get-token
          - --cluster-name
          - prod
`);

    expect(findEksContexts(config)).toEqual([]);
  });

  it('rejects aws exec when a no-value global option uses equals syntax', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: malformed-no-value-global-cluster
    cluster:
      server: https://example.com
contexts:
  - name: malformed-no-value-global
    context:
      cluster: malformed-no-value-global-cluster
      user: malformed-no-value-global-user
users:
  - name: malformed-no-value-global-user
    user:
      exec:
        command: aws
        args:
          - --debug=bad
          - eks
          - get-token
          - --cluster-name
          - prod
`);

    expect(findEksContexts(config)).toEqual([]);
  });

  it('includes a best-effort result for an EKS-looking server without guessing region', () => {
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

    expect(findEksContexts(config)).toEqual([
      expect.objectContaining({
        contextName: 'server-only',
        clusterName: 'opaque-cluster',
        userName: 'server-user',
        source: 'server'
      })
    ]);
    expect(findEksContexts(config)[0]?.region).toBeUndefined();
    expect(findEksContexts(config)[0]?.cluster).toBeUndefined();
  });

  it('does not detect non-EKS servers as EKS', () => {
    const config = parseKubeconfig(`
apiVersion: v1
kind: Config
clusters:
  - name: plain-cluster
    cluster:
      server: https://example.eks.amazonaws.example.com
contexts:
  - name: plain-server
    context:
      cluster: plain-cluster
      user: plain-user
users:
  - name: plain-user
    user: {}
`);

    expect(findEksContexts(config)).toEqual([]);
  });
});
