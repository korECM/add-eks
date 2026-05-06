import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { readCacheStatus } from '../core/cache.js';
import type { CacheStatus } from '../core/cache.js';
import type { RuntimeOptionFlags } from '../core/options.js';
import { resolveRuntimeOptions } from '../core/options.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';
import { parseKubeconfig } from '../kubeconfig/parser.js';
import { version as packageVersion } from '../index.js';

const execFileAsync = promisify(execFile);

export type DoctorCheckStatus = 'ok' | 'warning' | 'error';

export interface DoctorCheckResult {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface DoctorResult {
  ok: boolean;
  node: {
    version: string;
  };
  cli: {
    version: string;
  };
  checks: DoctorCheckResult[];
}

export interface DoctorOptions extends RuntimeOptionFlags {
  kubeconfig?: string;
  json?: boolean;
}

export interface DoctorChecks {
  command?: (command: 'aws' | 'kubectl') => Promise<DoctorCheckResult>;
  helper?: (helperPath: string) => Promise<DoctorCheckResult>;
  cacheDir?: (cacheDir: string) => Promise<DoctorCheckResult>;
  kubeconfig?: (kubeconfigPath: string) => Promise<DoctorCheckResult>;
}

export interface DoctorDeps {
  home?: string;
  cliVersion?: string;
  nodeVersion?: string;
  checks?: DoctorChecks;
}

export async function runDoctor(
  options: DoctorOptions,
  deps: DoctorDeps = {},
): Promise<DoctorResult> {
  const home = deps.home ?? os.homedir();
  const defaults = defaultPaths(home);
  const runtimeOptions = resolveRuntimeOptions(options, home);
  const helperPath = path.resolve(runtimeOptions.helperPath);
  const cacheDir = path.resolve(runtimeOptions.cacheDir);
  const kubeconfigPath = path.resolve(resolveHomePath(options.kubeconfig ?? defaults.kubeconfig, home));
  const nodeVersion = deps.nodeVersion ?? process.version;
  const cliVersion = deps.cliVersion ?? packageVersion;
  const checks = deps.checks ?? {};

  const results = await Promise.all([
    (checks.command ?? checkCommand)('aws'),
    (checks.command ?? checkCommand)('kubectl'),
    (checks.helper ?? checkHelper)(helperPath),
    (checks.cacheDir ?? checkCacheDir)(cacheDir),
    (checks.kubeconfig ?? checkKubeconfig)(kubeconfigPath),
  ]);

  const setupChecks: DoctorCheckResult[] = [
    {
      id: 'node',
      label: 'Node.js',
      status: 'ok',
      message: nodeVersion,
    },
    {
      id: 'cli',
      label: 'add-eks',
      status: 'ok',
      message: cliVersion,
    },
    ...results,
  ];

  return {
    ok: setupChecks.every((check) => check.status !== 'error'),
    node: { version: nodeVersion },
    cli: { version: cliVersion },
    checks: setupChecks,
  };
}

export function formatDoctorHuman(result: DoctorResult): string {
  const lines = ['add-eks doctor'];

  for (const check of result.checks) {
    const prefix = check.status.toUpperCase();
    const suffix = check.path === undefined ? '' : ` (${check.path})`;
    lines.push(`${prefix} ${check.label}: ${check.message}${suffix}`);
  }

  lines.push(`Overall: ${result.ok ? 'ok' : 'needs attention'}`);
  return `${lines.join('\n')}\n`;
}

async function checkCommand(command: 'aws' | 'kubectl'): Promise<DoctorCheckResult> {
  const label = command === 'aws' ? 'AWS CLI' : 'kubectl';
  const args = command === 'aws' ? ['--version'] : ['version', '--client'];

  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 5_000,
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    return {
      id: command,
      label,
      status: 'ok',
      message: firstLine(output) ?? 'available',
    };
  } catch (error) {
    return {
      id: command,
      label,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkHelper(helperPath: string): Promise<DoctorCheckResult> {
  try {
    const fileStat = await stat(helperPath);
    if (!fileStat.isFile()) {
      return {
        id: 'helper',
        label: 'Token helper',
        status: 'error',
        message: 'exists but is not a file',
        path: helperPath,
      };
    }

    await access(helperPath, constants.X_OK);
    return {
      id: 'helper',
      label: 'Token helper',
      status: 'ok',
      message: 'installed and executable',
      path: helperPath,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        id: 'helper',
        label: 'Token helper',
        status: 'warning',
        message: 'not installed yet',
        path: helperPath,
      };
    }

    return {
      id: 'helper',
      label: 'Token helper',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      path: helperPath,
    };
  }
}

async function checkCacheDir(cacheDir: string): Promise<DoctorCheckResult> {
  try {
    const fileStat = await stat(cacheDir);
    if (!fileStat.isDirectory()) {
      return {
        id: 'cache',
        label: 'Cache directory',
        status: 'error',
        message: 'exists but is not a directory',
        path: cacheDir,
      };
    }

    const status: CacheStatus = await readCacheStatus(cacheDir);
    return {
      id: 'cache',
      label: 'Cache directory',
      status: 'ok',
      message: `${status.totalEntries} entries, ${status.totalSize} bytes`,
      path: cacheDir,
      details: {
        totalEntries: status.totalEntries,
        totalSize: status.totalSize,
        counts: status.counts,
      },
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        id: 'cache',
        label: 'Cache directory',
        status: 'warning',
        message: 'missing; will be created on first use',
        path: cacheDir,
      };
    }

    return {
      id: 'cache',
      label: 'Cache directory',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      path: cacheDir,
    };
  }
}

async function checkKubeconfig(kubeconfigPath: string): Promise<DoctorCheckResult> {
  try {
    const source = await readFile(kubeconfigPath, 'utf8');
    const config = parseKubeconfig(source);
    const contextCount = config.contexts?.length ?? 0;
    return {
      id: 'kubeconfig',
      label: 'Kubeconfig',
      status: 'ok',
      message: `readable (${contextCount} contexts)`,
      path: kubeconfigPath,
      details: {
        contextCount,
      },
    };
  } catch (error) {
    return {
      id: 'kubeconfig',
      label: 'Kubeconfig',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      path: kubeconfigPath,
    };
  }
}

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
