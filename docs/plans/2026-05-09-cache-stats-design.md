# Cache Stats Design

## Goal

Add lightweight cache statistics that show how much time `add-eks` saved by avoiding repeated `aws eks get-token` calls. The output should keep exact numbers visible, then translate saved time into playful real-world units.

## Runtime Constraints

The kubectl exec path must remain quiet and reliable:

- stdout remains only the Kubernetes `ExecCredential` JSON.
- stats writes are best-effort and must not fail kubectl.
- the helper stays POSIX `sh`; no Node, jq, Python, or extra runtime dependency.
- stats storage must not grow without bound.

## Storage

Use one bounded aggregate file in the cache directory:

```text
~/.kube/add-eks/cache/.add-eks-stats.json
```

The helper updates totals on cache hit and miss:

- `hits`
- `misses`
- `awsCalls`
- `estimatedSavedMs`
- `actualAwsMsTotal`
- compact `byCluster` buckets
- capped `recent` events for streaks and diagnostics

No append-only event log is used. `recent` is capped at 50 entries, and `byCluster` is capped at 50 buckets by last-seen time. If the stats file is malformed, move it aside as `.broken.<timestamp>` and start a new file.

## Saved Time Calculation

Use measured values first:

- On miss, measure the actual `aws eks get-token` duration.
- On hit, estimate saved time using the recent measured average AWS call time.
- If there is no measured data yet, use a conservative fallback of 2000 ms per hit.

This keeps early output useful while becoming more accurate as the user keeps using the tool.

## CLI Surface

Add:

```bash
add-eks stats
add-eks stats --json
add-eks stats clear --yes
```

Keep `add-eks cache status` focused, but add a short pointer:

```text
Stats: 38 hits, about 4m 12s saved. Run `add-eks stats` for details.
```

## Human Output

Show exact numbers first:

```text
Time saved: 4m 12s
Cache hits: 38
AWS token calls avoided: 38
AWS token calls made: 5
Average token call: 6.6s
Best hit streak: 14
Top cluster: prod-apne1
```

Then show a small "other units" section. Pick units based on duration size:

- small durations: instant ramen timers, songs, loading spinners, short CI waits
- medium durations: CI runs, PR reviews, power naps, docs reading
- large durations: workdays, book pages, side-project evenings, sleep cycles

Example:

```text
In other units:
- 1.4 instant ramen timers
- 1 CI run you did not have to stare at
- 70 lines of docs you could have read

kubectl quietly handed you 4m 12s back.
```

## Testing

Cover:

- helper records hit and miss totals without changing stdout.
- helper records measured AWS duration on miss.
- stats updates survive missing or malformed stats files.
- bounded storage keeps `recent` and `byCluster` under limits.
- `add-eks stats` human and JSON output.
- `add-eks stats clear --yes` safety guard.
- `cache status` includes the short stats pointer.
