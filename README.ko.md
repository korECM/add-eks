# add-eks

EKS kubeconfig 등록과 업데이트를 편하게 하고, 빠른 토큰 캐시까지 지원하는 CLI입니다.

`add-eks`는 EKS kubeconfig의 exec 설정을 패치해서 `kubectl`이 매번 `aws eks get-token`을 호출하지 않고 캐시된 EKS 토큰을 재사용할 수 있게 합니다. 설정 도구는 Node.js CLI지만, kubectl 실행 경로는 작은 POSIX `sh` helper라서 설정 후에는 Node.js가 필요하지 않습니다.

## 매력 포인트

- **kubectl 지연 감소**: EKS `ExecCredential` JSON을 `expirationTimestamp` 직전까지 캐시합니다.
- **아낀 시간 통계**: cache hit, 피한 AWS token 호출 수, 되찾은 시간을 다른 단위로 바꾼 재치 있는 통계를 보여줍니다.
- **Node 없는 kubectl 런타임**: helper는 POSIX `sh`와 AWS CLI만 사용합니다. Node.js, npx, bun, jq, Python이 필요 없습니다.
- **대화식/비대화식 모두 지원**: 로컬에서는 친절한 프롬프트로, CI나 스크립트에서는 flag만으로 실행할 수 있습니다.
- **기존 kubeconfig 패치**: kubeconfig를 다시 만들지 않고 현재 EKS context를 업데이트합니다.
- **기본 안전장치**: 쓰기 전 backup, 가능한 atomic write, 비대화식 변경 시 `--yes` 요구.
- **쉬운 복구**: add-eks 설정을 다시 `aws eks get-token` 방식으로 되돌리거나 전체 backup을 복원할 수 있습니다.
- **풍부한 자동완성**: bash, zsh, fish에서 profile, context, region, cluster 후보를 동적으로 제공합니다.

## 빠른 시작

```sh
npx @eatingcookieman/add-eks
```

첫 설정 이후 설치되는 명령 이름은 그대로 `add-eks`입니다.

```sh
add-eks doctor
```

비대화식 실행:

```sh
npx @eatingcookieman/add-eks update --context prod --profile prod --yes
npx @eatingcookieman/add-eks update --current --profile prod --yes
npx @eatingcookieman/add-eks update --all --profile prod --yes
```

## 동작 방식

일반적인 EKS kubeconfig는 다음과 비슷한 exec credential 명령을 사용합니다.

```sh
aws eks get-token --cluster-name prod --region ap-northeast-2
```

이 호출은 kubectl 사용 중 자주 발생할 수 있습니다. `add-eks`는 kubeconfig의 exec command를 아래 helper로 바꿉니다.

```text
~/.kube/add-eks/add-eks-token
```

helper는 토큰 응답을 아래 디렉터리에 저장합니다.

```text
~/.kube/add-eks/cache
```

캐시된 `expirationTimestamp`가 아직 유효하면 캐시된 `ExecCredential` JSON을 출력합니다. 만료됐거나 만료에 가까우면 AWS CLI를 다시 호출하고 캐시를 atomic하게 갱신합니다.

## 런타임 구조

| 단계 | 필요 조건 |
| --- | --- |
| 설정 | `npx @eatingcookieman/add-eks` 또는 `bunx @eatingcookieman/add-eks`를 실행할 Node.js |
| kubectl 런타임 | POSIX `sh`, AWS CLI, 기본 유틸리티 |
| 런타임에 필요 없는 것 | Node.js, npx, bun, jq, Python |

즉 Node.js는 설정할 때만 쓰고, 이후 kubectl은 계속 동작할 수 있습니다.

## 명령

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

## 기존 kubeconfig 업데이트

context 하나만 패치:

```sh
add-eks update --context prod --profile prod --yes
```

현재 kube context 패치:

```sh
add-eks update --current --profile prod --yes
```

감지된 모든 EKS context 패치:

```sh
add-eks update --all --profile prod --yes
```

변경 미리보기:

```sh
add-eks update --context prod --profile prod --dry-run
```

`add-eks`는 가능한 한 기존 context 이름, cluster endpoint, certificate authority data, 관련 없는 kubeconfig 필드를 보존합니다.

interactive 설정은 AWS identity와 패치할 EKS context만 묻고, 쓰기 전 짧은 plan을 보여줍니다.

## Backup과 Revert

kubeconfig를 쓰기 전 기본으로 backup을 만듭니다.

```text
~/.kube/add-eks/backups/
```

context 하나를 표준 AWS CLI exec 방식으로 되돌리기:

```sh
add-eks revert --context prod --yes
```

전체 kubeconfig backup 복원:

```sh
add-eks restore --backup ~/.kube/add-eks/backups/config.20260508-120000.yaml --yes
```

## Cache 관리

```sh
add-eks cache list
add-eks cache status
add-eks cache clear --yes
```

cache clear는 보수적으로 동작합니다. add-eks helper cache entry라고 확실히 판단되는 파일만 삭제하고, 관련 없는 파일은 건너뜁니다.

## 아낀 시간 통계

```sh
add-eks stats
add-eks stats --json
add-eks stats clear --yes
```

`add-eks`는 token cache 옆에 bounded stats file을 두고 cache hit/miss를 기록합니다. miss 때는 실제 `aws eks get-token` 소요 시간을 측정하고, hit 때는 측정된 평균 시간을 기준으로 아낀 시간을 계산합니다. 데이터가 아직 부족하면 보수적인 fallback 값을 사용합니다.

사람용 출력은 실제 숫자를 먼저 보여준 뒤, 되찾은 시간을 작은 현실 단위로 바꿔 보여줍니다.

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

stats 저장소는 무한히 커지지 않습니다. helper는 compact totals를 유지하고 recent event와 cluster bucket 수를 제한합니다. stats 기록 실패는 무시되므로 kubectl 동작을 깨지 않습니다. `add-eks cache status`도 saved-time 데이터가 있으면 짧은 stats pointer를 보여줍니다.

## Shell Completion

```sh
add-eks completion bash
add-eks completion zsh
add-eks completion fish
```

자동완성은 다음 후보를 지원합니다.

- 명령과 flag,
- AWS profile,
- kube context,
- 감지된 EKS context,
- 일반적인 AWS region과 감지된 region,
- profile과 region이 있을 때 AWS CLI 기반 EKS cluster 후보.

## Doctor

```sh
add-eks doctor
add-eks doctor --json
```

Doctor는 다음을 확인합니다.

- Node/setup CLI 버전,
- AWS CLI 사용 가능 여부,
- kubectl 사용 가능 여부,
- helper 설치 상태,
- cache directory 상태,
- saved-time stats file 상태,
- kubeconfig 읽기 가능 여부.

## 보안 메모

- cache file은 제한적인 권한으로 작성합니다.
- stats file은 bounded 방식으로 best-effort 작성됩니다. stats 실패가 kubectl 실패로 이어지지 않습니다.
- cache identity에는 cluster, region, profile 또는 ambient AWS identity 정보, role ARN, 가능한 경우 cluster ARN을 포함합니다.
- helper stdout은 Kubernetes `ExecCredential` JSON 전용입니다. 로그는 stderr로 출력합니다.
- 만료 시간이 애매하거나 잘못된 경우 cache hit로 처리하지 않습니다.

## 문제 해결

먼저 확인:

```sh
add-eks doctor
```

helper debug log:

```sh
ADD_EKS_DEBUG=1 kubectl get pods
```

문제가 생기면:

```sh
add-eks revert --context <context> --yes
```

또는 `~/.kube/add-eks/backups/`의 backup을 복원하세요.

## License

MIT
