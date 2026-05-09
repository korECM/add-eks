# Cache Stats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track cache hit/miss savings and show exact plus playful saved-time statistics.

**Architecture:** The POSIX helper updates a bounded `.add-eks-stats.json` aggregate in the cache directory on hit and miss. Node CLI code reads, summarizes, clears, and formats that stats file; `cache status` only prints a short pointer. Runtime stats writes are best-effort so kubectl stdout and token flow stay safe.

**Tech Stack:** TypeScript, Commander, Vitest, POSIX `sh`, Node `fs/promises`.

---

### Task 1: Add Core Stats Reader and Formatter

**Files:**
- Create: `src/core/stats.ts`
- Test: `tests/core/stats.test.ts`

**Step 1: Write the failing tests**

Create `tests/core/stats.test.ts` with tests for:

```ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clearStats,
  formatDuration,
  readStats,
  summarizeStats,
  statsPathForCacheDir,
} from '../../src/core/stats.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'add-eks-stats-'));
}

describe('stats core utilities', () => {
  it('treats missing stats as empty', async () => {
    const cacheDir = await tempDir();
    await expect(readStats(cacheDir)).resolves.toMatchObject({
      totals: {
        hits: 0,
        misses: 0,
        awsCalls: 0,
        estimatedSavedMs: 0,
        actualAwsMsTotal: 0,
      },
    });
  });

  it('summarizes exact totals and average aws duration', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      statsPathForCacheDir(cacheDir),
      JSON.stringify({
        schemaVersion: 1,
        totals: {
          hits: 38,
          misses: 5,
          awsCalls: 5,
          estimatedSavedMs: 252000,
          actualAwsMsTotal: 33000,
        },
        byCluster: {
          prod: { hits: 20, misses: 2, estimatedSavedMs: 132000, lastSeen: '2026-05-09T00:00:00Z' },
        },
        recent: [{ type: 'hit', at: '2026-05-09T00:00:00Z', estimatedSavedMs: 6600 }],
      }),
      'utf8',
    );

    expect(summarizeStats(await readStats(cacheDir))).toMatchObject({
      hits: 38,
      misses: 5,
      awsCalls: 5,
      estimatedSavedMs: 252000,
      averageAwsMs: 6600,
      topCluster: 'prod',
    });
  });

  it('moves malformed stats aside and starts fresh', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    const statsPath = statsPathForCacheDir(cacheDir);
    await writeFile(statsPath, '{broken', 'utf8');

    const stats = await readStats(cacheDir);
    expect(stats.totals.hits).toBe(0);
    await expect(readFile(statsPath, 'utf8')).resolves.toContain('"schemaVersion"');
  });

  it('formats compact durations', () => {
    expect(formatDuration(252000)).toBe('4m 12s');
    expect(formatDuration(6600)).toBe('6.6s');
    expect(formatDuration(3_726_000)).toBe('1h 2m 6s');
  });

  it('clears stats only when confirmed by caller', async () => {
    const cacheDir = await tempDir();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(statsPathForCacheDir(cacheDir), '{"schemaVersion":1}', 'utf8');
    await expect(clearStats(cacheDir)).resolves.toEqual({ deleted: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/core/stats.test.ts
```

Expected: FAIL because `src/core/stats.ts` does not exist.

**Step 3: Write minimal implementation**

Create `src/core/stats.ts` with:

- `statsPathForCacheDir(cacheDir)`
- `emptyStats()`
- `readStats(cacheDir)`
- `summarizeStats(stats)`
- `formatDuration(ms)`
- `clearStats(cacheDir)`

Keep parsing strict enough to avoid crashes, but tolerant of missing fields by falling back to zero.

**Step 4: Run tests**

Run:

```bash
npm test -- tests/core/stats.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/stats.ts tests/core/stats.test.ts
git commit -m "feat: add cache stats core"
```

---

### Task 2: Add `add-eks stats` CLI

**Files:**
- Modify: `src/cli.ts`
- Create: `src/commands/stats.ts`
- Test: `tests/commands/stats.test.ts`
- Modify: `tests/smoke.test.ts`
- Modify: `tests/commands/completion.test.ts`

**Step 1: Write failing command tests**

Create tests for:

- `runStatsShow({ cacheDir })` returns summary and comparison lines.
- `runStatsClear({ cacheDir })` throws unless `--yes`.
- `runStatsClear({ cacheDir, yes: true })` clears stats.

Expected API:

```ts
const result = await runStatsShow({ cacheDir }, { home: root });
expect(result.summary.estimatedSavedMs).toBe(252000);
expect(result.comparisons.length).toBeGreaterThan(0);
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/commands/stats.test.ts
```

Expected: FAIL because command module is missing.

**Step 3: Implement command handler**

Create `src/commands/stats.ts`:

- resolve cache dir via `defaultPaths(home).cacheDir`
- return `{ cacheDir, stats, summary, comparisons }`
- require `--yes` for clear

Add Commander surface:

```bash
add-eks stats
add-eks stats --json
add-eks stats clear --yes
```

Human output should print exact numbers first, then:

```text
In other units:
- ...

kubectl quietly handed you 4m 12s back.
```

**Step 4: Run tests**

```bash
npm test -- tests/commands/stats.test.ts tests/smoke.test.ts tests/commands/completion.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/commands/stats.ts tests/commands/stats.test.ts tests/smoke.test.ts tests/commands/completion.test.ts
git commit -m "feat: add stats command"
```

---

### Task 3: Add Saved-Time Comparison Engine

**Files:**
- Modify: `src/core/stats.ts`
- Test: `tests/core/stats.test.ts`

**Step 1: Write failing tests**

Add tests for:

- small durations include ramen/song/loading-spinner style comparisons.
- medium durations include CI/PR review/power nap style comparisons.
- large durations include workday/book/side-project style comparisons.
- output is deterministic, not random.

Example:

```ts
expect(buildTimeComparisons(252000).map((item) => item.label)).toContain(
  'instant ramen timers',
);
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/core/stats.test.ts
```

Expected: FAIL because `buildTimeComparisons` is missing.

**Step 3: Implement comparisons**

Use fixed unit definitions:

- instant ramen timer: 180000 ms
- song: 210000 ms
- loading spinner: 45000 ms
- CI stare: 240000 ms
- PR review: 900000 ms
- power nap: 1200000 ms
- docs lines: 3600 ms per line
- workday: 28800000 ms
- technical book page: 90000 ms
- side-project evening: 10800000 ms

Return 2-3 comparisons based on saved-time bucket. Avoid zero-value comparisons; use one decimal where helpful.

**Step 4: Run tests**

```bash
npm test -- tests/core/stats.test.ts tests/commands/stats.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/stats.ts tests/core/stats.test.ts tests/commands/stats.test.ts
git commit -m "feat: translate saved time into playful units"
```

---

### Task 4: Teach POSIX Helper to Update Stats

**Files:**
- Modify: `assets/add-eks-token.sh`
- Test: `tests/helper/add-eks-token.integration.test.ts`

**Step 1: Write failing integration tests**

Add tests for:

- first helper run records miss/aws call duration.
- second helper run records hit and estimated saved time.
- stdout remains exactly ExecCredential JSON.
- malformed stats file is moved aside and recreated.
- repeated calls keep `recent` capped at 50.

Use existing helper fixture patterns in `tests/helper/add-eks-token.integration.test.ts`.

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/helper/add-eks-token.integration.test.ts
```

Expected: FAIL because helper does not write `.add-eks-stats.json`.

**Step 3: Implement helper stats**

Add POSIX-safe helpers to `assets/add-eks-token.sh`:

- `now_ms` using `date +%s` plus best available nanosecond/millisecond support; fall back to seconds.
- `stats_file=$cache_dir/.add-eks-stats.json`
- `record_stats_hit`
- `record_stats_miss`

Because POSIX shell cannot safely edit complex JSON, keep the stats schema intentionally simple and write via an atomic temp file. A small awk/sed parser may read known numeric keys from the current JSON. On malformed or missing values, start from empty stats. Use best-effort wrapping:

```sh
record_stats_hit "$cache_file" "$estimated_ms" || debug 'failed to record stats hit'
```

Never call `fatal` from stats functions.

**Step 4: Run tests**

```bash
npm test -- tests/helper/add-eks-token.integration.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add assets/add-eks-token.sh tests/helper/add-eks-token.integration.test.ts
git commit -m "feat: record cache stats from helper"
```

---

### Task 5: Add Cache Status Pointer

**Files:**
- Modify: `src/commands/cache.ts`
- Modify: `src/cli.ts`
- Test: `tests/commands/cache.test.ts`

**Step 1: Write failing tests**

Add test that `runCacheStatus` includes stats summary when stats exists:

```ts
await expect(runCacheStatus({ cacheDir }, { home: root })).resolves.toMatchObject({
  stats: {
    hits: 38,
    estimatedSavedMs: 252000,
  },
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/commands/cache.test.ts
```

Expected: FAIL because status has no stats field.

**Step 3: Implement pointer**

Have `runCacheStatus` read stats summary and include a compact optional field. In `src/cli.ts`, print:

```text
Stats: 38 hits, about 4m 12s saved. Run `add-eks stats` for details.
```

Only print if hits or saved time are non-zero.

**Step 4: Run tests**

```bash
npm test -- tests/commands/cache.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/commands/cache.ts src/cli.ts tests/commands/cache.test.ts
git commit -m "feat: show cache stats pointer"
```

---

### Task 6: Document Stats

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `CONTRIBUTING.md` if release checklist needs stats mention

**Step 1: Add docs**

Document:

- `add-eks stats`
- `add-eks stats --json`
- `add-eks stats clear --yes`
- stats file is bounded and best-effort
- no stdout pollution in kubectl runtime

**Step 2: Run docs-adjacent smoke**

```bash
npm test -- tests/smoke.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add README.md README.ko.md CONTRIBUTING.md
git commit -m "docs: explain cache stats"
```

---

### Task 7: Final Verification and Release Prep

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Run full verification**

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected:

- typecheck exits 0
- all tests pass
- build exits 0
- tarball includes `assets/add-eks-token.sh`, `dist`, README files, and package metadata

**Step 2: Bump patch version**

```bash
npm version patch
```

Expected: new version commit and tag.

**Step 3: Publish**

```bash
npm publish --access=public
```

If npm requires 2FA, the package owner must complete auth or provide OTP.

**Step 4: Push**

```bash
git push --follow-tags
```

If the patch tag is lightweight, push it explicitly:

```bash
git push origin vX.Y.Z
```
