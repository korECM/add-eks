import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverAwsProfiles } from '../aws/profiles.js';
import type { DiscoverAwsProfilesOptions } from '../aws/profiles.js';
import type { RuntimeOptionFlags } from '../core/options.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';
import { findEksContexts } from '../kubeconfig/detect.js';
import { parseKubeconfig } from '../kubeconfig/parser.js';
import type { EksContextDetection } from '../kubeconfig/types.js';
import { runUpdate } from './update.js';
import type { UpdateOptions, UpdateResult } from './update.js';

type InteractiveAction = 'update-existing';
type ApplyMode = 'apply' | 'dry-run';

export interface InteractiveOptions extends RuntimeOptionFlags {
  kubeconfig?: string;
  awsConfigPath?: string;
  awsCredentialsPath?: string;
  dryRun?: boolean;
  backup?: boolean;
}

export interface PromptChoice<T> {
  name: string;
  value: T;
  description?: string;
  checked?: boolean;
}

export interface SelectPromptConfig<T> {
  message: string;
  choices: PromptChoice<T>[];
  default?: T;
}

export interface CheckboxPromptConfig<T> {
  message: string;
  choices: PromptChoice<T>[];
  required?: boolean;
}

export interface InputPromptConfig {
  message: string;
  default?: string;
  required?: boolean;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

export interface ConfirmPromptConfig {
  message: string;
  default?: boolean;
}

export interface InteractivePromptFunctions {
  select: <T>(config: SelectPromptConfig<T>) => Promise<T>;
  checkbox: <T>(config: CheckboxPromptConfig<T>) => Promise<T[]>;
  input: (config: InputPromptConfig) => Promise<string>;
  confirm: (config: ConfirmPromptConfig) => Promise<boolean>;
}

export interface InteractiveDeps {
  home?: string;
  prompts?: InteractivePromptFunctions;
  discoverProfiles?: (options: DiscoverAwsProfilesOptions) => Promise<string[]>;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  runUpdate?: (options: UpdateOptions) => Promise<UpdateResult>;
}

export interface InteractiveEntrypointDeps {
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
  stderr?: { write: (message: string) => unknown };
  runInteractive?: () => Promise<UpdateResult>;
  writeResult?: (result: UpdateResult) => void;
}

export async function runInteractive(
  options: InteractiveOptions = {},
  deps: InteractiveDeps = {},
): Promise<UpdateResult> {
  const home = deps.home ?? os.homedir();
  const prompts = deps.prompts ?? defaultPrompts;
  const kubeconfigPath = path.resolve(
    resolveHomePath(options.kubeconfig ?? defaultPaths(home).kubeconfig, home),
  );
  const profiles = await (deps.discoverProfiles ?? discoverAwsProfiles)({
    home,
    configPath: options.awsConfigPath,
    credentialsPath: options.awsCredentialsPath,
  });
  const profile = await promptForProfile(prompts, profiles);
  const source = await (deps.readFile ?? readFile)(kubeconfigPath, 'utf8');
  const detections = findSelectableEksContexts(parseKubeconfig(source));
  if (detections.length === 0) {
    throw new Error('No detectable EKS contexts found in kubeconfig');
  }

  const region = await promptForRegion(prompts, detections);
  const action = await prompts.select<InteractiveAction>({
    message: 'Choose action',
    choices: [{ name: 'Update existing EKS contexts', value: 'update-existing' }],
    default: 'update-existing',
  });

  if (action !== 'update-existing') {
    throw new Error(`Unsupported interactive action: ${action}`);
  }

  const selectableContexts = detections.filter((detection) => detection.region === region);
  if (selectableContexts.length === 0) {
    throw new Error(`No detectable EKS contexts found for region '${region}'`);
  }

  const selectedContexts = await prompts.checkbox<string>({
    message: 'Select EKS contexts to update',
    choices: selectableContexts.map((detection) => ({
      name: formatContextChoice(detection),
      value: detection.contextName,
      checked: true,
    })),
    required: true,
  });

  const applyMode = await promptForApplyMode(prompts, options.dryRun === true);
  const updateOptions: UpdateOptions = {
    kubeconfig: kubeconfigPath,
    context: selectedContexts,
    profile,
    region,
    helperPath: options.helperPath,
    cacheDir: options.cacheDir,
    backupDir: options.backupDir,
    safetyMargin: options.safetyMargin,
    cacheKey: options.cacheKey,
    backup: options.backup,
    dryRun: applyMode === 'dry-run',
    yes: applyMode === 'apply',
  };

  return (deps.runUpdate ?? runUpdate)(updateOptions);
}

export async function runInteractiveEntrypoint(
  deps: InteractiveEntrypointDeps = {},
): Promise<number> {
  const stdin = deps.stdin ?? process.stdin;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    stderr.write(
      'Interactive mode requires a TTY. Use an explicit non-interactive command such as `add-eks update --help`.\n',
    );
    return 1;
  }

  try {
    const result = await (deps.runInteractive ?? (() => runInteractive()))();
    (deps.writeResult ?? writeDefaultInteractiveResult)(result);
    return 0;
  } catch (error) {
    if (isPromptCancellation(error)) {
      stderr.write('Interactive setup canceled; no changes were made.\n');
      return 1;
    }

    throw error;
  }
}

const defaultPrompts: InteractivePromptFunctions = {
  select: (config) => select(config),
  checkbox: (config) => checkbox(config),
  input: (config) => input(config),
  confirm: (config) => confirm(config),
};

async function promptForProfile(
  prompts: InteractivePromptFunctions,
  profiles: string[],
): Promise<string> {
  if (profiles.length === 0) {
    return prompts.input({
      message: 'AWS profile',
      default: 'default',
      required: true,
      validate: (value) => value.trim() !== '' || 'Enter an AWS profile',
    });
  }

  return prompts.select<string>({
    message: 'Choose AWS profile',
    choices: profiles.map((profile) => ({ name: profile, value: profile })),
    default: profiles.includes('default') ? 'default' : profiles[0],
  });
}

async function promptForRegion(
  prompts: InteractivePromptFunctions,
  detections: EksContextDetection[],
): Promise<string> {
  const regions = [...new Set(detections.map((detection) => detection.region))]
    .filter((region): region is string => region !== undefined)
    .sort();
  return prompts.select<string>({
    message: 'Choose AWS region',
    choices: regions.map((region) => ({ name: region, value: region })),
    default: regions[0],
  });
}

async function promptForApplyMode(
  prompts: InteractivePromptFunctions,
  dryRunRequested: boolean,
): Promise<ApplyMode> {
  if (dryRunRequested) {
    return 'dry-run';
  }

  const apply = await prompts.confirm({
    message: 'Apply changes to kubeconfig?',
    default: false,
  });

  return apply ? 'apply' : 'dry-run';
}

function findSelectableEksContexts(config: Parameters<typeof findEksContexts>[0]): EksContextDetection[] {
  return findEksContexts(config).filter(
    (detection) => detection.cluster !== undefined && detection.region !== undefined,
  );
}

function formatContextChoice(detection: EksContextDetection): string {
  const cluster = detection.cluster === undefined ? 'unknown cluster' : detection.cluster;
  const region = detection.region === undefined ? 'unknown region' : detection.region;
  return `${detection.contextName} (${cluster}, ${region})`;
}

function writeDefaultInteractiveResult(result: UpdateResult): void {
  const prefix = result.dryRun ? 'Would update' : 'Updated';
  process.stdout.write(`${prefix} contexts: ${result.changedContexts.join(', ')}\n`);
  if (result.backupPath !== undefined) {
    process.stdout.write(`Backup: ${result.backupPath}\n`);
  }
}

function isPromptCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'ExitPromptError' ||
    error.name === 'AbortPromptError' ||
    error.message.includes('User force closed the prompt') ||
    error.message.includes('Prompt was canceled')
  );
}
