# add-eks

EKS kubeconfig 등록과 업데이트를 더 편하게 하고, 토큰 캐시까지 지원하는 CLI입니다.

`add-eks`는 EKS kubeconfig의 user exec 설정을 작은 POSIX `sh` helper로 패치합니다. 설정 CLI는 `npx` 또는 `bunx`로 실행하지만, 설정 이후 kubectl 실행 시점에는 Node.js가 필요하지 않습니다.

## 빠른 시작

```sh
npx add-eks
```

비대화식 실행:

```sh
npx add-eks update --context prod --profile prod --yes
npx add-eks update --all --profile prod --yes
```

## 목적

`kubectl`은 EKS 토큰이 필요할 때 kubeconfig의 exec command를 호출합니다. 매번 `aws eks get-token`을 실행하면 지연이 생길 수 있습니다. `add-eks` helper는 Kubernetes `ExecCredential`의 `expirationTimestamp`를 기준으로 토큰을 안전하게 캐시합니다.

## 런타임 구조

- 설정: `npx add-eks` 또는 `bunx add-eks`로 실행하는 Node.js CLI.
- kubectl 런타임: `~/.kube/add-eks/add-eks-token`에 설치되는 POSIX shell helper.
- kubectl 실행 시 필요한 것: `sh`, AWS CLI, 기본 유틸리티.
- kubectl 실행 시 필요 없는 것: Node.js, npx, bun, jq, Python.

## 명령

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

AWS profile, kube context, 감지된 EKS context, region, EKS cluster 후보를 가능한 범위에서 동적으로 자동완성합니다.

## 안전장치

- kubeconfig 수정 전 기본으로 backup을 생성합니다.
- 가능한 경로에서 atomic write를 사용합니다.
- `update`, `revert`, `restore`, `cache clear`는 비대화식 변경 시 `--yes`가 필요합니다.
- patch와 cache clear 경로에는 `--dry-run`을 제공합니다.

## License

MIT
