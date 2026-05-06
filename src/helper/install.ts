import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallHelperInput {
  sourcePath?: string;
  helperPath: string;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const helperTemplateCandidates = [
  path.resolve(moduleDir, '../assets/add-eks-token.sh'),
  path.resolve(moduleDir, '../../assets/add-eks-token.sh'),
];

export async function installHelper(input: InstallHelperInput): Promise<void> {
  const sourcePath = input.sourcePath ?? (await resolveBundledHelperTemplate());
  const contents = await readFile(sourcePath, 'utf8');

  await mkdir(path.dirname(input.helperPath), { recursive: true });
  await writeFile(input.helperPath, contents, { encoding: 'utf8', mode: 0o755 });
  await chmod(input.helperPath, 0o755);
}

async function resolveBundledHelperTemplate(): Promise<string> {
  for (const candidate of helperTemplateCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next package layout candidate.
    }
  }

  throw new Error('Unable to locate bundled add-eks-token.sh helper template');
}
