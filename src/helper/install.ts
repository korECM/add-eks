import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallHelperInput {
  sourcePath?: string;
  helperPath: string;
}

const helperTemplatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/add-eks-token.sh',
);

export async function installHelper(input: InstallHelperInput): Promise<void> {
  const sourcePath = input.sourcePath ?? helperTemplatePath;
  const contents = await readFile(sourcePath, 'utf8');

  await mkdir(path.dirname(input.helperPath), { recursive: true });
  await writeFile(input.helperPath, contents, { encoding: 'utf8', mode: 0o755 });
  await chmod(input.helperPath, 0o755);
}
