import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const tempPath = path.join(directory, `.${basename}.${process.pid}.${randomUUID()}.tmp`);
  const mode = await existingFileMode(filePath);

  await mkdir(directory, { recursive: true });

  let closed = false;
  const handle = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);

  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(tempPath, filePath);
  } catch (error) {
    if (!closed) {
      await closeBestEffort(handle);
    }
    await removeBestEffort(tempPath);
    throw error;
  }
}

async function closeBestEffort(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  try {
    await handle.close();
  } catch {
    // Preserve the original write or rename failure.
  }
}

async function removeBestEffort(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Preserve the original write or rename failure.
  }
}

async function existingFileMode(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).mode & 0o777;
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return 0o600;
    }

    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
