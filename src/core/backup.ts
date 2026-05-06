import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic as defaultWriteFileAtomic } from './file.js';

export interface CreateBackupInput {
  kubeconfigPath: string;
  backupDir: string;
  operation: string;
  contexts: string[];
  helperPath: string;
  now?: Date;
}

export interface CreateBackupResult {
  backupPath: string;
  metadataPath: string;
}

export interface RestoreBackupInput {
  backupPath: string;
  kubeconfigPath: string;
}

export interface RestoreBackupDeps {
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  writeFileAtomic?: (filePath: string, contents: string) => Promise<void>;
}

interface BackupMetadata {
  createdAt: string;
  kubeconfig: string;
  operation: string;
  contexts: string[];
  helperPath: string;
}

export async function createBackup(
  input: CreateBackupInput,
): Promise<CreateBackupResult> {
  const createdAt = input.now ?? new Date();
  await mkdir(input.backupDir, { recursive: true });

  const metadata: BackupMetadata = {
    createdAt: createdAt.toISOString(),
    kubeconfig: input.kubeconfigPath,
    operation: input.operation,
    contexts: input.contexts,
    helperPath: input.helperPath,
  };

  for (let suffix = 0; ; suffix += 1) {
    const backupPath = path.join(
      input.backupDir,
      backupFileName(input.kubeconfigPath, createdAt, suffix),
    );
    const metadataPath = `${backupPath}.metadata.json`;

    try {
      await copyFile(input.kubeconfigPath, backupPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if (isErrorCode(error, 'EEXIST')) {
        continue;
      }

      throw error;
    }

    try {
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      if (isErrorCode(error, 'EEXIST')) {
        await unlink(backupPath);
        continue;
      }

      throw error;
    }

    return { backupPath, metadataPath };
  }
}

export async function restoreBackup(
  input: RestoreBackupInput,
  deps: RestoreBackupDeps = {},
): Promise<void> {
  const contents = await (deps.readFile ?? readFile)(input.backupPath, 'utf8');
  await (deps.writeFileAtomic ?? defaultWriteFileAtomic)(input.kubeconfigPath, contents);
}

function backupFileName(
  kubeconfigPath: string,
  now: Date,
  suffix: number,
): string {
  const name = path.basename(kubeconfigPath);
  const extension = path.extname(name) || '.yaml';
  const basename = path.basename(name, path.extname(name));
  const suffixSegment = suffix === 0 ? '' : `.${suffix}`;

  return `${basename}.${formatTimestamp(now)}${suffixSegment}${extension}`;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());

  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
