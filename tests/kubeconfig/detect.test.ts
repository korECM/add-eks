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
});
