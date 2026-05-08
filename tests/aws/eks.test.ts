import { describe, expect, it, vi } from 'vitest';

import { listEksClusters } from '../../src/aws/eks.js';

describe('listEksClusters', () => {
  it('runs aws eks list-clusters and returns cluster names', async () => {
    const runner = vi.fn(async () => ({ stdout: JSON.stringify({ clusters: ['prod', 'stage'] }) }));

    await expect(
      listEksClusters({ region: 'ap-northeast-2', profile: 'prod', runner }),
    ).resolves.toEqual(['prod', 'stage']);

    expect(runner).toHaveBeenCalledWith('aws', [
      'eks',
      'list-clusters',
      '--region',
      'ap-northeast-2',
      '--profile',
      'prod',
      '--output',
      'json',
    ]);
  });

  it('throws clearly when aws returns invalid JSON', async () => {
    const runner = vi.fn(async () => ({ stdout: 'not json' }));

    await expect(
      listEksClusters({ region: 'ap-northeast-2', profile: 'prod', runner }),
    ).rejects.toThrow('Unable to parse AWS EKS cluster list JSON');
  });
});
