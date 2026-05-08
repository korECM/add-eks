import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBackup } from '../core/backup.js';
import type { CreateBackupResult } from '../core/backup.js';
import { writeFileAtomic } from '../core/file.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';
import { parseKubeconfig, stringifyKubeconfig } from '../kubeconfig/parser.js';
import { findAddEksPatchedContexts, planRevert } from '../kubeconfig/patch.js';
import type { Kubeconfig } from '../kubeconfig/types.js';

export interface RevertOptions {
  kubeconfig?: string;
  context?: string | string[];
  all?: boolean;
  backup?: boolean;
  backupDir?: string;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface RevertResult {
  kubeconfigPath: string;
  changedContexts: string[];
  dryRun: boolean;
  wroteKubeconfig: boolean;
  backupPath?: string;
  metadataPath?: string;
}

export interface RevertDeps {
  home?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  writeFileAtomic?: (filePath: string, contents: string) => Promise<void>;
  createBackup?: (input: {
    kubeconfigPath: string;
    backupDir: string;
    operation: string;
    contexts: string[];
    helperPath: string;
  }) => Promise<CreateBackupResult>;
}

export async function runRevert(
  options: RevertOptions,
  deps: RevertDeps = {},
): Promise<RevertResult> {
  const home = deps.home ?? os.homedir();
  const defaults = defaultPaths(home);
  const kubeconfigPath = resolvePath(options.kubeconfig ?? defaults.kubeconfig, home);
  const backupDir = path.resolve(resolveHomePath(options.backupDir ?? defaults.backupDir, home));
  const source = await (deps.readFile ?? readFile)(kubeconfigPath, 'utf8');
  const config = parseKubeconfig(source);
  const selectedContexts = selectContexts(config, options);
  const revert = planRevert({
    config,
    contexts: selectedContexts,
  });

  if (options.dryRun === true) {
    return {
      kubeconfigPath,
      changedContexts: revert.changedContexts,
      dryRun: true,
      wroteKubeconfig: false,
    };
  }

  if (options.yes !== true) {
    throw new Error('--yes is required for non-interactive reverts');
  }

  const backup =
    options.backup === false
      ? undefined
      : await (deps.createBackup ?? createBackup)({
          kubeconfigPath,
          backupDir,
          operation: 'revert',
          contexts: revert.changedContexts,
          helperPath: defaults.helperPath,
        });

  await (deps.writeFileAtomic ?? writeFileAtomic)(
    kubeconfigPath,
    stringifyKubeconfig(revert.config),
  );

  return {
    kubeconfigPath,
    changedContexts: revert.changedContexts,
    dryRun: false,
    wroteKubeconfig: true,
    backupPath: backup?.backupPath,
    metadataPath: backup?.metadataPath,
  };
}

function resolvePath(value: string, home: string): string {
  return path.resolve(resolveHomePath(value, home));
}

function selectContexts(config: Kubeconfig, options: RevertOptions): string[] {
  const requestedContexts = parseContextFlags(options.context);
  const hasContextSelection = requestedContexts.length > 0;

  if (options.all === true && hasContextSelection) {
    throw new Error('Use either --all or --context, not both');
  }

  if (options.all === true) {
    const patchedContexts = findAddEksPatchedContexts(config);
    if (patchedContexts.length === 0) {
      throw new Error('No add-eks patched contexts found');
    }

    return [...new Set(patchedContexts)];
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
