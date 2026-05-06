import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { listEksClusters } from '../aws/eks.js';
import { discoverAwsProfiles } from '../aws/profiles.js';
import { defaultPaths, resolveHomePath } from '../core/paths.js';
import { findEksContexts } from '../kubeconfig/detect.js';
import { parseKubeconfig } from '../kubeconfig/parser.js';

const execFileAsync = promisify(execFile);
const COMPLETION_AWS_TIMEOUT_MS = 1_500;

export type CompletionShell = 'bash' | 'zsh' | 'fish';
export type CompletionKind = 'profiles' | 'contexts' | 'eks-contexts' | 'regions' | 'clusters';

export interface CompletionOptions {
  binaryName?: string;
}

export interface CompletionArgs {
  profile?: string;
  region?: string;
  kubeconfig?: string;
}

export interface CompletionDeps {
  home?: string;
  discoverProfiles?: () => Promise<string[]>;
  readKubeconfig?: (kubeconfigPath: string) => Promise<string>;
  listClusters?: (input: { profile: string; region: string }) => Promise<string[]>;
}

const CORE_COMMANDS = [
  'update',
  'revert',
  'restore',
  'cache',
  'doctor',
  'completion',
];
const CACHE_COMMANDS = ['list', 'status', 'clear'];
const GLOBAL_FLAGS = ['--help', '--version'];
const UPDATE_FLAGS = [
  '--kubeconfig',
  '--context',
  '--all',
  '--profile',
  '--helper-path',
  '--cache-dir',
  '--safety-margin',
  '--cache-key',
  '--backup',
  '--no-backup',
  '--backup-dir',
  '--yes',
  '--dry-run',
  '--json',
];
const REVERT_FLAGS = [
  '--kubeconfig',
  '--context',
  '--all',
  '--backup',
  '--no-backup',
  '--backup-dir',
  '--yes',
  '--dry-run',
  '--json',
];
const RESTORE_FLAGS = ['--backup', '--kubeconfig', '--yes', '--json'];
const CACHE_FLAGS = ['--cache-dir', '--cluster', '--region', '--profile', '--yes', '--dry-run', '--json'];
const DOCTOR_FLAGS = ['--kubeconfig', '--helper-path', '--cache-dir', '--json'];
const COMPLETION_SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish'];
const COMMON_AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ca-central-1',
  'ca-west-1',
  'eu-central-1',
  'eu-central-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-south-1',
  'eu-south-2',
  'eu-north-1',
  'il-central-1',
  'me-central-1',
  'me-south-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1',
];

export function generateCompletionScript(
  shell: CompletionShell,
  options: CompletionOptions = {},
): string {
  const binaryName = options.binaryName ?? 'add-eks';

  if (shell === 'bash') {
    return generateBashCompletion(binaryName);
  }

  if (shell === 'zsh') {
    return generateZshCompletion(binaryName);
  }

  return generateFishCompletion(binaryName);
}

export async function completeCandidates(
  kind: CompletionKind,
  args: CompletionArgs,
  deps: CompletionDeps = {},
): Promise<string[]> {
  try {
    switch (kind) {
      case 'profiles':
        return sortUnique(await (deps.discoverProfiles ?? (() => discoverAwsProfiles({ home: deps.home })))());
      case 'contexts':
        return sortUnique((await readCompletionKubeconfig(args, deps)).contexts);
      case 'eks-contexts':
        return sortUnique((await readCompletionKubeconfig(args, deps)).eksContexts);
      case 'regions':
        return await completeRegions(args, deps);
      case 'clusters':
        return await completeClusters(args, deps);
    }
  } catch {
    return [];
  }
}

export function parseCompletionArgs(values: string[]): CompletionArgs {
  const args: CompletionArgs = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      continue;
    }

    const [flag, inlineValue] = value.split('=', 2);
    const candidateValue = inlineValue ?? values[index + 1];
    const nextValue =
      candidateValue === undefined || candidateValue.startsWith('--') ? undefined : candidateValue;
    if (inlineValue === undefined && nextValue !== undefined) {
      index += 1;
    }

    if (flag === '--profile' && nextValue !== undefined) {
      args.profile = nextValue;
    } else if (flag === '--region' && nextValue !== undefined) {
      args.region = nextValue;
    } else if (flag === '--kubeconfig' && nextValue !== undefined) {
      args.kubeconfig = nextValue;
    }
  }

  return args;
}

async function completeClusters(
  args: CompletionArgs,
  deps: CompletionDeps,
): Promise<string[]> {
  if (args.profile === undefined || args.region === undefined) {
    return [];
  }

  return sortUnique(
    await (deps.listClusters ?? listClustersForCompletion)({
      profile: args.profile,
      region: args.region,
    }),
  );
}

async function listClustersForCompletion(input: {
  profile: string;
  region: string;
}): Promise<string[]> {
  return listEksClusters({
    ...input,
    runner: async (command, args) => {
      const result = await execFileAsync(command, args, {
        encoding: 'utf8',
        timeout: COMPLETION_AWS_TIMEOUT_MS,
        env: {
          ...process.env,
          AWS_EC2_METADATA_DISABLED: 'true',
          AWS_PAGER: '',
        },
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  });
}

async function completeRegions(
  args: CompletionArgs,
  deps: CompletionDeps,
): Promise<string[]> {
  try {
    return completionRegions(await readCompletionKubeconfig(args, deps));
  } catch {
    return completionRegions({
      contexts: [],
      eksContexts: [],
      regions: [],
    });
  }
}

interface KubeconfigCompletionData {
  contexts: string[];
  eksContexts: string[];
  regions: string[];
}

async function readCompletionKubeconfig(
  args: CompletionArgs,
  deps: CompletionDeps,
): Promise<KubeconfigCompletionData> {
  const home = deps.home ?? os.homedir();
  const kubeconfigPath = path.resolve(resolveHomePath(args.kubeconfig ?? defaultPaths(home).kubeconfig, home));
  const source = await (deps.readKubeconfig ?? ((filePath) => readFile(filePath, 'utf8')))(kubeconfigPath);
  const config = parseKubeconfig(source);
  const detections = findEksContexts(config);

  return {
    contexts: (config.contexts ?? []).map((context) => context.name),
    eksContexts: detections.map((detection) => detection.contextName),
    regions: detections.flatMap((detection) => detection.region ?? []),
  };
}

function completionRegions(data: KubeconfigCompletionData): string[] {
  const detected = sortUnique(data.regions);
  const common = COMMON_AWS_REGIONS.filter((region) => !detected.includes(region));
  return [...detected, ...common];
}

function generateBashCompletion(binaryName: string): string {
  return `# bash completion for ${binaryName}
# commands: cache ${CACHE_COMMANDS.join(' ')}
_${binaryName.replace(/[^A-Za-z0-9_]/g, '_')}()
{
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words=("\${COMP_WORDS[@]}")
  cword=$COMP_CWORD

  case "$prev" in
    --profile) COMPREPLY=( $(compgen -W "$(${binaryName} __complete profiles "\${words[@]}")" -- "$cur") ); return ;;
    --context) COMPREPLY=( $(compgen -W "$(${binaryName} __complete eks-contexts "\${words[@]}") $(${binaryName} __complete contexts "\${words[@]}")" -- "$cur") ); return ;;
    --region) COMPREPLY=( $(compgen -W "$(${binaryName} __complete regions "\${words[@]}")" -- "$cur") ); return ;;
    --cluster) COMPREPLY=( $(compgen -W "$(${binaryName} __complete clusters "\${words[@]}")" -- "$cur") ); return ;;
  esac

  case "\${words[1]}" in
    cache)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "${CACHE_COMMANDS.join(' ')}" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "${CACHE_FLAGS.join(' ')}" -- "$cur") )
      fi
      ;;
    update)
      COMPREPLY=( $(compgen -W "${UPDATE_FLAGS.join(' ')}" -- "$cur") )
      ;;
    revert)
      COMPREPLY=( $(compgen -W "${REVERT_FLAGS.join(' ')}" -- "$cur") )
      ;;
    restore)
      COMPREPLY=( $(compgen -W "${RESTORE_FLAGS.join(' ')}" -- "$cur") )
      ;;
    doctor)
      COMPREPLY=( $(compgen -W "${DOCTOR_FLAGS.join(' ')}" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${COMPLETION_SHELLS.join(' ')}" -- "$cur") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "${[...CORE_COMMANDS, ...GLOBAL_FLAGS].join(' ')}" -- "$cur") )
      ;;
  esac
}
complete -F _${binaryName.replace(/[^A-Za-z0-9_]/g, '_')} ${binaryName}
`;
}

function generateZshCompletion(binaryName: string): string {
  return `#compdef ${binaryName}
_${binaryName.replace(/[^A-Za-z0-9_]/g, '_')}() {
  local -a commands cache_commands flags
  commands=(${CORE_COMMANDS.join(' ')})
  cache_commands=(${CACHE_COMMANDS.join(' ')})

  case "$words[CURRENT-1]" in
    --profile) compadd -- \${(f)"$(${binaryName} __complete profiles "$words[@]")"}; return ;;
    --context) compadd -- \${(f)"$(${binaryName} __complete eks-contexts "$words[@]")"} \${(f)"$(${binaryName} __complete contexts "$words[@]")"}; return ;;
    --region) compadd -- \${(f)"$(${binaryName} __complete regions "$words[@]")"}; return ;;
    --cluster) compadd -- \${(f)"$(${binaryName} __complete clusters "$words[@]")"}; return ;;
  esac

  case "$words[2]" in
    cache)
      if (( CURRENT == 3 )); then
        compadd -- $cache_commands
      else
        compadd -- ${CACHE_FLAGS.join(' ')}
      fi
      ;;
    update) compadd -- ${UPDATE_FLAGS.join(' ')} ;;
    revert) compadd -- ${REVERT_FLAGS.join(' ')} ;;
    restore) compadd -- ${RESTORE_FLAGS.join(' ')} ;;
    doctor) compadd -- ${DOCTOR_FLAGS.join(' ')} ;;
    completion) compadd -- ${COMPLETION_SHELLS.join(' ')} ;;
    *) compadd -- $commands ${GLOBAL_FLAGS.join(' ')} ;;
  esac
}
_${binaryName.replace(/[^A-Za-z0-9_]/g, '_')} "$@"
`;
}

function generateFishCompletion(binaryName: string): string {
  return `# fish completion for ${binaryName}
complete -c ${binaryName} -f -n "__fish_use_subcommand" -a "${CORE_COMMANDS.join(' ')}"
complete -c ${binaryName} -f -n "__fish_seen_subcommand_from cache" -a "${CACHE_COMMANDS.join(' ')}"
complete -c ${binaryName} -f -n "__fish_seen_subcommand_from completion" -a "${COMPLETION_SHELLS.join(' ')}"
complete -c ${binaryName} -f -l profile -a "(${binaryName} __complete profiles (commandline -opc))"
complete -c ${binaryName} -f -l context -a "(${binaryName} __complete contexts (commandline -opc))"
complete -c ${binaryName} -f -l region -a "(${binaryName} __complete regions (commandline -opc))"
complete -c ${binaryName} -f -l cluster -a "(${binaryName} __complete clusters (commandline -opc))"
${[...new Set([...UPDATE_FLAGS, ...REVERT_FLAGS, ...RESTORE_FLAGS, ...CACHE_FLAGS, ...DOCTOR_FLAGS])]
  .map((flag) => `complete -c ${binaryName} -l ${flag.slice(2)}`)
  .join('\n')}
`;
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
