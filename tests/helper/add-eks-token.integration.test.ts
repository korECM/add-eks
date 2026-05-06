import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const helperPath = new URL('../../assets/add-eks-token.sh', import.meta.url);

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-token-'));
}

describe('add-eks-token POSIX helper', () => {
  it('caches aws ExecCredential JSON and reuses it on the second run', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');
    const awsPath = path.join(binDir, 'aws');

    await mkdir(binDir);
    await writeFile(
      awsPath,
      `#!/bin/sh
set -eu
count=0
if [ -f "$AWS_CALL_COUNT" ]; then
  count=$(cat "$AWS_CALL_COUNT")
fi
count=$(expr "$count" + 1)
printf '%s\\n' "$count" > "$AWS_CALL_COUNT"

if [ "$*" != "eks get-token --cluster-name dev --region us-west-2 --profile team" ]; then
  printf 'unexpected aws command\\n' >&2
  printf '%s\\n' "$*" >&2
  exit 11
fi

printf '%s\\n' '{"apiVersion":"client.authentication.k8s.io/v1beta1","kind":"ExecCredential","status":{"expirationTimestamp":"2999-01-01T00:00:00Z","token":"cached-token"}}'
`,
      'utf8',
    );
    await chmod(awsPath, 0o755);

    const env = {
      ...process.env,
      ADD_EKS_DEBUG: '1',
      AWS_CALL_COUNT: callsPath,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    const args = [
      '--cluster',
      'dev',
      '--region',
      'us-west-2',
      '--cache-dir',
      cacheDir,
      '--safety-margin',
      '60',
      '--cache-key',
      'cluster-region-profile',
      '--profile',
      'team',
    ];

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const firstJson = JSON.parse(first.stdout);
    expect(firstJson.status.token).toBe('cached-token');
    expect(first.stderr).toContain('cache miss');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');

    const cacheFiles = await readdir(cacheDir);
    expect(cacheFiles).toHaveLength(1);
    expect((await stat(cacheDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(cacheDir, cacheFiles[0]))).mode & 0o777).toBe(0o600);

    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const secondJson = JSON.parse(second.stdout);
    expect(secondJson).toEqual(firstJson);
    expect(second.stderr).toContain('cache hit');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');

    const quiet = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: { ...env, ADD_EKS_DEBUG: '' },
    });
    expect(JSON.parse(quiet.stdout)).toEqual(firstJson);
    expect(quiet.stderr).toBe('');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');
  });
});
