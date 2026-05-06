# add-eks CLI Design

Date: 2026-05-06
Status: Approved for implementation planning

## Summary

`add-eks` is a friendly CLI for registering and updating EKS kubeconfig entries with cached token support. It should support both interactive and fully non-interactive usage.

The design separates setup-time convenience from kubectl runtime stability:

- The setup layer is a Node.js CLI distributed through `npx` and `bunx`.
- The runtime layer is a POSIX `sh` helper installed at `~/.kube/add-eks/add-eks-token`.
- Kubeconfig `exec.command` points to the installed helper by absolute path.
- The runtime helper depends on `sh` and the AWS CLI, not Node.js, npx, bun, jq, or Python.

This lets users run `npx add-eks` once, then keep using kubectl even if Node.js is removed.

## Goals

- Make EKS kubeconfig registration easier than manually running and editing AWS CLI output.
- Add token caching to reduce repeated `aws eks get-token` latency.
- Support existing kubeconfig patching before broader refresh behavior.
- Provide a polished interactive flow for local use.
- Provide complete flag-based non-interactive flows for CI and automation.
- Keep the kubectl runtime path small, quiet, and predictable.
- Provide safe backup and revert behavior.
- Start the repository with clear contribution and documentation conventions.

## Non-Goals

- No native binary helper in the initial version.
- No GIF demo in the initial version.
- No required jq, Python, Node.js, npx, or bun dependency at kubectl runtime.
- No default live AWS integration tests in CI.

## Architecture

### Setup Layer

The setup layer is the `add-eks` Node.js CLI. Users run it with:

```sh
npx add-eks
bunx add-eks
```

It is responsible for:

- AWS profile discovery.
- Region selection.
- EKS cluster listing.
- Existing kubeconfig EKS context detection.
- Helper installation and updates.
- Kubeconfig patching.
- Backups and restore metadata.
- Cache management commands.
- Doctor checks.
- Shell completion generation.
- Human-friendly output and `--json` output for automation.

### Runtime Layer

The runtime layer is a generated or bundled POSIX shell helper installed at:

```text
~/.kube/add-eks/add-eks-token
```

Kubeconfig entries use the helper by absolute path:

```yaml
users:
- name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: /Users/me/.kube/add-eks/add-eks-token
      args:
        - --cluster
        - prod
        - --region
        - ap-northeast-2
        - --profile
        - prod
      interactiveMode: Never
```

Runtime rules:

- stdout must contain only Kubernetes `ExecCredential` JSON.
- logs and debug output must go to stderr.
- cache directory permissions should be `700`.
- cache file permissions should be `600`.
- cache writes should use a temporary file followed by atomic `mv`.
- corrupted or ambiguous cache entries should be treated as cache misses.
- `ADD_EKS_DEBUG=1` should explain cache decisions on stderr.

## Commands

```sh
add-eks
add-eks add
add-eks update
add-eks revert
add-eks restore
add-eks cache list
add-eks cache clear
add-eks cache status
add-eks doctor
add-eks completion
```

### Interactive Entry

`add-eks` starts an interactive flow:

1. Select AWS profile.
2. Select or detect region.
3. Choose an action: add new EKS entry, update existing EKS entries, manage cache, or run doctor.
4. For updates, show EKS contexts found in kubeconfig and allow multi-select.
5. Show a patch preview.
6. Create a backup.
7. Install or update the helper.
8. Patch kubeconfig.
9. Offer optional kubectl validation.

### Non-Interactive Examples

```sh
add-eks add --cluster prod --region ap-northeast-2 --profile prod --alias prod --yes

add-eks update --context prod --profile prod --yes

add-eks update --all --profile prod --yes

add-eks cache clear --cluster prod --region ap-northeast-2 --profile prod --yes
```

## Kubeconfig Patching

Patching must use structured YAML parsing and writing. String replacement is not allowed.

EKS context detection priority:

1. A user exec command matching `aws eks get-token`.
2. A user, context, or cluster name matching `arn:aws:eks:...:cluster/...`.
3. A cluster server that appears to be an EKS endpoint.
4. User confirmation in interactive mode when detection is uncertain.

Patch mode is the default for existing kubeconfig updates. It should preserve:

- context names,
- cluster names,
- user names,
- server endpoints,
- certificate authority data,
- current context.

`--refresh` may later run `aws eks update-kubeconfig` before patching, but refresh is not the default behavior.

## Backup, Restore, and Revert

Before patching, backups are enabled by default.

Default backup path:

```text
~/.kube/add-eks/backups/config.20260506-143012.yaml
```

Each backup should have metadata:

```json
{
  "createdAt": "2026-05-06T14:30:12+09:00",
  "kubeconfig": "/Users/me/.kube/config",
  "operation": "update",
  "contexts": ["prod"],
  "helperPath": "/Users/me/.kube/add-eks/add-eks-token"
}
```

Supported backup options:

```sh
--backup
--no-backup
--backup-dir <path>
--backup-suffix <suffix>
```

`add-eks revert --context <name>` should convert an add-eks helper exec entry back to a standard `aws eks get-token` exec entry.

`add-eks restore --backup <path>` should restore the full kubeconfig file from a backup. Because full restore can overwrite unrelated changes, it requires interactive confirmation or `--yes`.

## Customization

Core options:

```sh
--kubeconfig <path>
--profile <name>
--region <region>
--cluster <name>
--context <name>
--alias <name>
--all
--yes
--dry-run
--json
--verbose
--quiet
```

Runtime and cache options:

```sh
--helper-path <path>
--cache-dir <path>
--safety-margin <seconds>
--cache-key <cluster|cluster-profile|cluster-region-profile|arn>
```

AWS token options:

```sh
--role-arn <arn>
--assume-role-arn <arn>
--proxy-url <url>
--endpoint-url <url>
```

Default config file:

```yaml
defaults:
  safetyMargin: 60
  helperPath: ~/.kube/add-eks/add-eks-token
  cacheDir: ~/.kube/add-eks/cache
  backup: true
  cacheKey: cluster-region-profile
```

Expected config path:

```text
~/.config/add-eks/config.yaml
```

## Documentation

Initial docs should include:

- `README.md` in English.
- `README.ko.md` in Korean.
- `CONTRIBUTING.md`.
- `CODE_OF_CONDUCT.md`.

README content:

- install and quick start,
- interactive usage,
- non-interactive examples,
- updating existing kubeconfig entries,
- backup, revert, and restore behavior,
- cache commands,
- security model,
- troubleshooting.

GIF examples are intentionally excluded from the initial scope.

## Testing

Testing should cover three layers:

- Unit tests for option resolution, kubeconfig parsing, patch planning, and EKS context detection.
- Snapshot or fixture tests for before and after kubeconfig YAML.
- Integration tests using a fake `aws` binary placed earlier in PATH to verify helper cache miss and hit behavior.

Live AWS tests should be opt-in only and excluded from default CI.

## Commit Discipline

The project should use small, focused commits. Good initial commit sequence:

1. design document,
2. package scaffold and tooling,
3. kubeconfig parser and patch planner,
4. shell helper and cache behavior,
5. interactive CLI,
6. non-interactive command coverage,
7. docs and contribution guide.
