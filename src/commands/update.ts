import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBackup } from '../core/backup.js';
import type { CreateBackupResult } from '../core/backup.js';
import { writeFileAtomic } from '../core/file.js';
import type { RuntimeOptionFlags } from '../core/options.js';
import { resolveRuntimeOptions } from '../core/options.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';
import { installHelper } from '../helper/install.js';
import { findEksContexts } from '../kubeconfig/detect.js';
import { parseKubeconfig, stringifyKubeconfig } from '../kubeconfig/parser.js';
import { planPatch } from '../kubeconfig/patch.js';
import type { Kubeconfig } from '../kubeconfig/types.js';

export interface UpdateOptions extends RuntimeOptionFlags {
  kubeconfig?: string;
  context?: string | string[];
  all?: boolean;
  profile?: string;
  region?: string;
  backup?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface UpdateResult {
  kubeconfigPath: string;
  changedContexts: string[];
  dryRun: boolean;
  installedHelper: boolean;
  wroteKubeconfig: boolean;
  backupPath?: string;
  metadataPath?: string;
}

export interface UpdateDeps {
  home?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  writeFileAtomic?: (filePath: string, contents: string) => Promise<void>;
  installHelper?: (input: { helperPath: string }) => Promise<void>;
  createBackup?: (input: {
    kubeconfigPath: string;
    backupDir: string;
    operation: string;
    contexts: string[];
    helperPath: string;
  }) => Promise<CreateBackupResult>;
}

export async function runUpdate(
  options: UpdateOptions,
  deps: UpdateDeps = {},
): Promise<UpdateResult> {
  const home = deps.home ?? os.homedir();
  const defaults = defaultPaths(home);
  const kubeconfigPath = resolvePath(options.kubeconfig ?? defaults.kubeconfig, home);
  const runtimeOptions = resolveRuntimeOptions(options, home);
  const resolvedRuntimeOptions = {
    ...runtimeOptions,
    helperPath: path.resolve(runtimeOptions.helperPath),
    cacheDir: path.resolve(runtimeOptions.cacheDir),
    backupDir: path.resolve(runtimeOptions.backupDir),
  };
  const source = await (deps.readFile ?? readFile)(kubeconfigPath, 'utf8');
  const config = parseKubeconfig(source);
  const selectedContexts = selectContexts(config, options);
  const patch = planPatch({
    config,
    contexts: selectedContexts,
    helperPath: resolvedRuntimeOptions.helperPath,
    cacheDir: resolvedRuntimeOptions.cacheDir,
    safetyMargin: resolvedRuntimeOptions.safetyMargin,
    cacheKey: resolvedRuntimeOptions.cacheKey,
    profile: options.profile,
  });

  if (options.dryRun === true) {
    return {
      kubeconfigPath,
      changedContexts: patch.changedContexts,
      dryRun: true,
      installedHelper: false,
      wroteKubeconfig: false,
    };
  }

  if (options.yes !== true) {
    throw new Error('--yes is required for non-interactive updates');
  }

  const backup =
    options.backup === false
      ? undefined
      : await (deps.createBackup ?? createBackup)({
          kubeconfigPath,
          backupDir: resolvedRuntimeOptions.backupDir,
          operation: 'update',
          contexts: patch.changedContexts,
          helperPath: resolvedRuntimeOptions.helperPath,
        });

  await (deps.installHelper ?? installHelper)({
    helperPath: resolvedRuntimeOptions.helperPath,
  });

  await (deps.writeFileAtomic ?? writeFileAtomic)(
    kubeconfigPath,
    stringifyKubeconfig(patch.config),
  );

  return {
    kubeconfigPath,
    changedContexts: patch.changedContexts,
    dryRun: false,
    installedHelper: true,
    wroteKubeconfig: true,
    backupPath: backup?.backupPath,
    metadataPath: backup?.metadataPath,
  };
}

function resolvePath(value: string, home: string): string {
  return path.resolve(resolveHomePath(value, home));
}

function selectContexts(config: Kubeconfig, options: UpdateOptions): string[] {
  const requestedContexts = parseContextFlags(options.context);
  const hasContextSelection = requestedContexts.length > 0;

  if (options.all === true && hasContextSelection) {
    throw new Error('Use either --all or --context, not both');
  }

  if (options.all === true) {
    const patchableContexts = findEksContexts(config)
      .filter((detection) => detection.cluster !== undefined && detection.region !== undefined)
      .map((detection) => detection.contextName);

    if (patchableContexts.length === 0) {
      throw new Error('No detectable EKS contexts found');
    }

    return [...new Set(patchableContexts)];
  }

  if (!hasContextSelection) {
    throw new Error('Select contexts with --context or --all');
  }

  const knownContexts = new Set((config.contexts ?? []).map((entry) => entry.name));
  for (const contextName of requestedContexts) {
    if (!knownContexts.has(contextName)) {
      throw new Error(`Unknown context '${contextName}'`);
    }
  }

  return requestedContexts;
}

function parseContextFlags(context: string | string[] | undefined): string[] {
  const values = Array.isArray(context) ? context : context === undefined ? [] : [context];
  const contexts = values.flatMap((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  );

  return [...new Set(contexts)];
}
