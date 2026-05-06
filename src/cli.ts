#!/usr/bin/env node
import { Command } from 'commander';

import { runUpdate } from './commands/update.js';
import { name, version } from './index.js';

const program = new Command();

program
  .name(name)
  .description('Friendly EKS kubeconfig setup with cached token support.')
  .version(version)
  .action(() => {
    program.outputHelp();
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

      const prefix = result.dryRun ? 'Would update' : 'Updated';
      process.stdout.write(`${prefix} contexts: ${result.changedContexts.join(', ')}\n`);
      if (result.backupPath !== undefined) {
        process.stdout.write(`Backup: ${result.backupPath}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  });

type UpdateOptions = Parameters<typeof runUpdate>[0];

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

await program.parseAsync(process.argv);
