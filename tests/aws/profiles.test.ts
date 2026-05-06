import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverAwsProfiles } from '../../src/aws/profiles.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-profiles-'));
}

describe('discoverAwsProfiles', () => {
  it('parses profiles from AWS config and credentials files', async () => {
    const root = await tempDir();
    const configPath = path.join(root, 'config');
    const credentialsPath = path.join(root, 'credentials');

    await writeFile(
      configPath,
      `
[default]
region = us-east-1

[profile prod]
region = ap-northeast-2

[profile stage]
region = us-west-2
`,
      'utf8',
    );
    await writeFile(
      credentialsPath,
      `
[prod]
aws_access_key_id = test

[dev]
aws_access_key_id = test
`,
      'utf8',
    );

    await expect(discoverAwsProfiles({ configPath, credentialsPath })).resolves.toEqual([
      'default',
      'dev',
      'prod',
      'stage',
    ]);
  });

  it('ignores missing AWS files', async () => {
    const root = await tempDir();

    await expect(
      discoverAwsProfiles({
        configPath: path.join(root, 'missing-config'),
        credentialsPath: path.join(root, 'missing-credentials'),
      }),
    ).resolves.toEqual([]);
  });
});
