# add-eks

Friendly EKS kubeconfig setup with fast cached token support.

`add-eks` helps you register or update EKS kubeconfig entries so `kubectl` can reuse cached EKS tokens instead of calling `aws eks get-token` every time. The setup experience is a Node.js CLI, but the kubectl runtime path is a small POSIX `sh` helper, so Node.js is not required after setup.

## Highlights

- **Faster kubectl startup**: cache EKS `ExecCredential` JSON until shortly before `expirationTimestamp`.
- **Time-saved stats**: track cache hits, avoided AWS token calls, and playful "other units" for the time you got back.
- **Node-free kubectl runtime**: the installed helper uses POSIX `sh` and AWS CLI, not Node.js, npx, bun, jq, or Python.
- **Interactive and scriptable**: run a guided flow or fully non-interactive commands with flags.
- **Patch existing kubeconfigs**: update current EKS contexts without recreating your whole kubeconfig.
- **Safe by default**: backup before writes, atomic writes where practical, `--yes` required for non-interactive changes.
- **Easy rollback**: revert add-eks patched contexts back to `aws eks get-token`, or restore a full backup.
- **Useful completion**: bash, zsh, and fish completion with dynamic candidates for profiles, contexts, regions, and clusters.

## Quick Start

```sh
npx @eatingcookieman/add-eks
```

After the first setup, the installed binary command is still `add-eks`:

```sh
add-eks doctor
```

For non-interactive use:

```sh
npx @eatingcookieman/add-eks update --context prod --profile prod --yes
npx @eatingcookieman/add-eks update --current --profile prod --yes
npx @eatingcookieman/add-eks update --all --profile prod --yes
```

## How It Works

EKS kubeconfigs usually use an exec credential command similar to:

```sh
aws eks get-token --cluster-name prod --region ap-northeast-2
```

That call can happen often during normal kubectl usage. `add-eks` patches the kubeconfig exec command to call:

```text
~/.kube/add-eks/add-eks-token
```

The helper stores token responses in:

```text
~/.kube/add-eks/cache
```

When the cached `expirationTimestamp` is still valid, the helper prints the cached `ExecCredential` JSON. When it is expired or close to expiry, the helper calls AWS CLI again and atomically refreshes the cache.

## Runtime Model

| Phase | Requirement |
| --- | --- |
| Setup | Node.js via `npx @eatingcookieman/add-eks` or `bunx @eatingcookieman/add-eks` |
| kubectl runtime | POSIX `sh`, AWS CLI, common base utilities |
| Not required at runtime | Node.js, npx, bun, jq, Python |

This means you can use Node.js only for setup and still keep `kubectl` working later.

## Commands

```sh
add-eks
add-eks update --context prod --profile prod --yes
add-eks update --current --profile prod --yes
add-eks update --all --profile prod --yes
add-eks update --context prod --profile prod --dry-run

add-eks revert --context prod --yes
add-eks restore --backup ~/.kube/add-eks/backups/config.20260508-120000.yaml --yes

add-eks cache list
add-eks cache status
add-eks cache clear --yes

add-eks stats
add-eks stats --json
add-eks stats clear --yes

add-eks doctor
add-eks completion zsh
```

## Updating Existing Kubeconfigs

Patch one context:

```sh
add-eks update --context prod --profile prod --yes
```

Patch the current kube context:

```sh
add-eks update --current --profile prod --yes
```

Patch every detected EKS context:

```sh
add-eks update --all --profile prod --yes
```

Preview changes:

```sh
add-eks update --context prod --profile prod --dry-run
```

`add-eks` preserves your existing context names, cluster endpoints, certificate authority data, and unrelated kubeconfig fields where possible.

Interactive setup asks only for the AWS identity and EKS contexts to patch, then shows a short plan before writing.

## Backup and Revert

Backups are created by default before kubeconfig writes:

```text
~/.kube/add-eks/backups/
```

Revert one context back to standard AWS CLI exec:

```sh
add-eks revert --context prod --yes
```

Restore an entire kubeconfig backup:

```sh
add-eks restore --backup ~/.kube/add-eks/backups/config.20260508-120000.yaml --yes
```

## Cache Management

```sh
add-eks cache list
add-eks cache status
add-eks cache clear --yes
```

Cache clearing is conservative. It skips files that are not confidently identified as add-eks helper cache entries.

## Saved-Time Stats

```sh
add-eks stats
add-eks stats --json
add-eks stats clear --yes
```

`add-eks` records cache hit/miss totals in a bounded stats file next to the token cache. Misses measure real `aws eks get-token` time. Hits estimate saved time from the measured average, with a conservative fallback until enough data exists.

Human output keeps the numbers clear, then translates the saved time into small real-world units:

```text
Time saved: 4m 12s
Cache hits: 38
AWS token calls avoided: 38
AWS token calls made: 5
Average token call: 6.6s

In other units:
- 1.4 Instant ramen timers
- 1.2 Songs
- 5.6 Loading spinners

kubectl quietly handed you 4m 12s back.
```

Stats storage is bounded. The helper keeps compact totals, caps recent events and cluster buckets, and ignores stats write failures so kubectl keeps working. `add-eks cache status` also shows a short stats pointer when saved-time data exists.

## Shell Completion

```sh
add-eks completion bash
add-eks completion zsh
add-eks completion fish
```

Completion supports:

- commands and flags,
- AWS profiles,
- kube contexts,
- detected EKS contexts,
- common and detected AWS regions,
- best-effort EKS clusters from AWS CLI when profile and region are available.

## Doctor

```sh
add-eks doctor
add-eks doctor --json
```

Doctor checks:

- Node/setup CLI version,
- AWS CLI availability,
- kubectl availability,
- helper installation,
- cache directory,
- saved-time stats file,
- kubeconfig readability.

## Security Notes

- Cache files are written with restrictive permissions.
- Stats files are bounded and written best-effort; stats failures do not fail kubectl.
- Cache identity includes cluster, region, profile or ambient AWS identity material, role ARN, and cluster ARN when available.
- stdout from the helper is reserved for Kubernetes `ExecCredential` JSON; logs go to stderr.
- The helper fails closed on malformed or ambiguous expiration timestamps.

## Troubleshooting

Run:

```sh
add-eks doctor
```

Enable helper debug logs:

```sh
ADD_EKS_DEBUG=1 kubectl get pods
```

If something goes wrong:

```sh
add-eks revert --context <context> --yes
```

or restore a backup from `~/.kube/add-eks/backups/`.

## License

MIT
