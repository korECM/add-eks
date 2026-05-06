import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  const backupPath = path.join(
    input.backupDir,
    backupFileName(input.kubeconfigPath, createdAt),
  );
  const metadataPath = `${backupPath}.metadata.json`;

  await mkdir(input.backupDir, { recursive: true });
  await copyFile(input.kubeconfigPath, backupPath);

  const metadata: BackupMetadata = {
    createdAt: createdAt.toISOString(),
    kubeconfig: input.kubeconfigPath,
    operation: input.operation,
    contexts: input.contexts,
    helperPath: input.helperPath,
  };

  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  return { backupPath, metadataPath };
}

export async function restoreBackup(input: RestoreBackupInput): Promise<void> {
  await copyFile(input.backupPath, input.kubeconfigPath);
}

function backupFileName(kubeconfigPath: string, now: Date): string {
  const name = path.basename(kubeconfigPath);
  const extension = path.extname(name) || '.yaml';
  const basename = path.basename(name, path.extname(name));

  return `${basename}.${formatTimestamp(now)}${extension}`;
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
