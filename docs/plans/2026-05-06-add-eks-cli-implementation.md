# add-eks CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `add-eks`, a Node.js setup CLI that installs a POSIX shell EKS token cache helper and safely patches kubeconfig entries.

**Architecture:** The Node.js CLI handles discovery, prompts, YAML patch planning, backups, cache management, and docs-friendly output. The kubectl runtime path is a standalone POSIX `sh` helper installed at `~/.kube/add-eks/add-eks-token`, so kubectl does not depend on Node.js after setup. The implementation starts with testable pure modules, then wires commands and interactive UX around them.

**Tech Stack:** TypeScript, Node.js ESM, `commander`, `@inquirer/prompts`, `yaml`, `picocolors`, `vitest`, `tsup`, POSIX `sh`.

---

## Task 1: Project Scaffold and Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Create: `tests/smoke.test.ts`

**Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "add-eks",
  "version": "0.1.0",
  "description": "Friendly EKS kubeconfig setup with cached token support.",
  "type": "module",
  "bin": {
    "add-eks": "./dist/cli.js"
  },
  "files": [
    "dist",
    "README.md",
    "README.ko.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@inquirer/prompts": "^7.0.0",
    "commander": "^14.0.0",
    "picocolors": "^1.1.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Add TypeScript and build configs**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "tests", "tsup.config.ts", "vitest.config.ts"]
}
```

Create `tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 3: Add minimal CLI and smoke test**

Create `src/index.ts`:

```ts
export const name = 'add-eks';
```

Create `src/cli.ts`:

```ts
import { Command } from 'commander';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('add-eks')
    .description('Friendly EKS kubeconfig setup with cached token support.')
    .version('0.1.0')
    .action(() => {
      program.outputHelp();
    });

  return program;
}

buildProgram().parseAsync(process.argv);
```

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { name } from '../src/index.js';

describe('package smoke test', () => {
  it('exports the package name', () => {
    expect(name).toBe('add-eks');
  });
});
```

**Step 4: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created.

**Step 5: Verify scaffold**

Run:

```sh
npm run typecheck
npm test
npm run build
node dist/cli.js --help
```

Expected: typecheck passes, tests pass, build emits `dist/cli.js`, help text prints.

**Step 6: Commit**

```sh
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore src tests
git commit -m "chore: scaffold TypeScript CLI"
```

## Task 2: Path and Option Resolution

**Files:**
- Create: `src/core/paths.ts`
- Create: `src/core/options.ts`
- Test: `tests/core/paths.test.ts`
- Test: `tests/core/options.test.ts`

**Step 1: Write path tests**

Create `tests/core/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveHomePath, defaultPaths } from '../../src/core/paths.js';

describe('resolveHomePath', () => {
  it('expands a leading tilde', () => {
    expect(resolveHomePath('~/.kube/config', '/home/alice')).toBe('/home/alice/.kube/config');
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolveHomePath('/tmp/kubeconfig', '/home/alice')).toBe('/tmp/kubeconfig');
  });
});

describe('defaultPaths', () => {
  it('places helper and cache below .kube/add-eks', () => {
    expect(defaultPaths('/home/alice')).toEqual({
      baseDir: '/home/alice/.kube/add-eks',
      helperPath: '/home/alice/.kube/add-eks/add-eks-token',
      cacheDir: '/home/alice/.kube/add-eks/cache',
      backupDir: '/home/alice/.kube/add-eks/backups',
      kubeconfig: '/home/alice/.kube/config',
      configPath: '/home/alice/.config/add-eks/config.yaml',
    });
  });
});
```

**Step 2: Implement paths**

Create `src/core/paths.ts`:

```ts
import path from 'node:path';

export function resolveHomePath(value: string, home = process.env.HOME ?? ''): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

export function defaultPaths(home = process.env.HOME ?? '') {
  const baseDir = path.join(home, '.kube', 'add-eks');

  return {
    baseDir,
    helperPath: path.join(baseDir, 'add-eks-token'),
    cacheDir: path.join(baseDir, 'cache'),
    backupDir: path.join(baseDir, 'backups'),
    kubeconfig: path.join(home, '.kube', 'config'),
    configPath: path.join(home, '.config', 'add-eks', 'config.yaml'),
  };
}
```

**Step 3: Write option resolution tests**

Create `tests/core/options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveRuntimeOptions } from '../../src/core/options.js';

describe('resolveRuntimeOptions', () => {
  it('uses defaults when flags are absent', () => {
    const result = resolveRuntimeOptions({}, '/home/alice');
    expect(result.safetyMargin).toBe(60);
    expect(result.cacheKey).toBe('cluster-region-profile');
    expect(result.helperPath).toBe('/home/alice/.kube/add-eks/add-eks-token');
  });

  it('lets flags override defaults', () => {
    const result = resolveRuntimeOptions({
      safetyMargin: '120',
      cacheDir: '~/cache',
      cacheKey: 'arn',
    }, '/home/alice');

    expect(result.safetyMargin).toBe(120);
    expect(result.cacheDir).toBe('/home/alice/cache');
    expect(result.cacheKey).toBe('arn');
  });
});
```

**Step 4: Implement option resolution**

Create `src/core/options.ts`:

```ts
import { defaultPaths, resolveHomePath } from './paths.js';

export type CacheKeyStrategy = 'cluster' | 'cluster-profile' | 'cluster-region-profile' | 'arn';

export interface RuntimeOptions {
  helperPath: string;
  cacheDir: string;
  backupDir: string;
  safetyMargin: number;
  cacheKey: CacheKeyStrategy;
}

export function resolveRuntimeOptions(flags: Record<string, unknown>, home = process.env.HOME ?? ''): RuntimeOptions {
  const paths = defaultPaths(home);

  return {
    helperPath: resolveHomePath(String(flags.helperPath ?? paths.helperPath), home),
    cacheDir: resolveHomePath(String(flags.cacheDir ?? paths.cacheDir), home),
    backupDir: resolveHomePath(String(flags.backupDir ?? paths.backupDir), home),
    safetyMargin: Number(flags.safetyMargin ?? 60),
    cacheKey: String(flags.cacheKey ?? 'cluster-region-profile') as CacheKeyStrategy,
  };
}
```

**Step 5: Verify**

Run: `npm test -- tests/core/paths.test.ts tests/core/options.test.ts`

Expected: tests pass.

**Step 6: Commit**

```sh
git add src/core tests/core
git commit -m "feat: resolve add-eks paths and runtime options"
```

## Task 3: Kubeconfig Parser and EKS Context Detection

**Files:**
- Create: `src/kubeconfig/types.ts`
- Create: `src/kubeconfig/parser.ts`
- Create: `src/kubeconfig/detect.ts`
- Create: `tests/fixtures/kubeconfig-aws-exec.yaml`
- Test: `tests/kubeconfig/detect.test.ts`

**Step 1: Add fixture**

Create `tests/fixtures/kubeconfig-aws-exec.yaml` with one EKS context whose user exec is `aws eks get-token`.

**Step 2: Write detection tests**

Create `tests/kubeconfig/detect.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseKubeconfig } from '../../src/kubeconfig/parser.js';
import { findEksContexts } from '../../src/kubeconfig/detect.js';

describe('findEksContexts', () => {
  it('detects contexts that use aws eks get-token', () => {
    const config = parseKubeconfig(readFileSync('tests/fixtures/kubeconfig-aws-exec.yaml', 'utf8'));
    const contexts = findEksContexts(config);

    expect(contexts).toEqual([
      expect.objectContaining({
        contextName: 'prod',
        clusterName: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
        userName: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
        cluster: 'prod',
        region: 'ap-northeast-2',
      }),
    ]);
  });
});
```

**Step 3: Implement parser and types**

Create minimal kubeconfig types in `src/kubeconfig/types.ts` and parse YAML with `yaml.parse` in `src/kubeconfig/parser.ts`.

**Step 4: Implement detection**

`findEksContexts` should join `contexts[].context.user`, `contexts[].context.cluster`, `users[].user.exec`, and `clusters[]`. Detect `aws eks get-token` first, then ARN names.

**Step 5: Verify**

Run: `npm test -- tests/kubeconfig/detect.test.ts`

Expected: tests pass.

**Step 6: Commit**

```sh
git add src/kubeconfig tests/fixtures tests/kubeconfig
git commit -m "feat: detect EKS kubeconfig contexts"
```

## Task 4: Patch Planner

**Files:**
- Create: `src/kubeconfig/patch.ts`
- Create: `tests/fixtures/kubeconfig-add-eks-patched.yaml`
- Test: `tests/kubeconfig/patch.test.ts`

**Step 1: Write patch tests**

Create tests that:

- patch one selected context,
- preserve context and cluster data,
- set `exec.command` to helper path,
- set `interactiveMode: Never`,
- include cluster, region, profile, cache dir, safety margin, and cache key args.

**Step 2: Implement patch planner**

Create a pure function:

```ts
export function planPatch(input: {
  config: Kubeconfig;
  contexts: string[];
  helperPath: string;
  cacheDir: string;
  safetyMargin: number;
  cacheKey: string;
  profile?: string;
}): { config: Kubeconfig; changedContexts: string[] };
```

The function should clone the config, modify selected `users[].user.exec`, and return changed context names.

**Step 3: Add YAML serialization**

Expose `stringifyKubeconfig(config)` from `parser.ts` using `yaml.stringify`.

**Step 4: Verify**

Run: `npm test -- tests/kubeconfig/patch.test.ts`

Expected: tests pass and fixture output is stable.

**Step 5: Commit**

```sh
git add src/kubeconfig tests/fixtures tests/kubeconfig
git commit -m "feat: plan kubeconfig helper patches"
```

## Task 5: Backup and Restore Utilities

**Files:**
- Create: `src/core/backup.ts`
- Test: `tests/core/backup.test.ts`

**Step 1: Write backup tests**

Use `mkdtemp` in the OS temp directory. Test that backup copies the kubeconfig, writes metadata JSON, and returns both paths.

**Step 2: Implement backup creation**

Create:

```ts
export async function createBackup(input: {
  kubeconfigPath: string;
  backupDir: string;
  operation: string;
  contexts: string[];
  helperPath: string;
  now?: Date;
}): Promise<{ backupPath: string; metadataPath: string }>;
```

Use `fs.promises.mkdir`, `copyFile`, and `writeFile`.

**Step 3: Implement full restore**

Create `restoreBackup({ backupPath, kubeconfigPath })` that copies backup contents over the kubeconfig path.

**Step 4: Verify**

Run: `npm test -- tests/core/backup.test.ts`

Expected: tests pass.

**Step 5: Commit**

```sh
git add src/core/backup.ts tests/core/backup.test.ts
git commit -m "feat: add kubeconfig backup utilities"
```

## Task 6: POSIX Shell Helper Template

**Files:**
- Create: `assets/add-eks-token.sh`
- Create: `src/helper/install.ts`
- Test: `tests/helper/install.test.ts`
- Create: `tests/helper/add-eks-token.integration.test.ts`

**Step 1: Write installer test**

Test that installing the helper writes the file, creates parent directories, and marks it executable.

**Step 2: Implement helper installer**

Create:

```ts
export async function installHelper(input: {
  sourcePath?: string;
  helperPath: string;
}): Promise<void>;
```

It reads `assets/add-eks-token.sh` and writes it to `helperPath` with mode `0755`.

**Step 3: Write helper integration tests**

Create a temporary fake `aws` executable earlier in PATH. It should print a valid `ExecCredential` JSON with a future `expirationTimestamp`.

Test:

- first helper run calls fake AWS and writes cache,
- second helper run returns cached JSON,
- debug logs go to stderr,
- stdout remains JSON.

**Step 4: Implement shell helper**

The helper must:

- parse `--cluster`, `--region`, `--profile`, `--cache-dir`, `--safety-margin`, `--cache-key`,
- build a safe cache filename,
- check cached `expirationTimestamp`,
- call `aws eks get-token` on cache miss,
- write cache via temp file and `mv`,
- emit only JSON to stdout.

Keep timestamp validation conservative. If parsing is uncertain, treat cache as expired.

**Step 5: Verify**

Run:

```sh
npm test -- tests/helper/install.test.ts tests/helper/add-eks-token.integration.test.ts
```

Expected: tests pass on macOS and Linux.

**Step 6: Commit**

```sh
git add assets src/helper tests/helper
git commit -m "feat: install POSIX token cache helper"
```

## Task 7: Non-Interactive `update` Command

**Files:**
- Modify: `src/cli.ts`
- Create: `src/commands/update.ts`
- Create: `src/core/file.ts`
- Test: `tests/commands/update.test.ts`

**Step 1: Write command tests**

Call the command handler directly with temp kubeconfig fixtures. Test:

- `--context prod --profile prod --yes` patches one context,
- `--all --profile prod --yes` patches all detected EKS contexts,
- backup is created by default,
- `--dry-run` returns planned output without writing files.

**Step 2: Implement safe file write**

Create `writeFileAtomic(path, contents)` using a same-directory temp file and rename.

**Step 3: Implement update handler**

The handler should:

1. resolve paths and runtime options,
2. read kubeconfig,
3. detect EKS contexts,
4. select contexts from flags,
5. require `--yes` when non-interactive writes are planned,
6. install helper,
7. create backup unless `--no-backup`,
8. write patched kubeconfig atomically.

**Step 4: Wire commander command**

Add `update` with the core flags from the design.

**Step 5: Verify**

Run:

```sh
npm test -- tests/commands/update.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

**Step 6: Commit**

```sh
git add src/cli.ts src/commands src/core tests/commands
git commit -m "feat: add non-interactive update command"
```

## Task 8: Cache Commands

**Files:**
- Create: `src/commands/cache.ts`
- Create: `src/core/cache.ts`
- Test: `tests/commands/cache.test.ts`
- Modify: `src/cli.ts`

**Step 1: Write cache tests**

Test cache list, status, and clear using temp cache directories and sample JSON files.

**Step 2: Implement cache utilities**

Implement:

```ts
listCacheEntries(cacheDir)
clearCacheEntries(cacheDir, filter)
readCacheStatus(cacheDir)
```

**Step 3: Wire commands**

Add:

```sh
add-eks cache list
add-eks cache status
add-eks cache clear --yes
```

Support `--json`, `--cluster`, `--region`, and `--profile` filters where practical.

**Step 4: Verify**

Run: `npm test -- tests/commands/cache.test.ts`

Expected: tests pass.

**Step 5: Commit**

```sh
git add src/commands/cache.ts src/core/cache.ts tests/commands/cache.test.ts src/cli.ts
git commit -m "feat: add cache management commands"
```

## Task 9: Revert and Restore Commands

**Files:**
- Create: `src/commands/revert.ts`
- Create: `src/commands/restore.ts`
- Modify: `src/kubeconfig/patch.ts`
- Test: `tests/commands/revert.test.ts`
- Test: `tests/commands/restore.test.ts`
- Modify: `src/cli.ts`

**Step 1: Write revert tests**

Use a patched kubeconfig fixture. Verify `revert --context prod --yes` changes helper exec back to:

```yaml
command: aws
args:
  - eks
  - get-token
  - --cluster-name
  - prod
  - --region
  - ap-northeast-2
  - --profile
  - prod
interactiveMode: Never
```

**Step 2: Implement revert planner**

Add a pure planner that recognizes add-eks helper exec entries and reconstructs standard AWS exec args from stored helper args.

**Step 3: Write restore tests**

Verify `restore --backup path --kubeconfig path --yes` copies backup contents over kubeconfig.

**Step 4: Implement commands**

Wire `revert` and `restore`. Require confirmation or `--yes` for writes.

**Step 5: Verify**

Run:

```sh
npm test -- tests/commands/revert.test.ts tests/commands/restore.test.ts
```

Expected: tests pass.

**Step 6: Commit**

```sh
git add src/commands src/kubeconfig tests/commands src/cli.ts
git commit -m "feat: add revert and restore commands"
```

## Task 10: Interactive Flow

**Files:**
- Create: `src/commands/interactive.ts`
- Create: `src/aws/profiles.ts`
- Create: `src/aws/eks.ts`
- Modify: `src/cli.ts`
- Test: `tests/aws/profiles.test.ts`

**Step 1: Write profile discovery tests**

Use temp AWS config and credentials files. Verify profile names are discovered from both files.

**Step 2: Implement AWS profile discovery**

Parse profile names from:

- `~/.aws/config` sections like `[profile prod]`,
- `~/.aws/credentials` sections like `[prod]`.

**Step 3: Implement EKS list wrapper**

Create a small command runner around:

```sh
aws eks list-clusters --region <region> --profile <profile> --output json
```

Keep it injectable for tests.

**Step 4: Implement interactive entry**

Use `@inquirer/prompts` for select, checkbox, confirm, and input. The interactive update path should reuse the same command handler as non-interactive update after collecting options.

**Step 5: Wire default action**

`add-eks` with no subcommand should call `runInteractive`.

**Step 6: Verify manually**

Run:

```sh
npm run dev
```

Expected: prompts render. Do not require live AWS credentials to complete all tests.

**Step 7: Commit**

```sh
git add src/commands/interactive.ts src/aws tests/aws src/cli.ts
git commit -m "feat: add interactive setup flow"
```

## Task 11: Doctor and Completion

**Files:**
- Create: `src/commands/doctor.ts`
- Create: `src/commands/completion.ts`
- Test: `tests/commands/doctor.test.ts`
- Modify: `src/cli.ts`

**Step 1: Write doctor tests**

Inject command availability checks. Verify doctor reports:

- Node setup CLI version,
- AWS CLI availability,
- kubectl availability,
- helper install status,
- cache directory status,
- kubeconfig readability.

**Step 2: Implement doctor**

Use `child_process.spawn` or `execFile` with timeouts for command checks.

**Step 3: Implement completion**

Start with shell completion output for bash and zsh. Keep it simple and documented.

**Step 4: Verify**

Run:

```sh
npm test -- tests/commands/doctor.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

**Step 5: Commit**

```sh
git add src/commands/doctor.ts src/commands/completion.ts tests/commands/doctor.test.ts src/cli.ts
git commit -m "feat: add doctor and completion commands"
```

## Task 12: Documentation and Contribution Guide

**Files:**
- Create: `README.md`
- Create: `README.ko.md`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `docs/examples/non-interactive.md`

**Step 1: Write English README**

Cover:

- what `add-eks` does,
- why runtime does not depend on Node.js,
- `npx add-eks` and `bunx add-eks`,
- interactive flow,
- non-interactive examples,
- updating existing kubeconfig,
- backup, revert, restore,
- cache commands,
- security model,
- troubleshooting.

**Step 2: Write Korean README**

Mirror the English README in Korean. Keep examples identical.

**Step 3: Write contribution guide**

Include:

- setup,
- test commands,
- commit style,
- small PR expectations,
- no live AWS tests in default CI,
- how to add fixtures.

**Step 4: Add code of conduct**

Use a concise contributor covenant style document.

**Step 5: Verify docs**

Run:

```sh
npm run build
npm test
npm run typecheck
```

Expected: all pass.

**Step 6: Commit**

```sh
git add README.md README.ko.md CONTRIBUTING.md CODE_OF_CONDUCT.md docs/examples
git commit -m "docs: add usage and contribution guides"
```

## Task 13: Final Verification

**Files:**
- Modify only if verification reveals issues.

**Step 1: Run full checks**

```sh
npm run typecheck
npm test
npm run build
node dist/cli.js --help
node dist/cli.js update --help
node dist/cli.js cache --help
```

Expected: all commands succeed.

**Step 2: Run local helper smoke test**

Use the fake AWS integration test command:

```sh
npm test -- tests/helper/add-eks-token.integration.test.ts
```

Expected: cache miss then cache hit behavior passes.

**Step 3: Inspect git history**

```sh
git log --oneline --decorate -10
git status --short
```

Expected: clean working tree and focused commits.

**Step 4: Commit any verification fixes**

Only if needed:

```sh
git add <changed-files>
git commit -m "fix: address final verification issues"
```

## Execution Notes

- Do not introduce runtime dependencies in `assets/add-eks-token.sh` beyond POSIX shell, AWS CLI, and common base utilities.
- Keep all CLI command handlers testable without live AWS credentials.
- Keep stdout machine-readable when `--json` is used.
- Treat kubeconfig writes as sensitive: backup first, write atomically, and preserve unrelated fields.
- GIF demo remains out of scope for the initial implementation.
