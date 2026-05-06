import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandRunnerResult {
  stdout: string;
  stderr?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandRunnerResult>;

export interface ListEksClustersOptions {
  region: string;
  profile: string;
  runner?: CommandRunner;
}

export async function listEksClusters(options: ListEksClustersOptions): Promise<string[]> {
  const runner = options.runner ?? defaultCommandRunner;
  const result = await runner('aws', [
    'eks',
    'list-clusters',
    '--region',
    options.region,
    '--profile',
    options.profile,
    '--output',
    'json',
  ]);

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error('Unable to parse AWS EKS cluster list JSON', { cause: error });
  }

  if (!isClusterListPayload(payload)) {
    throw new Error('AWS EKS cluster list JSON did not include a clusters array');
  }

  return payload.clusters;
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<CommandRunnerResult> {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8' });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (isExecError(error)) {
      const message = error.stderr.trim() || error.message;
      throw new Error(message, { cause: error });
    }

    throw error;
  }
}

function isClusterListPayload(payload: unknown): payload is { clusters: string[] } {
  if (typeof payload !== 'object' || payload === null || !('clusters' in payload)) {
    return false;
  }

  const clusters = (payload as { clusters: unknown }).clusters;
  return Array.isArray(clusters) && clusters.every((cluster) => typeof cluster === 'string');
}

function isExecError(error: unknown): error is Error & { stderr: string } {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string';
}
