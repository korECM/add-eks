# add-eks

Friendly EKS kubeconfig setup with cached token support.

`add-eks` patches EKS kubeconfig users to call a small POSIX `sh` token helper. The setup CLI runs with Node.js through `npx` or `bunx`, but kubectl does not depend on Node.js after setup.

## Quick Start

```sh
npx @eatingcookieman/add-eks
```

For non-interactive use:

```sh
npx @eatingcookieman/add-eks update --context prod --profile prod --yes
npx @eatingcookieman/add-eks update --all --profile prod --yes
```

## Why

`kubectl` calls the kubeconfig exec command whenever it needs an EKS token. Repeated `aws eks get-token` calls can add noticeable latency. `add-eks` installs a helper that caches the returned Kubernetes `ExecCredential` until shortly before `expirationTimestamp`.

## Runtime Model

- Setup: Node.js CLI via `npx add-eks` or `bunx add-eks`.
- Runtime: POSIX shell helper installed at `~/.kube/add-eks/add-eks-token`.
- Required at kubectl runtime: `sh`, AWS CLI, and common base utilities.
- Not required at kubectl runtime: Node.js, npx, bun, jq, Python.

## Commands

```sh
add-eks
add-eks update --context prod --profile prod --yes
add-eks revert --context prod --yes
add-eks restore --backup ~/.kube/add-eks/backups/config.20260508-120000.yaml --yes
add-eks cache list
add-eks cache status
add-eks cache clear --yes
add-eks doctor
add-eks completion zsh
```

## Shell Completion

```sh
add-eks completion bash
add-eks completion zsh
add-eks completion fish
```

Completion includes dynamic candidates for AWS profiles, kube contexts, detected EKS contexts, regions, and best-effort EKS clusters.

## Safety

- Kubeconfig writes are backed up by default.
- Writes are atomic where practical.
- `update`, `revert`, `restore`, and `cache clear` require `--yes` for non-interactive changes.
- `--dry-run` is available for patching and cache clearing paths.

## License

MIT
