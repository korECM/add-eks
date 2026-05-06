#!/bin/sh

debug() {
  if [ "${ADD_EKS_DEBUG:-}" = "1" ]; then
    printf 'add-eks-token: %s\n' "$*" >&2
  fi
}

fatal() {
  printf 'add-eks-token: %s\n' "$*" >&2
  exit 1
}

need_value() {
  opt=$1
  value=${2-}
  if [ "$value" = "" ]; then
    fatal "$opt requires a value"
  fi
  case "$value" in
    --*) fatal "$opt requires a value" ;;
  esac
}

safe_name() {
  printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g'
}

expiration_timestamp() {
  sed -n 's/.*"expirationTimestamp"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p'
}

timestamp_epoch() {
  ts=$1
  normalized=$(printf '%s' "$ts" | sed 's/\.[0-9][0-9]*Z$/Z/')

  case "$normalized" in
    ????-??-??T??:??:??Z) ;;
    *) return 1 ;;
  esac

  epoch=$(date -u -d "$normalized" +%s 2>/dev/null)
  if [ "$epoch" = "" ]; then
    epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$normalized" +%s 2>/dev/null)
  fi

  case "$epoch" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s\n' "$epoch" ;;
  esac
}

cache_key_value() {
  case "$cache_key" in
    cluster)
      printf '%s' "$cluster"
      ;;
    cluster-profile)
      printf '%s__%s' "$cluster" "${profile:-default}"
      ;;
    cluster-region-profile)
      printf '%s__%s__%s' "$cluster" "$region" "${profile:-default}"
      ;;
    arn)
      if [ "${arn:-}" != "" ]; then
        printf '%s' "$arn"
      else
        case "$cluster" in
          arn:*) printf '%s' "$cluster" ;;
          *)
            debug 'cache key arn requested without arn value; using cluster-region-profile'
            printf '%s__%s__%s' "$cluster" "$region" "${profile:-default}"
            ;;
        esac
      fi
      ;;
    *)
      debug "unsupported cache key '$cache_key'; using cluster-region-profile"
      printf '%s__%s__%s' "$cluster" "$region" "${profile:-default}"
      ;;
  esac
}

read_cache_if_fresh() {
  file=$1

  if [ ! -f "$file" ]; then
    debug 'cache miss: cache file not found'
    return 1
  fi

  cached_json=$(cat "$file") || {
    debug 'cache miss: cache file unreadable'
    return 1
  }

  expires=$(printf '%s\n' "$cached_json" | expiration_timestamp)
  if [ "$expires" = "" ]; then
    debug 'cache miss: expirationTimestamp missing'
    return 1
  fi

  expires_epoch=$(timestamp_epoch "$expires")
  if [ "$expires_epoch" = "" ]; then
    debug "cache miss: expirationTimestamp unparseable: $expires"
    return 1
  fi

  now_epoch=$(date -u +%s 2>/dev/null)
  case "$now_epoch" in
    ''|*[!0-9]*)
      debug 'cache miss: current time unavailable'
      return 1
      ;;
  esac

  if [ "$expires_epoch" -le $((now_epoch + safety_margin)) ]; then
    debug 'cache miss: cached token expired or inside safety margin'
    return 1
  fi

  debug 'cache hit'
  printf '%s\n' "$cached_json"
  return 0
}

call_aws() {
  if [ "${profile:-}" != "" ] && [ "${role_arn:-}" != "" ]; then
    aws eks get-token --cluster-name "$cluster" --region "$region" --profile "$profile" --role-arn "$role_arn"
  elif [ "${profile:-}" != "" ]; then
    aws eks get-token --cluster-name "$cluster" --region "$region" --profile "$profile"
  elif [ "${role_arn:-}" != "" ]; then
    aws eks get-token --cluster-name "$cluster" --region "$region" --role-arn "$role_arn"
  else
    aws eks get-token --cluster-name "$cluster" --region "$region"
  fi
}

cluster=
region=
profile=
cache_dir=
safety_margin=60
cache_key=cluster-region-profile
arn=
role_arn=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cluster)
      need_value "$1" "${2-}"
      cluster=$2
      shift 2
      ;;
    --cluster=*)
      cluster=${1#--cluster=}
      shift
      ;;
    --cluster-name)
      need_value "$1" "${2-}"
      cluster=$2
      shift 2
      ;;
    --cluster-name=*)
      cluster=${1#--cluster-name=}
      shift
      ;;
    --region)
      need_value "$1" "${2-}"
      region=$2
      shift 2
      ;;
    --region=*)
      region=${1#--region=}
      shift
      ;;
    --profile)
      need_value "$1" "${2-}"
      profile=$2
      shift 2
      ;;
    --profile=*)
      profile=${1#--profile=}
      shift
      ;;
    --cache-dir)
      need_value "$1" "${2-}"
      cache_dir=$2
      shift 2
      ;;
    --cache-dir=*)
      cache_dir=${1#--cache-dir=}
      shift
      ;;
    --safety-margin)
      need_value "$1" "${2-}"
      safety_margin=$2
      shift 2
      ;;
    --safety-margin=*)
      safety_margin=${1#--safety-margin=}
      shift
      ;;
    --cache-key)
      need_value "$1" "${2-}"
      cache_key=$2
      shift 2
      ;;
    --cache-key=*)
      cache_key=${1#--cache-key=}
      shift
      ;;
    --arn|--cluster-arn)
      need_value "$1" "${2-}"
      arn=$2
      shift 2
      ;;
    --arn=*|--cluster-arn=*)
      arn=${1#*=}
      shift
      ;;
    --role-arn)
      need_value "$1" "${2-}"
      role_arn=$2
      shift 2
      ;;
    --role-arn=*)
      role_arn=${1#--role-arn=}
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      fatal "unknown option: $1"
      ;;
  esac
done

[ "$cluster" != "" ] || fatal 'missing --cluster'
[ "$region" != "" ] || fatal 'missing --region'
[ "$cache_dir" != "" ] || fatal 'missing --cache-dir'

case "$safety_margin" in
  ''|*[!0-9]*) fatal '--safety-margin must be a non-negative integer' ;;
esac

umask 077
mkdir -p "$cache_dir" || fatal "failed to create cache dir: $cache_dir"
chmod 700 "$cache_dir" || fatal "failed to set cache dir mode: $cache_dir"

key_value=$(cache_key_value)
safe_key=$(safe_name "$cache_key")
safe_value=$(safe_name "$key_value")
[ "$safe_value" != "" ] || fatal 'cache key produced an empty filename'
cache_file=$cache_dir/$safe_key-$safe_value.json

if read_cache_if_fresh "$cache_file"; then
  exit 0
fi

debug 'cache miss: invoking aws'
aws_err=$cache_file.$$.aws.err
json=$(call_aws 2>"$aws_err")
aws_status=$?
if [ "$aws_status" -ne 0 ]; then
  if [ -s "$aws_err" ]; then
    cat "$aws_err" >&2
  fi
  rm -f "$aws_err"
  fatal 'aws eks get-token failed'
fi
if [ -s "$aws_err" ]; then
  debug 'aws wrote stderr on success; suppressing because token fetch succeeded'
fi
rm -f "$aws_err"

expires=$(printf '%s\n' "$json" | expiration_timestamp)
if [ "$expires" != "" ]; then
  if ! timestamp_epoch "$expires" >/dev/null; then
    debug "aws response expirationTimestamp unparseable: $expires"
  fi
else
  debug 'aws response missing expirationTimestamp'
fi

tmp_file=$cache_file.$$.tmp
trap 'rm -f "$tmp_file"' HUP INT TERM EXIT
printf '%s\n' "$json" > "$tmp_file" || fatal 'failed to write temporary cache file'
chmod 600 "$tmp_file" || fatal 'failed to set temporary cache file mode'
mv "$tmp_file" "$cache_file" || fatal 'failed to replace cache file'
trap - HUP INT TERM EXIT

printf '%s\n' "$json"
