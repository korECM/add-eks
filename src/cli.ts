#!/usr/bin/env node
import { Command } from 'commander';

import { runCacheClear, runCacheList, runCacheStatus } from './commands/cache.js';
import {
  completeCandidates,
  generateCompletionScript,
  parseCompletionArgs,
} from './commands/completion.js';
import type { CompletionKind, CompletionShell } from './commands/completion.js';
import { formatDoctorHuman, runDoctor } from './commands/doctor.js';
import { runInteractive, runInteractiveEntrypoint } from './commands/interactive.js';
import { runRestore } from './commands/restore.js';
import { runRevert } from './commands/revert.js';
import { formatStatsHuman, runStatsClear, runStatsShow } from './commands/stats.js';
import { runUpdate } from './commands/update.js';
import { name, version } from './index.js';

const program = new Command();

program.enablePositionalOptions();

program
  .name(name)
  .description('Friendly EKS kubeconfig setup with cached token support.')
  .version(version)
  .action(async () => {
    try {
      const exitCode = await runInteractiveEntrypoint({
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        runInteractive: () => runInteractive(),
        writeResult: writeUpdateResult,
      });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    } catch (error) {
      writeCommandError(error);
    }
  });

program
  .command('doctor')
  .description('Check local add-eks, AWS CLI, kubectl, helper, cache, and kubeconfig setup.')
  .option('--kubeconfig <path>', 'kubeconfig file to inspect')
  .option('--helper-path <path>', 'expected token helper path')
  .option('--cache-dir <path>', 'token cache directory to inspect')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: DoctorOptions) => {
    try {
      const result = await runDoctor(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(formatDoctorHuman(result));
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      writeCommandError(error);
    }
  });

program
  .command('completion <shell>')
  .description('Print shell completion script for bash, zsh, or fish.')
  .action((shell: string) => {
    try {
      if (!isCompletionShell(shell)) {
        throw new Error("completion shell must be one of: bash, zsh, fish");
      }

      process.stdout.write(generateCompletionScript(shell, { binaryName: name }));
    } catch (error) {
      writeCommandError(error);
    }
  });

program
  .command('__complete <kind> [words...]', { hidden: true })
  .description('Internal completion candidate endpoint.')
  .allowUnknownOption(true)
  .passThroughOptions()
  .action(async (kind: string, words: string[] | undefined) => {
    try {
      if (!isCompletionKind(kind)) {
        return;
      }

      const candidates = await completeCandidates(kind, parseCompletionArgs(words ?? []));
      if (candidates.length > 0) {
        process.stdout.write(`${candidates.join('\n')}\n`);
      }
    } catch {
      // Completion should never make an interactive shell command noisy.
    }
  });

program
  .command('update')
  .description('Patch EKS kubeconfig contexts to use the add-eks token helper.')
  .option('--kubeconfig <path>', 'kubeconfig file to update')
  .option('--context <name>', 'context to update; can be repeated or comma-separated', collect, [])
  .option('--all', 'update all detected EKS contexts')
  .option('--profile <name>', 'AWS profile to pass to the helper')
  .option('--helper-path <path>', 'path where the helper should be installed')
  .option('--cache-dir <path>', 'token cache directory for patched exec args')
  .option('--safety-margin <seconds>', 'token refresh safety margin in seconds')
  .option('--cache-key <strategy>', 'cache key strategy')
  .option('--backup', 'create a kubeconfig backup before writing', true)
  .option('--no-backup', 'skip kubeconfig backup creation')
  .option('--backup-dir <path>', 'directory for kubeconfig backups')
  .option('--yes', 'confirm non-interactive writes')
  .option('--dry-run', 'show planned changes without installing, backing up, or writing')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: UpdateOptions) => {
    try {
      const result = await runUpdate(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      writeUpdateResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('revert')
  .description('Revert add-eks patched kubeconfig contexts back to aws eks get-token.')
  .option('--kubeconfig <path>', 'kubeconfig file to update')
  .option('--context <name>', 'context to revert; can be repeated or comma-separated', collect, [])
  .option('--all', 'revert all add-eks patched contexts')
  .option('--backup', 'create a kubeconfig backup before writing', true)
  .option('--no-backup', 'skip kubeconfig backup creation')
  .option('--backup-dir <path>', 'directory for kubeconfig backups')
  .option('--yes', 'confirm non-interactive writes')
  .option('--dry-run', 'show planned changes without backing up or writing')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: RevertOptions) => {
    try {
      const result = await runRevert(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const prefix = result.dryRun ? 'Would revert' : 'Reverted';
      process.stdout.write(`${prefix} contexts: ${result.changedContexts.join(', ')}\n`);
      if (result.backupPath !== undefined) {
        process.stdout.write(`Backup: ${result.backupPath}\n`);
      }
    } catch (error) {
      writeCommandError(error);
    }
  });

program
  .command('restore')
  .description('Restore a kubeconfig from an add-eks backup file.')
  .requiredOption('--backup <path>', 'backup file to restore from')
  .option('--kubeconfig <path>', 'kubeconfig file to restore')
  .option('--yes', 'confirm non-interactive restore')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: RestoreOptions) => {
    try {
      const result = await runRestore(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      process.stdout.write(`Restored ${result.kubeconfigPath} from ${result.backupPath}\n`);
    } catch (error) {
      writeCommandError(error);
    }
  });

const statsCommand = program
  .command('stats')
  .description('Show add-eks token cache statistics.')
  .option('--cache-dir <path>', 'token cache directory to inspect')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: StatsOptions) => {
    try {
      const result = await runStatsShow(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      process.stdout.write(formatStatsHuman(result));
    } catch (error) {
      writeCommandError(error);
    }
  });

statsCommand
  .command('clear')
  .description('Clear add-eks token cache statistics.')
  .option('--cache-dir <path>', 'token cache directory to clear stats from')
  .option('--yes', 'confirm stats deletion')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: StatsOptions, command: Command) => {
    try {
      const mergedOptions = mergeParentStatsOptions(options, command);
      const result = await runStatsClear(mergedOptions);
      if (mergedOptions.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      process.stdout.write(
        result.deleted ? 'Deleted stats.\n' : 'No stats file found.\n',
      );
    } catch (error) {
      writeCommandError(error);
    }
  });

const cacheCommand = program
  .command('cache')
  .description('Inspect and clear cached EKS ExecCredential files.');

cacheCommand
  .command('list')
  .description('List cache entries.')
  .option('--cache-dir <path>', 'token cache directory to inspect')
  .option('--cluster <name>', 'filter entries by cluster when filename metadata allows it')
  .option('--region <name>', 'filter entries by region when filename metadata allows it')
  .option('--profile <name>', 'filter entries by profile when filename metadata allows it')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: CacheOptions) => {
    try {
      const result = await runCacheList(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (result.entries.length === 0) {
        process.stdout.write('No cache entries found.\n');
        return;
      }

      for (const entry of result.entries) {
        process.stdout.write(`${formatCacheEntry(entry)}\n`);
      }
    } catch (error) {
      writeCommandError(error);
    }
  });

cacheCommand
  .command('status')
  .description('Summarize cache entry status.')
  .option('--cache-dir <path>', 'token cache directory to inspect')
  .option('--cluster <name>', 'filter entries by cluster when filename metadata allows it')
  .option('--region <name>', 'filter entries by region when filename metadata allows it')
  .option('--profile <name>', 'filter entries by profile when filename metadata allows it')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: CacheOptions) => {
    try {
      const result = await runCacheStatus(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const statuses = Object.entries(result.counts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(', ');
      process.stdout.write(`Cache dir: ${result.cacheDir}\n`);
      process.stdout.write(`Entries: ${result.totalEntries}\n`);
      process.stdout.write(`Size: ${result.totalSize} bytes\n`);
      process.stdout.write(`Status: ${statuses === '' ? 'none' : statuses}\n`);
    } catch (error) {
      writeCommandError(error);
    }
  });

cacheCommand
  .command('clear')
  .description('Clear cache entries.')
  .option('--cache-dir <path>', 'token cache directory to clear')
  .option('--cluster <name>', 'clear entries by cluster when filename metadata allows it')
  .option('--region <name>', 'clear entries by region when filename metadata allows it')
  .option('--profile <name>', 'clear entries by profile when filename metadata allows it')
  .option('--yes', 'confirm cache deletion')
  .option('--dry-run', 'show what would be cleared without deleting files')
  .option('--json', 'print machine-readable JSON output')
  .action(async (options: CacheOptions) => {
    try {
      const result = await runCacheClear(options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (result.dryRun) {
        process.stdout.write(
          `Would delete ${result.wouldDeleteCount} cache entries; skipped ${result.skippedCount}.\n`,
        );
        return;
      }

      process.stdout.write(
        `Deleted ${result.deletedCount} cache entries; skipped ${result.skippedCount}.\n`,
      );
    } catch (error) {
      writeCommandError(error);
    }
  });

type UpdateOptions = Parameters<typeof runUpdate>[0];
type RevertOptions = Parameters<typeof runRevert>[0];
type RestoreOptions = Parameters<typeof runRestore>[0];
type CacheOptions = Parameters<typeof runCacheList>[0];
type DoctorOptions = Parameters<typeof runDoctor>[0];
type StatsOptions = Parameters<typeof runStatsShow>[0];
type CacheEntry = Awaited<ReturnType<typeof runCacheList>>['entries'][number];

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function formatCacheEntry(entry: CacheEntry): string {
  const details = [
    entry.expirationTimestamp === undefined ? undefined : `expires=${entry.expirationTimestamp}`,
    entry.cluster === undefined ? undefined : `cluster=${entry.cluster}`,
    entry.region === undefined ? undefined : `region=${entry.region}`,
    entry.profile === undefined ? undefined : `profile=${entry.profile}`,
  ].filter((value) => value !== undefined);

  const suffix = details.length === 0 ? '' : ` ${details.join(' ')}`;
  return `${entry.name} ${entry.status} ${entry.size}B${suffix}`;
}

function mergeParentStatsOptions(options: StatsOptions, command: Command): StatsOptions {
  const parentOptions = command.parent?.opts<StatsOptions>() ?? {};

  return {
    ...parentOptions,
    ...options,
  };
}

function writeUpdateResult(result: Awaited<ReturnType<typeof runUpdate>>): void {
  const prefix = result.dryRun ? 'Would update' : 'Updated';
  process.stdout.write(`${prefix} contexts: ${result.changedContexts.join(', ')}\n`);
  if (result.backupPath !== undefined) {
    process.stdout.write(`Backup: ${result.backupPath}\n`);
  }
}

function writeCommandError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}

function isCompletionShell(value: string): value is CompletionShell {
  return value === 'bash' || value === 'zsh' || value === 'fish';
}

function isCompletionKind(value: string): value is CompletionKind {
  return (
    value === 'profiles' ||
    value === 'contexts' ||
    value === 'eks-contexts' ||
    value === 'regions' ||
    value === 'clusters'
  );
}

await program.parseAsync(process.argv);
