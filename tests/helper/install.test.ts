import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { installHelper } from '../../src/helper/install.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-install-'));
}

describe('installHelper', () => {
  it('writes a custom source into a nested executable helper path', async () => {
    const root = await tempDir();
    const sourcePath = path.join(root, 'source.sh');
    const helperPath = path.join(root, 'nested', 'bin', 'add-eks-token');
    const contents = '#!/bin/sh\nprintf test\n';

    await writeFile(sourcePath, contents, 'utf8');

    await installHelper({ sourcePath, helperPath });

    await expect(readFile(helperPath, 'utf8')).resolves.toBe(contents);
    expect((await stat(path.dirname(helperPath))).isDirectory()).toBe(true);
    const helperStats = await stat(helperPath);
    expect(helperStats.isFile()).toBe(true);
    expect(helperStats.mode & 0o777).toBe(0o755);
  });

  it('uses the bundled POSIX helper template by default', async () => {
    const root = await tempDir();
    const helperPath = path.join(root, 'bin', 'add-eks-token');

    await installHelper({ helperPath });

    const installed = await readFile(helperPath, 'utf8');
    expect(installed.startsWith('#!/bin/sh\n')).toBe(true);
    expect(installed).toContain('aws eks get-token');
    expect((await stat(helperPath)).mode & 0o777).toBe(0o755);
  });
});
