import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { readStats, summarizeStats } from '../../src/core/stats.js';

const execFileAsync = promisify(execFile);
const helperPath = new URL('../../assets/add-eks-token.sh', import.meta.url);

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-token-'));
}

async function writeFakeAws(input: {
  binDir: string;
  callsPath: string;
  expectedArgs?: string;
  fail?: boolean;
}): Promise<void> {
  const awsPath = path.join(input.binDir, 'aws');

  await mkdir(input.binDir);
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

if [ "${input.expectedArgs ?? ''}" != "" ] && [ "$*" != "${input.expectedArgs ?? ''}" ]; then
  printf 'unexpected aws command\\n' >&2
  printf '%s\\n' "$*" >&2
  exit 11
fi

if [ "${input.fail === true ? '1' : ''}" = "1" ]; then
  printf 'fake aws failed\\n' >&2
  exit 12
fi

printf '%s\\n' "{\\"apiVersion\\":\\"client.authentication.k8s.io/v1beta1\\",\\"kind\\":\\"ExecCredential\\",\\"status\\":{\\"expirationTimestamp\\":\\"2999-01-01T00:00:00Z\\",\\"token\\":\\"token-$count\\"}}"
`,
    'utf8',
  );
  await chmod(awsPath, 0o755);
}

function testEnv(input: { binDir: string; callsPath: string; debug?: boolean }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ADD_EKS_DEBUG: input.debug === false ? '' : '1',
    AWS_ACCESS_KEY_ID: '',
    AWS_CONFIG_FILE: '',
    AWS_DEFAULT_PROFILE: '',
    AWS_PROFILE: '',
    AWS_ROLE_ARN: '',
    AWS_SHARED_CREDENTIALS_FILE: '',
    AWS_WEB_IDENTITY_TOKEN_FILE: '',
    AWS_CALL_COUNT: input.callsPath,
    PATH: `${input.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
  };
}

function baseArgs(cacheDir: string, extra: string[] = []): string[] {
  return [
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
    ...extra,
  ];
}

async function cacheEntryFiles(cacheDir: string): Promise<string[]> {
  return (await readdir(cacheDir)).filter((entry) => !entry.startsWith('.add-eks-stats'));
}

describe('add-eks-token POSIX helper', () => {
  it('caches aws ExecCredential JSON and reuses it on the second run', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({
      binDir,
      callsPath,
      expectedArgs: 'eks get-token --cluster-name dev --region us-west-2 --profile team',
    });

    const env = testEnv({ binDir, callsPath });
    const args = baseArgs(cacheDir);

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const firstJson = JSON.parse(first.stdout);
    expect(firstJson.status.token).toBe('token-1');
    expect(first.stderr).toContain('cache miss');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');

    const cacheFiles = await cacheEntryFiles(cacheDir);
    expect(cacheFiles).toHaveLength(1);
    expect((await stat(cacheDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(cacheDir, cacheFiles[0]))).mode & 0o777).toBe(0o600);

    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const secondJson = JSON.parse(second.stdout);
    expect(secondJson).toEqual(firstJson);
    expect(second.stderr).toContain('cache hit');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');

    const quiet = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });
    expect(JSON.parse(quiet.stdout)).toEqual(firstJson);
    expect(quiet.stderr).toBe('');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');
  });

  it('records miss then hit totals and keeps stdout JSON parseable', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({
      binDir,
      callsPath,
      expectedArgs: 'eks get-token --cluster-name dev --region us-west-2 --profile team',
    });

    const env = testEnv({ binDir, callsPath, debug: false });
    const args = baseArgs(cacheDir);

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const firstJson = JSON.parse(first.stdout);
    expect(firstJson.status.token).toBe('token-1');
    expect(first.stderr).toBe('');

    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const secondJson = JSON.parse(second.stdout);
    expect(secondJson).toEqual(firstJson);
    expect(second.stderr).toBe('');

    const stats = await readStats(cacheDir);
    const summary = summarizeStats(stats);
    expect(stats.schemaVersion).toBe(1);
    expect(summary.hits).toBe(1);
    expect(summary.misses).toBe(1);
    expect(summary.awsCalls).toBe(1);
    expect(summary.actualAwsMsTotal).toBeGreaterThanOrEqual(0);
    expect(summary.estimatedSavedMs).toBeGreaterThanOrEqual(0);
    expect(stats.recent).toHaveLength(2);
    expect(stats.recent[0]).toMatchObject({ type: 'miss' });
    expect(stats.recent[0].actualAwsMs).toBeGreaterThanOrEqual(0);
    expect(stats.recent[1]).toMatchObject({ type: 'hit' });
    expect(stats.recent[1].estimatedSavedMs).toBeGreaterThanOrEqual(0);

    const buckets = Object.values(stats.byCluster) as Array<{
      hits: number;
      misses: number;
      estimatedSavedMs: number;
    }>;
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      hits: 1,
      misses: 1,
    });
    expect(buckets[0].estimatedSavedMs).toBeGreaterThanOrEqual(0);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');
  });

  it('writes stats that the app stats reader summarizes', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath, debug: false });
    const args = baseArgs(cacheDir);
    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-1');
    expect(first.stderr).toBe('');
    expect(second.stderr).toBe('');

    const stats = await readStats(cacheDir);
    const summary = summarizeStats(stats);
    expect(summary.hits).toBe(1);
    expect(summary.misses).toBe(1);
    expect(summary.awsCalls).toBe(1);
    expect(summary.estimatedSavedMs).toBeGreaterThanOrEqual(0);
    expect(Object.values(stats.byCluster)[0]).toMatchObject({
      hits: 1,
      misses: 1,
    });
  });

  it('moves malformed stats file aside and recreates it', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(cacheDir);
    await writeFile(path.join(cacheDir, '.add-eks-stats.json'), 'not-json\n', 'utf8');

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');

    const entries = await readdir(cacheDir);
    expect(entries).toContain('.add-eks-stats.json');
    expect(entries).toContain('.add-eks-stats.json.malformed');

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(1);
    expect(stats.totals.awsCalls).toBe(1);
    expect(stats.recent).toHaveLength(1);
    expect(stats.recent[0]).toMatchObject({ type: 'miss' });
  });

  it('moves marker-bearing malformed stats file aside and recreates it', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(cacheDir);
    await writeFile(
      path.join(cacheDir, '.add-eks-stats.json'),
      `{
"schemaVersion":1,
"totals":{
"hits":41,
"misses":41,
"awsCalls":41,
"estimatedSavedMs":0,
"actualAwsMsTotal":41000
},
"byCluster":{
},
"recent":[
]
not-json
`,
      'utf8',
    );

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');

    const entries = await readdir(cacheDir);
    expect(entries).toContain('.add-eks-stats.json');
    expect(entries).toContain('.add-eks-stats.json.malformed');

    const stats = await readStats(cacheDir);
    expect(stats.totals.hits).toBe(0);
    expect(stats.totals.misses).toBe(1);
    expect(stats.totals.awsCalls).toBe(1);
    expect(stats.recent).toHaveLength(1);
    expect(stats.recent[0]).toMatchObject({ type: 'miss' });
  });

  it('bounds malformed stats sidecars across repeated recoveries', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(cacheDir);

    const env = testEnv({ binDir, callsPath, debug: false });
    for (let index = 0; index < 3; index += 1) {
      await writeFile(path.join(cacheDir, '.add-eks-stats.json'), 'not-json\n', 'utf8');
      const result = await execFileAsync(
        '/bin/sh',
        [
          helperPath.pathname,
          ...baseArgs(cacheDir, ['--cluster', `broken-${index}`, '--cache-key', 'cluster']),
        ],
        { env },
      );
      expect(JSON.parse(result.stdout).status.token).toBe(`token-${index + 1}`);
      expect(result.stderr).toBe('');
    }

    const sidecars = (await readdir(cacheDir)).filter((entry) =>
      entry.startsWith('.add-eks-stats.json.malformed'),
    );
    expect(sidecars).toHaveLength(1);
  });

  it('recovers stale stats lock and records stats', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(path.join(cacheDir, '.add-eks-stats.json.lock'), { recursive: true });
    await writeFile(
      path.join(cacheDir, '.add-eks-stats.json.lock', 'created-at-ms'),
      '0\n',
      'utf8',
    );

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');
    expect((await readdir(cacheDir)).includes('.add-eks-stats.json.lock')).toBe(false);

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(1);
    expect(stats.totals.awsCalls).toBe(1);
    expect(stats.recent).toHaveLength(1);
  });

  it('skips stats quickly when lock is missing metadata but fresh', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(path.join(cacheDir, '.add-eks-stats.json.lock'), { recursive: true });

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(0);
    expect(stats.recent).toHaveLength(0);
    expect((await readdir(cacheDir)).includes('.add-eks-stats.json.lock')).toBe(true);
  });

  it('skips stats quickly when lock is fresh', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(path.join(cacheDir, '.add-eks-stats.json.lock'), { recursive: true });
    await writeFile(
      path.join(cacheDir, '.add-eks-stats.json.lock', 'created-at-ms'),
      `${Date.now()}\n`,
      'utf8',
    );

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(0);
    expect(stats.recent).toHaveLength(0);
  });

  it('recovers old stats lock without metadata and records stats', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');
    const lockDir = path.join(cacheDir, '.add-eks-stats.json.lock');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(lockDir, { recursive: true });
    const old = new Date(Date.now() - 120_000);
    await utimes(lockDir, old, old);

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');
    expect((await readdir(cacheDir)).includes('.add-eks-stats.json.lock')).toBe(false);

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(1);
    expect(stats.totals.awsCalls).toBe(1);
    expect(stats.recent).toHaveLength(1);
  });

  it('does not fail when stats lock metadata has invalid octal digits', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');
    const lockDir = path.join(cacheDir, '.add-eks-stats.json.lock');

    await writeFakeAws({ binDir, callsPath });
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, 'created-at-ms'), '08\n', 'utf8');

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
      env: testEnv({ binDir, callsPath, debug: false }),
    });

    expect(JSON.parse(result.stdout).status.token).toBe('token-1');
    expect(result.stderr).toBe('');

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(0);
    expect(stats.recent).toHaveLength(0);
  });

  it('caps recent stats at 50 entries', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath, debug: false });
    for (let index = 0; index < 55; index += 1) {
      const result = await execFileAsync(
        '/bin/sh',
        [
          helperPath.pathname,
          ...baseArgs(cacheDir, ['--cluster', `dev-${index}`, '--cache-key', 'cluster']),
        ],
        { env },
      );
      expect(JSON.parse(result.stdout).status.token).toBe(`token-${index + 1}`);
      expect(result.stderr).toBe('');
    }

    const stats = await readStats(cacheDir);
    expect(stats.totals.misses).toBe(55);
    expect(stats.totals.awsCalls).toBe(55);
    expect(stats.recent).toHaveLength(50);
    expect(stats.recent[0]).toMatchObject({ type: 'miss' });
    expect(Object.keys(stats.byCluster)).toHaveLength(50);
  });

  it('treats an invalid future expiration timestamp in cache as a miss', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath });
    const args = baseArgs(cacheDir);

    await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const [cacheFile] = await cacheEntryFiles(cacheDir);
    await writeFile(
      path.join(cacheDir, cacheFile),
      '{"apiVersion":"client.authentication.k8s.io/v1beta1","kind":"ExecCredential","status":{"expirationTimestamp":"2999-02-31T00:00:00Z","token":"invalid-cache"}}\n',
      'utf8',
    );

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });

    expect(JSON.parse(result.stdout).status.token).toBe('token-2');
    expect(result.stderr).toContain('cache miss');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('treats an expired cached token as a miss', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath });
    const args = baseArgs(cacheDir);

    await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const [cacheFile] = await cacheEntryFiles(cacheDir);
    await writeFile(
      path.join(cacheDir, cacheFile),
      '{"apiVersion":"client.authentication.k8s.io/v1beta1","kind":"ExecCredential","status":{"expirationTimestamp":"2000-01-01T00:00:00Z","token":"expired-cache"}}\n',
      'utf8',
    );

    const result = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });

    expect(JSON.parse(result.stdout).status.token).toBe('token-2');
    expect(result.stderr).toContain('cache miss');
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('keeps role ARN values isolated in cache identity', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath });
    const roleOneArgs = baseArgs(cacheDir, [
      '--role-arn',
      'arn:aws:iam::111111111111:role/app',
    ]);
    const roleTwoArgs = baseArgs(cacheDir, [
      '--role-arn',
      'arn:aws:iam::222222222222:role/app',
    ]);

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...roleOneArgs], {
      env,
    });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...roleTwoArgs], {
      env,
    });
    const third = await execFileAsync('/bin/sh', [helperPath.pathname, ...roleOneArgs], {
      env,
    });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-2');
    expect(JSON.parse(third.stdout).status.token).toBe('token-1');
    await expect(cacheEntryFiles(cacheDir)).resolves.toHaveLength(2);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('keeps cluster ARN values isolated under the default cache strategy', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath });
    const accountOneArgs = baseArgs(cacheDir, [
      '--cluster-arn',
      'arn:aws:eks:us-west-2:111111111111:cluster/dev',
    ]);
    const accountTwoArgs = baseArgs(cacheDir, [
      '--cluster-arn',
      'arn:aws:eks:us-west-2:222222222222:cluster/dev',
    ]);

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...accountOneArgs], {
      env,
    });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...accountTwoArgs], {
      env,
    });
    const third = await execFileAsync('/bin/sh', [helperPath.pathname, ...accountOneArgs], {
      env,
    });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-2');
    expect(JSON.parse(third.stdout).status.token).toBe('token-1');
    await expect(cacheEntryFiles(cacheDir)).resolves.toHaveLength(2);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('continues to use cluster ARN for arn cache strategy', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const args = baseArgs(cacheDir, [
      '--cache-key',
      'arn',
      '--cluster-arn',
      'arn:aws:eks:us-west-2:111111111111:cluster/dev',
    ]);
    const env = testEnv({ binDir, callsPath });

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], { env });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-1');
    await expect(cacheEntryFiles(cacheDir)).resolves.toHaveLength(1);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');
  });

  it('keeps omitted profile cache identity isolated by ambient AWS_PROFILE', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({
      binDir,
      callsPath,
      expectedArgs: 'eks get-token --cluster-name dev --region us-west-2',
    });

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
    ];
    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: { ...testEnv({ binDir, callsPath }), AWS_PROFILE: 'alpha' },
    });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: { ...testEnv({ binDir, callsPath }), AWS_PROFILE: 'beta' },
    });
    const third = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: { ...testEnv({ binDir, callsPath }), AWS_PROFILE: 'alpha' },
    });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-2');
    expect(JSON.parse(third.stdout).status.token).toBe('token-1');
    await expect(cacheEntryFiles(cacheDir)).resolves.toHaveLength(2);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('keeps explicit profile cache identity isolated by AWS_SHARED_CREDENTIALS_FILE', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({
      binDir,
      callsPath,
      expectedArgs: 'eks get-token --cluster-name dev --region us-west-2 --profile team',
    });

    const args = baseArgs(cacheDir);
    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: {
        ...testEnv({ binDir, callsPath }),
        AWS_SHARED_CREDENTIALS_FILE: path.join(root, 'credentials-one'),
      },
    });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: {
        ...testEnv({ binDir, callsPath }),
        AWS_SHARED_CREDENTIALS_FILE: path.join(root, 'credentials-two'),
      },
    });
    const third = await execFileAsync('/bin/sh', [helperPath.pathname, ...args], {
      env: {
        ...testEnv({ binDir, callsPath }),
        AWS_SHARED_CREDENTIALS_FILE: path.join(root, 'credentials-one'),
      },
    });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-2');
    expect(JSON.parse(third.stdout).status.token).toBe('token-1');
    await expect(cacheEntryFiles(cacheDir)).resolves.toHaveLength(2);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('uses a hash so lossy-safe key prefixes do not collide', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath });

    const env = testEnv({ binDir, callsPath });
    const slashArgs = [
      '--cluster',
      'team/dev',
      '--region',
      'us-west-2',
      '--cache-dir',
      cacheDir,
      '--safety-margin',
      '60',
      '--cache-key',
      'cluster',
    ];
    const colonArgs = [
      '--cluster',
      'team:dev',
      '--region',
      'us-west-2',
      '--cache-dir',
      cacheDir,
      '--safety-margin',
      '60',
      '--cache-key',
      'cluster',
    ];

    const first = await execFileAsync('/bin/sh', [helperPath.pathname, ...slashArgs], {
      env,
    });
    const second = await execFileAsync('/bin/sh', [helperPath.pathname, ...colonArgs], {
      env,
    });
    const third = await execFileAsync('/bin/sh', [helperPath.pathname, ...slashArgs], {
      env,
    });

    expect(JSON.parse(first.stdout).status.token).toBe('token-1');
    expect(JSON.parse(second.stdout).status.token).toBe('token-2');
    expect(JSON.parse(third.stdout).status.token).toBe('token-1');
    await expect(cacheEntryFiles(cacheDir)).resolves.toHaveLength(2);
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('2\n');
  });

  it('keeps stdout empty and relays stderr when aws fails', async () => {
    const root = await tempDir();
    const binDir = path.join(root, 'bin');
    const cacheDir = path.join(root, 'cache');
    const callsPath = path.join(root, 'aws-calls');

    await writeFakeAws({ binDir, callsPath, fail: true });

    await expect(
      execFileAsync('/bin/sh', [helperPath.pathname, ...baseArgs(cacheDir)], {
        env: testEnv({ binDir, callsPath, debug: false }),
      }),
    ).rejects.toMatchObject({
      stdout: '',
      stderr: expect.stringContaining('fake aws failed'),
    });
    await expect(readFile(callsPath, 'utf8')).resolves.toBe('1\n');
  });
});
